import { create } from "zustand";
import type { Tool, Region } from "./types";
type EditorState = {
  tool: Tool;
  color: string;
  fill: string;
  stroke: number;
  opacity: number;
  dash: boolean;
  lineEnding: "none" | "arrow" | "both";
  fontSize: number;
  eraserSize: number;
  tolerance: number;
  selection: string[];
  region: Region | null;
  layers: { student: boolean; tutor: boolean; grading: boolean };
  zoom: number;
  rotation: number;
  rail: boolean;
  split: number;
  follow: boolean;
  speed: number;
  paused: boolean;
  set: (patch: Partial<EditorState>) => void;
};
export const useEditor = create<EditorState>((set) => ({
  tool: "pen" as Tool,
  color: "#4361ee",
  fill: "none",
  stroke: 3,
  opacity: 1,
  dash: false,
  lineEnding: "none",
  fontSize: 24,
  eraserSize: 18,
  tolerance: 32,
  selection: [],
  region: null,
  layers: { student: true, tutor: true, grading: true },
  zoom: 1,
  rotation: 0,
  rail: false,
  split: 70,
  follow: false,
  speed: 1,
  paused: false,
  set,
}));
