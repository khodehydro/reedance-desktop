/**
 * Line/turn timing as the exported pack will carry it.
 *
 * This is the single renderer-side copy of the export rule used by
 * `src/main/lesson.ts` (songs) and `assembleDialogue` in `src/main/reetalk.ts`
 * (ReeTalk): a recorded end is kept verbatim (silence gaps survive), a missing
 * end becomes the immediately following line's start, and the last line — or
 * a line whose follower has no start — ends at the audio duration. The
 * timeline and the Android simulator both read this so what the operator sees
 * is what ships; `tests/timing.test.ts` pins it against the exporters.
 */

export interface TimingMark {
  startMs: number | null;
  endMs: number | null;
}

export type EndSource = "recorded" | "next" | "duration";

export type TimingProblem =
  | "no-start"
  | "start-outside-audio"
  | "end-not-after-start"
  | "end-outside-audio"
  | "overlaps-next"
  | "starts-before-previous";

export interface ResolvedTiming {
  id: string;
  index: number;
  startMs: number | null;
  /** Effective end (export value); null only when the line has no start. */
  endMs: number | null;
  endSource: EndSource | null;
  problems: TimingProblem[];
}

export function resolveTimings(
  ids: readonly string[],
  marks: Readonly<Record<string, TimingMark | undefined>>,
  durationMs: number,
): ResolvedTiming[] {
  const duration = Math.round(durationMs);
  const resolved = ids.map((id, index): ResolvedTiming => {
    const mark = marks[id];
    const startMs = mark?.startMs ?? null;
    if (startMs === null) {
      return { id, index, startMs: null, endMs: null, endSource: null, problems: ["no-start"] };
    }
    const nextId = ids[index + 1];
    const nextStart = nextId !== undefined ? marks[nextId]?.startMs ?? null : null;
    let endMs: number;
    let endSource: EndSource;
    if (mark?.endMs !== null && mark?.endMs !== undefined) {
      endMs = mark.endMs;
      endSource = "recorded";
    } else if (nextStart !== null) {
      endMs = nextStart;
      endSource = "next";
    } else {
      endMs = duration;
      endSource = "duration";
    }
    const problems: TimingProblem[] = [];
    if (duration > 0 && startMs >= duration) problems.push("start-outside-audio");
    if (endMs <= startMs) problems.push("end-not-after-start");
    if (duration > 0 && endMs > duration) problems.push("end-outside-audio");
    if (nextStart !== null && endMs > nextStart && endSource === "recorded") problems.push("overlaps-next");
    return { id, index, startMs, endMs, endSource, problems };
  });
  for (let index = 1; index < resolved.length; index += 1) {
    const current = resolved[index];
    const previous = resolved[index - 1];
    if (current.startMs !== null && previous.startMs !== null && current.startMs <= previous.startMs) {
      current.problems.push("starts-before-previous");
    }
  }
  return resolved;
}

/** Index of the line playing at `ms` (start ≤ ms < end), or -1. */
export function activeIndexAt(timings: readonly ResolvedTiming[], ms: number): number {
  for (let index = timings.length - 1; index >= 0; index -= 1) {
    const timing = timings[index];
    if (timing.startMs === null || timing.endMs === null) continue;
    if (ms >= timing.startMs && ms < timing.endMs) return index;
  }
  return -1;
}

/** Number of lines whose start has been reached at `ms` (Android reveals chat bubbles this way). */
export function revealedCountAt(timings: readonly ResolvedTiming[], ms: number): number {
  let count = 0;
  for (let index = 0; index < timings.length; index += 1) {
    const start = timings[index].startMs;
    if (start !== null && start <= ms) count = index + 1;
  }
  return count;
}

export function problemLabel(problem: TimingProblem, lang: "fa" | "en"): string {
  const labels: Record<TimingProblem, [string, string]> = {
    "no-start": ["زمان شروع ثبت نشده", "no start time"],
    "start-outside-audio": ["شروع بعد از پایان صوت است", "start is past the end of the audio"],
    "end-not-after-start": ["پایان باید بعد از شروع باشد", "end must come after the start"],
    "end-outside-audio": ["پایان بعد از پایان صوت است", "end is past the end of the audio"],
    "overlaps-next": ["با شروع سطر بعد هم‌پوشانی دارد", "overlaps the next line's start"],
    "starts-before-previous": ["هم‌زمان یا قبل از سطر قبلی شروع می‌شود", "does not start after the previous line"],
  };
  return labels[problem][lang === "fa" ? 0 : 1];
}

/** Problems that make the export fail (vs. ones the operator should just know about). */
export function isBlockingProblem(problem: TimingProblem, kind: "song" | "reetalk"): boolean {
  if (problem === "overlaps-next") return kind === "reetalk";
  return true;
}
