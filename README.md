# Scriblune

**Work it out, together.** A Next.js study desk with private assignments, editable shared ink, grounded AI tools, rubric review, immutable final versions, and private staff feedback.

The app runs locally at **http://127.0.0.1:3000**. `/demo` is a clearly labeled sandbox with scripted tutoring and local sample drawings. Real sessions use Supabase and the OpenAI Responses API; missing services return setup errors rather than pretend answers.

## Start locally

Use Node 24–26 and npm. Versions are pinned in `package-lock.json`.

```sh
npm ci
cp .env.example .env.local  # Only when .env.local does not already exist.
npm run dev
```

Open `/` for the public experience, `/demo` for the sample workspace, or `/setup` for configuration status. Keep existing credentials when updating `.env.local`.

The supplied Supabase project is now connected locally and its migration, restricted login, private storage, and real tutoring/submission/feedback flow have been verified with synthetic accounts. Both AI settings use `gpt-5.4-2026-03-05`. The local adult pilot is enabled; the example configuration stays closed by default for fresh deployments. Operator credentials are isolated in `.env.operator.local`; never deploy that file.

On a fresh installation, complete [the database and deployment guide](docs/operations.md), then run the separate document worker:

```sh
npm run setup:check -- --live
npm run worker
```

Required server settings: `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `AI_TUTOR_MODEL`, and `AI_REVIEW_MODEL`. The supplied publishable Supabase key is public configuration, not a database or AI credential. Do not prefix secrets with `NEXT_PUBLIC_`.

Models must support image input, Responses function calling, and strict structured output. `gpt-5.4-2026-03-05` passed the included live algebra drawing evaluation. Model access is account-dependent; changing the model requires re-running the evaluation. No production model is silently selected when configuration is blank.

`ALLOW_ADULT_PILOT=false` keeps real session creation closed until the operator has configured verified-email authentication, support contact, retention decisions, and the deployment. The current scope is adults 18+; no guardian-consent workflow is implemented.

## What is implemented

- Server-rendered marketing and nine substantive feature pages; auth dialog, sign-up, verification callback, reset-password flow, and protected desk.
- Private PDF/PNG/JPEG/WebP ingestion, original preservation, progressive page rendering, text-first extraction, optional visual indexing, source regions, document roles, scratch paper, and retryable processing.
- Desktop split workspace/chat; phone page/chat switch; thumbnails, true width fitting, rotation, search, selection crops, references, follow controls, keyboard shortcuts, and local recovery opt-in.
- Editable SVG primitives shared by student, AI, renderer, and export. Pen/pencil/pressure brush, shapes, polygon, arrows, highlights, text/math/sticky notes, safe graphs, mask fill worker, selection/lasso, transforms, groups, locks, history, layers, colors, and line endings.
- Responses streaming, allowlisted tools, actual execution results, progressive drawing animation, cancellation acknowledgments, stale-work rejection, idempotent actions, append-only history, and snapshots.
- Current composite-page and selection context, recent messages, earlier-message retrieval, exact-source summaries, quoted problem ledgers, editable memory pins, and opt-in account preferences.
- Confirmed rubric/checklist and scope, visual review of every scoped page, separate work/scene revisions, server submission gate, immutable final snapshot, assignment PDF and separate recap, and a new-draft continuation.
- Grounded session-specific feedback, acknowledgment-only writes, inaccessible student feedback reads, audited protected staff review, and governed privacy requests.

## Validation

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run test:live  # Explicit paid API evaluation; uses synthetic fixtures only.
```

The default suite is offline. It uses an actual embedded PostgreSQL engine to execute the migration, RLS policies, and application services; it does not prove the remote Supabase configuration. Browser tests cover desktop and phone. The live model test invokes the real tutoring loop, checks circle placement around the fixture’s denominator, and requires editable path and graph objects.

See [acceptance coverage and limitations](docs/acceptance.md). Fixtures and their generator are in `public/fixtures` and `scripts/fixtures.ts`.

## Source map

| Area                                      | Location                                                      |
| ----------------------------------------- | ------------------------------------------------------------- |
| Brand, marketing, public features         | `src/lib/brand.ts`, `src/lib/features.ts`, `src/app/page.tsx` |
| Editing, canonical geometry, graph parser | `src/lib/workspace`, `src/components/workspace-*`             |
| Provider, context, memory, tools, review  | `src/lib/ai`                                                  |
| Ownership, actions, submission, feedback  | `src/lib/server`, `src/app/api`                               |
| PDF/image adapters and isolated worker    | `src/lib/ingestion`, `src/workers`                            |
| Additive schema and access policies       | `supabase/migrations`                                         |
| Setup, fixtures, privacy operations       | `scripts`                                                     |

Read [architecture](docs/architecture.md), [security and privacy](docs/security.md), [operations](docs/operations.md), and [dependency/license notes](docs/dependencies.md) before opening a pilot.

Submission saves a final version **inside Scriblune**. It does not send work to a school or teacher. The app makes no grade, subject-expertise, privacy-certification, or accessibility-certification guarantee.
