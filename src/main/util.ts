import crypto from "node:crypto";

/** Deterministic JSON so hashes are stable across runs and machines. */
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node;
    if (seen.has(node as object)) throw new Error("cannot canonicalize a cyclic structure");
    seen.add(node as object);
    if (Array.isArray(node)) return node.map(walk);
    const source = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = walk(source[key]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** `mm:ss.mmm` <- milliseconds (used by the timeline UI and logs). */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const clamped = Math.max(0, Math.round(ms));
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
