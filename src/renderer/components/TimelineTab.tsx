import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftContent, ProjectDetail } from "@shared/types";
import { isBlockingProblem, problemLabel, resolveTimings, type ResolvedTiming } from "@shared/timing";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatMs, parseTimecode } from "../format";
import { clipBounds, estimateLineMs, hasRoom, MIN_CLIP_MS, type ClipBounds } from "../timelineMath";
import { AudioTimeline, type AudioTimelineHandle, type DropPayload, type TimelineClip } from "./AudioTimeline";
import { Badge, Button, Callout, Mono, useToast } from "./ui";

interface MarkDraft {
  startMs: number | null;
  endMs: number | null;
}

/**
 * One timeable row. Song projects pass the lesson's lyric lines; ReeTalk
 * projects pass their dialogue turns (badge = speaker name, tone = speaker
 * index) — the timeline does not care where the lines came from.
 */
export interface TimelineLine {
  id: string;
  text: string;
  translationEn: string;
  translationFa?: string;
  badge?: string;
  tone?: 0 | 1;
}

type MarkMap = Record<string, MarkDraft>;
type BinFilter = "all" | "unplaced" | "placed";

const HISTORY_LIMIT = 200;

function marksFrom(lines: TimelineLine[], detail: ProjectDetail): MarkMap {
  const map: MarkMap = {};
  for (const line of lines) map[line.id] = { startMs: null, endMs: null };
  for (const mark of detail.marks) map[mark.lineId] = { startMs: mark.startMs, endMs: mark.endMs };
  return map;
}

/**
 * Timeline tab, built like a video editor (CapCut / InShot):
 *
 * - Lines start off the timeline, in the line list. Drag a line onto the
 *   timeline to create its clip there; it becomes the selected clip.
 * - Only the selected clip is editable: drag its body to move it, its edges
 *   to set the exact start and end. Every other clip is locked, so nothing
 *   already synced can be nudged by accident. Select another line from the
 *   list (or J/K) to edit it.
 * - A clip can only sit inside the gap between its placed neighbours, so the
 *   line order the pack needs is kept by construction.
 * - Sync by ear still works: M = start of the selected line at the playhead
 *   (then the next line), E = end of the line being played.
 * - Undo/redo (Ctrl+Z / Ctrl+Shift+Z) for every edit; debounced save sends
 *   only changed rows.
 */
export function TimelineTab({
  detail,
  content,
  lines,
  onChanged,
}: {
  detail: ProjectDetail;
  content: DraftContent | null;
  lines?: TimelineLine[];
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const { t, lang } = useLang();
  const toast = useToast();
  const projectId = detail.summary.projectId;
  const projectKind = detail.summary.kind === "reetalk" ? "reetalk" : "song";
  const storedDuration = detail.media?.durationMs ?? 0;
  const timelineRef = useRef<AudioTimelineHandle>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const lyricLines: TimelineLine[] = useMemo(
    () =>
      lines ??
      (content?.lyrics ?? []).map((line) => ({
        id: line.id,
        text: line.text,
        translationEn: line.translationEn,
        translationFa: line.translationFa,
      })),
    [lines, content],
  );
  const lineIds = useMemo(() => lyricLines.map((line) => line.id), [lyricLines]);

  const [marks, setMarksState] = useState<MarkMap>(() => marksFrom(lyricLines, detail));
  const marksRef = useRef(marks);
  const setMarks = useCallback((next: MarkMap) => {
    marksRef.current = next;
    setMarksState(next);
  }, []);
  const savedRef = useRef<MarkMap>(marksFrom(lyricLines, detail));
  const undoRef = useRef<MarkMap[]>([]);
  const redoRef = useRef<MarkMap[]>([]);
  const [, setHistoryTick] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(lyricLines[0]?.id ?? "");
  const [playingIndex, setPlayingIndex] = useState(-1);
  const [durationMs, setDurationMs] = useState(storedDuration);
  const [filter, setFilter] = useState<BinFilter>("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    if (storedDuration > 0) setDurationMs((current) => (current > 0 && Math.abs(current - storedDuration) <= 250 ? current : storedDuration));
  }, [storedDuration]);

  /* Resync with the stored marks whenever nothing local is pending. */
  useEffect(() => {
    savedRef.current = marksFrom(lyricLines, detail);
    if (dirty) return;
    setMarks(marksFrom(lyricLines, detail));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.marks, lyricLines]);

  const timings = useMemo(() => resolveTimings(lineIds, marks, durationMs), [lineIds, marks, durationMs]);
  const timingById = useMemo(() => new Map(timings.map((timing) => [timing.id, timing])), [timings]);
  const selectedIndex = lyricLines.findIndex((line) => line.id === selectedId);
  const selectedLine = selectedIndex >= 0 ? lyricLines[selectedIndex] : null;
  const selectedTiming = selectedLine ? timingById.get(selectedLine.id) ?? null : null;
  const selectedPlaced = selectedTiming?.startMs !== null && selectedTiming?.startMs !== undefined;

  const lineNumber = useCallback((id: string) => lineIds.indexOf(id) + 1, [lineIds]);
  const effectiveDuration = useCallback((): number => timelineRef.current?.getDuration() || durationMs, [durationMs]);
  const now = (): number => Math.max(0, Math.round(timelineRef.current?.getTime() ?? 0));

  /* ------------------------------ history ------------------------------ */

  /** Every edit goes through here: one undo step per user action. */
  const commit = useCallback(
    (next: MarkMap) => {
      undoRef.current.push(marksRef.current);
      if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
      redoRef.current = [];
      setMarks(next);
      setDirty(true);
      setSaveError(null);
      setHistoryTick((value) => value + 1);
    },
    [setMarks],
  );

  const undo = useCallback(() => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(marksRef.current);
    setMarks(previous);
    setDirty(true);
    setHistoryTick((value) => value + 1);
  }, [setMarks]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(marksRef.current);
    setMarks(next);
    setDirty(true);
    setHistoryTick((value) => value + 1);
  }, [setMarks]);

  const update = useCallback((lineId: string, next: MarkDraft) => commit({ ...marksRef.current, [lineId]: next }), [commit]);

  const boundsFor = useCallback(
    (id: string): ClipBounds => clipBounds(lineIds, marksRef.current, id, effectiveDuration(), MIN_CLIP_MS),
    [lineIds, effectiveDuration],
  );

  /* ------------------------------ writes ------------------------------ */

  /** Validated start write. Returns false (and explains why) when rejected. */
  const writeStart = useCallback(
    (lineId: string, value: number | null, source: "capture" | "typed"): boolean => {
      const current = marksRef.current[lineId] ?? { startMs: null, endMs: null };
      if (value === null) {
        update(lineId, { startMs: null, endMs: null });
        return true;
      }
      const total = effectiveDuration();
      let start = Math.max(0, Math.round(value));
      if (total > 0 && start >= total) {
        if (source === "typed") {
          toast.push(
            t(`سطر ${lineNumber(lineId)}: زمان شروع بعد از پایان صوت (${formatMs(total)}) است.`, `Line ${lineNumber(lineId)}: the start is past the end of the audio (${formatMs(total)}).`),
            "bad",
          );
          return false;
        }
        start = total - 1;
      }
      // A start at/after the recorded end makes that end stale: drop it.
      const end = current.endMs !== null && current.endMs <= start ? null : current.endMs;
      update(lineId, { startMs: start, endMs: end });
      return true;
    },
    [update, lineNumber, t, toast, effectiveDuration],
  );

  /** Validated end write. */
  const writeEnd = useCallback(
    (lineId: string, value: number | null): boolean => {
      const current = marksRef.current[lineId] ?? { startMs: null, endMs: null };
      if (value === null) {
        update(lineId, { ...current, endMs: null });
        return true;
      }
      if (current.startMs === null) {
        toast.push(t(`سطر ${lineNumber(lineId)}: اول زمان شروع را ثبت کنید.`, `Line ${lineNumber(lineId)}: capture the start first.`), "bad");
        return false;
      }
      const total = effectiveDuration();
      const end = Math.min(Math.round(value), total > 0 ? total : Number.MAX_SAFE_INTEGER);
      if (end <= current.startMs) {
        toast.push(
          t(`سطر ${lineNumber(lineId)}: پایان باید بعد از شروع (${formatMs(current.startMs)}) باشد.`, `Line ${lineNumber(lineId)}: the end must come after the start (${formatMs(current.startMs)}).`),
          "bad",
        );
        return false;
      }
      update(lineId, { ...current, endMs: end });
      return true;
    },
    [update, lineNumber, t, toast, effectiveDuration],
  );

  /** Puts a line on the timeline (drop or "place at playhead") and selects it. */
  const place = useCallback(
    (lineId: string, startMs: number, endMs: number | null) => {
      commit({ ...marksRef.current, [lineId]: { startMs, endMs } });
      setSelectedId(lineId);
      timelineRef.current?.reveal(startMs, endMs ?? startMs);
    },
    [commit],
  );

  const placeAtPlayhead = useCallback(
    (lineId: string) => {
      const line = lyricLines.find((candidate) => candidate.id === lineId);
      if (!line) return;
      const bounds = boundsFor(lineId);
      const at = now();
      if (!hasRoom(bounds) || at < bounds.lower || at > bounds.upper - MIN_CLIP_MS) {
        toast.push(
          t(
            `سطر ${lineNumber(lineId)} اینجا جا نمی‌شود: باید بین ${formatMs(bounds.lower)} و ${formatMs(bounds.upper)} باشد.`,
            `Line ${lineNumber(lineId)} does not fit here: it must sit between ${formatMs(bounds.lower)} and ${formatMs(bounds.upper)}.`,
          ),
          "bad",
        );
        return;
      }
      place(lineId, at, Math.min(at + estimateLineMs(line.text), bounds.upper));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lyricLines, boundsFor, place, lineNumber, t, toast],
  );

  const removeFromTimeline = useCallback(
    (lineId: string) => {
      const current = marksRef.current[lineId];
      if (!current || current.startMs === null) return;
      update(lineId, { startMs: null, endMs: null });
    },
    [update],
  );

  const selectLine = useCallback(
    (lineId: string, options: { seek?: boolean } = {}) => {
      setSelectedId(lineId);
      const timing = timingById.get(lineId);
      if (timing && timing.startMs !== null) {
        timelineRef.current?.reveal(timing.startMs, timing.endMs ?? timing.startMs);
        if (options.seek !== false && !timelineRef.current?.isPlaying()) timelineRef.current?.seek(timing.startMs);
      }
    },
    [timingById],
  );

  const selectIndex = useCallback(
    (index: number) => {
      const line = lyricLines[Math.max(0, Math.min(lyricLines.length - 1, index))];
      if (line) selectLine(line.id);
    },
    [lyricLines, selectLine],
  );

  const captureStart = useCallback(
    (lineId?: string) => {
      const id = lineId ?? selectedId;
      if (!id) return;
      if (writeStart(id, now(), "capture")) {
        const index = lineIds.indexOf(id);
        if (index >= 0 && index < lineIds.length - 1) setSelectedId(lineIds[index + 1]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, writeStart, lineIds],
  );

  /** The line E applies to: the selected line once it started, else the previous one. */
  const endTarget = useCallback(
    (at: number): string | null => {
      if (selectedIndex < 0) return null;
      const current = marksRef.current;
      const selected = current[lineIds[selectedIndex]];
      if (selected?.startMs !== null && selected?.startMs !== undefined && selected.startMs < at) return lineIds[selectedIndex];
      const previousId = lineIds[selectedIndex - 1];
      const previous = previousId ? current[previousId] : undefined;
      if (previous?.startMs !== null && previous?.startMs !== undefined && previous.startMs < at) return previousId;
      return lineIds[selectedIndex];
    },
    [selectedIndex, lineIds],
  );

  const captureEnd = useCallback(
    (lineId?: string) => {
      const at = now();
      const id = lineId ?? endTarget(at);
      if (!id) return;
      writeEnd(id, at);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endTarget, writeEnd],
  );

  const playLine = useCallback(
    (lineId: string) => {
      const timing = timingById.get(lineId);
      if (!timing || timing.startMs === null || timing.endMs === null) {
        toast.push(t("این سطر هنوز روی تایم‌لاین نیست.", "This line is not on the timeline yet."), "bad");
        return;
      }
      timelineRef.current?.playRange(timing.startMs, timing.endMs);
    },
    [timingById, t, toast],
  );

  const nudge = useCallback(
    (edge: "start" | "end", deltaMs: number) => {
      if (!selectedId || !selectedTiming || selectedTiming.startMs === null) return;
      if (edge === "start") writeStart(selectedId, selectedTiming.startMs + deltaMs, "typed");
      else writeEnd(selectedId, (selectedTiming.endMs ?? selectedTiming.startMs) + deltaMs);
    },
    [selectedId, selectedTiming, writeStart, writeEnd],
  );

  /* Keyboard shortcuts (the timeline component's own shortcuts are off here). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          undo();
        } else if ((key === "z" && event.shiftKey) || key === "y") {
          event.preventDefault();
          redo();
        }
        return;
      }
      if (event.altKey) return;
      if (event.code === "Space") {
        event.preventDefault();
        timelineRef.current?.playPause();
      } else if (key === "m" || event.code === "KeyM") {
        event.preventDefault();
        captureStart();
      } else if (key === "e" || event.code === "KeyE") {
        event.preventDefault();
        captureEnd();
      } else if (key === "p" || event.code === "KeyP") {
        event.preventDefault();
        if (selectedId) playLine(selectedId);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (selectedId) removeFromTimeline(selectedId);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        timelineRef.current?.zoomBy(1.5);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        timelineRef.current?.zoomBy(1 / 1.5);
      } else if (event.key === "\\") {
        event.preventDefault();
        timelineRef.current?.fit();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        timelineRef.current?.seek(now() + (event.shiftKey ? 1000 : 100));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        timelineRef.current?.seek(now() - (event.shiftKey ? 1000 : 100));
      } else if (key === "j" || event.code === "KeyJ" || event.key === "ArrowUp") {
        event.preventDefault();
        selectIndex(selectedIndex - 1);
      } else if (key === "k" || event.code === "KeyK" || event.key === "ArrowDown") {
        event.preventDefault();
        selectIndex(selectedIndex + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureStart, captureEnd, playLine, selectIndex, selectedIndex, selectedId, undo, redo, removeFromTimeline]);

  /* Keep the selected row visible. */
  useEffect(() => {
    const rows = rowsRef.current;
    if (!rows || !selectedId) return;
    const row = Array.from(rows.querySelectorAll<HTMLElement>("[data-line-id]")).find((element) => element.dataset.lineId === selectedId);
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  /* Debounced save: only rows that differ from what is stored. */
  useEffect(() => {
    if (!dirty) return undefined;
    const timer = setTimeout(() => {
      const saved = savedRef.current;
      const payload = Object.entries(marks)
        .filter(([lineId, mark]) => {
          const before = saved[lineId];
          return !before || before.startMs !== mark.startMs || before.endMs !== mark.endMs;
        })
        .map(([lineId, mark]) => ({ lineId, startMs: mark.startMs, endMs: mark.endMs }));
      if (payload.length === 0) {
        setDirty(false);
        return;
      }
      void api.marks
        .save(projectId, payload)
        .then(() => {
          const next = { ...savedRef.current };
          for (const entry of payload) next[entry.lineId] = { startMs: entry.startMs, endMs: entry.endMs };
          savedRef.current = next;
          setDirty(false);
          setSaveError(null);
          return onChanged();
        })
        .catch((error: unknown) => {
          const raw = error instanceof Error ? error.message : String(error);
          const message = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
          const lineMatch = /for (\S+) /.exec(message);
          const number = lineMatch ? lineNumber(lineMatch[1]) : 0;
          const friendly =
            number > 0
              ? t(`ذخیره نشد — سطر ${number}: ${message}`, `Not saved — line ${number}: ${message}`)
              : t(`ذخیره نشد: ${message}`, `Not saved: ${message}`);
          setSaveError(friendly);
          toast.push(friendly, "bad");
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [dirty, marks, onChanged, projectId, toast, t, lineNumber]);

  const distribute = async (): Promise<void> => {
    const timed = timings.filter((timing) => timing.startMs !== null).length;
    if (
      timed > 0 &&
      !window.confirm(
        t(
          `${timed} سطر زمان دارد. همهٔ زمان‌ها با توزیع یکنواخت بازنویسی شوند؟ (با Ctrl+Z برمی‌گردد)`,
          `${timed} line(s) already have times. Overwrite them with an even spread? (Ctrl+Z undoes it)`,
        ),
      )
    ) {
      return;
    }
    setDistributing(true);
    try {
      undoRef.current.push(marksRef.current);
      redoRef.current = [];
      await api.marks.distribute(projectId);
      setDirty(false);
      await onChanged();
      toast.push(t("زمان‌ها توزیع شد؛ حالا هر سطر را که لازم است اصلاح کنید.", "Times distributed — adjust the lines that matter."), "ok");
    } catch (error) {
      undoRef.current.pop();
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setDistributing(false);
    }
  };

  const clips: TimelineClip[] = useMemo(
    () =>
      timings
        .filter((timing): timing is ResolvedTiming & { startMs: number; endMs: number } => timing.startMs !== null && timing.endMs !== null)
        .map((timing) => {
          const line = lyricLines[timing.index];
          return {
            id: timing.id,
            number: timing.index + 1,
            text: line?.text ?? "",
            badge: line?.badge,
            startMs: timing.startMs,
            endMs: Math.max(timing.endMs, timing.startMs + 1),
            endDerived: timing.endSource !== "recorded",
            selected: timing.id === selectedId,
            problem: timing.problems.some((problem) => problem !== "no-start" && isBlockingProblem(problem, projectKind)),
            tone: line?.tone ?? ((timing.index % 2) as 0 | 1),
          };
        }),
    [timings, selectedId, lyricLines, projectKind],
  );

  const onClipCommit = useCallback(
    (id: string, startMs: number, endMs: number | null) => {
      const current = marksRef.current[id];
      if (current && current.startMs === startMs && current.endMs === endMs) return;
      commit({ ...marksRef.current, [id]: { startMs, endMs } });
    },
    [commit],
  );

  const timedCount = timings.filter((timing) => timing.startMs !== null).length;
  const blockingCount = timings.filter((timing) =>
    timing.problems.some((problem) => problem !== "no-start" && isBlockingProblem(problem, projectKind)),
  ).length;
  const nextUnplacedId = timings.find((timing) => timing.startMs === null)?.id ?? null;

  const onTimeUpdate = useCallback(
    (ms: number) => {
      let index = -1;
      for (let i = timings.length - 1; i >= 0; i -= 1) {
        const timing = timings[i];
        if (timing.startMs !== null && timing.endMs !== null && ms >= timing.startMs && ms < timing.endMs) {
          index = i;
          break;
        }
      }
      setPlayingIndex((current) => (current === index ? current : index));
    },
    [timings],
  );

  /* ------------------------- drag from the line list ------------------------- */

  const payloadFor = useCallback(
    (line: TimelineLine): DropPayload => {
      const index = lineIds.indexOf(line.id);
      const timing = timingById.get(line.id);
      const placedLength = timing && timing.startMs !== null && timing.endMs !== null && timing.endSource === "recorded" ? timing.endMs - timing.startMs : null;
      return {
        lineId: line.id,
        number: index + 1,
        text: line.text,
        tone: line.tone ?? ((index % 2) as 0 | 1),
        lengthMs: placedLength ?? estimateLineMs(line.text),
      };
    },
    [lineIds, timingById],
  );

  const startRowDrag = useCallback(
    (event: React.PointerEvent, line: TimelineLine) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button, input")) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const payload = payloadFor(line);
      let active = false;
      const ghost = ghostRef.current;
      const moveGhost = (x: number, y: number, over: boolean): void => {
        if (!ghost) return;
        ghost.style.transform = `translate(${x + 14}px, ${y + 10}px)`;
        ghost.classList.toggle("is-over", over);
      };
      const cleanup = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        if (ghost) ghost.style.display = "none";
        document.body.classList.remove("is-dragging-line");
        setDraggingId(null);
      };
      const onMove = (moveEvent: PointerEvent): void => {
        if (!active) {
          if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
          active = true;
          setDraggingId(line.id);
          document.body.classList.add("is-dragging-line");
          if (ghost) {
            ghost.style.display = "flex";
            const label = ghost.querySelector(".drag-ghost-text");
            const number = ghost.querySelector(".drag-ghost-number");
            if (label) label.textContent = line.text;
            if (number) number.textContent = String(payload.number);
            ghost.dataset.tone = String(payload.tone);
          }
        }
        const over = timelineRef.current?.dragOver(payload, moveEvent.clientX, moveEvent.clientY, moveEvent.altKey) ?? false;
        moveGhost(moveEvent.clientX, moveEvent.clientY, over);
      };
      const onUp = (upEvent: PointerEvent): void => {
        cleanup();
        if (!active) {
          selectLine(line.id);
          return;
        }
        const placement = timelineRef.current?.drop(payload, upEvent.clientX, upEvent.clientY, upEvent.altKey) ?? null;
        if (!placement) return;
        if (!placement.ok) {
          const bounds = boundsFor(line.id);
          toast.push(
            t(
              `سطر ${payload.number} جا ندارد: باید بعد از سطر قبلی (${formatMs(bounds.lower)}) و قبل از سطر بعدی (${formatMs(bounds.upper)}) باشد.`,
              `Line ${payload.number} has no room: it must sit after the previous line (${formatMs(bounds.lower)}) and before the next (${formatMs(bounds.upper)}).`,
            ),
            "bad",
          );
          return;
        }
        place(line.id, placement.startMs, placement.endMs);
      };
      const onCancel = (): void => {
        cleanup();
        timelineRef.current?.dragOver(null, 0, 0);
      };
      const onKey = (keyEvent: KeyboardEvent): void => {
        if (keyEvent.key === "Escape") onCancel();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
    },
    [payloadFor, selectLine, boundsFor, place, t, toast],
  );

  if (!detail.media) {
    return (
      <div className="tab-body">
        <Callout tone="warn" title={t("تایم‌لاین بدون صوت قفل است", "The timeline needs audio")}>
          {t(
            "ابتدا در تب «نمای کلی و صوت» فایل صوتی را از سیستم انتخاب کنید. فایل خام ایجنت هیچ صوت یا زمانی ندارد.",
            "Choose the audio from this computer in the overview tab first. The agent draft contains no audio or timings.",
          )}
        </Callout>
      </div>
    );
  }

  const endHint = (timing: ResolvedTiming | null): string => {
    if (!timing || timing.endMs === null) return "—";
    if (timing.endSource === "next") return t("خودکار: شروع سطر بعد", "auto: next line's start");
    if (timing.endSource === "duration") return t("خودکار: پایان صوت", "auto: end of audio");
    return t("ثبت‌شده", "recorded");
  };

  const visibleLines = lyricLines.filter((line) => {
    if (filter === "all") return true;
    const placed = timingById.get(line.id)?.startMs !== null;
    return filter === "placed" ? placed : !placed;
  });

  const historyControls = (
    <span className="history-group">
      <button type="button" className="tl-icon" onClick={undo} disabled={undoRef.current.length === 0} title={t("واگرد (Ctrl+Z)", "Undo (Ctrl+Z)")}>
        ↶
      </button>
      <button type="button" className="tl-icon" onClick={redo} disabled={redoRef.current.length === 0} title={t("ازنو (Ctrl+Shift+Z)", "Redo (Ctrl+Shift+Z)")}>
        ↷
      </button>
    </span>
  );

  return (
    <div className="tab-body timeline-tab">
      <AudioTimeline
        ref={timelineRef}
        projectId={projectId}
        kind="audio"
        durationMs={storedDuration}
        onTimeUpdate={onTimeUpdate}
        onDurationReported={(ms) => {
          setDurationMs(ms);
          void onChanged();
        }}
        clips={clips}
        boundsFor={boundsFor}
        onClipCommit={onClipCommit}
        extraControls={historyControls}
      />

      <div className="timeline-status">
        <div className="row gap-sm wrap">
          <Badge tone={timedCount === lyricLines.length ? "ok" : "muted"}>
            {t("روی تایم‌لاین", "on the timeline")}: {timedCount}/{lyricLines.length}
          </Badge>
          {blockingCount > 0 ? (
            <Badge tone="bad">
              {t("مشکل زمان‌بندی", "timing problems")}: {blockingCount}
            </Badge>
          ) : null}
          {saveError ? (
            <Badge tone="bad">{t("ذخیره نشد", "not saved")}</Badge>
          ) : dirty ? (
            <Badge tone="warn">{t("در حال ذخیره…", "saving…")}</Badge>
          ) : (
            <Badge tone="ok">{t("ذخیره شد", "saved")}</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void distribute()}
          disabled={distributing}
          title={t("زمان شروع همهٔ سطرها را یکنواخت روی مدت صوت پخش می‌کند؛ بعد آزادانه اصلاح کنید.", "Spreads every line evenly across the audio; adjust afterwards.")}
        >
          {distributing ? t("در حال توزیع…", "Distributing…") : t(`توزیع یکنواخت ${lyricLines.length} سطر`, `Distribute ${lyricLines.length} lines`)}
        </Button>
      </div>
      {saveError && <div className="timeline-error">{saveError}</div>}

      <div className="editor-panels">
        {/* Inspector: the selected line, its exact times and the capture actions. */}
        <section className="capture-dock inspector" aria-label={t("سطر انتخاب‌شده", "Selected line")}>
          <div className="capture-meta">
            <span className="capture-index">
              {t("سطر", "Line")} {selectedIndex + 1}/{lyricLines.length}
            </span>
            {selectedLine?.badge && <span className={`speaker-chip tone-${selectedLine.tone ?? 0}`}>{selectedLine.badge}</span>}
            <span className={`placement-chip${selectedPlaced ? " is-placed" : ""}`}>
              {selectedPlaced ? t("روی تایم‌لاین · قابل ویرایش", "on the timeline · editable") : t("هنوز روی تایم‌لاین نیست", "not on the timeline yet")}
            </span>
            {playingIndex >= 0 && playingIndex !== selectedIndex && (
              <span className="tiny muted">
                {t("در حال پخش: سطر", "now playing: line")} {playingIndex + 1}
              </span>
            )}
          </div>
          <div className="capture-text" dir="ltr">
            {selectedLine?.text || "—"}
          </div>
          {(selectedLine?.translationFa || selectedLine?.translationEn) && (
            <div className="capture-translation">{lang === "fa" ? selectedLine?.translationFa || selectedLine?.translationEn : selectedLine?.translationEn}</div>
          )}

          {selectedPlaced && selectedLine && selectedTiming ? (
            <div className="edge-editors">
              <EdgeEditor
                label={t("شروع", "Start")}
                value={marks[selectedLine.id]?.startMs ?? null}
                derived={null}
                onCommit={(value) => writeStart(selectedLine.id, value, "typed")}
                onNudge={(delta) => nudge("start", delta)}
                onSeek={() => selectedTiming.startMs !== null && timelineRef.current?.seek(selectedTiming.startMs)}
                onCapture={() => writeStart(selectedLine.id, now(), "capture")}
                captureTitle={t("شروع = نوک پخش", "Start = playhead")}
              />
              <EdgeEditor
                label={t("پایان", "End")}
                value={marks[selectedLine.id]?.endMs ?? null}
                derived={marks[selectedLine.id]?.endMs === null ? selectedTiming.endMs : null}
                hint={endHint(selectedTiming)}
                optional
                onCommit={(value) => writeEnd(selectedLine.id, value)}
                onNudge={(delta) => nudge("end", delta)}
                onSeek={() => selectedTiming.endMs !== null && timelineRef.current?.seek(selectedTiming.endMs)}
                onCapture={() => captureEnd(selectedLine.id)}
                captureTitle={t("پایان = نوک پخش", "End = playhead")}
              />
              <div className="edge-length tiny muted">
                {t("طول", "length")}:{" "}
                <Mono>{selectedTiming.endMs !== null ? `${((selectedTiming.endMs - selectedTiming.startMs!) / 1000).toFixed(3)} s` : "—"}</Mono>
              </div>
            </div>
          ) : (
            <div className="inspector-empty">
              {t(
                "این سطر را از فهرست روبه‌رو بگیرید و روی تایم‌لاین رها کنید — یا نوک پخش را جای شروع بگذارید و «گذاشتن روی نوک پخش» یا M را بزنید.",
                "Grab this line in the list and drop it on the timeline — or park the playhead at its start and press “Place at playhead” or M.",
              )}
            </div>
          )}

          <div className="capture-main">
            <button type="button" className="capture-btn capture-start" onClick={() => captureStart()} title={t("زمان شروع سطر انتخابی = نوک پخش؛ بعد سطر بعدی انتخاب می‌شود", "Selected line's start = playhead, then select the next line")}>
              <span className="capture-icon">⏵|</span>
              <span className="capture-label">{t("ثبت شروع سطر", "Capture line start")}</span>
              <kbd>M</kbd>
            </button>
            <button type="button" className="capture-btn capture-end" onClick={() => captureEnd()} title={t("زمان پایان سطرِ در حال پخش = نوک پخش", "End of the line being played = playhead")}>
              <span className="capture-icon">|⏴</span>
              <span className="capture-label">{t("ثبت پایان سطر", "Capture line end")}</span>
              <kbd>E</kbd>
            </button>
          </div>
          <div className="capture-secondary">
            <Button size="sm" variant="ghost" onClick={() => selectIndex(selectedIndex - 1)} disabled={selectedIndex <= 0} title="J / ↑">
              ↑ {t("قبلی", "Previous")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => selectIndex(selectedIndex + 1)} disabled={selectedIndex >= lyricLines.length - 1} title="K / ↓">
              ↓ {t("بعدی", "Next")}
            </Button>
            {selectedPlaced ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => selectedId && playLine(selectedId)} title="P">
                  ▶ {t("پخش همین سطر", "Play this line")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => selectedId && removeFromTimeline(selectedId)} title={t("برگرداندن به فهرست (Delete)", "Back to the list (Delete)")}>
                  ⤒ {t("برداشتن از تایم‌لاین", "Remove from timeline")}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => selectedId && placeAtPlayhead(selectedId)} title={t("سطر را از نوک پخش شروع می‌کند", "Starts the line at the playhead")}>
                ⤓ {t("گذاشتن روی نوک پخش", "Place at playhead")}
              </Button>
            )}
          </div>
        </section>

        {/* Line list: the drag source. */}
        <section className="line-bin" aria-label={t("فهرست سطرها", "Lines")}>
          <div className="bin-head">
            <strong>{t("سطرها", "Lines")}</strong>
            <span className="tiny muted">{t("بکشید و روی تایم‌لاین رها کنید", "drag onto the timeline")}</span>
            <span className="bin-filters" role="group">
              {(
                [
                  ["all", t("همه", "All"), lyricLines.length],
                  ["unplaced", t("بیرون", "Off"), lyricLines.length - timedCount],
                  ["placed", t("روی تایم‌لاین", "Placed"), timedCount],
                ] as [BinFilter, string, number][]
              ).map(([id, label, count]) => (
                <button key={id} type="button" className={`bin-filter${filter === id ? " is-on" : ""}`} onClick={() => setFilter(id)}>
                  {label} <span>{count}</span>
                </button>
              ))}
            </span>
          </div>
          <div className="line-rows" ref={rowsRef}>
            {visibleLines.map((line) => {
              const index = lineIds.indexOf(line.id);
              return (
                <BinRow
                  key={line.id}
                  line={line}
                  index={index}
                  timing={timingById.get(line.id) ?? null}
                  selected={line.id === selectedId}
                  playing={index === playingIndex}
                  next={line.id === nextUnplacedId}
                  dragging={line.id === draggingId}
                  projectKind={projectKind}
                  lang={lang === "fa" ? "fa" : "en"}
                  onPointerDown={startRowDrag}
                  onPlay={playLine}
                  t={t}
                />
              );
            })}
            {visibleLines.length === 0 && <div className="bin-empty tiny muted">{t("چیزی اینجا نیست.", "Nothing here.")}</div>}
          </div>
        </section>
      </div>

      <Callout tone="info" title={t("روش کار", "How it works")}>
        <span className="tiny">
          {t(
            "۱) سطر را از فهرست بگیرید و روی تایم‌لاین بیندازید؛ همان سطر انتخاب می‌شود. ۲) لبه‌های چپ و راست باکس را بکشید تا شروع و پایان دقیق شود (با Ctrl + چرخ ماوس تا دقت میلی‌ثانیه بزرگ‌نمایی کنید). ۳) سطر بعدی را بیندازید — سطر قبلی خودکار قفل می‌شود. برای ویرایش دوبارهٔ هر سطر، آن را در فهرست انتخاب کنید. روش گوش‌دادن هم برقرار است: پخش کنید و با شروع هر جمله M بزنید.",
            "1) Grab a line in the list and drop it on the timeline; it becomes the selected clip. 2) Drag the clip's left/right edges for the exact start and end (Ctrl + wheel zooms down to milliseconds). 3) Drop the next line — the previous one locks automatically. To edit a line again, select it in the list. Syncing by ear still works: play and hit M as each sentence starts.",
          )}
          <br />
          Space {t("پخش/مکث", "play/pause")} · M {t("شروع", "start")} · E {t("پایان", "end")} · P {t("پخش سطر", "play line")} · Delete {t("برداشتن", "remove")} · Ctrl+Z / Ctrl+Shift+Z{" "}
          {t("واگرد/ازنو", "undo/redo")} · J/K {t("سطر قبل/بعد", "previous/next line")} · + / − / \ {t("بزرگ‌نمایی / کل صوت", "zoom / fit")} · ←/→ ±0.1s
        </span>
      </Callout>

      <div className="tiny muted">
        {t("مدت صوت:", "audio duration:")} <Mono>{formatMs(durationMs)}</Mono> · {t("هش صوت:", "audio sha256:")}{" "}
        <Mono>{detail.media.audioSha256.slice(0, 16)}…</Mono>
      </div>

      <div className="drag-ghost" ref={ghostRef} style={{ display: "none" }} aria-hidden="true">
        <b className="drag-ghost-number" />
        <span className="drag-ghost-text" />
      </div>
    </div>
  );
}

const BinRow = memo(function BinRow({
  line,
  index,
  timing,
  selected,
  playing,
  next,
  dragging,
  projectKind,
  lang,
  onPointerDown,
  onPlay,
  t,
}: {
  line: TimelineLine;
  index: number;
  timing: ResolvedTiming | null;
  selected: boolean;
  playing: boolean;
  next: boolean;
  dragging: boolean;
  projectKind: "song" | "reetalk";
  lang: "fa" | "en";
  onPointerDown: (event: React.PointerEvent, line: TimelineLine) => void;
  onPlay: (lineId: string) => void;
  t: (fa: string, en: string) => string;
}): React.ReactElement {
  const placed = timing?.startMs !== null && timing?.startMs !== undefined;
  const problems = (timing?.problems ?? []).filter((problem) => problem !== "no-start");
  const blocking = problems.some((problem) => isBlockingProblem(problem, projectKind));
  const classes = [
    "line-row",
    placed ? "is-placed" : "is-unplaced",
    selected ? "line-selected" : "",
    playing ? "line-playing" : "",
    blocking ? "line-problem" : "",
    next && !placed ? "is-next" : "",
    dragging ? "is-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} data-line-id={line.id} onPointerDown={(event) => onPointerDown(event, line)} title={line.translationFa || line.translationEn}>
      <span className="drag-grip" aria-hidden="true">
        ⠿
      </span>
      <span className="line-number">{index + 1}</span>
      <span className="line-body">
        <span className="line-text" dir="ltr">
          {line.badge && <span className={`speaker-chip tone-${line.tone ?? 0}`}>{line.badge}</span>}
          {line.text || <em className="muted">—</em>}
        </span>
        {problems.length > 0 && (
          <span className={`line-issues${blocking ? " is-blocking" : ""}`}>{problems.map((problem) => problemLabel(problem, lang)).join(" · ")}</span>
        )}
      </span>
      <span className="bin-time" dir="ltr">
        {placed ? (
          <>
            <Mono>{formatMs(timing!.startMs)}</Mono>
            <span className={timing!.endSource === "recorded" ? "" : "derived"}>
              <Mono>{formatMs(timing!.endMs)}</Mono>
            </span>
          </>
        ) : next ? (
          <span className="next-chip">{t("بعدی", "next")}</span>
        ) : (
          <span className="muted tiny">{t("بیرون", "off")}</span>
        )}
      </span>
      <button type="button" className="icon-btn" onClick={() => onPlay(line.id)} disabled={!placed} title={t("پخش فقط همین سطر", "Play just this line")}>
        ▶
      </button>
    </div>
  );
});

/** Start or end of the selected clip: typed value, ±10/100 ms nudges, capture and seek. */
function EdgeEditor({
  label,
  value,
  derived,
  hint,
  optional,
  onCommit,
  onNudge,
  onSeek,
  onCapture,
  captureTitle,
}: {
  label: string;
  value: number | null;
  derived: number | null;
  hint?: string;
  optional?: boolean;
  onCommit: (value: number | null) => boolean;
  onNudge: (deltaMs: number) => void;
  onSeek: () => void;
  onCapture: () => void;
  captureTitle: string;
}): React.ReactElement {
  return (
    <div className="edge-editor">
      <span className="edge-label">{label}</span>
      <span className="nudge-group" dir="ltr">
        <button type="button" className="nudge" onClick={() => onNudge(-100)} title="−100 ms">
          −100
        </button>
        <button type="button" className="nudge" onClick={() => onNudge(-10)} title="−10 ms">
          −10
        </button>
        <TimeCell value={value} derived={derived} placeholder="00:00.000" optional={optional} onCommit={onCommit} onSeek={onSeek} onCapture={onCapture} captureTitle={captureTitle} />
        <button type="button" className="nudge" onClick={() => onNudge(10)} title="+10 ms">
          +10
        </button>
        <button type="button" className="nudge" onClick={() => onNudge(100)} title="+100 ms">
          +100
        </button>
      </span>
      {hint && <span className="edge-hint tiny muted">{hint}</span>}
    </div>
  );
}

function TimeCell({
  value,
  derived = null,
  placeholder,
  optional,
  onCommit,
  onSeek,
  onCapture,
  captureTitle,
}: {
  value: number | null;
  derived?: number | null;
  placeholder: string;
  optional?: boolean;
  onCommit: (value: number | null) => boolean;
  onSeek: () => void;
  onCapture: () => void;
  captureTitle: string;
}): React.ReactElement {
  const [text, setText] = useState(value === null ? "" : formatMs(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(value === null ? "" : formatMs(value));
    setInvalid(false);
  }, [value]);

  const commit = (): void => {
    const current = value === null ? "" : formatMs(value);
    if (text === current) return;
    if (!text.trim()) {
      if (optional || value !== null) {
        setInvalid(!onCommit(null));
      }
      return;
    }
    const parsed = parseTimecode(text);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    const accepted = onCommit(parsed);
    setInvalid(!accepted);
    if (!accepted) setText(current);
  };

  return (
    <span className="time-cell">
      <button type="button" className="time-capture" onClick={onCapture} title={captureTitle}>
        ⏱
      </button>
      <input
        className={`input timecode${invalid ? " input-invalid" : ""}${value === null && derived !== null ? " is-derived" : ""}`}
        value={text}
        placeholder={derived !== null ? formatMs(derived) : placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            (event.target as HTMLInputElement).blur();
          } else if (event.key === "Escape") {
            setText(value === null ? "" : formatMs(value));
            (event.target as HTMLInputElement).blur();
          }
        }}
        dir="ltr"
      />
      <button type="button" className="time-seek" title="seek" onClick={onSeek} disabled={value === null && derived === null}>
        ▸
      </button>
    </span>
  );
}
