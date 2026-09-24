/**
 * Tool metadata shared by the dock (buttons, hints) and the keyboard shortcuts.
 */
import type { Tool } from "@/lib/ui/store";

export interface ToolMeta {
  tool: Tool;
  label: string;
  key: string;
  /** Short usage hint shown in the tooltip. */
  hint: string;
  /** Usable while time-travelling (read-only board). */
  readOnlyOk: boolean;
}

export const TOOLS: readonly ToolMeta[] = [
  { tool: "select", label: "Select", key: "V", hint: "Click, shift-click or drag a box", readOnlyOk: true },
  { tool: "hand", label: "Pan", key: "H", hint: "Drag to move around (or hold Space)", readOnlyOk: true },
  { tool: "pen", label: "Pen", key: "P", hint: "Draw freehand", readOnlyOk: false },
  { tool: "rect", label: "Rectangle", key: "R", hint: "Drag to size · Shift for a square", readOnlyOk: false },
  { tool: "ellipse", label: "Ellipse", key: "O", hint: "Drag to size · Shift for a circle", readOnlyOk: false },
  { tool: "arrow", label: "Arrow", key: "A", hint: "Drag from start to end · Shift snaps angle", readOnlyOk: false },
  { tool: "sticky", label: "Sticky note", key: "S", hint: "Click to place, then type", readOnlyOk: false },
  { tool: "text", label: "Text", key: "T", hint: "Click to place, then type", readOnlyOk: false },
  { tool: "eraser", label: "Eraser", key: "E", hint: "Drag across shapes to erase", readOnlyOk: false },
];

export const TOOL_BY_KEY: ReadonlyMap<string, ToolMeta> = new Map(TOOLS.map((t) => [t.key.toLowerCase(), t]));
export const TOOL_META: ReadonlyMap<Tool, ToolMeta> = new Map(TOOLS.map((t) => [t.tool, t]));
