/**
 * Pure geometry for the clip timeline (no DOM, no React) so the rules that
 * decide where a line may sit are unit-tested in `tests/timeline-math.test.ts`.
 *
 * The lesson/dialogue order is fixed: line i must start after line i−1 and
 * end before line i+1 starts. A clip may therefore only live inside the gap
 * left by its nearest *placed* neighbours — that gap is its `ClipBounds`.
 */

export interface ClipBounds {
  /** Earliest start: the previous placed line's end (or its start + min when its end is automatic). */
  lower: number;
  /** Latest end: the next placed line's start, else the audio end. */
  upper: number;
}

export interface MarkLike {
  startMs: number | null;
  endMs: number | null;
}

export const MIN_CLIP_MS = 80;

/** Gap available to line `id` between its placed neighbours. */
export function clipBounds(
  ids: readonly string[],
  marks: Readonly<Record<string, MarkLike | undefined>>,
  id: string,
  durationMs: number,
  minClipMs = MIN_CLIP_MS,
): ClipBounds {
  const index = ids.indexOf(id);
  let lower = 0;
  let upper = Math.max(0, Math.round(durationMs));
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const mark = marks[ids[previous]];
    if (mark && mark.startMs !== null) {
      lower = mark.endMs ?? mark.startMs + minClipMs;
      break;
    }
  }
  for (let next = index + 1; next < ids.length && index >= 0; next += 1) {
    const mark = marks[ids[next]];
    if (mark && mark.startMs !== null) {
      upper = Math.min(upper, mark.startMs);
      break;
    }
  }
  return { lower, upper };
}

export function hasRoom(bounds: ClipBounds, minClipMs = MIN_CLIP_MS): boolean {
  return bounds.upper - bounds.lower >= minClipMs;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** Typical spoken length of a line, used as the clip length on drop. */
export function estimateLineMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return clamp(600 + words * 380, 1200, 7000);
}

export interface Placement {
  ok: boolean;
  startMs: number;
  endMs: number;
  /** True when the drop point was outside the allowed gap and was pulled in. */
  clamped: boolean;
}

/** Where a line dropped at `desiredStartMs` lands (start at the pointer, clamped into its gap). */
export function placeClip(bounds: ClipBounds, desiredStartMs: number, lengthMs: number, minClipMs = MIN_CLIP_MS): Placement {
  if (!hasRoom(bounds, minClipMs)) {
    const start = Math.max(0, Math.round(desiredStartMs));
    return { ok: false, startMs: start, endMs: start + Math.max(minClipMs, Math.round(lengthMs)), clamped: false };
  }
  const start = clamp(desiredStartMs, bounds.lower, bounds.upper - minClipMs);
  const end = Math.min(start + Math.max(minClipMs, lengthMs), bounds.upper);
  return {
    ok: true,
    startMs: Math.round(start),
    endMs: Math.round(end),
    clamped: Math.abs(start - desiredStartMs) > 0.5,
  };
}

export type EditMode = "move" | "start" | "end";

export interface ClipEditInput {
  mode: EditMode;
  origStart: number;
  origEnd: number;
  /** The end is automatic (next start / audio end): it does not travel with the clip. */
  endDerived: boolean;
  bounds: ClipBounds;
  /** Pointer time for start/end handles; for move, the new start before clamping. */
  ms: number;
  minClipMs?: number;
}

export interface ClipEditResult {
  startMs: number;
  endMs: number;
  /** Whether the end should be stored (recorded) rather than left automatic. */
  recordEnd: boolean;
}

/**
 * Applies one drag step to the selected clip. Existing clips that already
 * violate their gap (legacy data) are edited against the whole audio instead,
 * so they can always be dragged back into a valid place.
 */
export function editClip(input: ClipEditInput, durationMs: number): ClipEditResult {
  const min = input.minClipMs ?? MIN_CLIP_MS;
  const bounds = hasRoom(input.bounds, min) ? input.bounds : { lower: 0, upper: Math.max(min, durationMs) };
  const { origStart, origEnd } = input;
  if (input.mode === "end") {
    const end = clamp(input.ms, origStart + min, Math.max(origStart + min, bounds.upper));
    return { startMs: Math.round(origStart), endMs: Math.round(end), recordEnd: true };
  }
  if (input.mode === "start") {
    const start = clamp(input.ms, bounds.lower, Math.max(bounds.lower, origEnd - min));
    return { startMs: Math.round(start), endMs: Math.round(origEnd), recordEnd: !input.endDerived };
  }
  if (input.endDerived) {
    // An automatic end stays where it is (it follows the next line): moving
    // the body slides the start inside [lower, end − min].
    const start = clamp(input.ms, bounds.lower, Math.max(bounds.lower, origEnd - min));
    return { startMs: Math.round(start), endMs: Math.round(origEnd), recordEnd: false };
  }
  const length = origEnd - origStart;
  const start = clamp(input.ms, bounds.lower, Math.max(bounds.lower, bounds.upper - length));
  const end = Math.min(start + length, Math.max(bounds.upper, start + min));
  return { startMs: Math.round(start), endMs: Math.round(end), recordEnd: true };
}

/** Nearest snap target within `thresholdMs`, else null. */
export function snapTo(ms: number, targets: readonly number[], thresholdMs: number): number | null {
  let best: number | null = null;
  let distance = thresholdMs;
  for (const target of targets) {
    const gap = Math.abs(target - ms);
    if (gap <= distance) {
      distance = gap;
      best = target;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* View (zoom / scroll)                                                */
/* ------------------------------------------------------------------ */

export const MAX_ZOOM = 4000; // px per second → 1 px = 0.25 ms

export interface View {
  startMs: number;
  /** Pixels per second. */
  zoom: number;
}

/** Zoom that shows the whole audio in `widthPx`. */
export function fitZoom(widthPx: number, durationMs: number): number {
  if (durationMs <= 0) return 100;
  return Math.min(MAX_ZOOM, Math.max(0.05, widthPx / (durationMs / 1000)));
}

/** Clamps zoom to [fit, MAX] and the view start so the view never leaves the audio. */
export function clampView(view: View, widthPx: number, durationMs: number): View {
  const zoom = clamp(view.zoom, fitZoom(widthPx, durationMs), MAX_ZOOM);
  const span = (widthPx / zoom) * 1000;
  const maxStart = Math.max(0, durationMs - span);
  return { zoom, startMs: clamp(view.startMs, 0, maxStart) };
}

/** Zooms keeping the time under `anchorPx` fixed on screen. */
export function zoomAround(view: View, nextZoom: number, anchorPx: number, widthPx: number, durationMs: number): View {
  const anchorMs = view.startMs + (anchorPx / view.zoom) * 1000;
  const zoom = clamp(nextZoom, fitZoom(widthPx, durationMs), MAX_ZOOM);
  return clampView({ zoom, startMs: anchorMs - (anchorPx / zoom) * 1000 }, widthPx, durationMs);
}

/** Ruler step (seconds) whose labels are at least `minPx` apart, plus its minor subdivision count. */
export function rulerStep(zoom: number, minPx = 84): { step: number; minor: number } {
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  const step = steps.find((candidate) => candidate * zoom >= minPx) ?? 1800;
  const lead = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
  const minor = Math.abs(lead - 2) < 1e-6 ? 4 : Math.abs(lead - 1.5) < 1e-6 || Math.abs(lead - 3) < 1e-6 ? 3 : Math.abs(lead - 6) < 1e-6 ? 6 : 5;
  return { step, minor };
}

/** Ruler label for a tick at `seconds` with the given step. */
export function rulerLabel(seconds: number, step: number): string {
  const totalMs = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  const base = `${minutes}:${String(secs).padStart(2, "0")}`;
  if (step >= 1) return base;
  if (step >= 0.1) return `${base}.${String(Math.floor(millis / 100))}`;
  if (step >= 0.01) return `${base}.${String(Math.floor(millis / 10)).padStart(2, "0")}`;
  return `${base}.${String(millis).padStart(3, "0")}`;
}
