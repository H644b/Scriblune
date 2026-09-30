import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  pointSchema,
  styleSchema,
  emptyGeometry,
  defaultStyle,
  type Annotation,
  type Geometry,
  type Region,
  type WorkspaceAction,
} from "../workspace/types";
import { plotPoints } from "../workspace/expression";
import { bounds, intersects } from "../workspace/geometry";
import { accountTx, ownedSession } from "../server/db";
import { commitActions } from "../server/workspace";
import { renderPage } from "../server/render";
import { AppError } from "../server/errors";
import { jsonSchema } from "./provider";
const id = z.uuid();
const region = z
  .object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
const point = z.object({ x: z.number(), y: z.number() }).strict();
export const toolSchemas = {
  inspect_workspace: z.object({}).strict(),
  inspect_region: z.object({ page_id: id, region }).strict(),
  read_page: z.object({ page_id: id }).strict(),
  find_problem: z.object({ query: z.string().min(1).max(200) }).strict(),
  focus_region: z
    .object({ page_id: id, region, label: z.string().max(120) })
    .strict(),
  draw_path: z
    .object({
      page_id: id,
      points: z.array(point).min(2).max(1000),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      width: z.number().min(0.5).max(30),
    })
    .strict(),
  draw_shape: z
    .object({
      page_id: id,
      shape: z.enum(["ellipse", "rectangle", "polygon"]),
      region,
      points: z.array(point).max(100),
      style: styleSchema,
    })
    .strict(),
  draw_arrow: z
    .object({
      page_id: id,
      from: point,
      to: point,
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .strict(),
  add_text: z
    .object({
      page_id: id,
      position: point,
      text: z.string().min(1).max(1000),
      font_size: z.number().min(10).max(80),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .strict(),
  add_math: z
    .object({
      page_id: id,
      position: point,
      text: z.string().min(1).max(500),
      font_size: z.number().min(10).max(80),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .strict(),
  highlight_region: z
    .object({
      page_id: id,
      region,
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .strict(),
  fill_region: z
    .object({
      page_id: id,
      object_id: id,
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .strict(),
  plot_function: z
    .object({
      page_id: id,
      region,
      expression: z.string().max(120),
      x_min: z.number().min(-1000),
      x_max: z.number().max(1000),
      y_min: z.number().min(-1000),
      y_max: z.number().max(1000),
      label: z.string().max(100),
    })
    .strict(),
  move_annotation: z
    .object({ page_id: id, object_id: id, x: z.number(), y: z.number() })
    .strict(),
  erase_annotation: z.object({ page_id: id, object_id: id }).strict(),
  undo_action_group: z.object({ action_group_id: id }).strict(),
  set_annotation_visibility: z
    .object({ page_id: id, object_id: id, visible: z.boolean() })
    .strict(),
};
const descriptions: Record<keyof typeof toolSchemas, string> = {
  inspect_workspace:
    "Read current revisions, page index, annotations, and roles. Indexed pages are not necessarily visually inspected.",
  inspect_region:
    "Inspect a current composite crop including student work. Coordinates in canonical page space.",
  read_page:
    "Read a page and inspect its current visual rendering including student work.",
  find_problem:
    "Find indexed questions or exact text across every document in this session.",
  focus_region:
    "Offer a focus reference without changing the student viewport.",
  draw_path:
    "Create an editable arbitrary polyline. Approximate curves with accurate closely spaced points.",
  draw_shape:
    "Create an editable ellipse, rectangle, or polygon. Region is a canonical bounding box; polygon points are local to it.",
  draw_arrow: "Draw an editable arrow connecting two canonical points.",
  add_text: "Write a short editable text label.",
  add_math:
    "Write editable Unicode mathematical notation, e.g. x² + 2x = 3. Do not use HTML.",
  highlight_region:
    "Create a translucent teaching highlight over a canonical region.",
  fill_region:
    "Change the editable fill of a tutor-owned closed shape. Cannot modify student work.",
  plot_function:
    "Plot a constrained mathematical expression with labeled axes. Allowed x, numbers, + - * / ^, sin cos tan sqrt abs ln log exp pi e. Choose a continuous visible range.",
  move_annotation:
    "Move a tutor-owned object after reading its current revision.",
  erase_annotation: "Erase a tutor-owned object. Student work is protected.",
  undo_action_group:
    "Undo tutor objects created in the specified group if none have been edited afterward.",
  set_annotation_visibility: "Hide or show a tutor-owned annotation.",
};
export const workspaceTools = Object.entries(toolSchemas).map(
  ([name, schema]) => ({
    type: "function" as const,
    name,
    description: descriptions[name as keyof typeof descriptions],
    parameters: jsonSchema(schema),
    strict: true,
  }),
);
export type ToolContext = {
  accountId: string;
  sessionId: string;
  turnId: string;
  groupId: string;
  emit: (event: unknown) => void;
};
export async function executeTool(
  name: string,
  args: unknown,
  c: ToolContext,
): Promise<{ result: unknown; image?: string }> {
  if (!Object.hasOwn(toolSchemas, name))
    throw new Error("Unknown workspace tool.");
  const a = toolSchemas[name as keyof typeof toolSchemas].parse(args) as Record<
    string,
    any
  >;
  const snapshot = await accountTx(c.accountId, async (tx) => {
    const s = await ownedSession(tx, c.sessionId, { draft: true });
    const turn = (
      await tx`select status from public.tutor_turns where id=${c.turnId} and session_id=${c.sessionId}`
    )[0];
    if (turn?.status !== "running")
      throw new AppError(409, "This turn is no longer active.");
    const pages =
      await tx`select * from public.document_pages where session_id=${c.sessionId}`;
    const docs =
      await tx`select id,name,role,status from public.documents where session_id=${c.sessionId}`;
    const rows =
      await tx`select object from public.annotation_objects where session_id=${c.sessionId} and not deleted`;
    const problems =
      await tx`select * from public.problem_regions where session_id=${c.sessionId}`;
    return {
      s,
      pages,
      docs,
      objects: rows.map((o) => o.object as Annotation),
      problems,
    };
  });
  const page = a.page_id
    ? snapshot.pages.find((p) => p.id === a.page_id)
    : null;
  if (a.page_id && !page) throw new Error("Page not in this session.");
  const objects = snapshot.objects.filter((o) => o.page_id === a.page_id);
  const current = a.object_id
    ? objects.find((o) => o.id === a.object_id)
    : null;
  if (name === "inspect_workspace")
    return {
      result: {
        scene_revision: snapshot.s.scene_revision,
        work_revision: snapshot.s.work_revision,
        documents: snapshot.docs,
        pages: snapshot.pages.map((p) => ({
          id: p.id,
          page_number: p.page_number,
          width: p.width,
          height: p.height,
          text: p.text_content,
          source_regions: p.source_regions,
        })),
        annotations: snapshot.objects,
        problems: snapshot.problems,
      },
    };
  if (name === "find_problem") {
    const query = a.query.toLowerCase();
    return {
      result: snapshot.problems
        .filter(
          (p) =>
            p.label.toLowerCase().includes(query) ||
            p.content.toLowerCase().includes(query),
        )
        .slice(0, 20),
    };
  }
  if (name === "read_page" || name === "inspect_region") {
    if (
      a.region &&
      (a.region.x + a.region.width > page!.width ||
        a.region.y + a.region.height > page!.height)
    )
      throw new Error("Region is outside the page.");
    const image = await renderPage(
      page as any,
      objects,
      name === "inspect_region" ? a.region : undefined,
    );
    return {
      result: {
        page_id: a.page_id,
        inspected: true,
        canonical_dimensions: { width: page!.width, height: page!.height },
        crop: a.region || null,
        text: page!.text_content,
        regions: page!.source_regions,
        annotations: objects.filter(
          (o) => !a.region || intersects(bounds(o.geometry), a.region),
        ),
      },
      image: image.toString("base64"),
    };
  }
  if (name === "focus_region") {
    if (
      a.region.x + a.region.width > page!.width ||
      a.region.y + a.region.height > page!.height
    )
      throw new Error("Focus outside page.");
    c.emit({
      type: "focus",
      page_id: a.page_id,
      region: a.region,
      label: a.label,
    });
    return { result: { focused: true, student_view_unchanged: true } };
  }
  async function create(
    g: Geometry,
    style = { ...defaultStyle, color: "#b16e50" },
  ) {
    const result = await commitActions(
      c.accountId,
      c.sessionId,
      [
        {
          action_id: randomUUID(),
          action_group_id: c.groupId,
          page_id: a.page_id,
          object_id: randomUUID(),
          operation_type: "create",
          base_scene_revision: snapshot.s.scene_revision,
          base_object_revision: null,
          geometry: g,
          style,
          visible: true,
          locked: false,
          group: null,
        },
      ],
      "tutor",
      c.turnId,
    );
    for (const action of result.actions)
      c.emit({ type: "action", action, work_revision: result.work_revision });
    return result.actions[0].after;
  }
  async function modify(
    operation: "update" | "delete" | "visibility",
    geometry: Geometry | null = null,
    style: any = null,
    visible: boolean | null = null,
  ) {
    if (!current) throw new Error("Object not found.");
    const result = await commitActions(
      c.accountId,
      c.sessionId,
      [
        {
          action_id: randomUUID(),
          action_group_id: c.groupId,
          page_id: a.page_id,
          object_id: a.object_id,
          operation_type: operation,
          base_scene_revision: snapshot.s.scene_revision,
          base_object_revision: current.revision,
          geometry,
          style,
          visible,
          locked: null,
          group: current.group,
        },
      ],
      "tutor",
      c.turnId,
    );
    for (const action of result.actions)
      c.emit({ type: "action", action, work_revision: result.work_revision });
    return { executed: true, object_id: a.object_id };
  }
  let object: Annotation | null | undefined;
  if (name === "draw_path")
    object = await create(
      { ...emptyGeometry, kind: "path", points: a.points },
      { ...defaultStyle, color: a.color, width: a.width },
    );
  else if (name === "draw_shape")
    object = await create(
      { ...emptyGeometry, kind: a.shape, ...a.region, points: a.points },
      a.style,
    );
  else if (name === "draw_arrow")
    object = await create(
      { ...emptyGeometry, kind: "arrow", points: [a.from, a.to] },
      { ...defaultStyle, color: a.color },
    );
  else if (name === "add_text" || name === "add_math")
    object = await create(
      {
        ...emptyGeometry,
        kind: name === "add_math" ? "math" : "text",
        ...a.position,
        width: Math.min(
          page!.width - a.position.x,
          a.text.length * a.font_size * 0.6,
        ),
        height: a.font_size * 1.5,
        text: a.text,
      },
      { ...defaultStyle, fontSize: a.font_size, color: a.color },
    );
  else if (name === "highlight_region")
    object = await create(
      { ...emptyGeometry, kind: "rectangle", ...a.region },
      {
        ...defaultStyle,
        color: a.color,
        fill: a.color,
        opacity: 0.25,
        width: 0.5,
      },
    );
  else if (name === "fill_region") {
    if (
      !current ||
      !["ellipse", "rectangle", "polygon"].includes(current.geometry.kind)
    )
      throw new Error("Choose a closed tutor shape.");
    return {
      result: await modify("update", null, { ...current.style, fill: a.color }),
    };
  } else if (name === "move_annotation")
    return {
      result: await modify("update", { ...current!.geometry, x: a.x, y: a.y }),
    };
  else if (name === "erase_annotation")
    return { result: await modify("delete") };
  else if (name === "set_annotation_visibility")
    return { result: await modify("visibility", null, null, a.visible) };
  else if (name === "plot_function") {
    const r = a.region as Region;
    const points = plotPoints(a.expression, r, {
      xMin: a.x_min,
      xMax: a.x_max,
      yMin: a.y_min,
      yMax: a.y_max,
    });
    const yZero = Math.max(
        0,
        Math.min(r.height, (a.y_max / (a.y_max - a.y_min)) * r.height),
      ),
      xZero = Math.max(
        0,
        Math.min(r.width, (-a.x_min / (a.x_max - a.x_min)) * r.width),
      );
    await create(
      {
        ...emptyGeometry,
        kind: "line",
        x: r.x,
        y: r.y,
        points: [
          { x: 0, y: yZero },
          { x: r.width, y: yZero },
        ],
      },
      { ...defaultStyle, color: "#727783", width: 1.5 },
    );
    await create(
      {
        ...emptyGeometry,
        kind: "line",
        x: r.x,
        y: r.y,
        points: [
          { x: xZero, y: 0 },
          { x: xZero, y: r.height },
        ],
      },
      { ...defaultStyle, color: "#727783", width: 1.5 },
    );
    object = await create(
      {
        ...emptyGeometry,
        kind: "graph",
        ...r,
        points,
        expression: a.expression,
      },
      { ...defaultStyle, color: "#4361ee", width: 2.5 },
    );
    await create(
      {
        ...emptyGeometry,
        kind: "math",
        x: r.x,
        y: Math.max(0, r.y - 32),
        width: r.width,
        height: 28,
        text: `${a.label}: y = ${a.expression}`,
      },
      { ...defaultStyle, fontSize: 20, color: "#4361ee" },
    );
    await create(
      {
        ...emptyGeometry,
        kind: "text",
        x: r.x,
        y: r.y + r.height + 5,
        width: r.width,
        height: 24,
        text: `x: ${a.x_min} to ${a.x_max} · y: ${a.y_min} to ${a.y_max}`,
      },
      { ...defaultStyle, fontSize: 13, color: "#727783" },
    );
  } else if (name === "undo_action_group") {
    const matches = snapshot.objects.filter(
      (o) => o.actor === "tutor" && o.action_group_id === a.action_group_id,
    );
    if (!matches.length)
      throw new Error("No unchanged tutor objects in that group.");
    const events = await accountTx(
      c.accountId,
      (tx) =>
        tx`select payload from public.workspace_events where session_id=${c.sessionId} and action_group_id=${a.action_group_id} order by sequence_number desc`,
    );
    if (
      matches.some(
        (o) =>
          !events.some(
            (e) =>
              e.payload.after?.id === o.id &&
              e.payload.sequence_number === o.revision,
          ),
      )
    )
      throw new Error("Later edits prevent undo.");
    const result = await commitActions(
      c.accountId,
      c.sessionId,
      matches.map((o) => ({
        action_id: randomUUID(),
        action_group_id: c.groupId,
        page_id: o.page_id,
        object_id: o.id,
        operation_type: "delete",
        base_scene_revision: snapshot.s.scene_revision,
        base_object_revision: o.revision,
        geometry: null,
        style: null,
        visible: null,
        locked: null,
        group: null,
      })),
      "tutor",
      c.turnId,
    );
    for (const action of result.actions)
      c.emit({ type: "action", action, work_revision: result.work_revision });
    return { result: { removed: result.actions.length } };
  }
  return {
    result: {
      executed: true,
      object_id: object?.id,
      page_id: a.page_id,
      action_group_id: c.groupId,
    },
  };
}
