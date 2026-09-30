"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  Cloud,
  CloudOff,
  FileText,
  PanelLeft,
  Minus,
  ZoomIn,
  Maximize2,
  RotateCw,
  MoreHorizontal,
  Pin,
  Layers,
  Search,
  Download,
  Play,
  Pause,
  SkipForward,
  X,
  FileUp,
  ImagePlus,
  Camera,
  LoaderCircle,
  Scan,
  Undo2,
  FileCheck2,
  MessageSquare,
  BookOpen,
  Save,
  Trash2,
} from "lucide-react";
import { Logo, Mark } from "./brand";
import { Dialog } from "./dialog";
import { Chat } from "./chat";
import { DrawingToolbar } from "./drawing-toolbar";
import { WorkspaceCanvas } from "./workspace-canvas";
import { ReviewDialog } from "./review-dialog";
import { AuthModal } from "./auth-modal";
import { api } from "@/lib/client-api";
import { useEditor } from "@/lib/workspace/store";
import { demoWorkspace, DEMO_PAGE } from "@/lib/workspace/demo";
import {
  type Workspace,
  type WorkspaceAction,
  type Annotation,
  type ActionInput,
  type Geometry,
  type Point,
  type Region,
  type Tool,
  emptyGeometry,
  defaultStyle,
  actionInputSchema,
} from "@/lib/workspace/types";
import { applyAction, applyCommitted } from "@/lib/workspace/scene";
import { bounds, selectedRegion } from "@/lib/workspace/geometry";
import { plotPoints } from "@/lib/workspace/expression";
const uuid = () => crypto.randomUUID();
export function WorkspaceLoader({ sessionId }: { sessionId: string }) {
  const q = useQuery({
    queryKey: ["workspace", sessionId],
    queryFn: () => api<Workspace>(`/api/sessions/${sessionId}`),
  });
  if (q.isPending)
    return (
      <div className="page-loading">
        <Mark size={46} />
        <p>Opening your study desk…</p>
      </div>
    );
  if (q.error)
    return (
      <div className="page-loading">
        <Logo />
        <h1>Your desk is waiting.</h1>
        <p className="error">{q.error.message}</p>
        <Link className="button secondary" href="/desk">
          Back to my desk
        </Link>
      </div>
    );
  return <WorkspaceRoom initial={q.data} />;
}
export function DemoRoom() {
  return <WorkspaceRoom initial={demoWorkspace()} demo />;
}
export function WorkspaceRoom({
  initial,
  demo = false,
}: {
  initial: Workspace;
  demo?: boolean;
}) {
  const [revealToken, setRevealToken] = useState(0);
  const [w, setW] = useState(initial),
    wRef = useRef(initial);
  const editor = useEditor();
  const [active, setActive] = useState(
      initial.session.active_page_id || initial.pages[0]?.id || "",
    ),
    [mobileView, setMobileView] = useState<"page" | "chat">("page");
  const [error, setError] = useState(""),
    [saveState, setSaveState] = useState(
      demo ? "Sample · saved on this device" : "Saved",
    ),
    [busy, setBusy] = useState(false),
    [activity, setActivity] = useState(""),
    [streamText, setStreamText] = useState(""),
    [modal, setModal] = useState(""),
    [authOpen, setAuthOpen] = useState(false),
    [uploading, setUploading] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [role, setRole] = useState("assignment"),
    [disclosed, setDisclosed] = useState(false),
    [textEntry, setTextEntry] = useState(""),
    [point, setPoint] = useState<Point>({ x: 100, y: 100 }),
    [textKind, setTextKind] = useState<"text" | "math" | "sticky">("text"),
    [search, setSearch] = useState(""),
    [focus, setFocus] = useState<{
      page_id: string;
      region: Region;
      label: string;
    } | null>(null),
    [recovery, setRecovery] = useState(false),
    [includeTutor, setIncludeTutor] = useState(false),
    [newPin, setNewPin] = useState("");
  const pending = useRef<ActionInput[][]>([]),
    saving = useRef(false),
    abort = useRef<AbortController | null>(null),
    turn = useRef<string | null>(null),
    animationQueue = useRef<WorkspaceAction[]>([]),
    animationRunning = useRef(false),
    cancelGeneration = useRef(0),
    streamDone = useRef(false),
    [animationObject, setAnimationObject] = useState<Annotation | null>(null),
    undoStack = useRef<WorkspaceAction[][]>([]),
    redoStack = useRef<WorkspaceAction[][]>([]),
    fileInput = useRef<HTMLInputElement>(null),
    photoInput = useRef<HTMLInputElement>(null),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const page = w.pages.find((p) => p.id === active) || w.pages[0],
    document = w.documents.find((d) => d.id === page?.document_id),
    readOnly = w.session.status === "submitted";
  const selected = w.objects.filter((o) => editor.selection.includes(o.id));
  function replace(next: Workspace) {
    wRef.current = next;
    setW(next);
    if (demo) {
      try {
        localStorage.setItem("scriblune-demo", JSON.stringify(next));
      } catch {}
    }
  }
  function patch(fn: (prev: Workspace) => Workspace) {
    replace(fn(wRef.current));
  }
  async function refresh() {
    if (demo || pending.current.length || busy || animationRunning.current)
      return;
    const next = await api<Workspace>(
      `/api/sessions/${wRef.current.session.id}`,
    );
    replace(next);
    if (!active && next.pages.length)
      setActive(next.session.active_page_id || next.pages[0].id);
  }
  useEffect(() => {
    if (demo) {
      try {
        const stored = localStorage.getItem("scriblune-demo");
        if (stored) {
          const parsed = JSON.parse(stored) as Workspace;
          if (parsed.session?.id === "demo" && parsed.pages?.length) {
            replace(parsed);
            setActive(parsed.session.active_page_id || parsed.pages[0].id);
          }
        }
      } catch {}
    } else {
      const stored = sessionStorage.getItem(
        `scriblune-recovery-${initial.session.id}`,
      );
      if (stored) {
        try {
          const recovered = actionInputSchema
            .array()
            .max(100)
            .array()
            .max(100)
            .parse(JSON.parse(stored));
          pending.current = recovered;
          let objects = initial.objects;
          let revision = initial.session.scene_revision;
          for (const input of recovered.flat()) {
            if (initial.events.some((e) => e.action_id === input.action_id))
              continue;
            const p = initial.pages.find((p) => p.id === input.page_id);
            if (!p) continue;
            try {
              const before =
                objects.find((o) => o.id === input.object_id) || null;
              const after = applyAction(
                input,
                before,
                "student",
                ++revision,
                p,
              );
              objects = applyCommitted(objects, {
                object_id: input.object_id,
                after,
              });
            } catch {
              /* Retry will report a conflict without discarding the local copy. */
            }
          }
          patch((prev) => ({ ...prev, objects }));
          setRecovery(true);
          setSaveState("Recovered unsaved ink · Retry");
        } catch {}
      }
    }
    editor.set({
      tool: "pen",
      selection: [],
      region: null,
      ...initial.session.viewport,
    });
    const groups = Object.groupBy(
      wRef.current.events.filter((e) => e.actor === "student" && e.object_id),
      (e) => e.action_group_id,
    );
    undoStack.current = Object.values(groups).filter(
      (events): events is WorkspaceAction[] =>
        !!events?.length &&
        events.every((e) => {
          const latest = events
            .filter((x) => x.object_id === e.object_id)
            .at(-1)!;
          const current = wRef.current.objects.find(
            (o) => o.id === e.object_id,
          );
          return latest.after
            ? current?.revision === latest.sequence_number
            : !current;
        }),
    );
  }, []);
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (pending.current.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);
  useEffect(() => {
    if (demo) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 4500);
    return () => clearInterval(timer);
  }, [busy, active]);
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (
        (e.target as HTMLElement)?.matches("input,textarea,select") ||
        documentGlobal().querySelector("dialog[open]")
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) void redo();
        else void undo();
      } else if (["v", "p", "h", "e", "q"].includes(e.key.toLowerCase()))
        editor.set({
          tool: (
            {
              v: "select",
              p: "pen",
              h: "highlighter",
              e: "eraser",
              q: "point",
            } as Record<string, Tool>
          )[e.key.toLowerCase()],
        });
      if (e.key === "Escape") editor.set({ selection: [], region: null });
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [w]);
  function documentGlobal() {
    return window.document;
  }
  function saveLayout(extra: Record<string, unknown> = {}) {
    const s = useEditor.getState();
    const viewport = {
      zoom: s.zoom,
      rotation: s.rotation,
      rail: s.rail,
      split: s.split,
    };
    patch((prev) => ({ ...prev, session: { ...prev.session, viewport } }));
    if (demo) return;
    setSaveState("Saving…");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api(`/api/sessions/${wRef.current.session.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          active_page_id: active || undefined,
          viewport,
          ...extra,
        }),
      })
        .then(() => {
          if (!pending.current.length) setSaveState("Saved");
        })
        .catch((e) => {
          setSaveState("Layout not saved");
          setError(e.message);
        });
    }, 500);
  }
  function changePage(id: string) {
    setActive(id);
    editor.set({ selection: [], region: null });
    patch((prev) => ({
      ...prev,
      session: { ...prev.session, active_page_id: id },
    }));
    if (!demo)
      void api(`/api/sessions/${w.session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active_page_id: id }),
      }).catch((e) => {
        setSaveState("Page position not saved");
        setError(e.message);
      });
  }
  async function flush() {
    if (saving.current || demo) return;
    saving.current = true;
    setSaveState("Saving…");
    try {
      while (pending.current.length) {
        const actions = pending.current[0];
        const result = await api<{
          actions: WorkspaceAction[];
          scene_revision: number;
          work_revision: number;
        }>(`/api/sessions/${wRef.current.session.id}/annotations`, {
          method: "POST",
          body: JSON.stringify({ actions }),
        });
        patch((prev) => ({
          ...prev,
          objects: result.actions.reduce(
            (acc, a) => applyCommitted(acc, a),
            prev.objects,
          ),
          session: {
            ...prev.session,
            scene_revision: Math.max(
              prev.session.scene_revision,
              result.scene_revision,
            ),
            work_revision: result.work_revision,
          },
          events: [...prev.events, ...result.actions],
        }));
        undoStack.current.push(result.actions);
        redoStack.current = [];
        pending.current.shift();
        if (recovery)
          sessionStorage.setItem(
            `scriblune-recovery-${wRef.current.session.id}`,
            JSON.stringify(pending.current),
          );
      }
      setSaveState("Saved");
      sessionStorage.removeItem(
        `scriblune-recovery-${wRef.current.session.id}`,
      );
    } catch (e) {
      setError((e as Error).message);
      setSaveState("Not saved · Retry");
    } finally {
      saving.current = false;
    }
  }
  async function commit(inputs: ActionInput[]) {
    if (readOnly) return;
    let objects = wRef.current.objects;
    const events: WorkspaceAction[] = [];
    let rev = wRef.current.session.scene_revision;
    try {
      for (const input of inputs) {
        const before = objects.find((o) => o.id === input.object_id) || null;
        const after = applyAction(input, before, "student", ++rev, page!);
        objects = applyCommitted(objects, {
          object_id: input.object_id,
          after,
        });
        events.push({
          ...input,
          turn_id: null,
          actor: "student",
          sequence_number: rev,
          animation_parameters: { duration_ms: 0 },
          before,
          after,
        });
      }
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    patch((prev) => ({
      ...prev,
      objects,
      session: {
        ...prev.session,
        scene_revision: rev,
        work_revision: prev.session.work_revision + 1,
      },
      events: demo ? [...prev.events, ...events] : prev.events,
    }));
    if (demo) {
      undoStack.current.push(events);
      redoStack.current = [];
      return;
    }
    pending.current.push(inputs);
    if (recovery)
      sessionStorage.setItem(
        `scriblune-recovery-${w.session.id}`,
        JSON.stringify(pending.current),
      );
    await flush();
  }
  function actionFor(
    g: Geometry,
    o?: Annotation,
    op: "create" | "update" | "delete" = "create",
    group = uuid(),
  ): ActionInput {
    const s = useEditor.getState();
    return {
      action_id: uuid(),
      action_group_id: group,
      page_id: o?.page_id || page!.id,
      object_id: o?.id || uuid(),
      operation_type: op,
      base_scene_revision: wRef.current.session.scene_revision,
      base_object_revision: o?.revision ?? null,
      geometry: op === "delete" ? null : g,
      style: o?.style || {
        ...defaultStyle,
        color: s.color,
        fill: s.fill,
        width: s.stroke,
        opacity: s.opacity,
        dash: s.dash,
        lineEnding: s.lineEnding,
        fontSize: s.fontSize,
      },
      visible: o?.visible ?? true,
      locked: o?.locked ?? false,
      group: o?.group ?? null,
    };
  }
  async function undo(group?: string) {
    if (pending.current.length) {
      setError("Save your pending ink before undoing earlier work.");
      return;
    }
    const events = group
      ? wRef.current.events.filter(
          (e) => e.action_group_id === group && e.after,
        )
      : undoStack.current.pop();
    if (!events?.length) return;
    try {
      if (demo) {
        patch((prev) => ({
          ...prev,
          objects: [...events].reverse().reduce(
            (acc, e) =>
              applyCommitted(acc, {
                object_id: e.object_id,
                after: e.before,
              }),
            prev.objects,
          ),
          session: {
            ...prev.session,
            scene_revision: prev.session.scene_revision + 1,
            work_revision: prev.session.work_revision + 1,
          },
        }));
      } else {
        const r = await api<{
          actions: WorkspaceAction[];
          scene_revision: number;
          work_revision: number;
        }>(`/api/sessions/${w.session.id}/undo`, {
          method: "POST",
          body: JSON.stringify({
            group_id: group || events[0].action_group_id,
            request_id: uuid(),
          }),
        });
        patch((prev) => ({
          ...prev,
          objects: r.actions.reduce(
            (acc, a) => applyCommitted(acc, a),
            prev.objects,
          ),
          session: {
            ...prev.session,
            scene_revision: r.scene_revision,
            work_revision: r.work_revision,
          },
          events: [...prev.events, ...r.actions],
        }));
      }
      redoStack.current.push(events);
      editor.set({ selection: [] });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function redo() {
    const events = redoStack.current.pop();
    if (!events) return;
    const group = uuid();
    const inputs = events.map((e) => {
      const current = wRef.current.objects.find((o) => o.id === e.object_id);
      return {
        ...actionFor(
          e.after?.geometry || emptyGeometry,
          current,
          e.after ? (current ? "update" : "create") : "delete",
          group,
        ),
        object_id: e.object_id,
        style: e.after?.style || null,
        visible: e.after?.visible ?? null,
        locked: false,
      };
    });
    await commit(inputs);
  }
  function editSelection(action: string) {
    const group = uuid();
    const s = useEditor.getState();
    void commit(
      selected.map((o) => {
        const g = { ...o.geometry };
        if (action === "duplicate") {
          g.x += 18;
          g.y += 18;
        }
        if (action === "rotate") g.rotation = (g.rotation + 15) % 360;
        const input = actionFor(
          g,
          action === "duplicate" ? undefined : o,
          action === "delete"
            ? "delete"
            : action === "duplicate"
              ? "create"
              : "update",
          group,
        );
        if (action === "style")
          input.style = {
            ...o.style,
            color: s.color,
            fill: s.fill,
            width: s.stroke,
            opacity: s.opacity,
            dash: s.dash,
            lineEnding: s.lineEnding,
            fontSize: s.fontSize,
          };
        if (action === "lock") input.locked = !o.locked;
        if (action === "group") input.group = group;
        if (action === "ungroup") input.group = null;
        if (action === "duplicate") input.style = o.style;
        return input;
      }),
    );
  }
  async function upload() {
    if (!file) return;
    if (demo) {
      setAuthOpen(true);
      return;
    }
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("role", role);
      form.set("disclosure", disclosed ? "accepted" : "");
      await api(`/api/sessions/${w.session.id}/documents`, {
        method: "POST",
        body: form,
      });
      setModal("");
      setFile(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  function chooseFile(f?: File) {
    if (!f) return;
    setFile(f);
    setModal("upload");
    setDisclosed(false);
  }
  async function scratch() {
    if (demo) {
      const id = uuid(),
        doc = uuid();
      patch((prev) => ({
        ...prev,
        documents: [
          ...prev.documents,
          {
            id: doc,
            name: "Scratch paper",
            role: "scratch",
            mime: "application/x-scriblune-scratch",
            status: "ready",
            page_count: 1,
          },
        ],
        pages: [
          ...prev.pages,
          {
            ...prev.pages[0],
            id,
            document_id: doc,
            page_number: 1,
            render_path: null,
            text_content: "",
            source_regions: [],
            extraction_method: "scratch",
          },
        ],
      }));
      changePage(id);
      return;
    }
    try {
      const r = await api<{ page_id: string }>(
        `/api/sessions/${w.session.id}/scratch`,
        { method: "POST", body: "{}" },
      );
      await refresh();
      changePage(r.page_id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function animationLoop(replay = false) {
    if (animationRunning.current) return;
    animationRunning.current = true;
    const generation = cancelGeneration.current;
    while (
      animationQueue.current.length &&
      generation === cancelGeneration.current
    ) {
      const action = animationQueue.current.shift()!;
      const after = action.after;
      if (!after) {
        if (replay) continue;
        patch((prev) => ({
          ...prev,
          objects: applyCommitted(prev.objects, action),
          events: [...prev.events, action],
        }));
        continue;
      }
      if (useEditor.getState().follow) {
        changePage(after.page_id);
        setFocus({
          page_id: after.page_id,
          region: bounds(after.geometry),
          label: "Tutor drawing",
        });
        setRevealToken((value) => value + 1);
      }
      const original = after.geometry;
      let geometry = original;
      if (original.kind === "ellipse") {
        const points = Array.from({ length: 100 }, (_, i) => {
          const angle = (i / 99) * Math.PI * 2;
          return {
            x: original.width / 2 + (Math.cos(angle) * original.width) / 2,
            y: original.height / 2 + (Math.sin(angle) * original.height) / 2,
          };
        });
        geometry = { ...original, kind: "path", points };
      }
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? 0
        : action.animation_parameters.duration_ms;
      let elapsed = 0,
        last = performance.now();
      await new Promise<void>((resolve) => {
        function frame(now: number) {
          if (generation !== cancelGeneration.current) {
            resolve();
            return;
          }
          const s = useEditor.getState();
          if (!s.paused) elapsed += (now - last) * s.speed;
          last = now;
          const progress = duration ? Math.min(1, elapsed / duration) : 1;
          setAnimationObject({
            ...after!,
            geometry: geometry.points.length
              ? {
                  ...geometry,
                  points: geometry.points.slice(
                    0,
                    Math.max(2, Math.round(geometry.points.length * progress)),
                  ),
                }
              : geometry,
            style: {
              ...after!.style,
              opacity:
                after!.style.opacity * (geometry.points.length ? 1 : progress),
            },
          });
          if (progress < 1) requestAnimationFrame(frame);
          else resolve();
        }
        requestAnimationFrame(frame);
      });
      if (generation !== cancelGeneration.current) break;
      if (!replay)
        patch((prev) => ({
          ...prev,
          objects: applyCommitted(prev.objects, action),
          events: prev.events.some((e) => e.action_id === action.action_id)
            ? prev.events
            : [...prev.events, action],
          session: {
            ...prev.session,
            scene_revision: Math.max(
              prev.session.scene_revision,
              action.sequence_number,
            ),
          },
        }));
      setAnimationObject(null);
      if (!replay && !demo && turn.current)
        await api(`/api/sessions/${w.session.id}/ack`, {
          method: "POST",
          body: JSON.stringify({
            turn_id: turn.current,
            action_id: action.action_id,
          }),
        }).catch(() => {});
    }
    animationRunning.current = false;
    if (streamDone.current) {
      setBusy(false);
      setActivity("Ready");
      setStreamText("");
      if (!demo) {
        const next = await api<Workspace>(`/api/sessions/${w.session.id}`);
        replace(next);
      }
    }
  }
  async function stop() {
    cancelGeneration.current++;
    animationQueue.current = [];
    setAnimationObject(null);
    abort.current?.abort();
    editor.set({ paused: false });
    if (!demo && turn.current) {
      try {
        await api(`/api/sessions/${w.session.id}/cancel`, {
          method: "POST",
          body: JSON.stringify({ turn_id: turn.current }),
        });
        const next = await api<Workspace>(`/api/sessions/${w.session.id}`);
        replace(next);
      } catch (e) {
        setError(
          "The stop request could not be confirmed. Reconnect to check the saved explanation.",
        );
      }
    }
    setBusy(false);
    setActivity("Stopped");
    setStreamText("");
  }
  async function send(text: string) {
    if (demo || busy || !page) return;
    if (pending.current.length) {
      await flush();
      if (pending.current.length) {
        setError(
          "Save your ink before asking the tutor, so it sees your latest work.",
        );
        return;
      }
    }
    setError("");
    setBusy(true);
    setStreamText("");
    streamDone.current = false;
    abort.current = new AbortController();
    const turnId = uuid();
    turn.current = turnId;
    try {
      const response = await fetch(`/api/sessions/${w.session.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turn_id: turnId,
          page_id: page.id,
          message: text,
          selection: editor.region || selectedRegion(selected),
          selected_ids: editor.selection,
        }),
        signal: abort.current.signal,
      });
      if (!response.ok) {
        const b = await response.json();
        throw new Error(b.error);
      }
      if (
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        await refresh();
        setBusy(false);
        return;
      }
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (!chunk.startsWith("data: ")) continue;
          const event = JSON.parse(chunk.slice(6));
          if (event.type === "accepted")
            patch((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                {
                  id: turnId,
                  turn_id: turnId,
                  role: "student",
                  content: text,
                  status: "complete",
                  created_at: new Date().toISOString(),
                  references_json: [],
                },
              ],
            }));
          if (event.type === "delta") setStreamText((t) => t + event.text);
          if (event.type === "activity") setActivity(event.activity);
          if (event.type === "focus") setFocus(event);
          if (event.type === "action") {
            animationQueue.current.push(event.action);
            void animationLoop();
          }
          if (event.type === "error") setError(event.error);
          if (event.type === "done") streamDone.current = true;
        }
      }
      streamDone.current = true;
      if (!animationRunning.current) {
        setBusy(false);
        setActivity("Ready");
        setStreamText("");
        replace(await api<Workspace>(`/api/sessions/${w.session.id}`));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
      setBusy(false);
      setActivity("Reconnecting");
    }
  }
  function sample() {
    if (busy || !page) return;
    setBusy(true);
    streamDone.current = true;
    setActivity("Drawing · scripted sample");
    const group = uuid(),
      id = uuid();
    const target =
      page.id === DEMO_PAGE
        ? { x: 270, y: 890, width: 60, height: 68 }
        : { x: 180, y: 330, width: 300, height: 220 };
    const a: WorkspaceAction = {
      ...actionFor({ ...emptyGeometry, kind: "ellipse", ...target }),
      action_group_id: group,
      object_id: id,
      actor: "tutor",
      turn_id: uuid(),
      sequence_number: wRef.current.session.scene_revision + 1,
      animation_parameters: { duration_ms: 1900 },
      before: null,
      after: {
        id,
        page_id: page.id,
        actor: "tutor",
        action_group_id: group,
        revision: wRef.current.session.scene_revision + 1,
        geometry: { ...emptyGeometry, kind: "ellipse", ...target },
        style: { ...defaultStyle, color: "#b16e50", width: 3 },
        visible: true,
        locked: false,
        group: null,
      },
    };
    animationQueue.current.push(a);
    patch((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        {
          id: uuid(),
          turn_id: a.turn_id!,
          role: "tutor",
          content:
            page.id === DEMO_PAGE
              ? "**Scripted sample:** The 8 in $\\frac{6}{8}$ is the denominator. It tells us the whole has been divided into eight equal parts. The 6 counts how many of those parts we have.\n\nThe circle is editable tutor ink. Select it to move or resize it."
              : "**Scripted sample:** This circle is a real editable annotation. Use the graph tool to plot a function, or draw your own approach.",
          status: "complete",
          created_at: new Date().toISOString(),
          references_json: [
            { page_id: page.id, object_id: id, label: "The denominator" },
          ],
        },
      ],
    }));
    void animationLoop();
  }
  function reference(pageId: string, objectId?: string) {
    const o = wRef.current.objects.find((o) => o.id === objectId);
    changePage(pageId);
    if (o) {
      editor.set({ selection: [o.id], tool: "select" });
      setFocus({
        page_id: pageId,
        region: bounds(o.geometry),
        label: "Referenced step",
      });
    }
    setMobileView("page");
    setRevealToken((value) => value + 1);
  }
  function saveText() {
    if (!page || !textEntry.trim()) return;
    const lines = textEntry.split("\n");
    const g: Geometry = {
      ...emptyGeometry,
      kind: textKind,
      x: point.x,
      y: point.y,
      width: Math.min(
        page.width - point.x,
        Math.max(
          170,
          Math.max(...lines.map((l) => l.length)) * editor.fontSize * 0.58,
        ),
      ),
      height: Math.min(
        page.height - point.y,
        Math.max(
          textKind === "sticky" ? 120 : editor.fontSize * 1.5,
          lines.length * editor.fontSize * 1.5,
        ),
      ),
      text: textEntry,
    };
    void commit([actionFor(g)]);
    setModal("");
  }
  function saveGraph() {
    try {
      if (!page) return;
      const width = Math.min(420, page.width - point.x - 20),
        height = Math.min(320, page.height - point.y - 60);
      if (width < 100 || height < 100)
        throw new Error("Click a spot with more room for your graph.");
      const points = plotPoints(
        textEntry,
        { width, height },
        { xMin: -5, xMax: 5, yMin: -10, yMax: 30 },
      );
      const group = uuid();
      void commit([
        actionFor(
          {
            ...emptyGeometry,
            kind: "line",
            x: point.x,
            y: point.y,
            points: [
              { x: 0, y: height * 0.75 },
              { x: width, y: height * 0.75 },
            ],
          },
          undefined,
          "create",
          group,
        ),
        actionFor(
          {
            ...emptyGeometry,
            kind: "line",
            x: point.x,
            y: point.y,
            points: [
              { x: width / 2, y: 0 },
              { x: width / 2, y: height },
            ],
          },
          undefined,
          "create",
          group,
        ),
        actionFor(
          {
            ...emptyGeometry,
            kind: "graph",
            x: point.x,
            y: point.y,
            width,
            height,
            points,
            expression: textEntry,
          },
          undefined,
          "create",
          group,
        ),
        actionFor(
          {
            ...emptyGeometry,
            kind: "math",
            x: point.x,
            y: point.y + height + 10,
            width,
            height: 35,
            text: `y = ${textEntry} · x: −5…5, y: −10…30`,
          },
          undefined,
          "create",
          group,
        ),
      ]);
      setModal("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function addPin() {
    if (!newPin.trim()) return;
    if (demo)
      patch((prev) => ({
        ...prev,
        memories: [
          ...prev.memories,
          {
            id: uuid(),
            kind: "preference",
            content: { text: newPin, basis: "stated" },
            active: true,
            source_ids: [],
            version: 1,
          },
        ],
      }));
    else {
      await api(`/api/sessions/${w.session.id}/memories`, {
        method: "POST",
        body: JSON.stringify({
          text: newPin,
          kind: "preference",
          active: true,
        }),
      });
      await refresh();
    }
    setNewPin("");
  }
  async function exportWork() {
    if (demo) {
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      for (const p of w.pages) {
        const res = await fetch(p.render_path || "/fixtures/blank.png");
        const png = await pdf.embedPng(await res.arrayBuffer());
        const pg = pdf.addPage([p.width * 0.612, p.height * 0.612]);
        pg.drawImage(png, {
          x: 0,
          y: 0,
          width: p.width * 0.612,
          height: p.height * 0.612,
        });
        const { annotationSVG } = await import("@/lib/workspace/svg");
        const svg = annotationSVG(
          p.width,
          p.height,
          w.objects.filter(
            (o) =>
              o.page_id === p.id && (o.actor === "student" || includeTutor),
          ),
        );
        const image = new Image(),
          url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = reject;
          image.src = url;
        });
        const canvas = documentGlobal().createElement("canvas");
        canvas.width = p.width;
        canvas.height = p.height;
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        URL.revokeObjectURL(url);
        const ink = await pdf.embedPng(canvas.toDataURL("image/png"));
        pg.drawImage(ink, {
          x: 0,
          y: 0,
          width: p.width * 0.612,
          height: p.height * 0.612,
        });
      }
      downloadBlob(
        new Blob([(await pdf.save()) as BlobPart], { type: "application/pdf" }),
        "scriblune-sample.pdf",
      );
    } else {
      const response = await fetch(
        `/api/sessions/${w.session.id}/export?tutor=${includeTutor ? "1" : "0"}`,
      );
      if (!response.ok) {
        const e = await response.json();
        throw new Error(e.error);
      }
      downloadBlob(await response.blob(), "scriblune-assignment.pdf");
    }
  }
  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob),
      a = documentGlobal().createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const liveObjects = animationObject
    ? [...w.objects.filter((o) => o.id !== animationObject.id), animationObject]
    : w.objects;
  return (
    <div
      className={`study-room mobile-${mobileView}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        chooseFile(e.dataTransfer.files[0]);
      }}
      onPaste={(e) => {
        const image = Array.from(e.clipboardData.items).find((i) =>
          i.type.startsWith("image/"),
        );
        if (image) {
          e.preventDefault();
          chooseFile(image.getAsFile() || undefined);
        }
      }}
    >
      <header className="room-header">
        <Logo />
        <span className="header-divider" />
        <div className="session-name">
          <input
            aria-label="Session title"
            value={w.session.title}
            onChange={(e) =>
              patch((prev) => ({
                ...prev,
                session: { ...prev.session, title: e.target.value },
              }))
            }
            onBlur={() => saveLayout({ title: w.session.title })}
            maxLength={160}
          />
          <button
            className={`save-status ${saveState.includes("Not") ? "unsaved" : ""}`}
            onClick={() => void flush()}
            title="Save status"
          >
            {saveState === "Saving…" ? (
              <LoaderCircle className="spin" size={11} />
            ) : saveState.includes("Not") ? (
              <CloudOff size={12} />
            ) : (
              <Check size={12} />
            )}{" "}
            {saveState}
          </button>
        </div>
        <div className="room-header-actions">
          {demo ? (
            <button className="text-button" onClick={() => setAuthOpen(true)}>
              Start a real session
            </button>
          ) : (
            <Link href="/desk" className="text-button">
              My desk
            </Link>
          )}
          <button
            className="button review-button"
            onClick={() => setModal("review")}
          >
            <FileCheck2 size={16} />
            <span>Review my work</span>
          </button>
          <button
            className="icon-button"
            aria-label="Session options"
            onClick={() => setModal("options")}
          >
            <MoreHorizontal size={22} />
          </button>
        </div>
      </header>
      {demo && (
        <div className="demo-ribbon">
          <span>YOUR SANDBOX</span> Sample assignment · drawings save on this
          device · tutor example is scripted{" "}
          <Link href="/">Back to Scriblune</Link>
        </div>
      )}
      <div className="mobile-switch">
        <button
          aria-pressed={mobileView === "page"}
          onClick={() => setMobileView("page")}
        >
          <BookOpen size={16} /> Your page
        </button>
        <button
          aria-pressed={mobileView === "chat"}
          onClick={() => setMobileView("chat")}
        >
          <MessageSquare size={16} /> Tutor & chat
        </button>
      </div>
      {error && (
        <div className="room-error" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div
        className="room-body"
        style={
          { "--workspace-split": `${editor.split}%` } as React.CSSProperties
        }
      >
        <section className="workspace-panel" aria-label="Assignment workspace">
          <div className="workspace-topbar">
            <button
              className={`icon-button ${editor.rail ? "is-active" : ""}`}
              aria-label="Toggle page thumbnails"
              onClick={() => {
                editor.set({ rail: !editor.rail });
                saveLayout();
              }}
            >
              <PanelLeft size={17} />
            </button>
            <FileText size={15} />
            <select
              aria-label="Choose document"
              value={document?.id || ""}
              onChange={(e) => {
                const p = w.pages.find((p) => p.document_id === e.target.value);
                if (p) changePage(p.id);
              }}
            >
              {!w.documents.length && <option>Your assignment</option>}
              {w.documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.status !== "ready" ? ` · ${d.status}` : ""}
                </option>
              ))}
            </select>
            <button
              className="icon-button add-document"
              aria-label="Add document"
              onClick={() => setModal("upload")}
            >
              <Plus size={17} />
            </button>
            <span className="workspace-nav">
              <button
                className="icon-button"
                aria-label="Previous page"
                disabled={!page || w.pages.indexOf(page) === 0}
                onClick={() =>
                  changePage(w.pages[w.pages.indexOf(page!) - 1].id)
                }
              >
                <ChevronLeft size={15} />
              </button>
              <span>
                {page ? w.pages.indexOf(page) + 1 : 0}{" "}
                <span className="muted">/ {w.pages.length}</span>
              </span>
              <button
                className="icon-button"
                aria-label="Next page"
                disabled={!page || w.pages.indexOf(page) === w.pages.length - 1}
                onClick={() =>
                  changePage(w.pages[w.pages.indexOf(page!) + 1].id)
                }
              >
                <ChevronRight size={15} />
              </button>
            </span>
            <button
              className="icon-button"
              aria-label="Search assignment text"
              onClick={() => setModal("search")}
            >
              <Search size={16} />
            </button>
          </div>
          {w.jobs.some((j) => !["complete", "failed"].includes(j.status)) && (
            <div className="processing-strip">
              <LoaderCircle size={13} className="spin" />{" "}
              {w.jobs.find((j) => j.status === "running")
                ? "Rendering and indexing pages…"
                : "Waiting for the document worker…"}{" "}
              Pages open as they become available.
            </div>
          )}
          {w.documents
            .filter((d) => d.status === "failed")
            .map((d) => (
              <div className="processing-strip error" key={d.id}>
                {d.name}: {d.error}
                <a
                  href={`/api/sessions/${w.session.id}/documents/${d.id}/original`}
                >
                  Download original
                </a>
                <button
                  className="text-button"
                  onClick={() =>
                    void api(
                      `/api/sessions/${w.session.id}/documents/${d.id}/retry`,
                      { method: "POST", body: "{}" },
                    )
                      .then(refresh)
                      .catch((e) => setError(e.message))
                  }
                >
                  Retry processing
                </button>
              </div>
            ))}
          <div className="canvas-area">
            {editor.rail && (
              <div className="thumbnail-rail">
                {w.pages.map((p, i) => (
                  <button
                    className={page?.id === p.id ? "active" : ""}
                    key={p.id}
                    onClick={() => changePage(p.id)}
                    aria-label={`Open page ${i + 1}`}
                  >
                    {p.render_path ? (
                      <img
                        alt=""
                        src={
                          demo
                            ? p.render_path
                            : `/api/sessions/${w.session.id}/pages/${p.id}/image`
                        }
                      />
                    ) : (
                      <span className="scratch-thumb" />
                    )}
                    <span>{i + 1}</span>
                  </button>
                ))}
                <button className="add-scratch" onClick={() => void scratch()}>
                  <Plus size={15} />
                  <span>Scratch</span>
                </button>
              </div>
            )}
            {page ? (
              <>
                <WorkspaceCanvas
                  key={page.id}
                  page={page}
                  sessionId={demo ? "demo" : w.session.id}
                  objects={liveObjects}
                  revision={w.session.scene_revision}
                  disabled={readOnly}
                  onCommit={commit}
                  onError={setError}
                  onText={(kind, p) => {
                    setTextKind(kind);
                    setPoint(p);
                    setTextEntry("");
                    setModal("text");
                  }}
                  onGraph={(p) => {
                    setPoint(p);
                    setTextEntry("x^2");
                    setModal("graph");
                  }}
                  focus={focus?.page_id === page.id ? focus.region : null}
                  revealToken={revealToken}
                />
                <DrawingToolbar
                  selected={selected}
                  canUndo={undoStack.current.length > 0}
                  canRedo={redoStack.current.length > 0}
                  onUndo={() => void undo()}
                  onRedo={() => void redo()}
                  onEdit={editSelection}
                />
              </>
            ) : (
              <div className="empty-workspace">
                <div className="empty-paper">
                  <FileUp size={35} />
                  <h1>
                    Every idea starts
                    <br />
                    with a page.
                  </h1>
                  <p>
                    Drop your assignment here, paste an image,
                    <br />
                    or choose a file to get started.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setModal("upload")}
                  >
                    Bring your page
                  </button>
                  <span>PDF, PNG, JPEG & WebP · Up to 20 MB</span>
                </div>
                <button className="text-button" onClick={() => void scratch()}>
                  Or start with scratch paper
                </button>
              </div>
            )}
          </div>
          <div className="workspace-bottom">
            <button className="text-button" onClick={() => setModal("layers")}>
              <Layers size={14} /> Layers
            </button>
            <button
              className="text-button scratch-link"
              onClick={() => void scratch()}
            >
              <Plus size={14} /> Scratch paper
            </button>
            {focus && (
              <button
                className="focus-indicator"
                onClick={() => reference(focus.page_id)}
              >
                <Scan size={12} />
                {focus.label} · Bring into view
              </button>
            )}
            <div className="zoom-controls">
              <button
                className="icon-button"
                aria-label="Zoom out"
                onClick={() => {
                  editor.set({ zoom: Math.max(0.3, editor.zoom - 0.2) });
                  saveLayout();
                }}
              >
                <Minus size={14} />
              </button>
              <button
                className="text-button"
                title="Fit page"
                onClick={() => {
                  editor.set({ zoom: 1 });
                  saveLayout();
                }}
              >
                {Math.round(editor.zoom * 100)}%
              </button>
              <button
                className="icon-button"
                aria-label="Zoom in"
                onClick={() => {
                  editor.set({ zoom: Math.min(4, editor.zoom + 0.2) });
                  saveLayout();
                }}
              >
                <Plus size={14} />
              </button>
              <button
                className="icon-button"
                aria-label="Fit to width"
                onClick={() => {
                  const viewport =
                    documentGlobal().querySelector<HTMLElement>(
                      ".canvas-scroll",
                    );
                  if (viewport && page) {
                    const rotated = editor.rotation % 180 !== 0;
                    const width = rotated ? page.height : page.width;
                    const height = rotated ? page.width : page.height;
                    const fitWidth = (viewport.clientWidth - 90) / width;
                    const fit = Math.min(
                      fitWidth,
                      (viewport.clientHeight - 105) / height,
                    );
                    editor.set({ zoom: fitWidth / Math.max(0.001, fit) });
                  }
                  saveLayout();
                }}
              >
                <Maximize2 size={14} />
              </button>
              <button
                className="icon-button"
                aria-label="Rotate page"
                onClick={() => {
                  editor.set({ rotation: (editor.rotation + 90) % 360 });
                  saveLayout();
                }}
              >
                <RotateCw size={14} />
              </button>
            </div>
          </div>
        </section>
        <div
          className="room-divider"
          role="separator"
          aria-label="Resize workspace and chat"
          aria-orientation="vertical"
          aria-valuemin={45}
          aria-valuemax={78}
          aria-valuenow={editor.split}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              editor.set({
                split: Math.max(
                  45,
                  Math.min(
                    78,
                    editor.split + (e.key === "ArrowRight" ? 2 : -2),
                  ),
                ),
              });
              saveLayout();
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              const parent =
                e.currentTarget.parentElement!.getBoundingClientRect();
              editor.set({
                split: Math.max(
                  45,
                  Math.min(
                    78,
                    ((e.clientX - parent.left) / parent.width) * 100,
                  ),
                ),
              });
            }
          }}
          onPointerUp={() => saveLayout()}
        >
          <span />
        </div>
        <Chat
          messages={w.messages}
          streamText={streamText}
          activity={activity}
          busy={busy}
          onSend={(text) => void send(text)}
          onStop={() => void stop()}
          onAttach={() => setModal("upload")}
          onReference={reference}
          onMemories={() => setModal("memories")}
          memories={w.memories}
          selection={editor.region || selectedRegion(selected)}
          demo={demo}
          onSample={sample}
          aiAvailable={w.setup.tutor}
          readOnly={readOnly}
        />
      </div>
      {busy && (
        <div className="explanation-controls">
          <span>{demo ? "Sample ink" : "Tutor explanation"}</span>
          <button
            className="icon-button"
            aria-label={editor.paused ? "Resume drawing" : "Pause drawing"}
            onClick={() => editor.set({ paused: !editor.paused })}
          >
            {editor.paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button
            className="text-button"
            onClick={() =>
              editor.set({
                speed: editor.speed === 1 ? 2 : editor.speed === 2 ? 4 : 1,
              })
            }
          >
            {editor.speed}×
          </button>
          <button className="text-button" onClick={() => void stop()}>
            Stop
          </button>
          <label>
            <input
              type="checkbox"
              checked={editor.follow}
              onChange={(e) => editor.set({ follow: e.target.checked })}
            />{" "}
            Follow tutor
          </label>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => chooseFile(e.target.files?.[0])}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => chooseFile(e.target.files?.[0])}
      />
      <Dialog
        open={modal === "upload"}
        onClose={() => setModal("")}
        title="Bring your page"
      >
        <div className="upload-dialog-body">
          <div
            className="drop-zone"
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") fileInput.current?.click();
            }}
          >
            <FileUp size={34} />
            <h3>{file ? file.name : "An assignment. A fresh perspective."}</h3>
            <p>
              {file
                ? `${(file.size / 1024 / 1024).toFixed(1)} MB · Kept locally until you confirm`
                : "Choose a file, drag it here, or paste an image."}
            </p>
            <span>PDF, PNG, JPEG & WebP · 20 MB · 30 PDF pages</span>
          </div>
          <div className="upload-buttons">
            <button
              className="button secondary"
              onClick={() => fileInput.current?.click()}
            >
              <FileText size={15} /> Choose a file
            </button>
            <button
              className="button secondary camera-input"
              onClick={() => photoInput.current?.click()}
            >
              <Camera size={16} /> Take a photo
            </button>
          </div>
          <label>
            This document contains
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="assignment">Assignment instructions</option>
              <option value="student_work">
                My completed or in-progress work
              </option>
              <option value="mixed">
                Instructions and work · mixed content
              </option>
              <option value="rubric">A rubric / marking criteria</option>
              <option value="reference">Reference material</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={disclosed}
              onChange={(e) => setDisclosed(e.target.checked)}
            />{" "}
            Save this file privately and process its pages. Relevant pages and
            my annotations will be sent to the configured AI provider for
            tutoring and review. I have permission to use this material.
          </label>
          {demo && (
            <p className="notice">
              Your file stays on this device until you sign in to a real
              session. If sign-in redirects, you may need to select it again.
            </p>
          )}
          <button
            className="button primary full"
            disabled={!file || !disclosed || uploading}
            onClick={() => void upload()}
          >
            {uploading ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <FileUp size={17} />
            )}{" "}
            {demo
              ? "Sign in to open my assignment"
              : uploading
                ? "Saving your original…"
                : "Open on my desk"}
          </button>
        </div>
      </Dialog>
      <Dialog
        open={modal === "text" || modal === "graph"}
        onClose={() => setModal("")}
        title={
          modal === "graph"
            ? "Give an idea a shape"
            : textKind === "math"
              ? "Write a mathematical step"
              : textKind === "sticky"
                ? "Leave yourself a note"
                : "A little annotation"
        }
      >
        <div className="dialog-body">
          <label>
            {modal === "graph" ? "y =" : "Your text"}
            <textarea
              autoFocus
              rows={3}
              value={textEntry}
              onChange={(e) => setTextEntry(e.target.value)}
              maxLength={modal === "graph" ? 120 : 2000}
            />
          </label>
          <p className="muted small-copy">
            {modal === "graph"
              ? "Use x, numbers, + − * / ^, sin, cos, sqrt, abs, ln, exp. Range: x −5 to 5; y −10 to 30."
              : textKind === "math"
                ? "Use mathematical symbols such as x², ½, √, π, and ≤."
                : "This becomes an editable mark on your page."}
          </p>
          <button
            className="button primary full"
            onClick={modal === "graph" ? saveGraph : saveText}
          >
            Add to my page
          </button>
        </div>
      </Dialog>
      <Dialog
        open={modal === "layers"}
        onClose={() => setModal("")}
        title="Make room for your thinking"
      >
        <div className="dialog-body">
          <p>
            Keep your original page untouched. Show the layers that help you
            right now.
          </p>
          <div className="layer-row">
            <span>Original assignment</span>
            <LockKeyholeFallback />
          </div>
          {(["student", "tutor", "grading"] as const).map((layer) => (
            <label className="layer-row" key={layer}>
              <span>
                <i className={`layer-dot ${layer}`} />
                {layer === "student"
                  ? "Your work"
                  : layer === "tutor"
                    ? "Tutor teaching ink"
                    : "Review feedback"}
              </span>
              <input
                type="checkbox"
                checked={editor.layers[layer]}
                onChange={(e) =>
                  editor.set({
                    layers: { ...editor.layers, [layer]: e.target.checked },
                  })
                }
              />
            </label>
          ))}
          <button
            className="text-button"
            onClick={() => {
              const last = [...w.events]
                .reverse()
                .find((e) => e.actor === "tutor" && e.action_group_id);
              if (last) void undo(last.action_group_id);
            }}
          >
            Undo the tutor’s last explanation
          </button>
        </div>
      </Dialog>
      <Dialog
        open={modal === "memories"}
        onClose={() => setModal("")}
        title="Keep the important things close"
      >
        <div className="dialog-body">
          <p className="muted">
            Memory pins belong to this session. You can change or remove them
            whenever your thinking changes.
          </p>
          {w.memories.map((m) => (
            <div className="memory-row" key={m.id}>
              <Pin size={16} />
              <input
                aria-label="Memory pin"
                defaultValue={String(
                  m.content.text || JSON.stringify(m.content),
                )}
                onBlur={async (e) => {
                  if (demo)
                    patch((prev) => ({
                      ...prev,
                      memories: prev.memories.map((p) =>
                        p.id === m.id
                          ? { ...p, content: { text: e.target.value } }
                          : p,
                      ),
                    }));
                  else
                    await api(`/api/sessions/${w.session.id}/memories`, {
                      method: "POST",
                      body: JSON.stringify({
                        id: m.id,
                        text: e.target.value,
                        kind: ["goal", "ledger"].includes(m.kind)
                          ? m.kind
                          : "preference",
                        active: m.active,
                      }),
                    });
                }}
              />
              <button
                className="icon-button"
                aria-label="Delete memory pin"
                onClick={async () => {
                  if (!demo)
                    await api(`/api/sessions/${w.session.id}/memories`, {
                      method: "DELETE",
                      body: JSON.stringify({ id: m.id }),
                    });
                  patch((prev) => ({
                    ...prev,
                    memories: prev.memories.filter((p) => p.id !== m.id),
                  }));
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <label>
            Add a goal or preference
            <input
              placeholder="For example: let me try the next step first."
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              maxLength={500}
            />
          </label>
          <button className="button primary" onClick={() => void addPin()}>
            Pin this thought
          </button>
          {!demo && (
            <Link className="text-button" href="/account">
              Manage preferences across sessions
            </Link>
          )}
        </div>
      </Dialog>
      <Dialog
        open={modal === "search"}
        onClose={() => setModal("")}
        title="Find a thought on your page"
      >
        <div className="dialog-body">
          <input
            autoFocus
            placeholder="Search extracted assignment text"
            aria-label="Search text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <p className="muted small-copy">
            Image text is searchable after visual indexing when the AI provider
            is configured. Unreadable symbols may be missing.
          </p>
          {search.length > 1 &&
            w.pages
              .filter((p) =>
                p.text_content.toLowerCase().includes(search.toLowerCase()),
              )
              .map((p) => (
                <button
                  className="search-result"
                  key={p.id}
                  onClick={() => {
                    changePage(p.id);
                    setModal("");
                  }}
                >
                  <FileText size={18} />
                  <span>
                    Page {p.page_number}
                    <small>
                      {p.text_content.slice(
                        Math.max(
                          0,
                          p.text_content
                            .toLowerCase()
                            .indexOf(search.toLowerCase()) - 35,
                        ),
                        p.text_content
                          .toLowerCase()
                          .indexOf(search.toLowerCase()) + 120,
                      )}
                    </small>
                  </span>
                </button>
              ))}
        </div>
      </Dialog>
      <Dialog
        open={modal === "options"}
        onClose={() => setModal("")}
        title="Your study desk"
      >
        <div className="dialog-body options-list">
          <button onClick={() => setModal("export")}>
            <Download size={19} /> Export your assignment
          </button>
          <button
            onClick={() => {
              setModal("");
              const last = [...w.events]
                .reverse()
                .find((e) => e.actor === "tutor" && e.after);
              if (last) {
                const group = w.events.filter(
                  (e) =>
                    e.action_group_id === last.action_group_id &&
                    e.after &&
                    w.objects.some(
                      (o) =>
                        o.id === e.object_id &&
                        o.revision === e.sequence_number,
                    ),
                );
                animationQueue.current.push(...group);
                streamDone.current = true;
                setBusy(true);
                turn.current = null;
                void animationLoop(true);
              } else
                setError(
                  "There isn’t a saved drawing explanation to replay yet.",
                );
            }}
          >
            <Play size={19} /> Replay the last tutor explanation
          </button>
          <button onClick={() => setModal("memories")}>
            <Pin size={19} /> Memory pins
          </button>
          <button
            onClick={() => {
              setModal("");
              void scratch();
            }}
          >
            <Plus size={19} /> Add scratch paper
          </button>
          {!demo && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={recovery}
                onChange={(e) => {
                  setRecovery(e.target.checked);
                  if (!e.target.checked)
                    sessionStorage.removeItem(
                      `scriblune-recovery-${w.session.id}`,
                    );
                }}
              />{" "}
              Keep unsaved drawing actions temporarily in this browser tab for
              recovery. Cleared on save or sign-out.
            </label>
          )}
          {readOnly && (
            <button
              onClick={async () => {
                const r = await api<{ id: string }>(
                  `/api/sessions/${w.session.id}/continue`,
                  { method: "POST", body: "{}" },
                );
                location.href = `/study/${r.id}`;
              }}
            >
              <Plus size={19} /> Continue in a new draft
            </button>
          )}
          <Link href={demo ? "/" : "/desk"}>
            Save a pause. Back to my desk.
          </Link>
        </div>
      </Dialog>
      <Dialog
        open={modal === "export"}
        onClose={() => setModal("")}
        title="Take your thinking with you"
      >
        <div className="dialog-body">
          <p>
            Your assignment exports as a PDF. Original content and your own work
            are included.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={includeTutor}
              onChange={(e) => setIncludeTutor(e.target.checked)}
            />{" "}
            Include tutor teaching overlays
          </label>
          <button
            className="button primary full"
            onClick={() => void exportWork().catch((e) => setError(e.message))}
          >
            <Download size={16} /> Download assignment
          </button>
          {!demo && (
            <a
              className="button secondary full"
              href={`/api/sessions/${w.session.id}/export?format=recap`}
            >
              Download a separate learning recap
            </a>
          )}
          <p className="muted small-copy">
            Exports never contain private feedback. Exporting doesn’t send work
            to a teacher.
          </p>
        </div>
      </Dialog>
      <ReviewDialog
        open={modal === "review"}
        onClose={() => setModal("")}
        workspace={w}
        onRefresh={refresh}
        demo={demo}
      />
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={() => {
          location.href = "/desk";
        }}
      />
    </div>
  );
}
function LockKeyholeFallback() {
  return <span className="muted small-copy">Protected</span>;
}
