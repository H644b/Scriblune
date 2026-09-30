import { randomUUID } from "node:crypto";
import { accountTx, db, ownedSession } from "../lib/server/db";
import { getFile, storeFile, storage } from "../lib/server/storage";
import { adapterFor } from "../lib/ingestion/adapters";
import { validateFile } from "../lib/ingestion/validation";
import { visualIndex } from "../lib/ai/indexing";
import { setupState } from "../lib/server/config";
const [jobId, accountId] = process.argv.slice(2);
async function run() {
  const job = await accountTx(accountId, async (tx) => {
    const j = (
      await tx`select * from public.processing_jobs where id=${jobId} and account_id=${accountId}`
    )[0];
    if (!j) throw new Error("Job not found.");
    await ownedSession(tx, j.session_id, { draft: true });
    const d = (
      await tx`select * from public.documents where id=${j.document_id} and session_id=${j.session_id}`
    )[0];
    if (j.kind === "ingest")
      await tx`update public.documents set status='processing',error=null where id=${d.id}`;
    return {
      id: j.id,
      session_id: j.session_id,
      kind: j.kind,
      page_id: j.page_id,
      doc: d,
    };
  });
  if (job.kind === "index") {
    const page = await accountTx(
      accountId,
      async (tx) =>
        (
          await tx`select * from public.document_pages where id=${job.page_id} and session_id=${job.session_id}`
        )[0],
    );
    const indexed = await visualIndex(
      await getFile(page.render_path),
      page.width,
      page.height,
    );
    if (indexed)
      await accountTx(accountId, async (tx) => {
        await tx`update public.document_pages set text_content=${indexed.text},source_regions=${tx.json(indexed.regions)} where id=${page.id}`;
        for (const p of indexed.problems)
          await tx`insert into public.problem_regions(session_id,page_id,label,content,region,source,confidence) values(${job.session_id},${page.id},${p.label},${p.content},${tx.json(p.region)},'visual',${p.confidence})`;
      });
    await accountTx(accountId, async (tx) => {
      await tx`update public.processing_jobs set status='complete',progress=100,locked_until=null where id=${jobId}`;
    });
    return;
  }
  const bytes = await getFile(job.doc.storage_path);
  validateFile(bytes, job.doc.mime);
  let count = 0;
  for await (const p of adapterFor(job.doc.mime).pages(bytes)) {
    const existing = await accountTx(
      accountId,
      async (tx) =>
        (
          await tx`select id from public.document_pages where document_id=${job.doc.id} and page_number=${p.number}`
        )[0],
    );
    if (existing) {
      count++;
      continue;
    }
    const pageId = randomUUID(),
      path = `${accountId}/${job.session_id}/${job.doc.id}/page-${p.number}-${pageId}.png`;
    await storeFile(path, p.png, "image/png");
    try {
      await accountTx(accountId, async (tx) => {
        await ownedSession(tx, job.session_id, { lock: true, draft: true });
        await tx`insert into public.document_pages(id,session_id,document_id,page_number,width,height,original_width,original_height,render_path,text_content,source_regions,extraction_method) values(${pageId},${job.session_id},${job.doc.id},${p.number},${p.width},${p.height},${p.originalWidth},${p.originalHeight},${path},${p.text},${tx.json(p.regions)},${p.method})`;
        await tx`update public.tutoring_sessions set active_page_id=coalesce(active_page_id,${pageId}),work_revision=work_revision+1 where id=${job.session_id}`;
        await tx`update public.processing_jobs set progress=${Math.min(90, p.number * 3)},locked_until=now()+interval '4 minutes' where id=${jobId}`;
        await tx`update public.documents set page_count=${p.number} where id=${job.doc.id}`;
      });
    } catch (e) {
      await storage().remove([path]);
      throw e;
    }
    const problems = p.regions
      .filter((r) => /^\s*\d+[.)]\s/.test(r.text))
      .map((r, i) => ({
        label: r.text.match(/^\s*\d+/)?.[0] || String(i + 1),
        content: r.text,
        region: r.region,
        confidence: "unconfirmed",
      }));
    await accountTx(accountId, async (tx) => {
      for (const problem of problems.slice(0, 80))
        await tx`insert into public.problem_regions(session_id,page_id,label,content,region,source,confidence) values(${job.session_id},${pageId},${problem.label},${problem.content},${tx.json(problem.region)},'text',${problem.confidence})`;
      if (p.method === "visual" && setupState().tutor)
        await tx`insert into public.processing_jobs(session_id,account_id,document_id,page_id,kind) values(${job.session_id},${accountId},${job.doc.id},${pageId},'index') on conflict do nothing`;
    });
    count++;
  }
  await accountTx(accountId, async (tx) => {
    await tx`update public.documents set status='ready',page_count=${count} where id=${job.doc.id}`;
    await tx`update public.processing_jobs set status='complete',progress=100,locked_until=null where id=${jobId}`;
  });
}
run()
  .catch(async (error) => {
    const safe = [
      "password protected",
      "up to 30",
      "could not be read",
      "unsupported",
      "Animated",
      "contents do not match",
    ].some((s) => String(error.message).includes(s))
      ? String(error.message).slice(0, 250)
      : "Processing stopped. The original is preserved. Retry processing or upload a clearer copy.";
    await accountTx(accountId, async (tx) => {
      const j = (
        await tx`update public.processing_jobs set status='failed',error=${safe},locked_until=null where id=${jobId} and account_id=${accountId} returning document_id,kind`
      )[0];
      if (j?.kind === "ingest")
        await tx`update public.documents set status='failed',error=${safe} where id=${j.document_id}`;
    }).catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    await db().end();
  });
