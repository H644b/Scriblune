# Annotation saving and clipboard export

Drawing updates the local scene immediately. Annotation POSTs begin after about
900 ms without pointer/keyboard activity; a held drawing pointer suppresses the
idle save. The small sync indicator sits beside the assignment workspace and
allows an explicit Save now / Retry.

The queue sends at most 100 independent-object actions and 3.8 MB per request.
Edits to the same object wait for the preceding acknowledgement so their exact
server object revisions can be used. Later local edits and deletions stay visible
while older saves finish. Refreshes and tutor completion overlay pending local
work, and older refresh responses cannot replace more recently acknowledged ink.

Network failures retry with the same action IDs and wire payload, with bounded
backoff (five automatic attempts total). Conflicts and other permanent failures
retain the local ink and require an explicit retry; they are not silently rebased
onto another writer's changes. Copy/download remains available for retained ink.
Tutor sends, review/rubric actions, submission, PDF export, undo, test completion,
and intercepted internal navigation wait for the pending save barrier. Drawing
can continue during a save; the barrier joins any in-flight request.

On backgrounding/leaving, the queue attempts a best-effort flush; requests below
60 KB use fetch keepalive. A dirty tab prompts before closing. The existing
**optional** per-tab browser recovery setting journals pending IDs, wire inputs,
and local revisions. Saved work clears that journal. Invalid recovery data is
retained instead of overwritten. Browser crashes and large unload requests cannot
be guaranteed to finish, so the tab should stay open until the indicator says Saved.

## Clipboard

- **Copy selected ink as image** / Ctrl-C or Cmd-C on selected ink creates a
  transparent cropped PNG. Download PNG is available if clipboard permission is
  denied. Page export includes only visible layers and includes tutor ink only
  when explicitly selected. Document pixels, account IDs, and private feedback
  are not included. PNG allocation is capped at 4096 px per side / 16 million pixels.
- **Copy selected drawings for Kami** and **Copy drawings for Kami** write a
  `text/plain` JSON envelope with `kamiAnnotationsCopy: true` and separate
  `Drawing` entries. The structure comes from the owner's supplied spiral sample
  in owner request `472cbe75-d838-419c-8506-37103e3c5974`, message 4 (2026-10-01).
  Paths, pressure segments, shapes, arrowheads, color, opacity, relative placement,
  and rotation are represented as SVG polylines. Coordinates use original page
  width rather than the current screen zoom. No external markup is parsed or
  executed. Internal object/account identifiers are omitted.
- Native Kami export rejects mixed selections containing text, math, sticky notes,
  or bucket fills with an explanation to use image copy; it never silently drops
  them. The JSON payload is capped at 4 MB, with bounded object/point counts.
- The generated format has local structural and browser tests. Actual paste and
  editability in the owner's Kami session remain unverified; this is a compatibility
  option, not a supported Kami API contract. PNG fallback is flattened.

Kami's [Select tool guide](https://help.kamiapp.com/kami-help-center/select-tool)
documents copying annotations within Kami. Its
[Add Media guide](https://help.kamiapp.com/kami-help-center/add-media-tool)
documents importing images through My Computer and requires a paid Kami plan for
that tool. No Kami account, document, plan, or permission is changed by Scriblune.

## Verification and request impact

Queue tests exercise idle coalescing, held pointers, delayed acknowledgements,
server revision mapping, joining in-flight saves, ambiguous response retries,
conflict retention, bounded retry, deletions, batch size, recovery, and stale
refreshes. Clipboard tests cover dimensions, the supplied Kami envelope, multiple
objects, rotation, pressure/arrow geometry, unsupported content, and input bounds.
Browser checks exercise image copy, denial/download, continuous drawing, tutor
barriers, and desktop/mobile layout using synthetic local data.

A controlled test submits three independent strokes in one POST after idle,
versus the previous immediate POST per stroke. Actual reduction depends on drawing
cadence and object dependencies. These changes do not alter model selection,
context retention, model output budgets, paid plans, or essential tutor features.
