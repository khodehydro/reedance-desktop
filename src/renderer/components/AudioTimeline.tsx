import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatMs, formatSeconds } from "../format";
import { Button, Mono } from "./ui";

export type TimelineKind = "audio" | "story-audio";

export interface AudioTimelineHandle {
  playPause: () => void;
  seek: (ms: number) => void;
  getTime: () => number;
}

interface AudioTimelineProps {
  projectId: string;
  kind: TimelineKind;
  /** Known duration in ms (0 while unknown). */
  durationMs: number;
  /** Fired when the component measures the duration itself (first decode). */
  onDurationReported?: (ms: number) => void | Promise<void>;
  /** Fired whenever the playhead or the capture line moves; the parent uses
   *  this to register line times at the current position. */
  onTimeUpdate?: (ms: number) => void;
  /** Enable Space / arrow-key shortcuts (the lyric timeline keeps its own
   *  window-level handler for M and J/K). */
  shortcuts?: boolean;
  /** Smaller waveform, for the story audio panel. */
  compact?: boolean;
}

/**
 * Shared audio timeline used by the lyric timeline (song audio) and the story
 * panel (story audio).
 *
 * Everything runs left-to-right: the time axis, the seek bar, the playhead and
 * the capture line all advance from the left edge to the right edge. The
 * capture line is a draggable vertical line — drag it (or click the waveform)
 * to place it, then register line times at its position. Zoom works with the
 * slider, the wheel and the fit preset; dragging anywhere scrubs the audio so
 * the operator hears exactly where the line lands.
 */
export const AudioTimeline = forwardRef<AudioTimelineHandle, AudioTimelineProps>(function AudioTimeline(
  {
    projectId,
    kind,
    durationMs,
    onDurationReported,
    onTimeUpdate,
    shortcuts = false,
    compact = false,
  },
  ref,
): React.ReactElement {
  const { t } = useLang();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef<"line" | "seek" | null>(null);
  const lastTimeRef = useRef(0);

  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [decodeState, setDecodeState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [lineMs, setLineMs] = useState(0);
  const [zoom, setZoom] = useState(70);
  const [loop, setLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const reportDuration = useCallback(
    async (ms: number): Promise<void> => {
      try {
        await api.media.reportDuration(projectId, ms, kind);
      } catch {
        /* the parent still receives the measurement through onDurationReported */
      }
      await onDurationReported?.(ms);
    },
    [projectId, kind, onDurationReported],
  );

  /* Load the audio element for this media kind. */
  useEffect(() => {
    let active = true;
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

  /* Decode once to draw the waveform and to measure the duration if needed. */
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
        const buckets = compact ? 8000 : 16000;
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
        const measured = Math.round(buffer.duration * 1000);
        if (measured > 0 && durationMs <= 0) {
          await reportDuration(measured);
        }
      } catch {
        if (active) setDecodeState("error");
      }
    };
    void run();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, projectId, kind]);

  const emitTime = useCallback(
    (ms: number) => {
      lastTimeRef.current = ms;
      setCurrentMs(ms);
      onTimeUpdate?.(ms);
    },
    [onTimeUpdate],
  );

  /* Playhead animation while playing, with optional loop. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const tick = (): void => {
      const ms = audio.currentTime * 1000;
      emitTime(ms);
      if (loop.a !== null && loop.b !== null && ms > loop.b) {
        audio.currentTime = loop.a / 1000;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    if (playing) rafRef.current = requestAnimationFrame(tick);
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
    const right = left + scroll.clientWidth;
    if (position < left + 60 || position > right - 120) {
      scroll.scrollLeft = Math.max(0, position - scroll.clientWidth * 0.3);
    }
  }, [currentMs, playing, zoom]);

  const width = useMemo(
    () => Math.max(compact ? 360 : 720, ((durationMs || 1000) / 1000) * zoom),
    [durationMs, zoom, compact],
  );
  const height = compact ? 96 : 172;

  /* Static waveform + grid + playhead/line drawn as DOM overlays. */
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

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(20, 40, 70, 0.85)");
    gradient.addColorStop(1, "rgba(10, 22, 40, 0.9)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const seconds = Math.ceil((durationMs || 1000) / 1000);
    for (let second = 0; second <= seconds; second += 1) {
      const x = second * zoom;
      if (x > width) break;
      ctx.strokeStyle = second % 5 === 0 ? "rgba(120, 170, 255, 0.22)" : "rgba(120, 170, 255, 0.08)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

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
      ctx.font = `${compact ? 11 : 13}px system-ui, sans-serif`;
      ctx.fillText(decodeState === "loading" ? "decoding waveform…" : "no waveform available", 16, height / 2);
    }

    if (loop.a !== null && loop.b !== null) {
      const x1 = (loop.a / 1000) * zoom;
      const x2 = (loop.b / 1000) * zoom;
      ctx.fillStyle = "rgba(255, 196, 92, 0.14)";
      ctx.fillRect(x1, 0, x2 - x1, height);
    }
  }, [peaks, width, height, zoom, durationMs, loop, decodeState, compact]);

  const seek = useCallback(
    (ms: number) => {
      const audio = audioRef.current;
      const clamped = Math.max(0, Math.min(ms, Math.max(0, durationMs - 30)));
      emitTime(clamped);
      if (audio) audio.currentTime = clamped / 1000;
    },
    [durationMs, emitTime],
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

  useImperativeHandle(
    ref,
    () => ({
      playPause: togglePlay,
      seek,
      getTime: () => lastTimeRef.current,
    }),
    [togglePlay, seek],
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

  const pointerX = (event: React.PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left;
  };

  const timeAtX = (x: number): number => Math.max(0, Math.round((x / zoom) * 1000 / 10) * 10);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const x = pointerX(event);
    const lineX = (lineMs / 1000) * zoom;
    if (Math.abs(x - lineX) < 14) {
      draggingRef.current = "line";
    } else {
      draggingRef.current = "seek";
      const ms = timeAtX(x);
      emitTime(ms);
      setLineMs(ms);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const mode = draggingRef.current;
    if (!mode) return;
    const x = pointerX(event);
    const ms = timeAtX(x);
    if (mode === "line") {
      setLineMs(ms);
      emitTime(ms);
      const audio = audioRef.current;
      if (audio) audio.currentTime = Math.min(ms, Math.max(0, durationMs - 30)) / 1000;
    } else {
      seek(ms);
    }
  };

  const onPointerUp = (): void => {
    draggingRef.current = null;
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 24) return;
    event.preventDefault();
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    const cursorX = event.clientX - rect.left + scroll.scrollLeft;
    const timeBefore = cursorX / zoom;
    const next = Math.min(400, Math.max(10, zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
    setZoom(next);
    // keep the point under the cursor stationary
    requestAnimationFrame(() => {
      const after = cursorX / next;
      scroll.scrollLeft = Math.max(0, cursorX - after * next + timeBefore * 0);
    });
  };

  const fitToView = (): void => {
    const scroll = scrollRef.current;
    if (!scroll || durationMs <= 0) return;
    setZoom(Math.max(20, Math.min(400, scroll.clientWidth / (durationMs / 1000))));
  };

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
          if (Number.isFinite(element.duration) && element.duration * 1000 > 0) {
            emitTime(element.currentTime * 1000);
          }
        }}
      />

      <div className="transport">
        <div className="transport-left">
          <Button size="md" variant="primary" onClick={togglePlay} title={t("پخش / مکث", "Play / pause")}>
            {playing ? t("⏸ مکث", "⏸ Pause") : t("▶ پخش", "▶ Play")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => seek(0)} title={t("ابتدا", "To start")}>
            ⏮
          </Button>
          <span className="step-group">
            <Button size="sm" variant="ghost" onClick={() => seek(currentMs - 10_000)} title="−10s">
              −10s
            </Button>
            <Button size="sm" variant="ghost" onClick={() => seek(currentMs - 1000)} title="−1s">
              −1s
            </Button>
            <Button size="sm" variant="ghost" onClick={() => seek(currentMs + 1000)} title="+1s">
              +1s
            </Button>
            <Button size="sm" variant="ghost" onClick={() => seek(currentMs + 10_000)} title="+10s">
              +10s
            </Button>
          </span>
          <span className="transport-time">
            <Mono>{formatMs(currentMs)}</Mono> / <Mono>{formatMs(durationMs)}</Mono>
          </span>
        </div>
        <div className="transport-right">
          <span className="tiny">{t("بزرگ‌نمایی", "zoom")}</span>
          <input
            type="range"
            min={10}
            max={400}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="zoom"
          />
          <Button size="sm" variant="ghost" onClick={fitToView} title={t("هم‌راست‌سازی", "fit to view")}>
            ⊡ {t("پرཔ་དེ་", "fit")}
          </Button>
          <Button
            size="sm"
            variant={loop.a !== null && loop.b !== null ? "primary" : "ghost"}
            onClick={() => setLoop((current) => ({ ...current, a: null, b: null }))}
            disabled={loop.a === null || loop.b === null}
            title={t("تکرار بازه A–B", "Loop the A–B region")}
          >
            {t("تکرار", "Loop")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLoop((current) => ({ ...current, a: Math.round(currentMs) }))} title={t("ابتدای بازه", "region start")}>
            A
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLoop((current) => ({ ...current, b: Math.round(currentMs) }))} title={t("پایانِ بازه", "region end")}>
            B
          </Button>
        </div>
      </div>

      <div className="seek-bar">
        <input
          type="range"
          className="seek-range"
          min={0}
          max={Math.max(1, durationMs)}
          step={10}
          value={Math.min(currentMs, Math.max(0, durationMs))}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label={t("نیروبار سینک", "seek bar")}
          style={{ ["--fill" as string]: `${durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0}%` }}
        />
        <div className="seek-axis">
          <span>0:00</span>
          <span>{formatSeconds(durationMs)}</span>
        </div>
      </div>

      <div className="wave-scroll" ref={scrollRef} onWheel={onWheel}>
        <div className="wave-content" style={{ width, height }}>
          <canvas ref={canvasRef} className="wave-canvas" />
          <div className="playhead" style={{ transform: `translateX(${(currentMs / 1000) * zoom}px)` }} />
          <div
            className="drag-line"
            style={{ transform: `translateX(${(lineMs / 1000) * zoom}px)` }}
            onPointerDown={(event) => {
              event.stopPropagation();
              draggingRef.current = "line";
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (draggingRef.current !== "line") return;
              const rect = event.currentTarget.parentElement?.getBoundingClientRect();
              const x = event.clientX - (rect?.left ?? 0);
              const ms = timeAtX(x);
              setLineMs(ms);
              emitTime(ms);
              const audio = audioRef.current;
              if (audio) audio.currentTime = Math.min(ms, Math.max(0, durationMs - 30)) / 1000;
            }}
            onPointerUp={onPointerUp}
          >
            <span className="drag-handle">{formatMs(lineMs)}</span>
          </div>
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
    </div>
  );
});
