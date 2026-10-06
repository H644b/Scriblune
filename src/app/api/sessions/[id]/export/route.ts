import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { renderPage } from "@/lib/server/render";
import { privateHeaders, failure, AppError } from "@/lib/server/errors";
import type { Annotation, DocumentPage } from "@/lib/workspace/types";
export const maxDuration = 180;
export const runtime = "nodejs";
export async function GET(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const u = await requireUser(),
      id = z.uuid().parse((await c.params).id),
      params = new URL(request.url).searchParams;
    const snapshot = await accountTx(u.id, async (tx) => {
      const s = await ownedSession(tx, id);
      if (s.status === "submitted") {
        const submission = (
          await tx`select snapshot from public.submissions where session_id=${id}`
        )[0];
        if (submission) return submission.snapshot;
        const test = (
          await tx`select snapshot from private.test_completions where session_id=${id}`
        )[0];
        if (test) return test.snapshot;
        throw new AppError(409, "The saved completion was not found.");
      }
      return {
        title: s.title,
        pages:
          await tx`select * from public.document_pages where session_id=${id} order by created_at,page_number`,
        objects: (
          await tx`select object from public.annotation_objects where session_id=${id} and not deleted`
        ).map((o) => o.object),
        messages:
          await tx`select role,content,created_at from public.messages where session_id=${id} order by created_at`,
        review: null,
      };
    });
    if (params.get("format") === "recap") {
      const text = `# ${snapshot.title}\n\nSaved with Scriblune. This is a learning recap, not independent student work.\n\n${snapshot.messages.map((m: any) => `## ${m.role === "student" ? "You" : "Scriblune AI Tutor"}\n\n${m.content}`).join("\n\n")}\n\nPrivate feedback is not included. Submission saves inside Scriblune; nothing is sent to a teacher.`;
      return new Response(text, {
        headers: {
          ...privateHeaders,
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="scriblune-learning-recap.md"',
        },
      });
    }
    if (snapshot.pages.length > 30)
      throw new AppError(422, "Export up to 30 pages at a time.");
    const pdf = await PDFDocument.create();
    pdf.setTitle(snapshot.title);
    pdf.setCreator("Scriblune");
    if (snapshot.is_test)
      pdf.setSubject("Test completion — no grading approval");
    for (const page of snapshot.pages as DocumentPage[]) {
      const objects = (snapshot.objects as Annotation[])
        .filter(
          (o) =>
            o.page_id === page.id &&
            (o.actor === "student" ||
              (params.get("tutor") === "1" && o.actor === "tutor")),
        )
        .map((o) => ({ ...o, visible: true }));
      const image = await pdf.embedPng(await renderPage(page, objects));
      const output = pdf.addPage([page.width * 0.612, page.height * 0.612]);
      output.drawImage(image, {
        x: 0,
        y: 0,
        width: page.width * 0.612,
        height: page.height * 0.612,
      });
    }
    return new Response(new Uint8Array(await pdf.save()), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition":
          'attachment; filename="scriblune-assignment.pdf"',
      },
    });
  } catch (e) {
    return failure(e);
  }
}
