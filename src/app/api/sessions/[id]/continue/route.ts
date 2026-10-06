import { captureFreeTier } from "@/lib/server/free-tier-guard";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { reserveUsage } from "@/lib/server/usage";
import { requirePermission } from "@/lib/server/admin";
import { sameOrigin, json, failure, AppError } from "@/lib/server/errors";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  const copied: string[] = [];
  try {
    sameOrigin(request);
    const u = await requireUser(),
      id = z.uuid().parse((await c.params).id);
    await captureFreeTier(u.id);
    const snapshot = await accountTx(u.id, async (tx) => {
      const s = await ownedSession(tx, id);
      if (s.status !== "submitted")
        throw new AppError(409, "Continue your existing draft.");
      const submission = (
        await tx`select snapshot from public.submissions where session_id=${id}`
      )[0];
      if (submission) return { ...submission.snapshot, is_test: s.is_test };
      const test = (
        await tx`select snapshot from private.test_completions where session_id=${id}`
      )[0];
      if (test) return test.snapshot;
      throw new AppError(409, "Saved completion not found.");
    });
    const nextId = randomUUID(),
      docMap = new Map<string, string>(),
      pageMap = new Map<string, string>();
    for (const d of snapshot.documents) {
      docMap.set(d.id, randomUUID());
      if (d.role !== "scratch") {
        const destination = `${u.id}/${nextId}/${docMap.get(d.id)}/original`;
        const { error } = await storage().copy(d.storage_path, destination);
        if (error)
          throw new AppError(
            503,
            "Could not copy the assignment. Your submitted version is safe.",
          );
        copied.push(destination);
      }
    }
    for (const p of snapshot.pages) {
      pageMap.set(p.id, randomUUID());
      if (p.render_path) {
        const path = `${u.id}/${nextId}/${docMap.get(p.document_id)}/page-${pageMap.get(p.id)}.png`;
        const { error } = await storage().copy(p.render_path, path);
        if (error)
          throw new AppError(
            503,
            "Could not copy a page. Your submitted version is safe.",
          );
        copied.push(path);
      }
    }
    await accountTx(u.id, async (tx) => {
      if (snapshot.is_test) await requirePermission(tx, u.id, "testing.tools");
      else await reserveUsage(tx, u.id, "session", nextId);
      await tx`insert into public.tutoring_sessions(id,account_id,title,is_test) values(${nextId},${u.id},${`${snapshot.title.slice(0, 145)} · new draft`},${!!snapshot.is_test})`;
      for (const d of snapshot.documents)
        await tx`insert into public.documents(id,session_id,name,role,mime,storage_path,byte_size,status,page_count) values(${docMap.get(d.id)!},${nextId},${d.name},${d.role},${d.mime},${`${u.id}/${nextId}/${docMap.get(d.id)}/${d.role === "scratch" ? "scratch" : "original"}`},${d.byte_size},'ready',${snapshot.pages.filter((p: any) => p.document_id === d.id).length})`;
      for (const p of snapshot.pages)
        await tx`insert into public.document_pages(id,session_id,document_id,page_number,width,height,original_width,original_height,render_path,text_content,source_regions,extraction_method) values(${pageMap.get(p.id)!},${nextId},${docMap.get(p.document_id)!},${p.page_number},${p.width},${p.height},${p.original_width},${p.original_height},${p.render_path ? `${u.id}/${nextId}/${docMap.get(p.document_id)}/page-${pageMap.get(p.id)}.png` : null},${p.text_content},${tx.json(p.source_regions)},${p.extraction_method})`;
      for (const o of snapshot.objects) {
        if (!pageMap.has(o.page_id)) continue;
        const newId = randomUUID(),
          group = randomUUID(),
          obj = {
            ...o,
            id: newId,
            page_id: pageMap.get(o.page_id),
            revision: 0,
            action_group_id: group,
            group: null,
          };
        await tx`insert into public.annotation_objects(id,session_id,page_id,actor,action_group_id,revision,object) values(${newId},${nextId},${obj.page_id!},${o.actor},${group},0,${tx.json(obj)})`;
      }
      await tx`update public.tutoring_sessions set active_page_id=${pageMap.get(snapshot.pages[0]?.id) || null} where id=${nextId}`;
    });
    return json({ id: nextId });
  } catch (e) {
    if (copied.length)
      await storage()
        .remove(copied)
        .catch(() => {});
    return failure(e);
  }
}
