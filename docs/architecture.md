# Architecture

## Trust and persistence

The browser is an untrusted editor. Every API route independently validates Supabase `getUser()`, verified email, request body, and session ownership. Mutations check same-origin. The server uses a dedicated Postgres login that can `SET LOCAL ROLE scriblune_server`; `app.account_id` is set only inside its transaction. Browser credentials never receive model, database, or privileged storage keys.

Authoritative state lives in PostgreSQL. Actions lock the session, check per-object revisions, validate page bounds and authorship, update the object, append an immutable event, and advance revisions atomically. Action IDs deduplicate retries. The model and browser cannot choose their actor, account, authoritative sequence, or eligibility. A snapshot is recorded every 50 scene actions.

`scene_revision` advances for visual operations. `work_revision` advances for changes to student answer geometry/style or assessment inputs. Tutor teaching ink does not raise work revision. Rubrics have their own immutable revision. Any material work or rubric change makes the prior review ineligible.

No Realtime channels are published. Authenticated HTTP polling reads durable state and SSE streams one authorized tutoring turn. This is a deliberate alternative to Supabase Realtime, not an unsecured UUID channel. A dropped stream does not erase the operation log. Student-originated broadcasts cannot impersonate authoritative events.

## Coordinates and editing

Original dimensions are retained. Normalized page width is 1000 canonical units; height preserves aspect ratio. Source text boxes, OCR regions, annotations, crops, and graph coordinates use this top-left space. PDF.js applies PDF transforms during extraction; sharp normalizes image orientation. Viewport fitting, zoom, and quarter-turn rotation are view transforms. Pointer positions are mapped back through the inverse transform before creating an action. Export uses canonical geometry directly.

SVG is the editable engine. Objects remain individual, selectable data, not flattened screenshots. `workspace/types.ts` defines strict schemas and `workspace/svg.ts` is also used by server rendering and export. Curves are accurate sampled polylines. Graphs use a constrained arithmetic parser, never `eval`. Raster flood fill runs in a Web Worker and creates bounded scanline masks on a separate layer; it never overwrites the original.

Tutor actions carry action/turn/group/page/object IDs, base scene/object revisions, operation, geometry, style, animation duration, authoritative sequence, and before/after values. Only complete model function calls reach the executor. Student content changes during an AI turn reject later tutor writes. Students can edit tutor objects; tutors cannot erase or replace student work. Undo preserves authorship and rejects groups that would overwrite intervening edits.

The client acknowledges displayed tutor actions. Cancellation rolls back the unseen suffix of each tutor object’s history, retains displayed marks, and preserves intervening student edits. Compensating operations remain in the append-only log. Replay animates current marks from the last explanation without writing old state back to the server.

## Ingestion and AI

The upload route validates owner, role, consent, signature, and size before registering a job. Originals and page renders are stored in `scriblune-private`. File downloads and page images pass through authenticated ownership-checked routes. Heavy rendering runs in a separate child process with a memory ceiling and timeout, leased from Postgres with `FOR UPDATE SKIP LOCKED`. First-page availability does not wait for the rest of the PDF or model indexing.

The adapter interface in `ingestion/adapters.ts` yields canonical pages with image data, geometry, extracted text, and source boxes. Add a format only after implementing and testing this interface. PDF.js extracts text first. Pages without enough text receive a separate optional vision-indexing job, with source boxes and uncertainty labels. All pages remain viewable without AI. No HEIC/TIFF/Office/SVG/video support is advertised.

Each tutor turn includes current revisions, page/annotation identities, selected IDs/crop, the current original-plus-ink image, recent conversation, exact-source summary, relevant older messages, active learning memories, enabled account preferences, source regions, and rubric context. The full document index distinguishes indexed content from images actually inspected in this turn. Retrieval is lexical and bounded, not a vector database. Problem-ledger entries must cite exact quotes from known messages; demonstrated-understanding evidence must come from student messages. Summary or ledger failure cannot delete the transcript.

`provider.ts` isolates Responses-specific calls. `tools.ts` defines every allowlisted tool and schema. Tool execution results are returned to the model. There is no model-accessible arbitrary code, shell, network, database query, or review-approval tool. Document instructions are untrusted input.

## Review, final versions, and feedback

The student confirms rubric criteria and up to 30 scoped pages. Uploaded rubric extraction proposes candidates and ambiguities; it does not confirm them. Without a rubric, the UI explicitly labels the checklist provisional. All required criteria must be met; no arbitrary percentage threshold is invented.

Review renders every selected page with student work and no tutor teaching overlays. Evidence references must belong to the agreed scope. Original content counts as student evidence only for documents explicitly classified as student work; mixed/unclear content remains uncertain. The server derives readiness. Submission rechecks owner, review, rubric/work revisions, evidence, scope, completed processing, and inactive tutor turn under a session lock, then saves one immutable snapshot.

Exports can be retried independently of submission. PDF generation is currently bounded, sequential server work (30 pages), not a durable background export queue. Continue creates a separate draft from the submitted scope; it does not carry over approval or private feedback.

Feedback questions use deterministic neutral templates attached to actual events, not invented model anecdotes. Exact wording/options/answers/version are stored privately. The public question set contains no answers. Neither tutor retrieval nor ordinary exports queries private feedback. Staff triage is audited and does not automatically change model behavior.
