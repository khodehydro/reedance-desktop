import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatMs, formatSeconds } from "../format";
import { Button, Mono } from "./ui";

export type TimelineKind = "audio" | "story-audio";

/** A timed line drawn on the waveform (start line + its effective interval). */
export interface TimelineMarker {
  id: string;
  label: string;
  startMs: number;
  /** Effective end as it will be exported (recorded or derived). */
  endMs: number | null;
  /** True when the end is derived (next start / audio end), not recorded. */
  endDerived: boolean;
  selected: boolean;
  problem: boolean;
  /** Alternates the colour per speaker / line parity. */
  tone: 0 | 1;
}

export interface AudioTimelineHandle {
  playPause: () => void;
  seek: (ms: number) => void;
  /** Exact current position (read from the audio element while playing). */
  getTime: () => number;
  /** Duration the waveform and playhead use (decoder-measured when known). */
  getDuration: () => number;
  /** Play [startMs, endMs) and stop exactly at the end. */
  playRange: (startMs: number, endMs: number) => void;
}

interface AudioTimelineProps {
  projectId: string;
  kind: TimelineKind;
  /** Duration stored in the project (0 while unknown). */
  durationMs: number;
  /** Fired after the decoder measured a duration that differs from `durationMs`. */
  onDurationReported?: (ms: number) => void | Promise<void>;
  /** Fired whenever the playhead moves. */
  onTimeUpdate?: (ms: number) => void;
  /** Enable Space / arrow-key shortcuts (the lyric timeline owns its own). */
  shortcuts?: boolean;
  /** Smaller waveform, for the story audio panel. */
  compact?: boolean;
  markers?: TimelineMarker[];
  onMarkerSelect?: (id: string) => void;
}

const RULER = 18;
const SPEEDS = [0.5, 0.75, 1] as const;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];

/**
 * Shared audio timeline (song audio, ReeTalk audio, story audio).
 *
 * Accuracy rules: the time scale is exactly `zoom` pixels per second
 * everywhere — waveform, ruler, playhead, markers and pointer mapping all use
 * the same `ms ↔ x` conversion, and the duration is the one Chromium's
 * decoder measured from the very bytes that play. There is one playhead: it is
 * both what you hear and what Capture records, so syncing by ear while the
 * audio plays and syncing by dragging while paused land on the same time.
 */
export const AudioTimeline = forwardRef<AudioTimelineHandle, AudioTimelineProps>(function AudioTimeline(
  { projectId, kind, durationMs, onDurationReported, onTimeUpdate, shortcuts = false, compact = false, markers, onMarkerSelect },
  ref,
): React.ReactElement {
  const { t } = useLang();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const lastTimeRef = useRef(0);
  const stopAtRef = useRef<number | null>(null);
  const reportedRef = useRef<string | null>(null);

  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [decodeState, setDecodeState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [zoom, setZoom] = useState(compact ? 40 : 90);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [decodedMs, setDecodedMs] = useState(0);
  const [elementMs, setElementMs] = useState(0);
  const [loop, setLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });

  /** The duration everything is drawn against: decoder > stored > element. */
  const totalMs = decodedMs > 0 ? decodedMs : durationMs > 0 ? durationMs : elementMs;
  const totalRef = useRef(totalMs);
  totalRef.current = totalMs;

  /* Load the audio element for this media kind. */
  useEffect(() => {
    let active = true;
    setDecodedMs(0);
    setElementMs(0);
    void api.media.playUrl(projectId, kind).then((url) => {
      if (active) {
        setAudioUrl(url);
        setDecodeState("idle");
        setPeaks(null);
      }
    });
    return () => {
      active = false;
    };
  }, [projectId, kind]);

  /* Decode once: waveform peaks + the exact duration. */
  useEffect(() => {
    if (!audioUrl) return undefined;
    let active = true;
    setPeaks(null);
    setDecodeState("loading");
    const run = async (): Promise<void> => {
      try {
        const bytes = await api.media.bytes(projectId, kind);
        if (!bytes) {
          if (active) setDecodeState("error");
          return;
        }
        const context = new AudioContext();
        const buffer = await context.decodeAudioData(bytes.slice(0));
        await context.close();
        // ~200 peaks per second: enough detail at the maximum zoom without
        // dropping the tail (fractional bucket edges cover every sample).
        const channel = buffer.getChannelData(0);
        const buckets = Math.max(2000, Math.min(400_000, Math.ceil(buffer.duration * 200)));
        const next = new Float32Array(buckets);
        const perBucket = channel.length / buckets;
        let peak = 0.001;
        for (let bucket = 0; bucket < buckets; bucket += 1) {
          const start = Math.floor(bucket * perBucket);
          const end = Math.min(channel.length, Math.max(start + 1, Math.floor((bucket + 1) * perBucket)));
          let max = 0;
          for (let index = start; index < end; index += 1) {
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
        setDecodedMs(Math.round(buffer.duration * 1000));
      } catch {
        if (active) setDecodeState("error");
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [audioUrl, projectId, kind]);

  /* Persist a decoder measurement that disagrees with the stored duration. */
  useEffect(() => {
    if (decodedMs <= 0 || !audioUrl) return;
    if (durationMs > 0 && Math.abs(decodedMs - durationMs) <= 250) return;
    const key = `${audioUrl}:${decodedMs}`;
    if (reportedRef.current === key) return;
    reportedRef.current = key;
    void (async () => {
      try {
        await api.media.reportDuration(projectId, decodedMs, kind);
      } catch {
        /* the waveform still uses the measurement locally */
      }
      await onDurationReported?.(decodedMs);
    })();
  }, [decodedMs, durationMs, audioUrl, projectId, kind, onDurationReported]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed, audioUrl]);

  const emitTime = useCallback(
    (ms: number) => {
      lastTimeRef.current = ms;
      setCurrentMs(ms);
      onTimeUpdate?.(ms);
    },
    [onTimeUpdate],
  );

  const clampMs = useCallback((ms: number): number => {
    const total = totalRef.current;
    const upper = total > 0 ? total - 1 : Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.min(Math.round(ms), upper));
  }, []);

  /* Playhead animation while playing: loop region and range-stop. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playing) return undefined;
    const tick = (): void => {
      let ms = audio.currentTime * 1000;
      const stopAt = stopAtRef.current;
      if (stopAt !== null && ms >= stopAt) {
        audio.pause();
        audio.currentTime = stopAt / 1000;
        ms = stopAt;
        stopAtRef.current = null;
      } else if (loop.a !== null && loop.b !== null && ms > loop.b) {
        audio.currentTime = loop.a / 1000;
        ms = loop.a;
      }
      emitTime(ms);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, loop, emitTime]);

  /* Keep the playhead in view while playing. */
  useEffect(() => {
    if (!playing) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const position = (currentMs / 1000) * zoom;
    const left = scroll.scrollLeft;
    if (position < left + 40 || position > left + scroll.clientWidth - 80) {
      scroll.scrollLeft = Math.max(0, position - scroll.clientWidth * 0.25);
    }
  }, [currentMs, playing, zoom]);

  const contentWidth = ((totalMs || 1000) / 1000) * zoom;
  const width = Math.max(compact ? 360 : 720, Math.ceil(contentWidth) + 24);
  const height = compact ? 96 : 168;
  const msToX = useCallback((ms: number) => (ms / 1000) * zoom, [zoom]);

  /* Waveform + ruler. Peaks span exactly [0, contentWidth]; past the end is shaded. */
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

    ctx.fillStyle = "#101a2a";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#0b1320";
    ctx.fillRect(0, 0, width, RULER);
    if (contentWidth < width) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(contentWidth, 0, width - contentWidth, height);
    }

    // Ruler: labelled ticks at least ~70 px apart, minor ticks in between.
    const step = TICK_STEPS.find((candidate) => candidate * zoom >= 70) ?? 120;
    const minor = step / 5;
    const totalSeconds = (totalMs || 1000) / 1000;
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";
    for (let index = 0; index * minor <= totalSeconds + 1e-6; index += 1) {
      const second = index * minor;
      const x = Math.round(second * zoom) + 0.5;
      const major = index % 5 === 0;
      ctx.strokeStyle = major ? "rgba(140, 180, 255, 0.28)" : "rgba(140, 180, 255, 0.09)";
      ctx.beginPath();
      ctx.moveTo(x, major ? 0 : RULER - 5);
      ctx.lineTo(x, height);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "rgba(190, 210, 240, 0.85)";
        const label = step < 1 ? formatMs(second * 1000).replace(/^00:/, "") : formatSeconds(second * 1000);
        ctx.fillText(label, x + 3, 3);
      }
    }

    const top = RULER;
    const area = height - RULER;
    const center = top + area / 2;
    if (peaks && contentWidth > 0) {
      ctx.fillStyle = "rgba(122, 214, 255, 0.75)";
      const columns = Math.min(Math.ceil(contentWidth), width);
      for (let x = 0; x < columns; x += 1) {
        const from = Math.floor((x / contentWidth) * peaks.length);
        const to = Math.max(from + 1, Math.floor(((x + 1) / contentWidth) * peaks.length));
        let max = 0;
        for (let bucket = from; bucket < to && bucket < peaks.length; bucket += 1) {
          if (peaks[bucket] > max) max = peaks[bucket];
        }
        const amplitude = max * (area * 0.45);
        ctx.fillRect(x, center - amplitude, 1, Math.max(1, amplitude * 2));
      }
    } else {
      ctx.fillStyle = "rgba(148, 170, 200, 0.6)";
      ctx.font = `${compact ? 11 : 13}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(decodeState === "loading" ? "decoding waveform…" : "no waveform available", 16, center);
    }

    if (loop.a !== null && loop.b !== null) {
      ctx.fillStyle = "rgba(255, 196, 92, 0.16)";
      ctx.fillRect(msToX(loop.a), top, msToX(loop.b) - msToX(loop.a), area);
    }
  }, [peaks, width, height, zoom, totalMs, contentWidth, loop, decodeState, compact, msToX]);

  const seek = useCallback(
    (ms: number) => {
      const audio = audioRef.current;
      const clamped = clampMs(ms);
      stopAtRef.current = null;
      emitTime(clamped);
      if (audio) audio.currentTime = clamped / 1000;
    },
    [clampMs, emitTime],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, []);

  const playRange = useCallback(
    (startMs: number, endMs: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const start = clampMs(startMs);
      audio.currentTime = start / 1000;
      emitTime(start);
      stopAtRef.current = Math.max(start + 1, Math.min(endMs, totalRef.current || endMs));
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    },
    [clampMs, emitTime],
  );

  useImperativeHandle(
    ref,
    () => ({
      playPause: togglePlay,
      seek,
      playRange,
      getTime: () => {
        const audio = audioRef.current;
        return audio && !audio.paused ? audio.currentTime * 1000 : lastTimeRef.current;
      },
      getDuration: () => totalRef.current,
    }),
    [togglePlay, seek, playRange],
  );

  /* Keyboard: Space and arrows, only when this component owns them. */
  useEffect(() => {
    if (!shortcuts) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(lastTimeRef.current + (event.shiftKey ? 1000 : 100));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(lastTimeRef.current - (event.shiftKey ? 1000 : 100));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, seek, togglePlay]);

  const timeAtClientX = (clientX: number): number => {
    const content = scrollRef.current?.firstElementChild as HTMLElement | null;
    const left = content?.getBoundingClientRect().left ?? 0;
    return clampMs(((clientX - left) / zoom) * 1000);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    draggingRef.current = true;
    seek(timeAtClientX(event.clientX));
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    seek(timeAtClientX(event.clientX));
  };
  const onPointerUp = (): void => {
    draggingRef.current = false;
  };

  const applyZoom = useCallback(
    (next: number, anchorClientX?: number) => {
      const scroll = scrollRef.current;
      const clamped = Math.min(600, Math.max(5, next));
      if (!scroll) {
        setZoom(clamped);
        return;
      }
      const rect = scroll.getBoundingClientRect();
      // Anchor: the cursor, else the playhead if visible, else the view centre.
      const playheadX = (lastTimeRef.current / 1000) * zoom - scroll.scrollLeft;
      const offset =
        anchorClientX !== undefined
          ? anchorClientX - rect.left
          : playheadX >= 0 && playheadX <= scroll.clientWidth
            ? playheadX
            : scroll.clientWidth / 2;
      const anchorSeconds = (scroll.scrollLeft + offset) / zoom;
      setZoom(clamped);
      requestAnimationFrame(() => {
        scroll.scrollLeft = Math.max(0, anchorSeconds * clamped - offset);
      });
    },
    [zoom],
  );

  /* Wheel: Ctrl/⌘ + wheel zooms around the cursor; a plain wheel scrolls the timeline sideways. */
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        applyZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX);
      } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        scroll.scrollLeft += event.deltaY;
      }
    };
    scroll.addEventListener("wheel", onWheel, { passive: false });
    return () => scroll.removeEventListener("wheel", onWheel);
  }, [applyZoom, zoom]);

  const fitToView = (): void => {
    const scroll = scrollRef.current;
    if (!scroll || totalMs <= 0) return;
    setZoom(Math.min(600, Math.max(5, (scroll.clientWidth - 30) / (totalMs / 1000))));
    requestAnimationFrame(() => {
      scroll.scrollLeft = 0;
    });
  };

  const durationMismatch = decodedMs > 0 && durationMs > 0 && Math.abs(decodedMs - durationMs) > 250;

  return (
    <div className={`timeline-ltr${compact ? " timeline-compact" : ""}`}>
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="auto"
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          element.playbackRate = speed;
          if (Number.isFinite(element.duration) && element.duration > 0) setElementMs(Math.round(element.duration * 1000));
        }}
      />

      <div className="transport">
        <div className="transport-left">
          <Button size="md" variant="primary" onClick={togglePlay} title={t("پخش / مکث (Space)", "Play / pause (Space)")}>
            {playing ? t("⏸ مکث", "⏸ Pause") : t("▶ پخش", "▶ Play")}
          </Button>
          <span className="step-group">
            <Button size="sm" variant="ghost" onClick={() => seek(0)} title={t("ابتدای صوت", "To start")}>
              ⏮
            </Button>
            <Button size="sm" variant="ghost" onClick={() => seek(currentMs - 5000)} title="−5s">
              −5s
            </Button>
            <Button size="sm" variant="ghost" onClick={() => seek(currentMs - 1000)} title="−1s">
              −1s
            </Button>
            <Button size="sm" variant="ghost" onClick={() => seek(currentMs - 100)} title="−0.1s">
              −0.1
            </Button>
            <Button size="sm" variant="ghost" onClick={() => seek(currentMs + 100)} title="+0.1s">
              +0.1
            </Button>
            <Button size="sm" variant="ghost" onClick={() => seek(currentMs + 1000)} title="+1s">
              +1s
            </Button>
            <Button size="sm" variant="ghost" onClick={() => seek(currentMs + 5000)} title="+5s">
              +5s
            </Button>
          </span>
          <span className="transport-time">
            <Mono>{formatMs(currentMs)}</Mono>
            <span className="muted">/</span>
            <Mono>{formatMs(totalMs)}</Mono>
          </span>
        </div>
        <div className="transport-right">
          <span className="speed-group" role="group" aria-label={t("سرعت پخش", "playback speed")}>
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                className={`speed-chip${speed === value ? " speed-chip-on" : ""}`}
                onClick={() => setSpeed(value)}
                title={t("سرعت پخش برای سینک دقیق‌تر", "Slower playback for precise syncing")}
              >
                {value}×
              </button>
            ))}
          </span>
          <span className="zoom-group">
            <Button size="sm" variant="ghost" onClick={() => applyZoom(zoom / 1.4)} title={t("کوچک‌نمایی", "Zoom out")}>
              −
            </Button>
            <input
              type="range"
              min={5}
              max={600}
              value={Math.round(zoom)}
              onChange={(event) => applyZoom(Number(event.target.value))}
              aria-label="zoom"
              title={t("بزرگ‌نمایی (Ctrl + چرخ ماوس)", "Zoom (Ctrl + wheel)")}
            />
            <Button size="sm" variant="ghost" onClick={() => applyZoom(zoom * 1.4)} title={t("بزرگ‌نمایی", "Zoom in")}>
              +
            </Button>
            <Button size="sm" variant="ghost" onClick={fitToView} title={t("کل صوت در یک نما", "Fit the whole audio")}>
              ⊡ {t("کل صوت", "fit")}
            </Button>
          </span>
          {!compact && (
            <span className="loop-group">
              <Button size="sm" variant="ghost" onClick={() => setLoop((current) => ({ ...current, a: Math.round(currentMs) }))} title={t("ابتدای بازهٔ تکرار", "loop start")}>
                A
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLoop((current) => ({ ...current, b: Math.round(currentMs) }))} title={t("پایان بازهٔ تکرار", "loop end")}>
                B
              </Button>
              <Button
                size="sm"
                variant={loop.a !== null && loop.b !== null ? "primary" : "ghost"}
                onClick={() => setLoop({ a: null, b: null })}
                disabled={loop.a === null && loop.b === null}
                title={t("حذف بازهٔ تکرار", "Clear the loop")}
              >
                {loop.a !== null && loop.b !== null ? t("✕ تکرار", "✕ Loop") : t("تکرار", "Loop")}
              </Button>
            </span>
          )}
        </div>
      </div>

      {durationMismatch && (
        <div className="timeline-note">
          {t(
            `مدت واقعی صوت (${formatMs(decodedMs)}) با مقدار قبلی (${formatMs(durationMs)}) فرق داشت و اصلاح شد.`,
            `The real audio duration (${formatMs(decodedMs)}) differed from the stored value (${formatMs(durationMs)}) and was corrected.`,
          )}
        </div>
      )}

      <div className="wave-scroll" ref={scrollRef}>
        <div className="wave-content" style={{ width, height }}>
          <canvas ref={canvasRef} className="wave-canvas" />
          {markers?.map((marker) => {
            const x = msToX(marker.startMs);
            const end = marker.endMs !== null ? msToX(marker.endMs) : x;
            return (
              <div
                key={marker.id}
                className={`wave-marker tone-${marker.tone}${marker.selected ? " is-selected" : ""}${marker.problem ? " has-problem" : ""}`}
                style={{ transform: `translateX(${x}px)`, width: Math.max(2, end - x) }}
              >
                <span className={`wave-region${marker.endDerived ? " is-derived" : ""}`} />
                <button
                  type="button"
                  className="wave-marker-label"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onMarkerSelect?.(marker.id)}
                  title={`${marker.label} · ${formatMs(marker.startMs)}${marker.endMs !== null ? ` → ${formatMs(marker.endMs)}` : ""}`}
                >
                  {marker.label}
                </button>
              </div>
            );
          })}
          <div
            className="wave-hit"
            style={{ width, height }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          <div className="playhead" style={{ transform: `translateX(${msToX(currentMs)}px)` }}>
            <span className="playhead-handle">{formatMs(currentMs)}</span>
          </div>
        </div>
      </div>
      {!compact && (
        <div className="tiny muted timeline-hint">
          {t(
            "کلیک یا کشیدن روی موج = جابه‌جایی نوک پخش · Ctrl + چرخ ماوس = بزرگ‌نمایی · چرخ ماوس = حرکت افقی · ثبت شروع/پایان همیشه روی نوک پخش (خط نارنجی) انجام می‌شود",
            "Click or drag the waveform to move the playhead · Ctrl + wheel zooms · wheel scrolls · captures always use the playhead (orange line)",
          )}
        </div>
      )}
    </div>
  );
});
