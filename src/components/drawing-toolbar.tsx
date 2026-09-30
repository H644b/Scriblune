"use client";
import {
  MousePointer2,
  Pencil,
  PenTool,
  Highlighter,
  Eraser,
  Type,
  StickyNote,
  MoveUpRight,
  Square,
  Circle,
  Shapes,
  Undo2,
  Redo2,
  Lasso,
  Paintbrush,
  PaintBucket,
  Minus,
  Scan,
  FunctionSquare,
  Triangle,
  Layers,
  Copy,
  LockKeyhole,
  Unlock,
  RotateCw,
  Group,
  Ungroup,
  Trash2,
} from "lucide-react";
import { useEditor } from "@/lib/workspace/store";
import type { Tool, Annotation } from "@/lib/workspace/types";
const tools: { id: Tool; label: string; icon: typeof Pencil; key?: string }[] =
  [
    { id: "select", label: "Select & move", icon: MousePointer2, key: "V" },
    { id: "pen", label: "Pen", icon: PenTool, key: "P" },
    { id: "highlighter", label: "Highlighter", icon: Highlighter, key: "H" },
    { id: "eraser", label: "Eraser", icon: Eraser, key: "E" },
    { id: "point", label: "Point & Ask", icon: Scan, key: "Q" },
  ];
const more: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: "pencil", label: "Pencil", icon: Pencil },
  { id: "brush", label: "Brush", icon: Paintbrush },
  { id: "line", label: "Line", icon: Minus },
  { id: "arrow", label: "Arrow", icon: MoveUpRight },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "polygon", label: "Polygon", icon: Triangle },
  { id: "text", label: "Text", icon: Type },
  { id: "math", label: "Math text", icon: FunctionSquare },
  { id: "sticky", label: "Sticky note", icon: StickyNote },
  { id: "lasso", label: "Lasso", icon: Lasso },
  { id: "fill", label: "Bucket fill", icon: PaintBucket },
  { id: "graph", label: "Graph", icon: FunctionSquare },
];
export function DrawingToolbar({
  onUndo,
  onRedo,
  onEdit,
  canUndo,
  canRedo,
  selected,
}: {
  onUndo: () => void;
  onRedo: () => void;
  onEdit: (action: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  selected: Annotation[];
}) {
  const s = useEditor();
  return (
    <>
      <div
        className="drawing-toolbar"
        role="toolbar"
        aria-label="Drawing tools"
      >
        {tools.map((t) => (
          <button
            key={t.id}
            className={`tool-button ${s.tool === t.id ? "active" : ""}`}
            onClick={() => s.set({ tool: t.id })}
            aria-label={`${t.label} (${t.key})`}
            aria-pressed={s.tool === t.id}
            title={`${t.label} (${t.key})`}
          >
            <t.icon size={19} />
          </button>
        ))}
        <details className="tool-more">
          <summary
            className={`tool-button ${more.some((t) => t.id === s.tool) ? "active" : ""}`}
            aria-label="More drawing tools"
            title="More drawing tools"
          >
            <Shapes size={20} />
          </summary>
          <div className="tools-menu">
            {more.map((t) => (
              <button
                key={t.id}
                onClick={(e) => {
                  s.set({ tool: t.id });
                  e.currentTarget.closest("details")?.removeAttribute("open");
                }}
                aria-pressed={s.tool === t.id}
              >
                <t.icon size={17} />
                {t.label}
              </button>
            ))}
          </div>
        </details>
        <span className="toolbar-separator" />
        <details className="color-picker">
          <summary aria-label="Ink color and style" className="color-summary">
            <span style={{ background: s.color }} />
          </summary>
          <div className="color-panel">
            <strong>Your ink</strong>
            <div className="swatches">
              {[
                ["#4361ee", "Pencil blue"],
                ["#20283a", "Deep ink"],
                ["#b16e50", "Clay"],
                ["#62886b", "Sage"],
                ["#d5a44c", "Amber"],
                ["#d14c5c", "Coral"],
              ].map(([color, name]) => (
                <button
                  key={color}
                  style={{ background: color }}
                  title={name}
                  aria-label={name}
                  onClick={() => s.set({ color })}
                />
              ))}
            </div>
            <label>
              Any color{" "}
              <input
                type="color"
                value={s.color}
                onChange={(e) => s.set({ color: e.target.value })}
              />
            </label>
            <label>
              Hex{" "}
              <input
                aria-label="Hexadecimal ink color"
                defaultValue={s.color}
                key={s.color}
                maxLength={7}
                onBlur={(e) => {
                  if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                    s.set({ color: e.target.value });
                  else e.target.value = s.color;
                }}
              />
            </label>
            <label>
              Stroke width{" "}
              <input
                aria-label="Stroke width"
                type="range"
                min="1"
                max="30"
                value={s.stroke}
                onChange={(e) => s.set({ stroke: Number(e.target.value) })}
              />
            </label>
            <label>
              Opacity{" "}
              <input
                aria-label="Ink opacity"
                type="range"
                min="0.1"
                max="1"
                step=".05"
                value={s.opacity}
                onChange={(e) => s.set({ opacity: Number(e.target.value) })}
              />
            </label>
            <label>
              Text size{" "}
              <input
                type="number"
                aria-label="Text size"
                min="8"
                max="140"
                value={s.fontSize}
                onChange={(e) => s.set({ fontSize: Number(e.target.value) })}
              />
            </label>
            <label>
              Shape fill{" "}
              <input
                type="color"
                value={s.fill === "none" ? "#ffffff" : s.fill}
                onChange={(e) => s.set({ fill: e.target.value })}
              />
              <button
                className="text-button"
                onClick={() => s.set({ fill: "none" })}
              >
                None
              </button>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={s.dash}
                onChange={(e) => s.set({ dash: e.target.checked })}
              />{" "}
              Dashed line
            </label>
            <label>
              Line ending{" "}
              <select
                value={s.lineEnding}
                onChange={(e) =>
                  s.set({
                    lineEnding: e.target.value as "none" | "arrow" | "both",
                  })
                }
              >
                <option value="none">Plain</option>
                <option value="arrow">Arrow</option>
                <option value="both">Both ends</option>
              </select>
            </label>
            <label>
              Eraser size{" "}
              <input
                type="range"
                min="3"
                max="60"
                value={s.eraserSize}
                onChange={(e) => s.set({ eraserSize: Number(e.target.value) })}
              />
            </label>
            <label>
              Fill tolerance{" "}
              <input
                type="range"
                min="0"
                max="100"
                value={s.tolerance}
                onChange={(e) => s.set({ tolerance: Number(e.target.value) })}
              />
            </label>
          </div>
        </details>
        <span className="toolbar-separator" />
        <button
          className="tool-button"
          aria-label="Undo my last action"
          title="Undo (⌘Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={18} />
        </button>
        <button
          className="tool-button"
          aria-label="Redo my last action"
          title="Redo (⌘⇧Z)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={18} />
        </button>
      </div>
      {selected.length > 0 && (
        <div
          className="selection-tools"
          role="toolbar"
          aria-label="Selected annotation tools"
        >
          <span>
            {selected.length} selected
            {selected[0]?.actor === "tutor" ? " · Tutor ink" : ""}
          </span>
          {[
            {
              id: "style",
              label: "Apply current color and style",
              icon: Paintbrush,
            },
            { id: "duplicate", label: "Duplicate", icon: Copy },
            { id: "rotate", label: "Rotate 15 degrees", icon: RotateCw },
            { id: "group", label: "Group selection", icon: Group },
            { id: "ungroup", label: "Ungroup selection", icon: Ungroup },
            {
              id: "lock",
              label: selected[0]?.locked ? "Unlock" : "Lock",
              icon: selected[0]?.locked ? Unlock : LockKeyhole,
            },
            { id: "delete", label: "Delete selected marks", icon: Trash2 },
          ].map((t) => (
            <button
              key={t.id}
              className="icon-button"
              title={t.label}
              aria-label={t.label}
              onClick={() => onEdit(t.id)}
            >
              <t.icon size={15} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
