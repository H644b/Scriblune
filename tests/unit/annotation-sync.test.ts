import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  InkSaveQueue,
  InkSaveError,
  inkJournal,
  recoverInk,
  mergeInkReceipt,
  overlayPending,
  type PendingInk,
  type InkReceipt,
} from "../../src/lib/workspace/save-queue";
import {
  applyAction,
  applyCommitted,
  workChanges,
} from "../../src/lib/workspace/scene";
import { demoWorkspace } from "../../src/lib/workspace/demo";
import {
  defaultStyle,
  emptyGeometry,
  type ActionInput,
  type WorkspaceAction,
} from "../../src/lib/workspace/types";
function harness() {
  let view = demoWorkspace(),
    server = demoWorkspace(),
    known = 0,
    local = 0;
  const committed = new Map<string, WorkspaceAction>(),
    states: string[] = [],
    requests: ActionInput[][] = [];
  const send = vi.fn(async (inputs: ActionInput[]): Promise<InkReceipt> => {
    requests.push(structuredClone(inputs));
    let next = structuredClone(server);
    const actions: WorkspaceAction[] = [];
    for (const input of inputs) {
      const prior = committed.get(input.action_id);
      if (prior) {
        actions.push(prior);
        continue;
      }
      if (input.base_scene_revision > next.session.scene_revision)
        throw new InkSaveError("Future scene", false);
      const before = next.objects.find((o) => o.id === input.object_id) || null;
      let after;
      try {
        after = applyAction(
          input,
          before,
          "student",
          ++next.session.scene_revision,
          next.pages[0],
        );
      } catch (error) {
        throw new InkSaveError((error as Error).message, false);
      }
      if (workChanges("student", before, after)) next.session.work_revision++;
      const action = {
        ...input,
        before,
        after,
        actor: "student" as const,
        turn_id: null,
        sequence_number: next.session.scene_revision,
        animation_parameters: { duration_ms: 0 },
      };
      next.objects = applyCommitted(next.objects, action);
      next.events.push(action);
      actions.push(action);
    }
    server = next;
    for (const action of actions) committed.set(action.action_id, action);
    return {
      actions,
      scene_revision: server.session.scene_revision,
      work_revision: server.session.work_revision,
    };
  });
  let transport = (a: ActionInput[], _k: boolean) => send(a);
  const queue = new InkSaveQueue({
    sceneRevision: () => known,
    send: (a, k) => transport(a, k),
    acknowledge: (_entries, result) => {
      known = Math.max(known, result.scene_revision);
      view = mergeInkReceipt(view, queue.pending, result);
    },
    changed: (state) => states.push(state),
  });
  function add(
    object_id: string = randomUUID(),
    x = 20,
    operation_type: ActionInput["operation_type"] = "create",
  ) {
    const before = view.objects.find((o) => o.id === object_id) || null;
    const input: ActionInput = {
      action_id: randomUUID(),
      action_group_id: randomUUID(),
      object_id,
      page_id: view.pages[0].id,
      operation_type,
      base_scene_revision: view.session.scene_revision,
      base_object_revision: before?.revision ?? null,
      geometry:
        operation_type === "delete"
          ? null
          : {
              ...emptyGeometry,
              kind: "rectangle",
              x,
              y: 20,
              width: 20,
              height: 20,
            },
      style: defaultStyle,
      visible: true,
      locked: false,
      group: null,
    };
    const revision = Math.max(++local, view.session.scene_revision + 1);
    local = revision;
    const after = applyAction(
      input,
      before,
      "student",
      revision,
      view.pages[0],
    );
    const entry: PendingInk = {
      input,
      optimistic: {
        ...input,
        before,
        after,
        actor: "student",
        turn_id: null,
        sequence_number: revision,
        animation_parameters: { duration_ms: 0 },
      },
    };
    view = overlayPending(view, [entry]);
    queue.enqueue([entry]);
    return entry;
  }
  return {
    queue,
    add,
    send,
    states,
    requests,
    get view() {
      return view;
    },
    get server() {
      return server;
    },
    setTransport(fn: typeof transport) {
      transport = fn;
    },
    advanceServer(n: number) {
      server.session.scene_revision += n;
    },
    setView(next: typeof view) {
      view = next;
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("idle annotation saves", () => {
  it("draws immediately, waits through continuous activity, then coalesces independent strokes", async () => {
    const h = harness();
    h.add();
    await vi.advanceTimersByTimeAsync(700);
    h.add();
    await vi.advanceTimersByTimeAsync(700);
    h.add();
    expect(h.view.objects).toHaveLength(3);
    expect(h.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(899);
    expect(h.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.requests[0]).toHaveLength(3);
    expect(h.queue.pending).toHaveLength(0);
    expect(h.server.objects).toHaveLength(3);
  });
  it("does not start saving during a held pointer, even after the debounce expires", async () => {
    const h = harness();
    h.add();
    h.queue.activity(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.send).not.toHaveBeenCalled();
    h.queue.activity(false);
    await vi.advanceTimersByTimeAsync(900);
    expect(h.send).toHaveBeenCalledOnce();
  });
  it("keeps a newer move visible while an earlier create is in flight and maps its actual revision", async () => {
    const h = harness();
    let release!: () => void;
    h.advanceServer(7);
    h.setTransport(async (inputs) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return h.send(inputs);
    });
    const created = h.add();
    await vi.advanceTimersByTimeAsync(900);
    h.add(created.input.object_id, 250, "update");
    expect(h.view.objects[0].geometry.x).toBe(250);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.view.objects[0].geometry.x).toBe(250);
    expect(h.queue.pending[0].input.base_object_revision).toBe(8);
    h.setTransport((inputs) => h.send(inputs));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.server.objects[0].geometry.x).toBe(250);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1][0].base_object_revision).toBe(8);
    expect(h.queue.pending).toHaveLength(0);
  });
  it("explicit flush joins the in-flight save and waits for newly queued edits before proceeding", async () => {
    const h = harness();
    let release!: () => void;
    h.setTransport(async (inputs) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      h.setTransport((a) => h.send(a));
      return h.send(inputs);
    });
    h.add();
    const first = h.queue.flush();
    h.add();
    const barrier = h.queue.flush();
    expect(barrier).toBe(first);
    let ready = false;
    void barrier.then((ok) => {
      ready = ok;
    });
    expect(ready).toBe(false);
    release();
    await barrier;
    expect(ready).toBe(true);
    expect(h.server.objects).toHaveLength(2);
    expect(h.queue.pending).toHaveLength(0);
  });
  it("retries an ambiguous committed response with the same IDs and payload without duplicate ink", async () => {
    const h = harness();
    let lose = true;
    h.setTransport(async (inputs) => {
      const result = await h.send(inputs);
      if (lose) {
        lose = false;
        throw new Error("Response lost");
      }
      return result;
    });
    h.add();
    expect(await h.queue.flush()).toBe(false);
    expect(h.queue.pending).toHaveLength(1);
    expect(h.server.objects).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.queue.pending).toHaveLength(0);
    expect(h.server.objects).toHaveLength(1);
    expect(h.requests[1]).toEqual(h.requests[0]);
  });
  it("blocks repeated automatic requests on an actual object conflict while preserving local ink", async () => {
    const h = harness();
    h.setTransport(async () => {
      throw new InkSaveError("Changed in another tab", false);
    });
    h.add();
    expect(await h.queue.flush()).toBe(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.queue.pending).toHaveLength(1);
    expect(h.view.objects).toHaveLength(1);
    expect(h.states.at(-1)).toBe("blocked");
  });
  it("bounds network retries and resumes on an explicit retry", async () => {
    const h = harness();
    let attempts = 0;
    h.setTransport(async () => {
      attempts++;
      throw new Error("Offline");
    });
    h.add();
    await vi.advanceTimersByTimeAsync(120000);
    expect(attempts).toBe(5);
    expect(h.queue.pending).toHaveLength(1);
    h.setTransport((inputs) => h.send(inputs));
    expect(await h.queue.flush()).toBe(true);
    expect(h.queue.pending).toHaveLength(0);
  });
  it("retains a local deletion when the create acknowledgement arrives", async () => {
    const h = harness();
    let release!: () => void;
    h.setTransport(async (inputs) => {
      await new Promise<void>((r) => {
        release = r;
      });
      return h.send(inputs);
    });
    const entry = h.add();
    await vi.advanceTimersByTimeAsync(900);
    h.add(entry.input.object_id, 0, "delete");
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.view.objects).toHaveLength(0);
    h.setTransport((inputs) => h.send(inputs));
    await h.queue.flush();
    expect(h.server.objects).toHaveLength(0);
  });
  it("limits each batch to100 actions while preserving order and work", async () => {
    const h = harness();
    for (let i = 0; i < 101; i++) h.add();
    await h.queue.flush();
    expect(h.requests.map((a) => a.length)).toEqual([100, 1]);
    expect(h.server.objects).toHaveLength(101);
  });
  it("round trips optional recovery with local revision dependencies intact", async () => {
    const h = harness();
    const first = h.add();
    h.add(first.input.object_id, 180, "update");
    const recovered = recoverInk(inkJournal(h.queue.pending), demoWorkspace());
    expect(recovered[1].input.base_object_revision).toBe(
      recovered[0].optimistic.sequence_number,
    );
    expect(
      overlayPending(demoWorkspace(), recovered).objects[0].geometry.x,
    ).toBe(180);
    expect(recovered.map((e) => e.input.action_id)).toEqual(
      h.queue.pending.map((e) => e.input.action_id),
    );
  });
  it("keeps pending ink over a refresh and never moves revision counters backwards on a late receipt", () => {
    const h = harness();
    h.add();
    const next = demoWorkspace();
    next.session.scene_revision = 20;
    next.session.work_revision = 10;
    const overlaid = overlayPending(next, h.queue.pending);
    expect(overlaid.objects).toHaveLength(1);
    const merged = mergeInkReceipt(overlaid, h.queue.pending, {
      actions: [],
      scene_revision: 3,
      work_revision: 2,
    });
    expect(merged.session.scene_revision).toBe(20);
    expect(merged.session.work_revision).toBe(11);
  });
  it("pause cancels idle timers without dropping pending actions", async () => {
    const h = harness();
    h.add();
    h.queue.pause();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.queue.pending).toHaveLength(1);
    h.queue.resume();
    await vi.advanceTimersByTimeAsync(900);
    expect(h.send).toHaveBeenCalledOnce();
  });
});
