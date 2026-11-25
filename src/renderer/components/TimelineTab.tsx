import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DraftContent, ProjectDetail } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatMs, parseTimecode } from "../format";
import { AudioTimeline, type AudioTimelineHandle } from "./AudioTimeline";
import { Badge, Button, Callout, Mono, useToast } from "./ui";

interface MarkDraft {
  startMs: number | null;
  endMs: number | null;
}

/**
 * One timingable row. Song projects pass the lesson's lyric lines; ReeTalk
 * projects pass their dialogue turns (badge = speaker id) — the timeline does
 * not care where the lines came from.
 */
export interface TimelineLine {
  id: string;
  text: string;
  translationEn: string;
  badge?: string;
}

/**
 * Dedicated lyric timeline.
 *
 * The operator marks the start — and optionally the end — of every line
 * against the audio they selected. The waveform, seek bar and transport live
 * in the shared `AudioTimeline` (left-to-right, zoomable, with a draggable
 * capture line); this tab owns the marks: click the waveform or drag the
 * capture line to place the time, press Capture Start (`M`) or Capture End
 * (`E`) while playing, drag a marker, or type a millisecond timecode. Missing
 * end times are filled at export (next line's start, else audio duration), so
 * recording only starts is enough. Every change clears the review flag of
 * that line, because a reviewed mark must be bound to the current audio hash
 * and the current line text.
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
  const { t } = useLang();
  const toast = useToast();
  const projectId = detail.summary.projectId;
  const durationMs = detail.media?.durationMs ?? 0;
  const currentTimeRef = useRef(0);
  const timelineRef = useRef<AudioTimelineHandle>(null);

  const lyricLines: TimelineLine[] = lines ?? content?.lyrics ?? [];

  const [marks, setMarks] = useState<Record<string, MarkDraft>>(() => {
    const map: Record<string, MarkDraft> = {};
    for (const line of lyricLines) map[line.id] = { startMs: null, endMs: null };
    for (const mark of detail.marks) map[mark.lineId] = { startMs: mark.startMs, endMs: mark.endMs };
    return map;
  });
  const [dirty, setDirty] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(lyricLines[0]?.id ?? "");

  /* Resync when the project changes underneath us (e.g. after a save). */
  useEffect(() => {
    if (dirty) return;
    const map: Record<string, MarkDraft> = {};
    for (const line of lyricLines) map[line.id] = { startMs: null, endMs: null };
    for (const mark of detail.marks) map[mark.lineId] = { startMs: mark.startMs, endMs: mark.endMs };
    setMarks(map);
  }, [detail.marks, lyricLines, dirty]);

  const setMark = useCallback((lineId: string, startMs: number | null, endMs?: number | null) => {
    setMarks((current) => ({
      ...current,
      [lineId]: {
        startMs: startMs === null ? null : Math.max(0, Math.round(startMs)),
        endMs: endMs !== undefined ? endMs : current[lineId]?.endMs ?? null,
      },
    }));
    setDirty(true);
  }, []);

  const capture = useCallback(() => {
    if (!selectedId) return;
    const at = Math.max(0, Math.round(currentTimeRef.current));
    const recordedEnd = marks[selectedId]?.endMs ?? null;
    // A start placed at/after the recorded end makes that end stale: clear it
    // instead of silently producing an inverted interval.
    const end = recordedEnd !== null && at >= recordedEnd ? null : recordedEnd;
    setMark(selectedId, at, end);
    toast.push(t("شروع سطر انتخابی ثبت شد.", "Start of the selected line captured."), "ok");
    const next = lyricLines.find((line) => line.id === selectedId);
    if (next) {
      const index = lyricLines.indexOf(next);
      const follow = lyricLines[index + 1];
      if (follow) setSelectedId(follow.id);
    }
  }, [lyricLines, marks, selectedId, setMark, toast]);

  const captureEnd = useCallback(
    (lineId?: string) => {
      const id = lineId ?? selectedId;
      if (!id) return;
      const at = Math.max(0, Math.round(currentTimeRef.current));
      const start = marks[id]?.startMs ?? null;
      if (start === null) {
        toast.push(t("اول زمان شروع این سطر را ثبت کنید.", "Capture this line's start first."), "bad");
        return;
      }
      if (at <= start) {
        toast.push(
          t("زمان پایان باید بعد از زمان شروع باشد؛ جلوتر بروید و دوباره ثبت کنید.", "The end must come after the start — scrub forward and capture again."),
          "bad",
        );
        return;
      }
      setMark(id, start, at);
      toast.push(t("پایان سطر ثبت شد.", "Line end captured."), "ok");
    },
    [marks, selectedId, setMark, toast],
  );

  const selectedIndex = lyricLines.findIndex((line) => line.id === selectedId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        timelineRef.current?.playPause();
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        capture();
      } else if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        captureEnd();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        timelineRef.current?.seek(currentTimeRef.current + (event.shiftKey ? 1000 : 100));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        timelineRef.current?.seek(currentTimeRef.current - (event.shiftKey ? 1000 : 100));
      } else if (event.key === "j" && selectedIndex > 0) {
        setSelectedId(lyricLines[selectedIndex - 1].id);
      } else if (event.key === "k" && selectedIndex < lyricLines.length - 1) {
        setSelectedId(lyricLines[selectedIndex + 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture, captureEnd, lyricLines, durationMs, selectedIndex]);

  /* Debounced save of timing marks. */
  useEffect(() => {
    if (!dirty) return undefined;
    const timer = setTimeout(() => {
      const payload = Object.entries(marks).map(([lineId, mark]) => ({
        lineId,
        startMs: mark.startMs,
        endMs: mark.endMs,
      }));
      void api.marks
        .save(projectId, payload)
        .then(() => {
          setDirty(false);
          return onChanged();
        })
        .catch((error: unknown) => toast.push(error instanceof Error ? error.message : String(error), "bad"));
    }, 700);
    return () => clearTimeout(timer);
  }, [dirty, marks, onChanged, projectId, toast]);

  const distribute = async (): Promise<void> => {
    const timed = lyricLines.filter((line) => (marks[line.id]?.startMs ?? null) !== null).length;
    if (timed > 0 && !window.confirm(t(
      `${timed} سطر زمان دارد. همهٔ زمان‌ها با توزیع یکنواخت بازنویسی شوند؟`,
      `${timed} line(s) already have times. Overwrite them with an even spread?`,
    ))) {
      return;
    }
    setDistributing(true);
    try {
      await api.marks.distribute(projectId);
      await onChanged();
      toast.push(t("زمان‌ها توزیع شد؛ حالا هر سطر را که لازم است اصلاح کنید.", "Times distributed — adjust the lines that matter."), "ok");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setDistributing(false);
    }
  };

  if (!detail.media) {
    return (
      <div className="tab-body">
        <Callout tone="warn" title={t("تایم‌لاین بدون صوت قفل است", "The timeline needs audio")}>
          {t(
            "ابتدا در تب «نمای کلی و صوت» فایل آهنگ را از سیستم انتخاب کنید. فایل خام ایجنت هیچ صوت یا زمانی ندارد.",
            "Choose the song audio from this computer in the overview tab first. The agent draft contains no audio or timings.",
          )}
        </Callout>
      </div>
    );
  }

  return (
    <div className="tab-body timeline-tab">
      <AudioTimeline
        ref={timelineRef}
        projectId={projectId}
        kind="audio"
        durationMs={durationMs}
        onTimeUpdate={(ms) => {
          currentTimeRef.current = ms;
        }}
        onDurationReported={() => void onChanged()}
      />

      <div className="row between wrap gap">
        <div className="row gap-sm wrap">
          <Button variant="primary" size="sm" onClick={capture} title={t("زمان شروع سطر انتخابی را روی خط ثبت قرار کن", "Capture the selected line at the capture line")}>
            ⏱ {t("ثبت شروع سطر (M)", "Capture line start (M)")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => captureEnd()}
            title={t("زمان پایان سطر انتخابی را روی خط ثبت قرار کن", "Capture the selected line's end at the capture line")}
          >
            ⏱ {t("ثبت پایان سطر (E)", "Capture line end (E)")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void distribute()}
            disabled={distributing || !detail.media}
            title={t(
              "زمان شروع همهٔ سطرها را یکنواخت روی مدت صوت پخش می‌کند؛ بعد آزادانه اصلاح کنید.",
              "Spreads every line evenly across the audio; adjust afterwards as you like.",
            )}
          >
            {distributing
              ? t("در حال توزیع…", "Distributing…")
              : t(`توزیع یکنواخت ${lyricLines.length} سطر`, `Distribute ${lyricLines.length} lines`)}
          </Button>
          <Badge tone="muted">{t("سطر انتخابی", "selected")}: {selectedIndex + 1}/{lyricLines.length}</Badge>
          {dirty ? <Badge tone="warn">{t("ذخیره‌نشنده", "unsaved")}</Badge> : <Badge tone="ok">{t("ذخیره شد", "saved")}</Badge>}
        </div>
      </div>

      <div className="line-table">
        <div className="line-head">
          <span>#</span>
          <span>{t("متن", "text")}</span>
          <span>{t("شروع", "start")}</span>
          <span>{t("پایان", "end")}</span>
          <span>{t("ثبت", "mark")}</span>
        </div>
        <div className="line-rows">
          {lyricLines.map((line, index) => {
            const mark = marks[line.id] ?? { startMs: null, endMs: null };
            return (
              <div
                key={line.id}
                className={`line-row${line.id === selectedId ? " line-selected" : ""}`}
                onClick={() => setSelectedId(line.id)}
              >
                <span className="line-number">{line.badge ? `${index + 1}·${line.badge}` : index + 1}</span>
                <span className="line-text" title={line.translationEn}>
                  {line.text || <em className="muted">—</em>}
                </span>
                <TimecodeInput
                  value={mark.startMs}
                  onCommit={(value) => setMark(line.id, value)}
                  onSeek={() => mark.startMs !== null && timelineRef.current?.seek(mark.startMs)}
                />
                <TimecodeInput
                  value={mark.endMs}
                  optional
                  onCommit={(value) => setMark(line.id, mark.startMs, value)}
                  onSeek={() => mark.endMs !== null && timelineRef.current?.seek(mark.endMs)}
                />
                <span
                  className="line-review"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t("زمان شروع این سطر را روی خط ثبت قرار کن", "Capture this line at the capture line")}
                    onClick={() => {
                      setSelectedId(line.id);
                      const at = Math.max(0, Math.round(currentTimeRef.current));
                      const recordedEnd = mark.endMs;
                      setMark(line.id, at, recordedEnd !== null && at >= recordedEnd ? null : recordedEnd);
                      toast.push(t(`شروع سطر ${index + 1} ثبت شد.`, `Line ${index + 1} start captured.`), "ok");
                    }}
                  >
                    ⏱ {t("ثبت شروع", "Start")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t("زمان پایان این سطر را روی خط ثبت قرار کن", "Capture this line's end at the capture line")}
                    onClick={() => {
                      setSelectedId(line.id);
                      captureEnd(line.id);
                    }}
                  >
                    ⏱ {t("ثبت پایان", "End")}
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Callout tone="info" title={t("میان‌برهای صفحه‌کلید", "Keyboard shortcuts")}>
        <span className="tiny">
          Space {t("پخش/مکث", "play/pause")} · M {t("ثبت زمان شروع", "capture start")} · E {t("ثبت زمان پایان", "capture end")} · ←/→ ±100ms (Shift ±1s) · J/K{" "}
          {t("سطر قبلی/بعدی", "previous/next line")} · محور تایم‌لاین از چپ به راست است
        </span>
      </Callout>

      <div className="tiny">
        {t("مدت صوت:", "audio duration:")} <Mono>{formatMs(durationMs)}</Mono> ·{" "}
        {t("هش صوت:", "audio sha256:")} <Mono>{detail.media.audioSha256.slice(0, 16)}…</Mono> ·{" "}
        {t("پایان خالی در خروجی = شروع خط بعدی (آخرین خط = پایان صوت)", "empty end = next line's start at export (last line = audio end)")}
      </div>
    </div>
  );
}

function TimecodeInput({
  value,
  onCommit,
  onSeek,
  optional,
}: {
  value: number | null;
  onCommit: (value: number | null) => void;
  onSeek: () => void;
  optional?: boolean;
}): React.ReactElement {
  const [text, setText] = useState(value === null ? "" : formatMs(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(value === null ? "" : formatMs(value));
    setInvalid(false);
  }, [value]);

  const commit = (): void => {
    if (!text.trim()) {
      if (optional) {
        onCommit(null);
        setInvalid(false);
      } else {
        setInvalid(true);
      }
      return;
    }
    const parsed = parseTimecode(text);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(parsed);
  };

  return (
    <span className="timecode-cell" onClick={(event) => event.stopPropagation()}>
      <input
        className={`input timecode${invalid ? " input-invalid" : ""}`}
        value={text}
        placeholder={optional ? "—" : "00:00.000"}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            (event.target as HTMLInputElement).blur();
          }
        }}
        dir="ltr"
      />
      <button className="icon-btn tiny-btn" title="seek" onClick={onSeek} disabled={value === null}>
        ▸
      </button>
    </span>
  );
}
