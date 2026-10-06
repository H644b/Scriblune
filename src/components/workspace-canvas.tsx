"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { useEditor } from "@/lib/workspace/store";
import {
  type Annotation,
  type DocumentPage,
  type ActionInput,
  type Point,
  type Geometry,
  emptyGeometry,
  defaultStyle,
  type Region,
} from "@/lib/workspace/types";
import { objectSVG } from "@/lib/workspace/svg";
import {
  bounds,
  pathData,
  rotationTransform,
  unrotatePoint,
  simplify,
  hitsPolygon,
  selectedRegion,
} from "@/lib/workspace/geometry";
import { plotPoints } from "@/lib/workspace/expression";
const uuid = () => crypto.randomUUID();
type Props = {
  page: DocumentPage;
  sessionId: string;
  objects: Annotation[];
  revision: number;
  disabled: boolean;
  onCommit: (inputs: ActionInput[]) => Promise<void>;
  onInteraction?: (active: boolean) => void;
  onError: (message: string) => void;
  onText: (kind: "text" | "math" | "sticky", point: Point) => void;
  onGraph: (point: Point) => void;
  focus: Region | null;
  revealToken: number;
};
export function WorkspaceCanvas({
  page,
  sessionId,
  objects,
  revision,
  disabled,
  onCommit,
  onInteraction,
  onError,
  onText,
  onGraph,
  focus,
  revealToken,
}: Props) {
  const state = useEditor();
  const viewport = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const [fit, setFit] = useState(0.6);
  const focusRect = useRef<SVGRectElement>(null);
  const [drawing, setDrawing] = useState<Geometry | null>(null);
  const [moving, setMoving] = useState<Record<string, Geometry>>({});
  const [selectBox, setSelectBox] = useState<Region | null>(null);
  const drag = useRef<{
    start: Point;
    points: Point[];
    mode: string;
    objects: Annotation[];
    handle?: string;
  } | null>(null);
  const [polygon, setPolygon] = useState<Point[]>([]);
  const rotated = state.rotation % 180 !== 0;
  const w = rotated ? page.height : page.width,
    h = rotated ? page.width : page.height;
  const zoom = fit * state.zoom;
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setFit(Math.min((el.clientWidth - 90) / w, (el.clientHeight - 105) / h)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [w, h]);
  useEffect(() => {
    setPolygon([]);
    setDrawing(null);
  }, [page.id]);
  useEffect(() => {
    if (!revealToken) return;
    const frame = requestAnimationFrame(() =>
      focusRect.current?.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [revealToken, page.id]);
  function point(e: React.PointerEvent<SVGSVGElement>): Point {
    const matrix = svg.current!.getScreenCTM();
    const local = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix!.inverse(),
    );
    const p = unrotatePoint(local, page.width, page.height, state.rotation);
    return {
      x: Math.max(0, Math.min(page.width, p.x)),
      y: Math.max(0, Math.min(page.height, p.y)),
      pressure: e.pressure || 0.5,
    };
  }
  function inputFor(
    g: Geometry,
    object?: Annotation,
    operation: "create" | "update" | "delete" = "create",
    group = uuid(),
  ): ActionInput {
    return {
      action_id: uuid(),
      action_group_id: group,
      page_id: page.id,
      object_id: object?.id || uuid(),
      operation_type: operation,
      base_scene_revision: revision,
      base_object_revision: object?.revision ?? null,
      geometry: operation === "delete" ? null : g,
      style: object?.style || {
        ...defaultStyle,
        color: state.color,
        width:
          state.tool === "highlighter"
            ? Math.max(18, state.stroke * 5)
            : state.tool === "brush"
              ? state.stroke * 2
              : state.stroke,
        opacity:
          state.tool === "highlighter"
            ? 0.28
            : state.tool === "pencil"
              ? state.opacity * 0.75
              : state.opacity,
        fill: state.fill,
        dash: state.dash,
        lineEnding: state.lineEnding,
        fontSize: state.fontSize,
      },
      visible: true,
      locked: object?.locked ?? false,
      group: object?.group ?? null,
    };
  }
  const visible = objects.filter(
    (o) => o.page_id === page.id && state.layers[o.actor] && o.visible,
  );
  const selected = visible.filter((o) => state.selection.includes(o.id));
  const selectionBounds = selectedRegion(selected);
  async function rasterFill(p: Point) {
    try {
      if (!svg.current) return;
      const clone = svg.current.cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll("[data-editor-ui]").forEach((n) => n.remove());
      const imageNode = clone.querySelector("image");
      if (imageNode) {
        const response = await fetch(imageNode.getAttribute("href")!);
        const blob = await response.blob();
        const data = await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.readAsDataURL(blob);
        });
        imageNode.setAttribute("href", data);
      }
      clone.setAttribute("width", String(w));
      clone.setAttribute("height", String(h));
      const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
        type: "image/svg+xml",
      });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error("Could not read the page for fill."));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      if (state.rotation !== 0)
        throw new Error("Reset page rotation before raster fill.");
      const pixels = ctx.getImageData(0, 0, w, h);
      const worker = new Worker("/workers/fill.js");
      const spans = await new Promise<Geometry["spans"]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error("Fill took too long. Try a smaller region."));
        }, 8000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timeout);
          worker.terminate();
          if (data.error) reject(new Error(data.error));
          else resolve(data.spans);
        };
        worker.postMessage(
          {
            pixels: pixels.data.buffer,
            width: w,
            height: h,
            x: p.x,
            y: p.y,
            tolerance: state.tolerance,
          },
          [pixels.data.buffer],
        );
      });
      await onCommit([inputFor({ ...emptyGeometry, kind: "mask", spans })]);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  function down(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const p = point(e),
      el = e.target as Element;
    const object = visible.find(
      (o) => o.id === el.closest("[data-object]")?.getAttribute("data-object"),
    );
    const handle = el.getAttribute("data-handle");
    if (
      state.tool === "select" ||
      state.tool === "lasso" ||
      state.tool === "point"
    ) {
      if (handle && selectionBounds && !disabled) {
        drag.current = {
          start: p,
          points: [],
          mode: "resize",
          objects: selected.filter((o) => !o.locked),
          handle,
        };
      } else if (object && state.tool === "select") {
        const ids = e.shiftKey
          ? [...new Set([...state.selection, object.id])]
          : state.selection.includes(object.id)
            ? state.selection
            : [object.id];
        const groupObjects = object.group
          ? visible.filter((o) => o.group === object.group).map((o) => o.id)
          : ids;
        state.set({ selection: groupObjects, region: null });
        if (!disabled && !object.locked)
          drag.current = {
            start: p,
            points: [],
            mode: "move",
            objects: visible.filter(
              (o) => groupObjects.includes(o.id) && !o.locked,
            ),
          };
      } else {
        if (!e.shiftKey) state.set({ selection: [] });
        drag.current = {
          start: p,
          points: [p],
          mode: state.tool === "lasso" ? "lasso" : "selection",
          objects: [],
        };
        setSelectBox({ x: p.x, y: p.y, width: 0, height: 0 });
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (disabled) {
      onError("This version is read-only. Create a new draft to keep working.");
      return;
    }
    if (state.tool === "eraser") {
      const targets = visible.filter(
        (o) =>
          !o.locked &&
          Math.hypot(
            Math.max(
              bounds(o.geometry).x - p.x,
              0,
              p.x - bounds(o.geometry).x - bounds(o.geometry).width,
            ),
            Math.max(
              bounds(o.geometry).y - p.y,
              0,
              p.y - bounds(o.geometry).y - bounds(o.geometry).height,
            ),
          ) <= state.eraserSize,
      );
      if (targets.length) {
        const group = uuid();
        void onCommit(
          targets.map((o) => inputFor(o.geometry, o, "delete", group)),
        );
      }
      return;
    }
    if (state.tool === "fill") {
      if (
        object &&
        ["ellipse", "rectangle", "polygon", "sticky"].includes(
          object.geometry.kind,
        )
      ) {
        const a = inputFor(object.geometry, object, "update");
        a.style = { ...object.style, fill: state.color };
        void onCommit([a]);
      } else void rasterFill(p);
      return;
    }
    if (["text", "math", "sticky"].includes(state.tool)) {
      onText(state.tool as "text" | "math" | "sticky", p);
      return;
    }
    if (state.tool === "graph") {
      onGraph(p);
      return;
    }
    if (state.tool === "polygon") {
      if (
        polygon.length > 2 &&
        Math.hypot(p.x - polygon[0].x, p.y - polygon[0].y) < 18
      ) {
        void onCommit([
          inputFor({ ...emptyGeometry, kind: "polygon", points: polygon }),
        ]);
        setPolygon([]);
      } else setPolygon([...polygon, p]);
      return;
    }
    drag.current = { start: p, points: [p], mode: "draw", objects: [] };
    setDrawing({
      ...emptyGeometry,
      kind: state.tool === "pen" ? "path" : (state.tool as Geometry["kind"]),
      points: [p],
    });
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const p = point(e),
      dx = p.x - d.start.x,
      dy = p.y - d.start.y;
    if (d.mode === "move") {
      const next: Record<string, Geometry> = {};
      for (const o of d.objects)
        next[o.id] = {
          ...o.geometry,
          x: o.geometry.x + dx,
          y: o.geometry.y + dy,
        };
      setMoving(next);
      return;
    }
    if (d.mode === "resize" && d.objects.length === 1) {
      const o = d.objects[0],
        g = o.geometry,
        b = bounds(g);
      const sx = Math.max(0.1, (b.width + dx) / Math.max(1, b.width)),
        sy = Math.max(0.1, (b.height + dy) / Math.max(1, b.height));
      setMoving({
        [o.id]: {
          ...g,
          width: g.width * sx,
          height: g.height * sy,
          points: g.points.map((q) => ({
            ...q,
            x: (q.x - (b.x - g.x)) * sx + (b.x - g.x),
            y: (q.y - (b.y - g.y)) * sy + (b.y - g.y),
          })),
        },
      });
      return;
    }
    if (d.mode === "selection") {
      setSelectBox({
        x: Math.min(p.x, d.start.x),
        y: Math.min(p.y, d.start.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      });
      return;
    }
    d.points.push(p);
    if (d.mode === "lasso") {
      setDrawing({ ...emptyGeometry, kind: "path", points: d.points.slice() });
      return;
    }
    if (["ellipse", "rectangle"].includes(state.tool))
      setDrawing({
        ...emptyGeometry,
        kind: state.tool as any,
        x: Math.min(p.x, d.start.x),
        y: Math.min(p.y, d.start.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      });
    else if (["line", "arrow"].includes(state.tool))
      setDrawing({
        ...emptyGeometry,
        kind: state.tool as any,
        points: [d.start, p],
      });
    else
      setDrawing({
        ...emptyGeometry,
        kind: state.tool === "pen" ? "path" : (state.tool as any),
        points: d.points.slice(),
      });
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === "move" || d.mode === "resize") {
      const group = uuid();
      const actions = d.objects
        .filter((o) => moving[o.id])
        .map((o) => inputFor(moving[o.id], o, "update", group));
      setMoving({});
      if (actions.length) void onCommit(actions);
      return;
    }
    if (d.mode === "selection" && selectBox) {
      state.set({
        region: selectBox.width > 4 && selectBox.height > 4 ? selectBox : null,
        selection: visible
          .filter((o) => {
            const b = bounds(o.geometry);
            return (
              b.x >= selectBox.x &&
              b.y >= selectBox.y &&
              b.x + b.width <= selectBox.x + selectBox.width &&
              b.y + b.height <= selectBox.y + selectBox.height
            );
          })
          .map((o) => o.id),
      });
      setSelectBox(null);
      return;
    }
    if (d.mode === "lasso") {
      state.set({
        selection: visible
          .filter((o) => {
            const b = bounds(o.geometry);
            return hitsPolygon(
              { x: b.x + b.width / 2, y: b.y + b.height / 2 },
              d.points,
            );
          })
          .map((o) => o.id),
        region: null,
      });
      setDrawing(null);
      return;
    }
    if (drawing) {
      const g = { ...drawing, points: simplify(drawing.points) };
      if (g.points.length === 1)
        g.points.push({ ...g.points[0], x: g.points[0].x + 0.5 });
      if (g.points.length > 1 || g.width > 2) void onCommit([inputFor(g)]);
    }
    setDrawing(null);
  }
  const image = page.render_path
    ? sessionId === "demo"
      ? page.render_path
      : `/api/sessions/${sessionId}/pages/${page.id}/image`
    : null;
  return (
    <div className="canvas-scroll" ref={viewport} data-testid="canvas-viewport">
      <div className="page-topline">
        <span>
          {page.extraction_method === "visual"
            ? "Visual page · symbols may need a closer look"
            : "YOUR PAGE, WITH ROOM TO THINK"}
        </span>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <div className="sheet-wrap" style={{ width: w * zoom, height: h * zoom }}>
        <svg
          ref={svg}
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${w} ${h}`}
          width={w * zoom}
          height={h * zoom}
          onPointerDown={(e) => {
            if (e.button === 0) onInteraction?.(true);
            down(e);
          }}
          onPointerMove={move}
          onPointerUp={() => {
            up();
            onInteraction?.(false);
          }}
          onLostPointerCapture={() => onInteraction?.(false)}
          onPointerCancel={() => {
            onInteraction?.(false);
            drag.current = null;
            setDrawing(null);
            setMoving({});
          }}
          className={`drawing-canvas tool-${state.tool}`}
          aria-label="Editable assignment canvas"
          role="img"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (["text", "math", "sticky"].includes(state.tool))
                onText(state.tool as "text" | "math" | "sticky", {
                  x: page.width * 0.2,
                  y: page.height * 0.3,
                });
              if (state.tool === "graph")
                onGraph({ x: page.width * 0.2, y: page.height * 0.3 });
            }
            if (
              ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
                e.key,
              ) &&
              selected.length &&
              !disabled
            ) {
              e.preventDefault();
              const step = e.shiftKey ? 20 : 5;
              const group = uuid();
              void onCommit(
                selected
                  .filter((o) => !o.locked)
                  .map((o) =>
                    inputFor(
                      {
                        ...o.geometry,
                        x:
                          o.geometry.x +
                          (e.key === "ArrowRight"
                            ? step
                            : e.key === "ArrowLeft"
                              ? -step
                              : 0),
                        y:
                          o.geometry.y +
                          (e.key === "ArrowDown"
                            ? step
                            : e.key === "ArrowUp"
                              ? -step
                              : 0),
                      },
                      o,
                      "update",
                      group,
                    ),
                  ),
              );
            }
          }}
          data-testid="drawing-canvas"
        >
          <g
            transform={rotationTransform(
              page.width,
              page.height,
              state.rotation,
            )}
          >
            <rect width={page.width} height={page.height} fill="#fffefa" />
            {image ? (
              <image
                href={image}
                width={page.width}
                height={page.height}
                preserveAspectRatio="none"
              />
            ) : (
              <g>
                <defs>
                  <pattern
                    id="scratch-grid"
                    width="25"
                    height="25"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx="1" cy="1" r="1" fill="#d9dce4" />
                  </pattern>
                </defs>
                <rect
                  width={page.width}
                  height={page.height}
                  fill="url(#scratch-grid)"
                />
              </g>
            )}
            {visible.map((o) => (
              <g
                key={o.id}
                data-object={o.id}
                data-author={o.actor}
                style={{
                  cursor:
                    state.tool === "select"
                      ? o.locked
                        ? "not-allowed"
                        : "move"
                      : undefined,
                }}
                dangerouslySetInnerHTML={{
                  __html: objectSVG(
                    moving[o.id] ? { ...o, geometry: moving[o.id] } : o,
                  ),
                }}
              />
            ))}
            {drawing && (
              <g
                pointerEvents="none"
                data-editor-ui
                dangerouslySetInnerHTML={{
                  __html: objectSVG({
                    id: "preview",
                    page_id: page.id,
                    actor: "student",
                    action_group_id: "",
                    revision,
                    geometry: drawing,
                    style: {
                      ...defaultStyle,
                      color: state.color,
                      width: state.tool === "highlighter" ? 20 : state.stroke,
                      opacity:
                        state.tool === "highlighter" ? 0.28 : state.opacity,
                      fill: "none",
                    },
                    visible: true,
                    locked: false,
                    group: null,
                  }),
                }}
              />
            )}
            {polygon.length > 0 && (
              <path
                d={pathData(polygon)}
                stroke={state.color}
                fill="none"
                strokeWidth={state.stroke}
                data-editor-ui
              />
            )}
            {selectionBounds && (
              <g data-editor-ui>
                <rect
                  x={selectionBounds.x - 6}
                  y={selectionBounds.y - 6}
                  width={selectionBounds.width + 12}
                  height={selectionBounds.height + 12}
                  fill="none"
                  stroke="#4361ee"
                  strokeWidth="1.5"
                  strokeDasharray="6 4"
                  pointerEvents="none"
                />
                {selected.length === 1 && !selected[0].locked && (
                  <rect
                    data-handle="resize"
                    x={selectionBounds.x + selectionBounds.width + 1}
                    y={selectionBounds.y + selectionBounds.height + 1}
                    width="11"
                    height="11"
                    fill="white"
                    stroke="#4361ee"
                    strokeWidth="2"
                    style={{ cursor: "nwse-resize" }}
                  />
                )}
              </g>
            )}
            {(selectBox || state.region) && (
              <rect
                data-editor-ui
                {...(selectBox || state.region!)}
                fill="#4361ee18"
                stroke="#4361ee"
                strokeWidth="2"
                strokeDasharray="7 5"
                pointerEvents="none"
              />
            )}
            {focus && (
              <rect
                ref={focusRect}
                data-editor-ui
                {...focus}
                fill="none"
                stroke="#ba7a4d"
                strokeWidth="2.5"
                strokeDasharray="9 7"
                rx="8"
                pointerEvents="none"
              />
            )}
          </g>
        </svg>
      </div>
      <div className="page-bottomline">
        {state.tool === "polygon"
          ? "Click points, then click the first point to close."
          : state.tool === "point"
            ? "Drag over the part you want to ask about."
            : state.tool === "select"
              ? "Select a mark to move, resize, or edit it."
              : "Every small step counts."}
      </div>
    </div>
  );
}
