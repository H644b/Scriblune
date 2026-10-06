import { z } from "zod";
import {
  actionInputSchema,
  type ActionInput,
  type WorkspaceAction,
  type Workspace,
} from "./types";
import { applyAction, applyCommitted, workChanges } from "./scene";

export type PendingInk = { input: ActionInput; optimistic: WorkspaceAction };
export type InkReceipt = {
  actions: WorkspaceAction[];
  scene_revision: number;
  work_revision: number;
};
export type InkSaveState =
  "saved" | "waiting" | "saving" | "retrying" | "blocked";
export class InkSaveError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Serial, idempotent saves. Drawing never awaits this queue. */
export class InkSaveQueue {
  readonly pending: PendingInk[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<boolean> | undefined;
  private retryBatch:
    { entries: PendingInk[]; actions: ActionInput[] } | undefined;
  private lastActivity = 0;
  private interacting = false;
  private force = false;
  private retries = 0;
  private blocked = false;
  private disposed = false;
  private keepalive = false;
  constructor(
    private readonly options: {
      sceneRevision: () => number;
      send: (actions: ActionInput[], keepalive: boolean) => Promise<InkReceipt>;
      acknowledge: (entries: PendingInk[], result: InkReceipt) => void;
      changed: (state: InkSaveState, error?: Error) => void;
      idleMs?: number;
    },
  ) {}
  get isSaving() {
    return !!this.running;
  }
  get idleMs() {
    return this.options.idleMs ?? 900;
  }
  enqueue(entries: PendingInk[]) {
    this.pending.push(...entries);
    this.activity();
    this.options.changed(
      this.blocked ? "blocked" : this.running ? "saving" : "waiting",
    );
  }
  activity(interacting = this.interacting) {
    this.lastActivity = Date.now();
    this.interacting = interacting;
    this.schedule();
  }
  resume() {
    this.disposed = false;
    this.schedule();
  }
  pause() {
    this.disposed = true;
    this.clearTimer();
  }
  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private schedule(delay = this.idleMs) {
    this.clearTimer();
    if (
      this.disposed ||
      this.blocked ||
      this.interacting ||
      this.running ||
      !this.pending.length
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.start(false);
    }, delay);
  }
  /** Explicit barriers join an existing request and drain all pending work. */
  flush(keepalive = false): Promise<boolean> {
    this.force = true;
    this.keepalive ||= keepalive;
    this.blocked = false;
    this.retries = 0;
    this.clearTimer();
    return this.start(true);
  }
  private start(force: boolean): Promise<boolean> {
    if (this.running) return this.running;
    if (!this.pending.length) {
      this.force = false;
      this.keepalive = false;
      return Promise.resolve(true);
    }
    if (this.disposed || (!force && (this.interacting || this.blocked)))
      return Promise.resolve(false);
    this.running = this.drain().finally(() => {
      this.running = undefined;
      this.force = false;
      this.keepalive = false;
      if (!this.blocked && this.pending.length)
        this.schedule(
          Math.max(this.idleMs, Math.min(30000, 1000 * 2 ** this.retries)),
        );
    });
    return this.running;
  }
  private batch() {
    if (this.retryBatch) return this.retryBatch;
    const entries: PendingInk[] = [],
      actions: ActionInput[] = [],
      objects = new Set<string>();
    let bytes = 16;
    for (const entry of this.pending) {
      // A second edit to the same object waits for its actual server revision.
      if (objects.has(entry.input.object_id) || entries.length === 100) break;
      const action = {
        ...entry.input,
        base_scene_revision: Math.min(
          entry.input.base_scene_revision,
          this.options.sceneRevision(),
        ),
      };
      const size = new TextEncoder().encode(JSON.stringify(action)).length + 1;
      if (bytes + size > 3_800_000) {
        if (!entries.length)
          throw new InkSaveError(
            "This drawing is too large to save in one request. Your local ink is still available to copy.",
            false,
          );
        break;
      }
      if (this.keepalive && entries.length && bytes + size > 60000) break;
      bytes += size;
      entries.push(entry);
      actions.push(action);
      objects.add(action.object_id);
      // Journal the exact wire input before sending. Retries keep IDs and payload.
      entry.input = action;
    }
    this.retryBatch = { entries, actions };
    return this.retryBatch;
  }
  private async drain() {
    try {
      while (this.pending.length && !this.disposed) {
        if (
          !this.force &&
          (this.interacting || Date.now() - this.lastActivity < this.idleMs)
        )
          return false;
        const batch = this.batch();
        this.options.changed("saving");
        const result = await this.options.send(batch.actions, this.keepalive);
        if (
          result.actions.length !== batch.entries.length ||
          result.actions.some(
            (a, i) => a.action_id !== batch.actions[i].action_id,
          )
        )
          throw new InkSaveError(
            "The save response was incomplete. Retry to confirm your ink.",
            true,
          );
        this.pending.splice(0, batch.entries.length);
        for (const [index, saved] of result.actions.entries()) {
          const local = batch.entries[index].optimistic;
          for (const entry of this.pending) {
            if (
              entry.input.object_id === saved.object_id &&
              entry.input.base_object_revision === local.sequence_number
            )
              entry.input = {
                ...entry.input,
                base_object_revision: saved.sequence_number,
              };
          }
        }
        this.retryBatch = undefined;
        this.retries = 0;
        this.options.acknowledge(batch.entries, result);
        this.options.changed(this.pending.length ? "waiting" : "saved");
      }
      return !this.pending.length;
    } catch (cause) {
      const error =
        cause instanceof Error ? cause : new Error("Ink could not be saved.");
      this.retries++;
      this.blocked =
        (error instanceof InkSaveError && !error.retryable) || this.retries > 4;
      this.options.changed(this.blocked ? "blocked" : "retrying", error);
      return false;
    }
  }
}

/** Only acknowledged ink is replaced; later optimistic edits remain visible. */
export function mergeInkReceipt(
  workspace: Workspace,
  pending: readonly PendingInk[],
  result: InkReceipt,
): Workspace {
  const dirty = new Set(pending.map((e) => e.input.object_id));
  const seen = new Set(workspace.events.map((e) => e.action_id));
  return {
    ...workspace,
    objects: result.actions.reduce(
      (objects, action) =>
        dirty.has(action.object_id) ? objects : applyCommitted(objects, action),
      workspace.objects,
    ),
    events: [
      ...workspace.events,
      ...result.actions.filter((a) => !seen.has(a.action_id)),
    ],
    session: {
      ...workspace.session,
      scene_revision: Math.max(
        workspace.session.scene_revision,
        result.scene_revision,
        ...pending.map((e) => e.optimistic.sequence_number),
      ),
      work_revision: Math.max(
        workspace.session.work_revision,
        result.work_revision +
          pending.filter((e) =>
            workChanges("student", e.optimistic.before, e.optimistic.after),
          ).length,
      ),
    },
  };
}

export function overlayPending(
  workspace: Workspace,
  pending: readonly PendingInk[],
): Workspace {
  return {
    ...workspace,
    objects: pending.reduce(
      (objects, e) => applyCommitted(objects, e.optimistic),
      workspace.objects,
    ),
    session: {
      ...workspace.session,
      scene_revision: Math.max(
        workspace.session.scene_revision,
        ...pending.map((e) => e.optimistic.sequence_number),
      ),
      work_revision:
        workspace.session.work_revision +
        pending.filter((e) =>
          workChanges("student", e.optimistic.before, e.optimistic.after),
        ).length,
    },
  };
}

const journalSchema = z
  .object({
    version: z.literal(2),
    entries: z
      .array(
        z
          .object({
            input: actionInputSchema,
            local_revision: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export function inkJournal(pending: readonly PendingInk[]) {
  return JSON.stringify({
    version: 2,
    entries: pending.map((e) => ({
      input: e.input,
      local_revision: e.optimistic.sequence_number,
    })),
  });
}
export function recoverInk(stored: string, initial: Workspace): PendingInk[] {
  const raw = JSON.parse(stored);
  const entries = Array.isArray(raw)
    ? actionInputSchema
        .array()
        .max(100)
        .array()
        .max(100)
        .parse(raw)
        .flat()
        .map((input, i) => ({
          input,
          local_revision: initial.session.scene_revision + i + 1,
        }))
    : journalSchema.parse(raw).entries;
  let objects = initial.objects;
  const recovered: PendingInk[] = [];
  for (const { input, local_revision } of entries) {
    const page = initial.pages.find((p) => p.id === input.page_id);
    if (!page)
      throw new Error(
        "An unsaved drawing belongs to a missing page. Its recovery copy has been retained.",
      );
    const before = objects.find((o) => o.id === input.object_id) || null;
    // Recreate the local preview only. Wire preconditions are never rebased over
    // another writer; the server can still reject a genuine object conflict.
    const previewBefore = input.operation_type === "create" ? null : before;
    const after = applyAction(
      { ...input, base_object_revision: previewBefore?.revision ?? null },
      previewBefore,
      "student",
      local_revision,
      page,
    );
    objects = applyCommitted(objects, { object_id: input.object_id, after });
    recovered.push({
      input,
      optimistic: {
        ...input,
        actor: "student",
        turn_id: null,
        sequence_number: local_revision,
        before,
        after,
        animation_parameters: { duration_ms: 0 },
      },
    });
  }
  return recovered;
}
