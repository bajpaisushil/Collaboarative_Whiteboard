/**
 * Pairing codes for the serverless WebRTC handshake. A code carries one side's full session
 * description (ICE candidates included — no trickle), compressed with deflate-raw and encoded
 * as base64url so it survives chat apps and URL fragments. Format: `W1.<z|j>.<payload>`
 * (z = deflate-raw, j = plain JSON fallback where CompressionStream is unavailable).
 */
import type { ReplicaId } from "../crdt/types";

export interface PairingOffer {
  v: 1;
  k: "offer";
  /** Pairing id: the answer echoes it so the inviter can match it to the right connection. */
  pid: string;
  room: string;
  from: ReplicaId;
  label: string;
  sdp: string;
}

export interface PairingAnswer {
  v: 1;
  k: "answer";
  pid: string;
  room: string;
  from: ReplicaId;
  label: string;
  sdp: string;
}

export type PairingCode = PairingOffer | PairingAnswer;

const PREFIX = "W1";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const canCompress = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

export async function encodePairing(code: PairingCode): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(code));
  if (canCompress()) {
    try {
      return `${PREFIX}.z.${toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))}`;
    } catch {
      // fall through to plain JSON
    }
  }
  return `${PREFIX}.j.${toBase64Url(json)}`;
}

export class PairingCodeError extends Error {}

/** Accepts a bare code, or any text/URL containing one (e.g. a pasted invite link). */
export function extractPairingCode(text: string): string | null {
  const m = /W1\.[zj]\.[A-Za-z0-9_-]+/.exec(text.trim());
  return m ? m[0] : null;
}

export async function decodePairing(text: string): Promise<PairingCode> {
  const code = extractPairingCode(text);
  if (!code) throw new PairingCodeError("That doesn't look like a Weave connection code.");
  const [, mode, payload] = code.split(".");
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(payload);
    if (mode === "z") {
      if (!canCompress()) throw new PairingCodeError("This browser can't read compressed codes.");
      bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
    }
  } catch (e) {
    if (e instanceof PairingCodeError) throw e;
    throw new PairingCodeError("The code is incomplete — copy the whole thing and try again.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PairingCodeError("The code is incomplete — copy the whole thing and try again.");
  }
  const c = parsed as Partial<PairingCode>;
  if (c.v !== 1 || (c.k !== "offer" && c.k !== "answer") || typeof c.sdp !== "string" || typeof c.pid !== "string" || typeof c.from !== "string" || typeof c.room !== "string") {
    throw new PairingCodeError("That code isn't a valid Weave invite or reply.");
  }
  return c as PairingCode;
}
