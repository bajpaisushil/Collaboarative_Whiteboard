/**
 * Canonical JSON + a fast synchronous 106-bit hash (two cyrb53 lanes).
 * canonicalJson sorts object keys, drops undefined, maps -0 → 0 and rejects non-finite numbers,
 * so two replicas holding the same state produce the same string regardless of insertion order.
 */

export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "number":
      if (!Number.isFinite(v)) return "0";
      return JSON.stringify(Object.is(v, -0) ? 0 : v);
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return v ? "true" : "false";
    case "undefined":
      return "null";
    case "object": {
      if (Array.isArray(v)) return "[" + v.map(serialize).join(",") + "]";
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + serialize(obj[k])).join(",") + "}";
    }
    default:
      return "null";
  }
}

function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 28 hex chars. */
export function hashString(str: string): string {
  return cyrb53(str, 0).toString(16).padStart(14, "0") + cyrb53(str, 0x9e3779b9).toString(16).padStart(14, "0");
}

export function hashValue(value: unknown): string {
  return hashString(canonicalJson(value));
}
