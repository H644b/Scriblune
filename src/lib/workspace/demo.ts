import {
  emptyGeometry,
  defaultStyle,
  type Workspace,
  type WorkspaceAction,
} from "./types";
export const DEMO_PAGE = "10000000-0000-4000-8000-000000000001";
export const DEMO_PAGE_TWO = "10000000-0000-4000-8000-000000000002";
const DOC = "20000000-0000-4000-8000-000000000001";
export function demoWorkspace(): Workspace {
  return {
    session: {
      id: "demo",
      title: "A little balance goes a long way",
      subject: "Mathematics",
      status: "draft",
      scene_revision: 0,
      work_revision: 0,
      rubric_revision: 0,
      active_page_id: DEMO_PAGE,
      viewport: {},
      summary: {},
      feedback_submitted: false,
    },
    documents: [
      {
        id: DOC,
        name: "Algebra practice.pdf",
        role: "assignment",
        mime: "application/pdf",
        status: "ready",
        page_count: 2,
      },
    ],
    pages: [
      {
        id: DEMO_PAGE,
        session_id: "demo",
        document_id: DOC,
        page_number: 1,
        width: 1000,
        height: 1294,
        original_width: 612,
        original_height: 792,
        rotation: 0,
        render_path: "/fixtures/algebra-1.png",
        text_content:
          "1. Solve for x. 3x + 6 = 18. 2. Simplify the fraction 6/8. Explain what the denominator tells you.",
        source_regions: [
          { text: "8", region: { x: 288, y: 906, width: 25, height: 38 } },
        ],
        extraction_method: "text",
      },
      {
        id: DEMO_PAGE_TWO,
        session_id: "demo",
        document_id: DOC,
        page_number: 2,
        width: 1000,
        height: 1294,
        original_width: 612,
        original_height: 792,
        rotation: 0,
        render_path: "/fixtures/algebra-2.png",
        text_content: "3. Plot y = x² from x = -3 to 3. Label your axes.",
        source_regions: [],
        extraction_method: "text",
      },
    ],
    objects: [],
    messages: [
      {
        id: "demo-message",
        turn_id: "demo",
        role: "tutor",
        content:
          "Welcome to your shared page. This is a **sample workspace**—you can draw, select, erase, and explore.\n\nTry the sample explanation to see editable tutor ink in action. A real AI tutor becomes available in a signed-in session once the site is configured.",
        status: "complete",
        created_at: new Date().toISOString(),
        references_json: [],
      },
    ],
    memories: [],
    problems: [],
    reviews: [],
    rubric: null,
    jobs: [],
    setup: { tutor: false, review: false },
    events: [],
  };
}
