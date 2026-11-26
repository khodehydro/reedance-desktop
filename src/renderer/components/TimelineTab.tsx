import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftContent, ProjectDetail } from "@shared/types";
import { isBlockingProblem, problemLabel, resolveTimings, type ResolvedTiming } from "@shared/timing";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatMs, parseTimecode } from "../format";
import { AudioTimeline, type AudioTimelineHandle, type TimelineMarker } from "./AudioTimeline";
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

function marksFrom(lines: TimelineLine[], detail: ProjectDetail): MarkMap {
  const map: MarkMap = {};
  for (const line of lines) map[line.id] = { startMs: null, endMs: null };
  for (const mark of detail.marks) map[mark.lineId] = { startMs: mark.startMs, endMs: mark.endMs };
  return map;
}

/**
 * Timeline tab: the operator times every line against their own audio.
 *
 * - One playhead: it is what you hear and what Capture records (M = start,
 *   E = end). Sync by ear while playing, or park the playhead and capture.
 * - `M` records the selected line's start and moves to the next line. `E`
 *   records the end of the line that is playing: the selected line if it has
 *   started, otherwise the previous one — so M, E, M, E… works in one pass.
 * - Missing ends are filled at export (next start, last line = audio end);
 *   the table shows those derived values in grey.
 * - Values are validated before saving (inside the audio, end after start)
 *   and only changed rows are sent, so one stale row can never block saving
 *   the rest.
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

  const [marks, setMarks] = useState<MarkMap>(() => marksFrom(lyricLines, detail));
  const savedRef = useRef<MarkMap>(marksFrom(lyricLines, detail));
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(lyricLines[0]?.id ?? "");
  const [playingIndex, setPlayingIndex] = useState(-1);
  const [durationMs, setDurationMs] = useState(storedDuration);

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

  const lineNumber = useCallback((id: string) => lineIds.indexOf(id) + 1, [lineIds]);
  const effectiveDuration = (): number => timelineRef.current?.getDuration() || durationMs;
  const now = (): number => Math.max(0, Math.round(timelineRef.current?.getTime() ?? 0));

  const update = useCallback((lineId: string, next: MarkDraft) => {
    setMarks((current) => ({ ...current, [lineId]: next }));
    setDirty(true);
    setSaveError(null);
  }, []);

  /** Validated start write. Returns false (and explains why) when rejected. */
  const writeStart = useCallback(
    (lineId: string, value: number | null, source: "capture" | "typed"): boolean => {
      const current = marks[lineId] ?? { startMs: null, endMs: null };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [marks, update, lineNumber, t, toast, durationMs],
  );

  /** Validated end write. */
  const writeEnd = useCallback(
    (lineId: string, value: number | null): boolean => {
      const current = marks[lineId] ?? { startMs: null, endMs: null };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [marks, update, lineNumber, t, toast, durationMs],
  );

  const selectIndex = useCallback(
    (index: number) => {
      const line = lyricLines[Math.max(0, Math.min(lyricLines.length - 1, index))];
      if (line) setSelectedId(line.id);
    },
    [lyricLines],
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
      const selected = marks[lineIds[selectedIndex]];
      if (selected?.startMs !== null && selected?.startMs !== undefined && selected.startMs < at) return lineIds[selectedIndex];
      const previousId = lineIds[selectedIndex - 1];
      const previous = previousId ? marks[previousId] : undefined;
      if (previous?.startMs !== null && previous?.startMs !== undefined && previous.startMs < at) return previousId;
      return lineIds[selectedIndex];
    },
    [selectedIndex, marks, lineIds],
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
        toast.push(t("این سطر هنوز زمان شروع ندارد.", "This line has no start yet."), "bad");
        return;
      }
      timelineRef.current?.playRange(timing.startMs, timing.endMs);
    },
    [timingById, t, toast],
  );

  /* Keyboard shortcuts (the timeline component's own shortcuts are off here). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
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
  }, [captureStart, captureEnd, playLine, selectIndex, selectedIndex, selectedId]);

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
          `${timed} سطر زمان دارد. همهٔ زمان‌ها با توزیع یکنواخت بازنویسی شوند؟`,
          `${timed} line(s) already have times. Overwrite them with an even spread?`,
        ),
      )
    ) {
      return;
    }
    setDistributing(true);
    try {
      await api.marks.distribute(projectId);
      setDirty(false);
      await onChanged();
      toast.push(t("زمان‌ها توزیع شد؛ حالا هر سطر را که لازم است اصلاح کنید.", "Times distributed — adjust the lines that matter."), "ok");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setDistributing(false);
    }
  };

  const markers: TimelineMarker[] = useMemo(
    () =>
      timings
        .filter((timing): timing is ResolvedTiming & { startMs: number } => timing.startMs !== null)
        .map((timing) => ({
          id: timing.id,
          label: String(timing.index + 1),
          startMs: timing.startMs,
          endMs: timing.endMs,
          endDerived: timing.endSource !== "recorded",
          selected: timing.id === selectedId,
          problem: timing.problems.some((problem) => problem !== "no-start" && isBlockingProblem(problem, projectKind)),
          tone: lyricLines[timing.index]?.tone ?? ((timing.index % 2) as 0 | 1),
        })),
    [timings, selectedId, lyricLines, projectKind],
  );

  const timedCount = timings.filter((timing) => timing.startMs !== null).length;
  const blockingCount = timings.filter((timing) =>
    timing.problems.some((problem) => problem !== "no-start" && isBlockingProblem(problem, projectKind)),
  ).length;

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
        markers={markers}
        onMarkerSelect={(id) => {
          setSelectedId(id);
          const timing = timingById.get(id);
          if (timing?.startMs !== null && timing?.startMs !== undefined) timelineRef.current?.seek(timing.startMs);
        }}
      />

      {/* Capture dock: the selected line and the two capture actions, together. */}
      <section className="capture-dock" aria-label={t("ثبت زمان", "Capture")}>
        <div className="capture-info">
          <div className="capture-meta">
            <span className="capture-index">
              {t("سطر", "Line")} {selectedIndex + 1}/{lyricLines.length}
            </span>
            {selectedLine?.badge && <span className={`speaker-chip tone-${selectedLine.tone ?? 0}`}>{selectedLine.badge}</span>}
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
          <div className="capture-times">
            <span>
              {t("شروع", "start")} <Mono>{formatMs(selectedTiming?.startMs ?? null)}</Mono>
            </span>
            <span>
              {t("پایان", "end")}{" "}
              <span className={selectedTiming?.endSource === "recorded" ? "" : "derived"}>
                <Mono>{formatMs(selectedTiming?.endMs ?? null)}</Mono>
              </span>
              <span className="tiny muted"> · {endHint(selectedTiming)}</span>
            </span>
          </div>
        </div>
        <div className="capture-actions">
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
              ↑ {t("سطر قبل", "Previous")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => selectIndex(selectedIndex + 1)} disabled={selectedIndex >= lyricLines.length - 1} title="K / ↓">
              ↓ {t("سطر بعد", "Next")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => selectedId && playLine(selectedId)} disabled={selectedTiming?.startMs == null} title="P">
              ▶ {t("پخش همین سطر", "Play this line")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => selectedId && writeStart(selectedId, null, "typed")}
              disabled={selectedTiming?.startMs == null}
              title={t("پاک کردن شروع و پایان این سطر", "Clear this line's start and end")}
            >
              ✕ {t("پاک کردن", "Clear")}
            </Button>
          </div>
        </div>
      </section>

      <div className="timeline-status">
        <div className="row gap-sm wrap">
          <Badge tone={timedCount === lyricLines.length ? "ok" : "muted"}>
            {t("زمان‌دار", "timed")}: {timedCount}/{lyricLines.length}
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

      <div className="line-table">
        <div className="line-head">
          <span>#</span>
          <span>{t("متن", "text")}</span>
          <span>{t("شروع", "start")}</span>
          <span>{t("پایان", "end")}</span>
          <span />
        </div>
        <div className="line-rows" ref={rowsRef}>
          {lyricLines.map((line, index) => {
            const mark = marks[line.id] ?? { startMs: null, endMs: null };
            const timing = timingById.get(line.id) ?? null;
            const problems = (timing?.problems ?? []).filter((problem) => problem !== "no-start");
            const blocking = problems.some((problem) => isBlockingProblem(problem, projectKind));
            return (
              <div
                key={line.id}
                data-line-id={line.id}
                className={`line-row${line.id === selectedId ? " line-selected" : ""}${index === playingIndex ? " line-playing" : ""}${blocking ? " line-problem" : ""}`}
                onClick={() => setSelectedId(line.id)}
              >
                <span className="line-number">{index + 1}</span>
                <span className="line-body">
                  <span className="line-text" dir="ltr" title={line.translationFa || line.translationEn}>
                    {line.badge && <span className={`speaker-chip tone-${line.tone ?? 0}`}>{line.badge}</span>}
                    {line.text || <em className="muted">—</em>}
                  </span>
                  {problems.length > 0 && (
                    <span className={`line-issues${blocking ? " is-blocking" : ""}`}>
                      {problems.map((problem) => problemLabel(problem, lang === "fa" ? "fa" : "en")).join(" · ")}
                    </span>
                  )}
                </span>
                <TimeCell
                  value={mark.startMs}
                  placeholder="00:00.000"
                  onCommit={(value) => writeStart(line.id, value, "typed")}
                  onSeek={() => mark.startMs !== null && timelineRef.current?.seek(mark.startMs)}
                  onCapture={() => {
                    setSelectedId(line.id);
                    writeStart(line.id, now(), "capture");
                  }}
                  captureTitle={t("شروع این سطر = نوک پخش", "This line's start = playhead")}
                />
                <TimeCell
                  value={mark.endMs}
                  derived={mark.endMs === null ? timing?.endMs ?? null : null}
                  placeholder="—"
                  optional
                  onCommit={(value) => writeEnd(line.id, value)}
                  onSeek={() => {
                    const target = mark.endMs ?? timing?.endMs ?? null;
                    if (target !== null) timelineRef.current?.seek(target);
                  }}
                  onCapture={() => {
                    setSelectedId(line.id);
                    captureEnd(line.id);
                  }}
                  captureTitle={t("پایان این سطر = نوک پخش", "This line's end = playhead")}
                />
                <span className="line-play" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => playLine(line.id)}
                    disabled={mark.startMs === null}
                    title={t("پخش فقط همین سطر", "Play just this line")}
                  >
                    ▶
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Callout tone="info" title={t("روش سریع سینک از روی صدا", "Fast sync by ear")}>
        <span className="tiny">
          {t(
            "پخش را بزنید (Space) و با شروع هر جمله M را بزنید؛ اگر بین جمله‌ها سکوت دارید، با تمام شدن جمله E را بزنید. اگر پایان را ثبت نکنید، در خروجی پایان = شروع سطر بعد. برای دقت بیشتر سرعت 0.75× یا 0.5× را انتخاب کنید و با «▶» هر سطر را جداگانه گوش کنید.",
            "Press play (Space) and hit M as each sentence starts; if there is silence between sentences, hit E as it ends. Without an end, the export uses the next line's start. Use 0.75× or 0.5× for precision and ▶ to audition single lines.",
          )}
          <br />
          Space {t("پخش/مکث", "play/pause")} · M {t("شروع", "start")} · E {t("پایان", "end")} · P {t("پخش سطر", "play line")} · J/K {t("یا", "or")} ↑/↓{" "}
          {t("سطر قبل/بعد", "previous/next line")} · ←/→ ±0.1s (Shift ±1s)
        </span>
      </Callout>

      <div className="tiny muted">
        {t("مدت صوت:", "audio duration:")} <Mono>{formatMs(durationMs)}</Mono> · {t("هش صوت:", "audio sha256:")}{" "}
        <Mono>{detail.media.audioSha256.slice(0, 16)}…</Mono>
      </div>
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
    <span className="time-cell" onClick={(event) => event.stopPropagation()}>
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
