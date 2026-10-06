import { z } from "zod";
export const pointSchema = z
  .object({
    x: z.number().finite().min(-12000).max(12000),
    y: z.number().finite().min(-12000).max(12000),
    pressure: z.number().min(0).max(1).optional(),
  })
  .strict();
export type Point = z.infer<typeof pointSchema>;
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const styleSchema = z
  .object({
    color: colorSchema,
    width: z.number().min(0.25).max(60),
    opacity: z.number().min(0.05).max(1),
    fill: z.union([colorSchema, z.literal("none")]),
    dash: z.boolean(),
    fontSize: z.number().min(8).max(140),
    lineEnding: z.enum(["none", "arrow", "both"]),
  })
  .strict();
export const defaultStyle = {
  color: "#4361ee",
  width: 3,
  opacity: 1,
  fill: "none" as const,
  dash: false,
  fontSize: 24,
  lineEnding: "none" as const,
};
export const geometrySchema = z
  .object({
    kind: z.enum([
      "path",
      "pencil",
      "brush",
      "highlighter",
      "line",
      "arrow",
      "rectangle",
      "ellipse",
      "polygon",
      "text",
      "math",
      "sticky",
      "graph",
      "mask",
    ]),
    x: z.number().finite().min(-12000).max(12000),
    y: z.number().finite().min(-12000).max(12000),
    width: z.number().finite().min(0).max(12000),
    height: z.number().finite().min(0).max(12000),
    rotation: z.number().min(-360).max(360),
    points: z.array(pointSchema).max(6000),
    text: z.string().max(2000),
    expression: z.string().max(120),
    spans: z
      .array(
        z.tuple([
          z.number().int().min(0).max(12000),
          z.number().int().min(0).max(12000),
          z.number().int().min(0).max(12000),
        ]),
      )
      .max(20000),
  })
  .strict();
export type Geometry = z.infer<typeof geometrySchema>;
export const emptyGeometry: Geometry = {
  kind: "path",
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  rotation: 0,
  points: [],
  text: "",
  expression: "",
  spans: [],
};
export type Actor = "student" | "tutor" | "grading";
export const annotationSchema = z
  .object({
    id: z.uuid(),
    page_id: z.uuid(),
    actor: z.enum(["student", "tutor", "grading"]),
    action_group_id: z.uuid(),
    revision: z.number().int().nonnegative(),
    geometry: geometrySchema,
    style: styleSchema,
    visible: z.boolean(),
    locked: z.boolean(),
    group: z.uuid().nullable(),
  })
  .strict();
export type Annotation = z.infer<typeof annotationSchema>;
export const actionInputSchema = z
  .object({
    action_id: z.uuid(),
    action_group_id: z.uuid(),
    page_id: z.uuid(),
    object_id: z.uuid(),
    operation_type: z.enum(["create", "update", "delete", "visibility"]),
    base_scene_revision: z.number().int().nonnegative(),
    base_object_revision: z.number().int().nonnegative().nullable(),
    geometry: geometrySchema.nullable(),
    style: styleSchema.nullable(),
    visible: z.boolean().nullable(),
    locked: z.boolean().nullable(),
    group: z.uuid().nullable(),
  })
  .strict();
export type ActionInput = z.infer<typeof actionInputSchema>;
export type WorkspaceAction = ActionInput & {
  turn_id: string | null;
  sequence_number: number;
  actor: Actor;
  animation_parameters: { duration_ms: number };
  before: Annotation | null;
  after: Annotation | null;
};
export type Region = { x: number; y: number; width: number; height: number };
export type DocumentPage = {
  id: string;
  session_id: string;
  document_id: string;
  page_number: number;
  width: number;
  height: number;
  original_width: number;
  original_height: number;
  rotation: number;
  render_path: string | null;
  text_content: string;
  source_regions: { text: string; region: Region; confidence?: string }[];
  extraction_method: string;
};
export type Doc = {
  id: string;
  name: string;
  role: string;
  mime: string;
  status: string;
  page_count: number;
  error?: string;
};
export type Message = {
  id: string;
  turn_id: string;
  role: "student" | "tutor" | "system";
  content: string;
  status: string;
  created_at: string;
  references_json: {
    page_id: string;
    object_id?: string;
    label?: string;
    region?: Region;
  }[];
};
export type Memory = {
  id: string;
  kind: string;
  content: { text?: string; [key: string]: unknown };
  active: boolean;
  source_ids: string[];
  version: number;
};
export type Session = {
  updated_at?: string;
  is_test?: boolean;
  id: string;
  title: string;
  subject: string;
  status: string;
  scene_revision: number;
  work_revision: number;
  rubric_revision: number;
  active_page_id: string | null;
  viewport: Record<string, unknown>;
  summary: Record<string, unknown>;
  feedback_submitted: boolean;
};
export type Review = {
  id: string;
  work_revision: number;
  rubric_revision: number;
  readiness_status: "ready" | "needs_work" | "uncertain";
  scope_page_ids: string[];
  result: ReviewResult;
  created_at: string;
};
export type CriterionResult = {
  criterion_id: string;
  status: "met" | "not_met" | "uncertain";
  explanation: string;
  evidence_references: {
    page_id: string;
    annotation_id: string | null;
    quote: string;
    region: Region | null;
  }[];
  suggested_correction: string;
};
export type ReviewResult = {
  criterion_results: CriterionResult[];
  missing_elements: string[];
  uncertainty: string[];
  suggested_corrections: string[];
  readiness_status: "ready" | "needs_work" | "uncertain";
  summary: string;
};
export type Workspace = {
  session: Session;
  documents: Doc[];
  pages: DocumentPage[];
  objects: Annotation[];
  messages: Message[];
  memories: Memory[];
  problems: {
    id: string;
    page_id: string;
    label: string;
    content: string;
    region: Region;
  }[];
  reviews: Review[];
  rubric: Rubric | null;
  jobs: {
    document_id: string;
    progress: number;
    status: string;
    error: string | null;
  }[];
  setup: { tutor: boolean; review: boolean };
  events: WorkspaceAction[];
};
export type Rubric = {
  id: string;
  revision: number;
  title: string;
  provisional: boolean;
  criteria: {
    id: string;
    description: string;
    required: boolean;
    weight: number | null;
  }[];
  scope_page_ids: string[];
};
export type Tool =
  "pen" | "select" | "lasso" | Geometry["kind"] | "eraser" | "fill" | "point";
