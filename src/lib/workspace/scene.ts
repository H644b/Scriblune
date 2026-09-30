import {
  type ActionInput,
  type Annotation,
  type Actor,
  annotationSchema,
} from "./types";
import { validateGeometry } from "./geometry";
export class SceneConflict extends Error {}
export function applyAction(
  input: ActionInput,
  current: Annotation | null,
  actor: Actor,
  revision: number,
  page: { width: number; height: number },
): Annotation | null {
  if (input.operation_type === "create") {
    if (current) throw new SceneConflict("This object already exists.");
    if (!input.geometry || !input.style)
      throw new Error("Drawing data is missing.");
    validateGeometry(input.geometry, page);
    return annotationSchema.parse({
      id: input.object_id,
      page_id: input.page_id,
      actor,
      action_group_id: input.action_group_id,
      revision,
      geometry: input.geometry,
      style: input.style,
      visible: true,
      locked: false,
      group: input.group,
    });
  }
  if (!current) throw new SceneConflict("This object no longer exists.");
  if (current.page_id !== input.page_id)
    throw new Error("The object belongs to another page.");
  if (current.revision !== input.base_object_revision)
    throw new SceneConflict(
      "This object changed while the action was being prepared.",
    );
  if (actor !== "student" && current.actor !== actor)
    throw new Error(
      "The tutor cannot replace or delete student work. Ask the student to make the change.",
    );
  if (
    current.locked &&
    input.locked !== false &&
    input.operation_type !== "visibility"
  )
    throw new Error("Unlock this object before editing.");
  if (input.operation_type === "delete") return null;
  const next = {
    ...current,
    geometry: input.geometry ?? current.geometry,
    style: input.style ?? current.style,
    visible: input.visible ?? current.visible,
    locked: input.locked ?? current.locked,
    group: input.group,
    revision,
  };
  validateGeometry(next.geometry, page);
  return annotationSchema.parse(next);
}
export function workChanges(
  actor: Actor,
  before: Annotation | null,
  after: Annotation | null,
) {
  if (actor === "grading") return false;
  if (actor === "tutor") return false;
  if (!before) return after?.actor === "student";
  if (before.actor !== "student") return false;
  if (!after) return true;
  return (
    JSON.stringify(before.geometry) !== JSON.stringify(after.geometry) ||
    JSON.stringify(before.style) !== JSON.stringify(after.style)
  );
}
export function applyCommitted(
  objects: Annotation[],
  action: { object_id: string; after: Annotation | null },
) {
  const filtered = objects.filter((o) => o.id !== action.object_id);
  return action.after ? [...filtered, action.after] : filtered;
}
