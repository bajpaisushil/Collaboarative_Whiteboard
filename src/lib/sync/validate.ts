/**
 * Structural validation of every message a peer can send (over BroadcastChannel or WebRTC).
 * A malformed message — from a mismatched build, a buggy peer or a hostile same-origin script —
 * is dropped instead of crashing the session. Ops inside `ops` messages are validated one by one
 * by the replica (`isValidOp`); presence previews are sanitised before they reach the canvas.
 */
import { sanitizeProps, sanitizePoints } from "../crdt/sanitize";
import type { ShapeProps, ShapeType } from "../crdt/types";
import { PROTOCOL_VERSION, type PresenceState, type SyncMessage } from "./protocol";

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isId = (v: unknown): v is string => isStr(v, 64) && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function isValidVc(v: unknown): boolean {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  if (keys.length > 512) return false;
  for (const k of keys) {
    const n = v[k];
    if (k.length === 0 || k.length > 64 || typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return false;
  }
  return true;
}

const TYPES = new Set(["hello", "ops", "sync-req", "heartbeat", "presence", "bye"]);
/** Only presence-class messages are ever forwarded by a bridge tab. */
const RELAYABLE = new Set(["hello", "heartbeat", "bye"]);
export const RELAY_MAX_HOPS = 4;

const isBeat = (v: unknown) => v === undefined || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);

function isValidRelay(r: unknown): boolean {
  if (!isObj(r)) return false;
  return (
    isId(r.by) &&
    typeof r.hops === "number" &&
    Number.isInteger(r.hops) &&
    r.hops >= 1 &&
    r.hops <= RELAY_MAX_HOPS &&
    isBool(r.far) &&
    (r.lost === undefined || isBool(r.lost))
  );
}

export function isValidMessage(m: unknown): m is SyncMessage {
  if (!isObj(m)) return false;
  if (m.v !== PROTOCOL_VERSION || !isId(m.from) || !isStr(m.nonce, 64) || !TYPES.has(m.t as string)) return false;
  if (m.to !== undefined && !isId(m.to)) return false;
  if (m.relay !== undefined && (!RELAYABLE.has(m.t as string) || m.to !== undefined || !isValidRelay(m.relay))) return false;
  switch (m.t) {
    case "hello":
      return isStr(m.label, 8) && isValidVc(m.vc) && isStr(m.stateHash, 64) && isBool(m.wantReply) && isBool(m.rtc) && isBool(m.visible) && isBeat(m.beat);
    case "heartbeat":
      return (
        isStr(m.label, 8) &&
        isValidVc(m.vc) &&
        isStr(m.stateHash, 64) &&
        isBool(m.rtc) &&
        isBool(m.visible) &&
        isBeat(m.beat) &&
        (m.offline === undefined || isBool(m.offline))
      );
    case "ops":
      // Elements are checked one by one (isValidOp) before anything reads them.
      return Array.isArray(m.ops) && m.ops.length <= 10_000 && (m.reason === "live" || m.reason === "catchup");
    case "sync-req":
      return isValidVc(m.vc);
    case "presence":
      return isNum(m.seq) && m.seq >= 0 && sanitizePresence(m.state) !== null;
    case "bye":
      return isBeat(m.beat);
  }
  return false;
}

/** Validate + sanitise a presence state; null if unusable. */
export function sanitizePresence(s: unknown): PresenceState | null {
  if (!isObj(s) || !isStr(s.label, 8) || !isStr(s.color, 64)) return null;
  const cursor = isObj(s.cursor) && isNum(s.cursor.x) && isNum(s.cursor.y) ? { x: s.cursor.x, y: s.cursor.y } : null;
  let drawing: PresenceState["drawing"] = null;
  if (isObj(s.drawing) && isStr(s.drawing.tool, 16) && Array.isArray(s.drawing.points) && s.drawing.points.length <= 20_000) {
    drawing = {
      tool: s.drawing.tool as ShapeType,
      points: sanitizePoints(s.drawing.points),
      stroke: isStr(s.drawing.stroke, 64) ? s.drawing.stroke : "#1d1b16",
      fill: isStr(s.drawing.fill, 64) ? s.drawing.fill : "none",
      strokeWidth: isNum(s.drawing.strokeWidth) ? Math.min(64, Math.max(0, s.drawing.strokeWidth)) : 2,
    };
  }
  let preview: PresenceState["preview"] = null;
  if (Array.isArray(s.preview)) {
    preview = s.preview
      .slice(0, 500)
      .filter((p): p is { shapeId: string; props: Record<string, unknown> } => isObj(p) && isId(p.shapeId) && isObj(p.props))
      .map((p) => ({ shapeId: p.shapeId, props: sanitizeProps(p.props as Partial<Record<keyof ShapeProps, unknown>>) }));
  }
  const selection = Array.isArray(s.selection) ? s.selection.filter(isId).slice(0, 1000) : [];
  const editingText = isId(s.editingText) ? s.editingText : null;
  return { label: s.label, color: s.color, cursor, drawing, preview, selection, editingText };
}
