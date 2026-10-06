# Practice quizzes

The desk combines tutoring sessions and quizzes by last update. New Quiz accepts
up to three owned sessions plus three PDFs, with twelve source pages total and
10 MB of PDF uploads. Difficulty is relative to those sources; question count is
1–20. Source page images include saved annotations. Recent conversation and a
bounded session summary accompany the images. PDFs are passed once in the same
model request, including scanned PDFs; this path creates no separate OCR calls.
Uploads are held only for generation, not retained in Storage. Quiz source names,
questions, choices, explanations and answers are retained privately.

Generation uses the existing tutor model and one existing tutor credit, disclosed
before creation. This change does not alter subscription prices, Stripe products,
checkout mappings, or credentials. Request fingerprints and a
transactional claim prevent duplicate generation; provider automatic retries are
disabled for this path. Output is bounded to `min(16000, 1500 + 700 * questionCount)`
tokens. Content-free `ai_usage` events use operation `quiz`. Generation failures
return the credit. Interrupted jobs become failed after five minutes when read;
they do not automatically incur another paid request. A new explicit quiz is
needed to try again. Native Next `after` runs the bounded generation after the
creation response; the database status survives navigation and process loss.

Answer saves carry a revision. Stale differing answers from another tab are
rejected, while identical retries are accepted. Local edits made during a save
are sent afterward, and an interrupted draft can recover from session storage.
Questions remain scrollable and choices use native radio controls. Submitting
requires every answer and finishes the attempt. Scoring uses the server-held
answer indices, not a model call or client score. Correct answers and explanations
are returned only after completion. AI-generated question correctness still
requires normal editorial/real-source evaluation; mocked tests establish the
workflow, not educational accuracy.

`private.practice_quizzes` has per-account RLS and no browser/service-role table
access. API routes use the existing verified login/second-factor and same-origin
checks. Account deletion cascades to quizzes; the existing protected privacy
export includes them.

## Release

The quiz schema was already applied. Release `20261004050757729` deployed and verified the approved Plus-and-above entitlement gates on 2026-10-04. Saved attempts remain retained if access changes or code is rolled back. The compact build reused existing image layers and left about 4.2 GiB free without deleting any prior image or data volume. No live AI generation or billing changes were performed during verification.

## Verification

`tests/integration/quizzes.test.ts` uses local PostgreSQL-compatible PGlite and real
migrations to cover isolation, scoring, persistence, conflicting edits, duplicates,
refunds, and expiration. `tests/unit/quiz.test.ts` exercises PDF bounds and a mocked
provider to verify one request, the existing model, and output/retry controls.
No paid AI calls are needed for these tests.

## Plus and above entitlement (active)

Practice quizzes require the effective Plus, Focus, or Flexible plan. An active
Owner grant of one of those plans qualifies. Free bonus credits do not unlock
quizzes. The existing entitlement calculation controls plan priority, paid-period
expiry, cancellation at period end, and expired grants; display labels and client
claims cannot grant access.

The server checks eligibility before upload/PDF parsing and rechecks in the
creation transaction. Generation claims, reads, answer saves, and submission also
check the authoritative plan. A downgrade before the generation claim refunds the
unstarted request exactly once without calling AI. Work already claimed may
finish; the result remains stored but cannot be read on Free. Saved quiz titles
and metadata remain listed, with answers/results withheld. Downgrading never
deletes questions, answers, or results; they unlock when an eligible plan returns.

The Desk, creation dialog and plan comparison advertise Plus and above. The quiz
room replaces a denied form with an upgrade notice, stops repeated denied
requests, preserves an unsaved local draft, and offers an explicit access recheck.
The Desk does not poll generating quizzes while they are plan-locked.

Validation uses synthetic database/provider responses and desktop/phone browser
fixtures; it covers all three eligible plans, Free with bonus credits, gate timing,
paid expiry, grant priority, preserved downgrade data, in-flight generation,
access recovery and the existing revision/idempotency rules. No live AI, Stripe,
email, or account-plan mutations are part of these checks.
