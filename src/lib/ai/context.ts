import type OpenAI from "openai";
import { getWorkspace } from "../server/workspace";
import { accountTx } from "../server/db";
import { renderPage } from "../server/render";
import { intersects, bounds } from "../workspace/geometry";
import type { Region } from "../workspace/types";
export async function assembleContext(
  accountId: string,
  sessionId: string,
  pageId: string,
  message: string,
  selection: Region | null,
  selectionIds: string[],
) {
  const w = await getWorkspace(accountId, sessionId);
  const page = w.pages.find((p) => p.id === pageId);
  if (!page) throw new Error("Choose a page to discuss.");
  if (
    selection &&
    (selection.x + selection.width > page.width ||
      selection.y + selection.height > page.height)
  )
    throw new Error("Selection outside the page.");
  const objects = w.objects.filter((o) => o.page_id === pageId);
  if (selectionIds.some((id) => !objects.some((o) => o.id === id)))
    throw new Error("Unknown selected annotation.");
  const terms = message
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 3);
  const old = w.messages
    .slice(0, -20)
    .map((m) => ({
      m,
      score: terms.filter((t) => m.content.toLowerCase().includes(t)).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.m);
  const preferences = await accountTx(
    accountId,
    async (tx) =>
      tx`select content from public.learning_preferences where account_id=${accountId} and active and exists(select 1 from public.profiles where id=${accountId} and preferences_enabled)`,
  );
  const visual = await renderPage(page as any, objects);
  const input: OpenAI.Responses.ResponseInput = [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            kind: "untrusted_workspace_context",
            scene_revision: w.session.scene_revision,
            work_revision: w.session.work_revision,
            active_page: { ...page, render_path: undefined },
            documents: w.documents,
            all_pages_index: w.pages.map((p) => ({
              id: p.id,
              document_id: p.document_id,
              page_number: p.page_number,
              text: p.text_content,
              visually_inspected_in_this_turn: p.id === pageId,
            })),
            problems: w.problems,
            student_selection: selection,
            selected_annotation_ids: selectionIds,
            annotations: objects,
            recent_changes: w.events.slice(-15),
            durable_memory: w.memories.filter((m) => m.active),
            session_summary: w.session.summary,
            account_preferences: preferences,
            earlier_relevant_messages: old,
            rubric: w.rubric,
          }),
        },
        {
          type: "input_image",
          image_url: `data:image/png;base64,${visual.toString("base64")}`,
          detail: "high",
        },
      ],
    },
  ];
  if (selection) {
    const crop = await renderPage(page as any, objects, selection);
    (input[0] as any).content.push(
      {
        type: "input_text",
        text: `Selection crop. Origin in canonical page: (${selection.x}, ${selection.y}); width ${selection.width}, height ${selection.height}.`,
      },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${crop.toString("base64")}`,
        detail: "high",
      },
    );
  }
  for (const m of w.messages.slice(-20))
    input.push({
      role: m.role === "student" ? "user" : "assistant",
      content: m.content,
    });
  return { input, workspace: w };
}
export async function updateMemory(accountId: string, sessionId: string) {
  await accountTx(accountId, async (tx) => {
    const messages =
      await tx`select id,role,content from public.messages where session_id=${sessionId} and status='complete' order by created_at desc limit 30`;
    const facts = messages
      .filter((m) => m.role === "student")
      .slice(0, 10)
      .map((m) => ({
        source_id: m.id,
        kind: "student_statement",
        quote: m.content.slice(0, 1500),
      }));
    await tx`update public.tutoring_sessions set summary=${tx.json({ version: 1, method: "exact_student_excerpts", facts, sources: messages.map((m) => m.id) })} where id=${sessionId}`;
    for (const m of messages
      .filter(
        (m) =>
          m.role === "student" &&
          /\b(i prefer|please use|shorter steps|visual explanation|don.t give me the answer)\b/i.test(
            m.content,
          ),
      )
      .slice(0, 3)) {
      const existing =
        await tx`select id from public.learning_memories where session_id=${sessionId} and ${m.id}::uuid=any(source_ids)`;
      if (!existing.length)
        await tx`insert into public.learning_memories(session_id,kind,content,source_ids) values(${sessionId},'preference',${tx.json({ text: m.content.slice(0, 500), basis: "stated", quote: m.content.slice(0, 500) })},${[m.id]})`;
    }
  });
}
