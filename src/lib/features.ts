export const features = [
  {
    slug: "bring-your-page",
    name: "Bring Your Page",
    eyebrow: "START WITH WHAT’S IN FRONT OF YOU",
    headline: "Your actual assignment.\nA fresh place to begin.",
    lead: "A worksheet, a screenshot, a photo of your working. Open it on a shared page without attaching it to every message.",
    sections: [
      [
        "One upload, a connected conversation",
        "PDF, PNG, JPEG, and still WebP images open in the workspace after sign-in and processing consent. PDF text is extracted first. Scans and images use visual analysis when the AI provider is configured. Unclear symbols remain uncertain.",
      ],
      [
        "Tell us what you brought",
        "Mark a document as assignment instructions, your work, a rubric, a reference, or mixed content. That distinction helps the tutor avoid treating printed instructions—or its own examples—as your independent answers.",
      ],
      [
        "Room for more than one page",
        "Add another document without resetting the conversation. PDFs support up to 30 pages and files up to 20 MB. HEIC, TIFF, SVG, Office files, animations, and video are not currently supported.",
      ],
    ],
    example:
      "A photo of your handwritten attempt can sit alongside the original worksheet. The tutor can refer to both while helping you decide what to try next.",
  },
  {
    slug: "shared-ink",
    name: "Shared Ink",
    eyebrow: "TWO MINDS. ONE PAGE.",
    headline: "When words need\na little ink.",
    lead: "A circle around the confusing term. An arrow connecting a thought. A graph that makes the pattern visible.",
    sections: [
      [
        "A real drawing, not a picture of one",
        "The student and tutor use the same editable objects: paths, shapes, arrows, labels, highlights, and constrained function plots. Tutor actions are validated and saved before they appear. Marks remain attached to the page when you zoom or rotate it.",
      ],
      [
        "Keep your own thinking clear",
        "Student work, tutor teaching ink, and grading feedback are separate layers. Hide teaching annotations, select and move a mark, or undo an explanation without replacing the original file. The tutor cannot erase student work.",
      ],
      [
        "At a pace you can follow",
        "Validated marks animate in sequence. Pause, speed up, or stop the explanation. A durable action log supports recovery and replay. The student controls whether the page follows the tutor’s focus.",
      ],
    ],
    example:
      "On a fraction problem, the tutor can draw an editable circle around the denominator, then explain what that particular number means.",
  },
  {
    slug: "point-and-ask",
    name: "Point & Ask",
    eyebrow: "THIS PART. RIGHT HERE.",
    headline: "Less describing.\nMore understanding.",
    lead: "Select a sentence, a diagram, a handwritten line, or one of your own circles. Your question travels with the part you mean.",
    sections: [
      [
        "A question with a place on the page",
        "Point & Ask sends the selected canonical region, selected annotation IDs, and a current composite crop to the tutor. Your later ink is included, so the conversation can follow your attempt.",
      ],
      [
        "A closer look when it matters",
        "The tutor can inspect a region or retrieve another indexed page. Being indexed is different from having been visually inspected in the current turn. When two regions are plausible, the tutor should ask which one you mean.",
      ],
      [
        "Keep uncertainty visible",
        "Handwriting and diagrams can be ambiguous. The tutor should ask for a clearer view or confirmation rather than silently choosing a symbol. You can upload a clearer image as an additional document.",
      ],
    ],
    example:
      "Circle the second line of your attempt, then ask why it works. The selected circle and the work beneath it become part of the next turn.",
  },
  {
    slug: "hint-ladder",
    name: "Hint Ladder",
    eyebrow: "JUST ENOUGH TO KEEP GOING",
    headline: "A nudge can be\nenough.",
    lead: "You get to decide how much help you want. Ask for a small hint, a strategy, a guided step, or a full explanation.",
    sections: [
      [
        "Start with the next useful step",
        "Ask the tutor to break down the goal and identify relevant information. A small hint should help you act without withholding the point or giving away every step.",
      ],
      [
        "Make your boundary explicit",
        "“Don’t give me the answer yet” becomes part of the conversation and can be pinned as a preference. Ask to try the next step yourself, then return for a check.",
      ],
      [
        "Worked examples when appropriate",
        "A full explanation can be useful when you ask for one. For an assessment explicitly restricted from outside help, the tutor should teach concepts or analogous practice rather than complete the restricted task.",
      ],
    ],
    example:
      "Try “Give me a small hint” before “Show me the next step.” If the algebra still feels abstract, ask for an analogous worked example.",
  },
  {
    slug: "strategy-switch",
    name: "Strategy Switch",
    eyebrow: "ANOTHER WAY IN",
    headline: "If it doesn’t click,\nchange the approach.",
    lead: "Sometimes a smaller step helps. Sometimes a picture does. The first explanation doesn’t have to be the last.",
    sections: [
      [
        "Name what isn’t helping",
        "Tell the tutor whether you need simpler language, a visual, an analogy, or a different mathematical method. The recent conversation and your memory pins stay in context.",
      ],
      [
        "Connect methods to the same problem",
        "The workspace gives both approaches a common point of reference. Keep your first attempt visible while trying a second method, or use scratch paper to compare them.",
      ],
      [
        "No promise of a perfect explanation",
        "AI reasoning can be mistaken. A different explanation should be checked against the assignment and your own understanding. If a step seems wrong, challenge it directly.",
      ],
    ],
    example:
      "After trying substitution, ask for an elimination approach. Pin the methods you tried so you can return to them after a long conversation.",
  },
  {
    slug: "memory-pins",
    name: "Memory Pins",
    eyebrow: "KEEP THE THREAD",
    headline: "The important things,\nwithin reach.",
    lead: "A goal, a preferred pace, a method you’ve already tried. Keep the useful context close, and change it when your thinking changes.",
    sections: [
      [
        "Memory you can inspect",
        "Session pins can be added, edited, and deleted. Exact conversation records and supporting event IDs remain separate from compact summaries, so equations and assignment wording are not replaced by a paraphrase.",
      ],
      [
        "Recent and relevant",
        "The tutor receives recent messages, relevant earlier excerpts, explicit session pins, and current page state. Summaries preserve source references. Context retention is bounded and tested; it is not perfect memory.",
      ],
      [
        "Across sessions, only if you want",
        "Account learning preferences are opt-in. You can inspect, edit, disable, and delete them. Private feedback never becomes part of student-facing tutor memory.",
      ],
    ],
    example:
      "Pin “Use short steps, and let me attempt the next one.” Later, change that preference if you want a complete worked explanation.",
  },
  {
    slug: "rubric-lens",
    name: "Rubric Lens",
    eyebrow: "A CLEARER FINAL LOOK",
    headline: "Know what’s ready.\nKnow what needs work.",
    lead: "Review your own answers against explicit criteria, with evidence tied to the page.",
    sections: [
      [
        "Agree on the target first",
        "Choose the pages and confirm a supplied rubric or a clearly labeled provisional checklist. Every required criterion must be met; the app does not invent a teacher’s passing score.",
      ],
      [
        "Your work is the evidence",
        "Teaching overlays are excluded from independent-work review. Original content is assessed as student work only when it is identified as such. Unreadable or uncertain evidence cannot silently become an approval.",
      ],
      [
        "Changes deserve another check",
        "Editing your answer or rubric makes a previous approval outdated. The server verifies ownership, work revision, rubric revision, scope, and readiness before saving a final submission. A tutor pointer alone does not invalidate the assessment.",
      ],
    ],
    example:
      "A writing review can ask whether each claim has relevant evidence and an explanation, if those are the criteria you explicitly confirm. It is not an instructor’s grade.",
  },
  {
    slug: "resume-and-replay",
    name: "Resume & Replay",
    eyebrow: "A PAUSE IS STILL PROGRESS",
    headline: "Pick up\nyour thinking.",
    lead: "Saved pages, messages, and annotations stay with the session. Come back to the step you were working through.",
    sections: [
      [
        "Saved means acknowledged",
        "The workspace shows Saved only after the server acknowledges durable changes. Pending ink is labeled honestly. Optional browser-tab recovery can retain unsaved actions; it is cleared on save or sign-out.",
      ],
      [
        "Revisit a helpful mark",
        "A durable operation log retains drawing actions and their groups. Replay a tutor drawing, or return to an annotation referenced from a message. The current implementation replays the most recent drawing rather than a full narrated timeline.",
      ],
      [
        "A final version stays final",
        "Submitting saves an immutable version inside Scriblune. Exports exclude tutor teaching ink by default. To continue, create a new draft; the submitted snapshot remains unchanged.",
      ],
    ],
    example:
      "Finish today with a draft. Tomorrow, reopen the session, inspect your memory pins, and ask about the next step on the same page.",
  },
  {
    slug: "private-feedback",
    name: "Private Feedback",
    eyebrow: "A BETTER EXPERIENCE STARTS WITH LISTENING",
    headline: "Tell us what\nmade a difference.",
    lead: "After finishing, reflect on the moments that actually happened in your session.",
    sections: [
      [
        "Specific, neutral questions",
        "Choose one to five stars with no preselected rating. Follow-up questions are generated from actual messages, drawings, and the final review. Wording and supporting event IDs are saved together. Written elaboration is optional.",
      ],
      [
        "Private to the team",
        "Feedback is linked to your account and stored outside the exposed database schema. After submission, it cannot be retrieved through your dashboard, tutor, normal export, session history, or student API. Your browser can naturally see what you type and send.",
      ],
      [
        "A human review workflow",
        "Authorized staff can filter feedback by account, session, subject, rating, issue, and review status. Access is audited. Feedback does not automatically retrain the tutor, change its behavior, or affect your completed review.",
      ],
    ],
    example:
      "If a drawing happened, you may be asked whether you could follow it while reading the explanation. If no drawing happened, the app does not invent one.",
  },
];
