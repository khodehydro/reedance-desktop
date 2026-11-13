import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftContent, ProjectDetail } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatMs, formatSeconds, parseTimecode } from "../format";
import { Badge, Button, Callout, Mono, useToast } from "./ui";

interface MarkDraft {
  startMs: number | null;
  endMs: number | null;
}

/**
 * Dedicated lyric timeline.
 *
 * The operator marks the start of every line against the audio they selected:
 * click the waveform to seek, press Capture (or `M`) while playing, drag a
 * marker, or type a millisecond timecode. Every change clears the review flag of
 * that line, because a reviewed mark must be bound to the current audio hash and
 * the current line text.
 */
export function TimelineTab({
  detail,
  content,
  onChanged,
}: {
  detail: ProjectDetail;
  content: DraftContent;
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const { t } = useLang();
  const toast = useToast();
  const projectId = detail.summary.projectId;
  const durationMs = detail.media?.durationMs ?? 0;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef<{ lineId: string } | null>(null);
  const seekingRef = useRef(false);

  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [decodeState, setDecodeState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [zoom, setZoom] = useState(60);
  const [selectedId, setSelectedId] = useState<string>(content.lyrics[0]?.id ?? "");
  const [marks, setMarks] = useState<Record<string, MarkDraft>>(() => {
    const map: Record<string, MarkDraft> = {};
    for (const line of content.lyrics) map[line.id] = { startMs: null, endMs: null };
    for (const mark of detail.marks) map[mark.lineId] = { startMs: mark.startMs, endMs: mark.endMs };
    return map;
  });
  const [dirty, setDirty] = useState(false);
  const [loop, setLoop] = useState<{ a: number | null; b: number | null; active: boolean }>({ a: null, b: null, active: false });

  /* Resync when the project changes underneath us (e.g. after a save). */
  useEffect(() => {
    if (dirty) return;
    const map: Record<string, MarkDraft> = {};
    for (const line of content.lyrics) map[line.id] = { startMs: null, endMs: null };
    for (const mark of detail.marks) map[mark.lineId] = { startMs: mark.startMs, endMs: mark.endMs };
    setMarks(map);
  }, [detail.marks, content.lyrics, dirty]);

  /* Load the audio element. */
  useEffect(() => {
    let active = true;
    void api.media.playUrl(projectId, "audio").then((url) => {
      if (active) setAudioUrl(url);
    });
    return () => {
      active = false;
    };
  }, [projectId, detail.media?.audioSha256]);

  /* Decode the audio once to draw a waveform and to measure duration if needed. */
  useEffect(() => {
    let active = true;
    setPeaks(null);
    setDecodeState("loading");
    const run = async (): Promise<void> => {
      try {
        const bytes = await api.media.bytes(projectId, "audio");
        if (!bytes) {
          if (active) setDecodeState("error");
          return;
        }
        const context = new AudioContext();
        const buffer = await context.decodeAudioData(bytes.slice(0));
        await context.close();
        const buckets = 16000;
        const channel = buffer.getChannelData(0);
        const step = Math.max(1, Math.floor(channel.length / buckets));
        const next = new Float32Array(buckets);
        let peak = 0.001;
        for (let bucket = 0; bucket < buckets; bucket += 1) {
          let max = 0;
          const start = bucket * step;
          for (let index = start; index < start + step && index < channel.length; index += 1) {
            const value = Math.abs(channel[index]);
            if (value > max) max = value;
          }
          next[bucket] = max;
          if (max > peak) peak = max;
        }
        for (let index = 0; index < next.length; index += 1) next[index] /= peak;
        if (!active) return;
        setPeaks(next);
        setDecodeState("ready");
        if (detail.media && detail.media.durationMs <= 0) {
          const measured = Math.round(buffer.duration * 1000);
          await api.media.reportDuration(projectId, measured);
          await onChanged();
        }
      } catch {
        if (active) setDecodeState("error");
      }
    };
    if (detail.media) void run();
    else setDecodeState("idle");
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, detail.media?.audioSha256]);

  /* Playhead animation while playing. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const tick = (): void => {
      setCurrentMs(audio.currentTime * 1000);
      if (loop.active && loop.a !== null && loop.b !== null) {
        if (audio.currentTime * 1000 > loop.b) audio.currentTime = loop.a / 1000;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    if (playing) rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, loop]);

  /* Keep the playhead in view while playing. */
  useEffect(() => {
    if (!playing) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const position = (currentMs / 1000) * zoom;
    const left = scroll.scrollLeft;
    const right = left + scroll.clientWidth;
    if (position < left + 60 || position > right - 120) {
      scroll.scrollLeft = Math.max(0, position - scroll.clientWidth * 0.3);
    }
  }, [currentMs, playing, zoom]);

  const width = useMemo(() => Math.max(720, ((durationMs || 1000) / 1000) * zoom), [durationMs, zoom]);
  const height = 172;

  /* Static waveform + markers. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(20, 40, 70, 0.85)");
    gradient.addColorStop(1, "rgba(10, 22, 40, 0.9)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // second grid
    const seconds = Math.ceil((durationMs || 1000) / 1000);
    for (let second = 0; second <= seconds; second += 1) {
      const x = ((second * 1000) / 1000) * zoom;
      if (x > width) break;
      ctx.strokeStyle = second % 5 === 0 ? "rgba(120, 170, 255, 0.22)" : "rgba(120, 170, 255, 0.08)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // waveform
    if (peaks) {
      ctx.fillStyle = "rgba(122, 214, 255, 0.72)";
      const center = height / 2;
      for (let x = 0; x < width; x += 1) {
        const bucket = Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length));
        const amplitude = peaks[bucket] * (height * 0.44);
        ctx.fillRect(x, center - amplitude, 1, Math.max(1, amplitude * 2));
      }
    } else {
      ctx.fillStyle = "rgba(148, 170, 200, 0.5)";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(decodeState === "loading" ? "decoding waveform…" : "no waveform available", 16, height / 2);
    }

    // loop region
    if (loop.a !== null && loop.b !== null) {
      const x1 = (loop.a / 1000) * zoom;
      const x2 = (loop.b / 1000) * zoom;
      ctx.fillStyle = "rgba(255, 196, 92, 0.14)";
      ctx.fillRect(x1, 0, x2 - x1, height);
    }

    // line markers
    content.lyrics.forEach((line, index) => {
      const mark = marks[line.id];
      if (!mark || mark.startMs === null) return;
      const x = (mark.startMs / 1000) * zoom;
      const isSelected = line.id === selectedId;
      ctx.strokeStyle = isSelected ? "rgba(255, 214, 120, 0.95)" : "rgba(160, 200, 255, 0.45)";
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillStyle = isSelected ? "rgba(255, 214, 120, 0.95)" : "rgba(200, 220, 255, 0.6)";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(String(index + 1), x + 3, 12);
    });
  }, [peaks, width, height, zoom, marks, selectedId, content.lyrics, durationMs, loop, decodeState]);

  const seek = useCallback((ms: number) => {
    const audio = audioRef.current;
    const clamped = Math.max(0, Math.min(ms, Math.max(0, durationMs - 30)));
    setCurrentMs(clamped);
    if (audio) audio.currentTime = clamped / 1000;
  }, [durationMs]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !detail.media) return;
    if (audio.paused) {
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [detail.media]);

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

  const selectedIndex = content.lyrics.findIndex((line) => line.id === selectedId);

  const capture = useCallback(() => {
    if (!selectedId) return;
    setMark(selectedId, Math.round(currentMs));
    const next = content.lyrics[selectedIndex + 1];
    if (next) setSelectedId(next.id);
  }, [currentMs, content.lyrics, selectedId, selectedIndex, setMark]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        capture();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(currentMs + (event.shiftKey ? 1000 : 100));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(currentMs - (event.shiftKey ? 1000 : 100));
      } else if (event.key === "j" && selectedIndex > 0) {
        setSelectedId(content.lyrics[selectedIndex - 1].id);
      } else if (event.key === "k" && selectedIndex < content.lyrics.length - 1) {
        setSelectedId(content.lyrics[selectedIndex + 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture, content.lyrics, currentMs, seek, selectedIndex, togglePlay]);

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

  const pointerPosition = (event: React.PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const x = pointerPosition(event);
    const ms = (x / zoom) * 1000;
    const nearest = content.lyrics.find((line) => {
      const start = marks[line.id]?.startMs;
      if (start === null || start === undefined) return false;
      return Math.abs((start / 1000) * zoom - x) < 7;
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (nearest) {
      draggingRef.current = { lineId: nearest.id };
      setSelectedId(nearest.id);
    } else {
      seekingRef.current = true;
      seek(ms);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current && !seekingRef.current) return;
    const x = pointerPosition(event);
    const ms = Math.max(0, Math.min(Math.round(((x / zoom) * 1000) / 10) * 10, Math.max(0, durationMs - 10)));
    if (draggingRef.current) {
      setMark(draggingRef.current.lineId, ms);
    } else {
      seek(ms);
    }
  };

  const onPointerUp = (): void => {
    draggingRef.current = null;
    seekingRef.current = false;
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
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="auto"
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          if (Number.isFinite(element.duration) && element.duration * 1000 > 0) {
            setCurrentMs(element.currentTime * 1000);
          }
        }}
      />

      <div className="transport">
        <div className="transport-left">
          <Button size="sm" variant="primary" onClick={togglePlay}>
            {playing ? t("مکث", "Pause") : t("پخش", "Play")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => seek(currentMs - 5000)}>
            −5s
          </Button>
          <Button size="sm" variant="ghost" onClick={() => seek(currentMs + 5000)}>
            +5s
          </Button>
          <Button size="sm" variant="ghost" onClick={() => seek(0)}>
            ⏮
          </Button>
          <span className="transport-time">
            <Mono>{formatMs(currentMs)}</Mono> / <Mono>{formatMs(durationMs)}</Mono>
          </span>
        </div>
        <div className="transport-right">
          <span className="tiny">{t("بزرگ‌نمایی", "zoom")}</span>
          <input
            type="range"
            min={20}
            max={260}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="zoom"
          />
          <Button
            size="sm"
            variant={loop.active ? "primary" : "ghost"}
            onClick={() => setLoop((current) => ({ ...current, active: !current.active }))}
            disabled={loop.a === null || loop.b === null}
          >
            {t("تکرار بازه", "Loop")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLoop((current) => ({ ...current, a: Math.round(currentMs) }))}>
            A
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLoop((current) => ({ ...current, b: Math.round(currentMs) }))}>
            B
          </Button>
        </div>
      </div>

      <div className="wave-scroll" ref={scrollRef}>
        <div className="wave-content" style={{ width, height }}>
          <canvas ref={canvasRef} className="wave-canvas" />
          <div className="playhead" style={{ transform: `translateX(${(currentMs / 1000) * zoom}px)` }} />
          <div
            className="wave-hit"
            style={{ width, height }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
      </div>

      <div className="row between wrap gap">
        <div className="row gap-sm wrap">
          <Button variant="primary" size="sm" onClick={capture}>
            {t("ثبت زمان سطر (M)", "Capture line time (M)")}
          </Button>
          <Badge tone="muted">{t("سطر انتخابی", "selected")}: {selectedIndex + 1}/{content.lyrics.length}</Badge>
          {dirty ? <Badge tone="warn">{t("ذخیره‌نشده", "unsaved")}</Badge> : <Badge tone="ok">{t("ذخیره شد", "saved")}</Badge>}
          {decodeState === "error" ? <Badge tone="warn">{t("waveform ناموجود", "waveform unavailable")}</Badge> : null}
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
          {content.lyrics.map((line, index) => {
            const mark = marks[line.id] ?? { startMs: null, endMs: null };
            return (
              <div
                key={line.id}
                className={`line-row${line.id === selectedId ? " line-selected" : ""}`}
                onClick={() => setSelectedId(line.id)}
              >
                <span className="line-number">{index + 1}</span>
                <span className="line-text" title={line.translationFa}>
                  {line.text || <em className="muted">—</em>}
                </span>
                <TimecodeInput
                  value={mark.startMs}
                  onCommit={(value) => setMark(line.id, value)}
                  onSeek={() => mark.startMs !== null && seek(mark.startMs)}
                />
                <TimecodeInput
                  value={mark.endMs}
                  optional
                  onCommit={(value) => setMark(line.id, mark.startMs, value)}
                  onSeek={() => mark.endMs !== null && seek(mark.endMs)}
                />
                <span className="line-review">
                  <button
                    className="icon-btn"
                    title={t("ثبت زمان همین سطر", "Capture this line")}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(line.id);
                      setMark(line.id, Math.round(currentMs));
                    }}
                  >
                    ⏱
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Callout tone="info" title={t("میان‌برهای صفحه‌کلید", "Keyboard shortcuts")}>
        <span className="tiny">
          Space {t("پخش/مکث", "play/pause")} · M {t("ثبت زمان سطر", "capture line")} · ←/→ ±100ms (Shift ±1s) · J/K{" "}
          {t("سطر قبلی/بعدی", "previous/next line")}
        </span>
      </Callout>

      <div className="tiny">
        {t("مدت صوت:", "audio duration:")} <Mono>{formatSeconds(durationMs)}</Mono> ·{" "}
        {t("هش صوت:", "audio sha256:")} <Mono>{detail.media.audioSha256.slice(0, 16)}…</Mono>
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
