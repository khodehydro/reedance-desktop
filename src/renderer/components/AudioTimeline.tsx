import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatMs } from "../format";
import {
  clampView,
  editClip,
  fitZoom,
  MAX_ZOOM,
  MIN_CLIP_MS,
  placeClip,
  rulerLabel,
  rulerStep,
  snapTo,
  zoomAround,
  type ClipBounds,
  type EditMode,
  type Placement,
  type View,
} from "../timelineMath";
import { Button, Mono } from "./ui";

export type TimelineKind = "audio" | "story-audio";

/** A placed line, drawn as a clip on the clip track. */
export interface TimelineClip {
  id: string;
  /** 1-based line number. */
  number: number;
  text: string;
  badge?: string;
  startMs: number;
  /** Effective end as exported (recorded or automatic). */
  endMs: number;
  /** True when the end is automatic (next start / audio end), not recorded. */
  endDerived: boolean;
  selected: boolean;
  problem: boolean;
  tone: 0 | 1;
}

/** A line being dragged in from the line list. */
export interface DropPayload {
  lineId: string;
  number: number;
  text: string;
  tone: 0 | 1;
  lengthMs: number;
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
  /** Scrolls the view so `ms` is visible (no seek). */
  reveal: (ms: number, endMs?: number) => void;
  zoomBy: (factor: number) => void;
  fit: () => void;
  /** External drag (line list → timeline): update the drop preview. Returns whether the pointer is over the timeline. */
  dragOver: (payload: DropPayload | null, clientX: number, clientY: number, altKey?: boolean) => boolean;
  /** External drop: the placement, or null when released outside the timeline. */
  drop: (payload: DropPayload, clientX: number, clientY: number, altKey?: boolean) => Placement | null;
  isPlaying: () => boolean;
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
  /** Placed lines. When omitted there is no clip track (story audio). */
  clips?: TimelineClip[];
  /** Gap a line may occupy between its placed neighbours. */
  boundsFor?: (id: string) => ClipBounds;
  /** The selected clip was moved/trimmed. `endMs` null = keep the end automatic. */
  onClipCommit?: (id: string, startMs: number, endMs: number | null) => void;
  /** Extra controls rendered at the end of the transport bar (undo/redo…). */
  extraControls?: React.ReactNode;
}

const RULER_H = 22;
const SPEEDS = [0.5, 0.75, 1] as const;
const SNAP_PX = 8;
const EDGE_PX = 42;

/* ------------------------------------------------------------------ */
/* Waveform data: raw samples + min/max pyramids for fast drawing      */
/* ------------------------------------------------------------------ */

interface WaveLevel {
  bucket: number;
  /** Interleaved [min, max] per bucket. */
  data: Float32Array;
}

interface WaveData {
  samples: Float32Array;
  sampleRate: number;
  levels: WaveLevel[];
  gain: number;
}

interface DecodedLike {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  getChannelData: (channel: number) => Float32Array;
}

function buildWave(buffer: DecodedLike): WaveData {
  const length = buffer.length;
  let samples: Float32Array;
  if (buffer.numberOfChannels <= 1) {
    samples = buffer.getChannelData(0);
  } else {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    samples = new Float32Array(length);
    for (let index = 0; index < length; index += 1) samples[index] = (left[index] + right[index]) * 0.5;
  }
  const levels: WaveLevel[] = [];
  // Level 1 from raw samples (64), then each next level groups 16 buckets.
  const first = 64;
  const count1 = Math.ceil(length / first);
  const data1 = new Float32Array(count1 * 2);
  let peak = 0.0001;
  for (let bucket = 0; bucket < count1; bucket += 1) {
    let min = 1;
    let max = -1;
    const end = Math.min(length, (bucket + 1) * first);
    for (let index = bucket * first; index < end; index += 1) {
      const value = samples[index];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (min > max) {
      min = 0;
      max = 0;
    }
    data1[bucket * 2] = min;
    data1[bucket * 2 + 1] = max;
    peak = Math.max(peak, -min, max);
  }
  levels.push({ bucket: first, data: data1 });
  let previous = levels[0];
  while (previous.data.length / 2 > 64) {
    const factor = 16;
    const count = Math.ceil(previous.data.length / 2 / factor);
    const data = new Float32Array(count * 2);
    for (let bucket = 0; bucket < count; bucket += 1) {
      let min = 1;
      let max = -1;
      const end = Math.min(previous.data.length / 2, (bucket + 1) * factor);
      for (let index = bucket * factor; index < end; index += 1) {
        if (previous.data[index * 2] < min) min = previous.data[index * 2];
        if (previous.data[index * 2 + 1] > max) max = previous.data[index * 2 + 1];
      }
      data[bucket * 2] = min > max ? 0 : min;
      data[bucket * 2 + 1] = min > max ? 0 : max;
    }
    const level = { bucket: previous.bucket * factor, data };
    levels.push(level);
    previous = level;
  }
  return { samples, sampleRate: buffer.sampleRate, levels, gain: Math.min(8, 0.98 / peak) };
}

/** Draws the waveform for [fromMs, fromMs + width·msPerPx) as one min/max bar per pixel. */
function drawWave(
  ctx: CanvasRenderingContext2D,
  wave: WaveData,
  fromMs: number,
  msPerPx: number,
  width: number,
  top: number,
  height: number,
): void {
  const { samples, sampleRate, levels, gain } = wave;
  const samplesPerPx = (msPerPx / 1000) * sampleRate;
  let level: WaveLevel | null = null;
  for (const candidate of levels) if (candidate.bucket <= samplesPerPx) level = candidate;
  const center = top + height / 2;
  const half = (height / 2) * 0.94;
  const total = samples.length;
  for (let x = 0; x < width; x += 1) {
    const s0 = ((fromMs + x * msPerPx) / 1000) * sampleRate;
    const s1 = s0 + samplesPerPx;
    if (s1 <= 0 || s0 >= total) continue;
    let min = 1;
    let max = -1;
    if (level) {
      const buckets = level.data.length / 2;
      const b0 = Math.max(0, Math.floor(s0 / level.bucket));
      const b1 = Math.min(buckets, Math.max(b0 + 1, Math.ceil(s1 / level.bucket)));
      for (let bucket = b0; bucket < b1; bucket += 1) {
        if (level.data[bucket * 2] < min) min = level.data[bucket * 2];
        if (level.data[bucket * 2 + 1] > max) max = level.data[bucket * 2 + 1];
      }
    } else {
      const i0 = Math.max(0, Math.floor(s0));
      const i1 = Math.min(total, Math.max(i0 + 1, Math.ceil(s1)));
      for (let index = i0; index < i1; index += 1) {
        const value = samples[index];
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    if (min > max) continue;
    const y1 = center - Math.min(1, max * gain) * half;
    const y2 = center - Math.max(-1, min * gain) * half;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type Gesture =
  | { kind: "scrub" }
  | {
      kind: "clip";
      mode: EditMode;
      id: string;
      origStart: number;
      origEnd: number;
      endDerived: boolean;
      grabMs: number;
      bounds: ClipBounds;
      downX: number;
      downMs: number;
      moved: boolean;
    }
  | { kind: "overview"; offsetMs: number }
  | { kind: "external"; payload: DropPayload };

interface EditPreview {
  id: string;
  startMs: number;
  endMs: number;
  recordEnd: boolean;
}

interface DropPreview extends Placement {
  payload: DropPayload;
}

/**
 * Shared audio timeline (song audio, ReeTalk audio, story audio), built like
 * a video editor: a ruler, the waveform, a clip track and a mini-map.
 *
 * - Virtualised: the canvas is only as wide as the screen and draws the
 *   visible window, so any zoom (down to 0.25 ms per pixel) stays sharp; the
 *   waveform comes from min/max pyramids of the decoded samples.
 * - One time scale: ruler, waveform, clips, playhead and pointer all use the
 *   same `ms ↔ x` mapping, against the decoder-measured duration.
 * - Only the selected clip is editable (body = move, edges = trim). Other
 *   clips are locked: clicks on them only move the playhead.
 */
export const AudioTimeline = forwardRef<AudioTimelineHandle, AudioTimelineProps>(function AudioTimeline(
  { projectId, kind, durationMs, onDurationReported, onTimeUpdate, shortcuts = false, compact = false, clips, boundsFor, onClipCommit, extraControls },
  ref,
): React.ReactElement {
  const { t } = useLang();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const stopAtRef = useRef<number | null>(null);
  const reportedRef = useRef<string | null>(null);
  const waveRef = useRef<WaveData | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pointerRef = useRef<{ clientX: number; clientY: number; altKey: boolean } | null>(null);
  const edgeRafRef = useRef<number | null>(null);

  const [waveVersion, setWaveVersion] = useState(0);
  const [decodeState, setDecodeState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [decodedMs, setDecodedMs] = useState(0);
  const [elementMs, setElementMs] = useState(0);
  const [loop, setLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [width, setWidth] = useState(800);
  const [view, setViewState] = useState<View>({ startMs: 0, zoom: 0 });
  const [snapOn, setSnapOn] = useState(true);
  const [edit, setEditState] = useState<EditPreview | null>(null);
  const editRef = useRef<EditPreview | null>(null);
  const setEdit = useCallback((next: EditPreview | null) => {
    editRef.current = next;
    setEditState(next);
  }, []);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [snapMs, setSnapMs] = useState<number | null>(null);

  const hasClips = clips !== undefined;
  const waveH = compact ? 72 : 112;
  const clipH = hasClips ? 54 : 0;
  const canvasH = RULER_H + waveH;

  /** The duration everything is drawn against: decoder > stored > element. */
  const totalMs = decodedMs > 0 ? decodedMs : durationMs > 0 ? durationMs : elementMs;
  const totalRef = useRef(totalMs);
  totalRef.current = totalMs;
  const viewRef = useRef(view);
  viewRef.current = view;
  const widthRef = useRef(width);
  widthRef.current = width;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const snapOnRef = useRef(snapOn);
  snapOnRef.current = snapOn;

  const setView = useCallback((next: View) => {
    const clamped = clampView(next, widthRef.current, totalRef.current || 10_000);
    viewRef.current = clamped;
    setViewState((current) => (current.startMs === clamped.startMs && current.zoom === clamped.zoom ? current : clamped));
  }, []);

  /* Measure the viewport width. */
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const measure = (): void => {
      const next = Math.max(240, Math.round(element.clientWidth || 800));
      setWidth((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* Initial zoom (~20 s visible, or the whole file), and re-clamp on resize/duration. */
  useEffect(() => {
    const total = totalMs || 10_000;
    if (viewRef.current.zoom === 0) {
      const initial = compact ? fitZoom(width, total) : Math.max(fitZoom(width, total), width / 20);
      setView({ startMs: 0, zoom: initial });
    } else {
      setView(viewRef.current);
    }
  }, [width, totalMs, compact, setView]);

  /* Load the audio element for this media kind. */
  useEffect(() => {
    let active = true;
    setDecodedMs(0);
    setElementMs(0);
    void api.media.playUrl(projectId, kind).then((url) => {
      if (active) {
        setAudioUrl(url);
        setDecodeState("idle");
        waveRef.current = null;
        setWaveVersion((value) => value + 1);
      }
    });
    return () => {
      active = false;
    };
  }, [projectId, kind]);

  /* Decode once: waveform pyramids + the exact duration. */
  useEffect(() => {
    if (!audioUrl) return undefined;
    let active = true;
    setDecodeState("loading");
    const run = async (): Promise<void> => {
      try {
        const bytes = await api.media.bytes(projectId, kind);
        if (!bytes) {
          if (active) setDecodeState("error");
          return;
        }
        const context = new AudioContext();
        const buffer = (await context.decodeAudioData(bytes.slice(0))) as unknown as DecodedLike & { duration: number };
        await context.close();
        const wave = buildWave(buffer);
        if (!active) return;
        waveRef.current = wave;
        setWaveVersion((value) => value + 1);
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

  const spanMs = (width / Math.max(0.0001, view.zoom)) * 1000;
  const msToX = useCallback((ms: number) => ((ms - view.startMs) * view.zoom) / 1000, [view]);

  /** Keeps the playhead on screen while playing (page-turn, like an NLE). */
  const follow = useCallback(
    (ms: number) => {
      if (gestureRef.current) return;
      const current = viewRef.current;
      const span = (widthRef.current / current.zoom) * 1000;
      if (ms < current.startMs || ms > current.startMs + span * 0.92) setView({ ...current, startMs: ms - span * 0.08 });
    },
    [setView],
  );

  /* Playhead animation while playing: loop region and range-stop. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playing) return undefined;
    const tick = (): void => {
      let ms = audio.currentTime * 1000;
      const stopAt = stopAtRef.current;
      const currentLoop = loopRef.current;
      if (stopAt !== null && ms >= stopAt) {
        audio.pause();
        audio.currentTime = stopAt / 1000;
        ms = stopAt;
        stopAtRef.current = null;
      } else if (currentLoop.a !== null && currentLoop.b !== null && ms > currentLoop.b) {
        audio.currentTime = currentLoop.a / 1000;
        ms = currentLoop.a;
      }
      emitTime(ms);
      follow(ms);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, emitTime, follow]);

  /* Ruler + waveform for the visible window only. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || view.zoom <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(canvasH * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${canvasH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, canvasH);
    const msPerPx = 1000 / view.zoom;
    const x = (ms: number): number => ((ms - view.startMs) * view.zoom) / 1000;

    ctx.fillStyle = "#0f1724";
    ctx.fillRect(0, 0, width, canvasH);
    ctx.fillStyle = "#0a111c";
    ctx.fillRect(0, 0, width, RULER_H);

    // Outside the audio.
    const total = totalRef.current;
    if (total > 0) {
      const endX = x(total);
      if (endX < width) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(Math.max(0, endX), 0, width - Math.max(0, endX), canvasH);
      }
    }

    // Ruler: adaptive steps down to milliseconds.
    const { step, minor } = rulerStep(view.zoom);
    const minorStep = step / minor;
    const fromSec = view.startMs / 1000;
    const toSec = fromSec + (width / view.zoom);
    const first = Math.floor(fromSec / minorStep);
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";
    for (let index = first; index * minorStep <= toSec + minorStep; index += 1) {
      const seconds = index * minorStep;
      if (seconds < 0) continue;
      const px = Math.round(x(seconds * 1000)) + 0.5;
      const major = index % minor === 0;
      ctx.strokeStyle = major ? "rgba(150, 185, 255, 0.30)" : "rgba(150, 185, 255, 0.10)";
      ctx.beginPath();
      ctx.moveTo(px, major ? 0 : RULER_H - 6);
      ctx.lineTo(px, major ? canvasH : RULER_H);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "rgba(200, 216, 240, 0.9)";
        ctx.fillText(rulerLabel(seconds, step), px + 4, 5);
      }
    }
    ctx.fillStyle = "rgba(150, 185, 255, 0.18)";
    ctx.fillRect(0, RULER_H - 1, width, 1);

    // Loop region.
    const currentLoop = loopRef.current;
    if (currentLoop.a !== null && currentLoop.b !== null) {
      ctx.fillStyle = "rgba(255, 196, 92, 0.15)";
      ctx.fillRect(x(currentLoop.a), RULER_H, x(currentLoop.b) - x(currentLoop.a), waveH);
      ctx.fillStyle = "rgba(255, 196, 92, 0.85)";
      ctx.fillRect(x(currentLoop.a), 0, x(currentLoop.b) - x(currentLoop.a), 3);
    }

    // Centre line + waveform.
    ctx.fillStyle = "rgba(122, 214, 255, 0.12)";
    ctx.fillRect(0, RULER_H + waveH / 2, width, 1);
    const wave = waveRef.current;
    if (wave) {
      ctx.fillStyle = "rgba(122, 214, 255, 0.82)";
      drawWave(ctx, wave, view.startMs, msPerPx, width, RULER_H + 4, waveH - 8);
    } else {
      ctx.fillStyle = "rgba(148, 170, 200, 0.65)";
      ctx.font = `${compact ? 11 : 13}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(decodeState === "loading" ? "decoding waveform…" : "no waveform available", 16, RULER_H + waveH / 2);
    }
  }, [view, width, canvasH, waveH, waveVersion, decodeState, compact, loop, totalMs]);

  /* Mini-map: the whole file, the clips and the visible window. */
  useEffect(() => {
    const canvas = overviewRef.current;
    if (!canvas) return;
    const height = 30;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b121d";
    ctx.fillRect(0, 0, width, height);
    const total = totalRef.current;
    if (total <= 0) return;
    const wave = waveRef.current;
    if (wave) {
      ctx.fillStyle = "rgba(122, 214, 255, 0.35)";
      drawWave(ctx, wave, 0, total / width, width, 2, height - 10);
    }
    for (const clip of clips ?? []) {
      ctx.fillStyle = clip.selected ? "#ffd66e" : clip.problem ? "#ff6b6b" : clip.tone === 1 ? "#b892ff" : "#4f9dff";
      const x0 = (clip.startMs / total) * width;
      const x1 = (clip.endMs / total) * width;
      ctx.fillRect(x0, height - 6, Math.max(1.5, x1 - x0 - 0.5), 4);
    }
  }, [width, waveVersion, clips, totalMs]);

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

  const applyZoom = useCallback(
    (nextZoom: number, anchorClientX?: number) => {
      const element = viewportRef.current;
      const current = viewRef.current;
      const rect = element?.getBoundingClientRect();
      const playheadX = ((lastTimeRef.current - current.startMs) * current.zoom) / 1000;
      const anchor =
        anchorClientX !== undefined && rect
          ? anchorClientX - rect.left
          : playheadX >= 0 && playheadX <= widthRef.current
            ? playheadX
            : widthRef.current / 2;
      setView(zoomAround(current, nextZoom, anchor, widthRef.current, totalRef.current || 10_000));
    },
    [setView],
  );

  const fit = useCallback(() => setView({ startMs: 0, zoom: fitZoom(widthRef.current, totalRef.current || 10_000) }), [setView]);

  const reveal = useCallback(
    (ms: number, endMs?: number) => {
      const current = viewRef.current;
      const span = (widthRef.current / current.zoom) * 1000;
      const end = endMs ?? ms;
      if (ms >= current.startMs && end <= current.startMs + span) return;
      if (end - ms < span * 0.8) setView({ ...current, startMs: ms - (span - (end - ms)) / 2 });
      else setView({ ...current, startMs: ms - span * 0.1 });
    },
    [setView],
  );

  /* ---------------------------- pointer geometry ---------------------------- */

  const timeAtClientX = useCallback((clientX: number): number => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const current = viewRef.current;
    const ms = current.startMs + ((clientX - left) / current.zoom) * 1000;
    const total = totalRef.current;
    return Math.max(0, Math.min(total > 0 ? total : ms, ms));
  }, []);

  const snapTargets = useCallback((excludeId: string | null): number[] => {
    const targets = [0, lastTimeRef.current];
    const total = totalRef.current;
    if (total > 0) targets.push(total);
    const currentLoop = loopRef.current;
    if (currentLoop.a !== null) targets.push(currentLoop.a);
    if (currentLoop.b !== null) targets.push(currentLoop.b);
    for (const clip of clipsRef.current ?? []) {
      if (clip.id === excludeId) continue;
      targets.push(clip.startMs, clip.endMs);
    }
    return targets;
  }, []);

  const snapMsFor = useCallback(
    (ms: number, excludeId: string | null, altKey: boolean): number | null => {
      if (snapOnRef.current === altKey) return null; // Alt inverts the magnet
      return snapTo(ms, snapTargets(excludeId), (SNAP_PX / viewRef.current.zoom) * 1000);
    },
    [snapTargets],
  );

  const insideTimeline = (clientX: number, clientY: number): boolean => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top - 28 && clientY <= rect.bottom + 28;
  };

  const computeDrop = useCallback(
    (payload: DropPayload, clientX: number, altKey: boolean): DropPreview => {
      const total = totalRef.current;
      const bounds = boundsFor?.(payload.lineId) ?? { lower: 0, upper: total };
      let desired = timeAtClientX(clientX);
      const snapped = snapMsFor(desired, payload.lineId, altKey);
      if (snapped !== null) desired = snapped;
      setSnapMs(snapped);
      return { ...placeClip(bounds, desired, payload.lengthMs), payload };
    },
    [boundsFor, timeAtClientX, snapMsFor],
  );

  /** Re-evaluates the active gesture against the last pointer position. */
  const processPointer = useCallback(() => {
    const gesture = gestureRef.current;
    const pointer = pointerRef.current;
    if (!gesture || !pointer) return;
    if (gesture.kind === "scrub") {
      seek(timeAtClientX(pointer.clientX));
      return;
    }
    if (gesture.kind === "overview") {
      const rect = overviewRef.current?.getBoundingClientRect();
      const total = totalRef.current;
      if (!rect || total <= 0) return;
      const ms = ((pointer.clientX - rect.left) / Math.max(1, rect.width || widthRef.current)) * total;
      setView({ ...viewRef.current, startMs: ms - gesture.offsetMs });
      return;
    }
    if (gesture.kind === "external") {
      setDropPreview(computeDrop(gesture.payload, pointer.clientX, pointer.altKey));
      return;
    }
    const ms = timeAtClientX(pointer.clientX);
    if (Math.abs(pointer.clientX - gesture.downX) > 2) gesture.moved = true;
    if (!gesture.moved) return;
    let target = gesture.mode === "move" ? ms - gesture.grabMs : ms;
    let snapped: number | null = null;
    if (gesture.mode === "move" && !gesture.endDerived) {
      const length = gesture.origEnd - gesture.origStart;
      const a = snapMsFor(target, gesture.id, pointer.altKey);
      const b = snapMsFor(target + length, gesture.id, pointer.altKey);
      if (a !== null && (b === null || Math.abs(a - target) <= Math.abs(b - (target + length)))) {
        target = a;
        snapped = a;
      } else if (b !== null) {
        target = b - length;
        snapped = b;
      }
    } else {
      snapped = snapMsFor(target, gesture.id, pointer.altKey);
      if (snapped !== null) target = snapped;
    }
    const result = editClip(
      { mode: gesture.mode, origStart: gesture.origStart, origEnd: gesture.origEnd, endDerived: gesture.endDerived, bounds: gesture.bounds, ms: target, minClipMs: MIN_CLIP_MS },
      totalRef.current,
    );
    setSnapMs(snapped);
    setEdit({ id: gesture.id, startMs: result.startMs, endMs: result.endMs, recordEnd: result.recordEnd });
  }, [computeDrop, seek, setView, snapMsFor, timeAtClientX, setEdit]);

  /** Scrolls while a drag sits near the viewport edges. */
  const edgeTick = useCallback(() => {
    edgeRafRef.current = null;
    const gesture = gestureRef.current;
    const pointer = pointerRef.current;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!gesture || !pointer || !rect || gesture.kind === "overview" || gesture.kind === "scrub") return;
    if (gesture.kind === "external" && !insideTimeline(pointer.clientX, pointer.clientY)) return;
    const x = pointer.clientX - rect.left;
    const w = rect.width || widthRef.current;
    let direction = 0;
    if (x < EDGE_PX) direction = -(EDGE_PX - x) / EDGE_PX;
    else if (x > w - EDGE_PX) direction = (x - (w - EDGE_PX)) / EDGE_PX;
    if (direction === 0) return;
    const current = viewRef.current;
    const span = (widthRef.current / current.zoom) * 1000;
    setView({ ...current, startMs: current.startMs + direction * span * 0.015 });
    processPointer();
    edgeRafRef.current = requestAnimationFrame(edgeTick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processPointer, setView]);

  const kickEdge = useCallback(() => {
    if (edgeRafRef.current === null) edgeRafRef.current = requestAnimationFrame(edgeTick);
  }, [edgeTick]);

  const endGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (edgeRafRef.current !== null) cancelAnimationFrame(edgeRafRef.current);
    edgeRafRef.current = null;
    setSnapMs(null);
    if (gesture?.kind === "clip") {
      const preview = editRef.current;
      if (gesture.moved && preview) {
        onClipCommit?.(preview.id, preview.startMs, preview.recordEnd ? preview.endMs : null);
        setEdit(null);
      } else {
        setEdit(null);
        seek(gesture.downMs);
      }
    }
  }, [onClipCommit, seek, setEdit]);

  const startWindowGesture = useCallback(
    (gesture: Gesture, event: React.PointerEvent) => {
      gestureRef.current = gesture;
      pointerRef.current = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey };
      const onMove = (moveEvent: PointerEvent): void => {
        pointerRef.current = { clientX: moveEvent.clientX, clientY: moveEvent.clientY, altKey: moveEvent.altKey };
        processPointer();
        kickEdge();
      };
      const onUp = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        endGesture();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [endGesture, kickEdge, processPointer],
  );

  const onScrubDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    startWindowGesture({ kind: "scrub" }, event);
    processPointer();
  };

  const onClipDown = (event: React.PointerEvent, clip: TimelineClip, mode: EditMode): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const total = totalRef.current;
    const bounds = boundsFor?.(clip.id) ?? { lower: 0, upper: total };
    const downMs = timeAtClientX(event.clientX);
    startWindowGesture(
      {
        kind: "clip",
        mode,
        id: clip.id,
        origStart: clip.startMs,
        origEnd: clip.endMs,
        endDerived: clip.endDerived,
        grabMs: downMs - clip.startMs,
        bounds,
        downX: event.clientX,
        downMs,
        moved: false,
      },
      event,
    );
  };

  const onOverviewDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = overviewRef.current?.getBoundingClientRect();
    const total = totalRef.current;
    if (!rect || total <= 0) return;
    const ms = ((event.clientX - rect.left) / Math.max(1, rect.width || widthRef.current)) * total;
    const current = viewRef.current;
    const span = (widthRef.current / current.zoom) * 1000;
    const inside = ms >= current.startMs && ms <= current.startMs + span;
    startWindowGesture({ kind: "overview", offsetMs: inside ? ms - current.startMs : span / 2 }, event);
    processPointer();
  };

  /* Wheel: Ctrl/⌘ + wheel zooms around the cursor; a plain wheel pans. */
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const current = viewRef.current;
      if (event.ctrlKey || event.metaKey) {
        applyZoom(current.zoom * Math.exp(-event.deltaY * 0.0022), event.clientX);
      } else {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        setView({ ...current, startMs: current.startMs + (delta / current.zoom) * 1000 });
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [applyZoom, setView]);

  useImperativeHandle(
    ref,
    () => ({
      playPause: togglePlay,
      seek,
      playRange,
      reveal,
      fit,
      zoomBy: (factor: number) => applyZoom(viewRef.current.zoom * factor),
      getTime: () => {
        const audio = audioRef.current;
        return audio && !audio.paused ? audio.currentTime * 1000 : lastTimeRef.current;
      },
      getDuration: () => totalRef.current,
      isPlaying: () => !!audioRef.current && !audioRef.current.paused,
      dragOver: (payload, clientX, clientY, altKey = false) => {
        if (!payload) {
          if (gestureRef.current?.kind === "external") gestureRef.current = null;
          setDropPreview(null);
          setSnapMs(null);
          return false;
        }
        gestureRef.current = { kind: "external", payload };
        pointerRef.current = { clientX, clientY, altKey };
        if (!insideTimeline(clientX, clientY)) {
          setDropPreview(null);
          setSnapMs(null);
          return false;
        }
        processPointer();
        kickEdge();
        return true;
      },
      drop: (payload, clientX, clientY, altKey = false) => {
        const inside = insideTimeline(clientX, clientY);
        const placement = inside ? computeDrop(payload, clientX, altKey) : null;
        gestureRef.current = null;
        if (edgeRafRef.current !== null) cancelAnimationFrame(edgeRafRef.current);
        edgeRafRef.current = null;
        setDropPreview(null);
        setSnapMs(null);
        return placement ? { ok: placement.ok, startMs: placement.startMs, endMs: placement.endMs, clamped: placement.clamped } : null;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [togglePlay, seek, playRange, reveal, fit, applyZoom, processPointer, kickEdge, computeDrop],
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

  const durationMismatch = decodedMs > 0 && durationMs > 0 && Math.abs(decodedMs - durationMs) > 250;
  const minZoom = fitZoom(width, totalMs || 10_000);
  const zoomSlider = view.zoom > 0 ? Math.round((Math.log(view.zoom / minZoom) / Math.log(MAX_ZOOM / Math.max(0.0001, minZoom))) * 1000) : 0;
  const msPerPx = view.zoom > 0 ? 1000 / view.zoom : 0;
  const playheadX = msToX(currentMs);
  const windowLeft = totalMs > 0 ? (view.startMs / totalMs) * 100 : 0;
  const windowWidth = totalMs > 0 ? Math.min(100, (spanMs / totalMs) * 100) : 100;

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
          <button type="button" className={`tl-play${playing ? " is-playing" : ""}`} onClick={togglePlay} title={t("پخش / مکث (Space)", "Play / pause (Space)")}>
            {playing ? "❚❚" : "▶"}
          </button>
          <span className="step-group">
            <button type="button" className="tl-icon" onClick={() => seek(0)} title={t("ابتدای صوت", "To start")}>
              ⏮
            </button>
            <button type="button" className="tl-icon" onClick={() => seek(lastTimeRef.current - 1000)} title="−1s">
              −1s
            </button>
            <button type="button" className="tl-icon" onClick={() => seek(lastTimeRef.current - 100)} title="−0.1s">
              −.1
            </button>
            <button type="button" className="tl-icon" onClick={() => seek(lastTimeRef.current + 100)} title="+0.1s">
              +.1
            </button>
            <button type="button" className="tl-icon" onClick={() => seek(lastTimeRef.current + 1000)} title="+1s">
              +1s
            </button>
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
            <button type="button" className="tl-icon" onClick={() => applyZoom(view.zoom / 1.5)} title={t("کوچک‌نمایی (−)", "Zoom out (−)")}>
              −
            </button>
            <input
              type="range"
              min={0}
              max={1000}
              value={Number.isFinite(zoomSlider) ? zoomSlider : 0}
              onChange={(event) => applyZoom(minZoom * Math.pow(MAX_ZOOM / minZoom, Number(event.target.value) / 1000))}
              aria-label="zoom"
              title={t("بزرگ‌نمایی (Ctrl + چرخ ماوس)", "Zoom (Ctrl + wheel)")}
            />
            <button type="button" className="tl-icon" onClick={() => applyZoom(view.zoom * 1.5)} title={t("بزرگ‌نمایی (+)", "Zoom in (+)")}>
              +
            </button>
            <button type="button" className="tl-icon tl-fit" onClick={fit} title={t("کل صوت در یک نما", "Fit the whole audio")}>
              ⊡
            </button>
            <span className="zoom-readout" title={t("دقت هر پیکسل", "time per pixel")}>
              {msPerPx >= 10 ? `${Math.round(msPerPx)}` : msPerPx.toFixed(msPerPx >= 1 ? 1 : 2)} ms/px
            </span>
          </span>
          {hasClips && (
            <button
              type="button"
              className={`tl-icon tl-toggle${snapOn ? " is-on" : ""}`}
              onClick={() => setSnapOn((value) => !value)}
              title={t("چسبیدن به لبه‌ها و نوک پخش (Alt = موقتاً برعکس)", "Snap to edges and the playhead (hold Alt to invert)")}
            >
              🧲
            </button>
          )}
          {!compact && (
            <span className="loop-group">
              <button type="button" className="tl-icon" onClick={() => setLoop((current) => ({ ...current, a: Math.round(lastTimeRef.current) }))} title={t("ابتدای بازهٔ تکرار", "loop start")}>
                A
              </button>
              <button type="button" className="tl-icon" onClick={() => setLoop((current) => ({ ...current, b: Math.round(lastTimeRef.current) }))} title={t("پایان بازهٔ تکرار", "loop end")}>
                B
              </button>
              {loop.a !== null && loop.b !== null && (
                <button type="button" className="tl-icon is-on" onClick={() => setLoop({ a: null, b: null })} title={t("حذف بازهٔ تکرار", "Clear the loop")}>
                  ✕
                </button>
              )}
            </span>
          )}
          {extraControls}
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

      <div className={`tl-viewport${dropPreview ? " is-drop-target" : ""}`} ref={viewportRef} style={{ height: canvasH + clipH }}>
        <canvas ref={canvasRef} className="wave-canvas" onPointerDown={onScrubDown} />
        {hasClips && (
          <div className="tl-clip-track" style={{ top: canvasH, height: clipH }} onPointerDown={onScrubDown}>
            <ClipLayer
              clips={clips ?? []}
              edit={edit}
              view={view}
              width={width}
              onClipDown={onClipDown}
              t={t}
            />
            {dropPreview && (
              <DropGhost preview={dropPreview} view={view} width={width} t={t} />
            )}
            {(clips ?? []).length === 0 && !dropPreview && (
              <div className="tl-empty">{t("سطرها را از فهرست پایین بکشید و اینجا رها کنید", "Drag lines from the list below and drop them here")}</div>
            )}
          </div>
        )}
        {snapMs !== null && msToX(snapMs) >= 0 && msToX(snapMs) <= width && (
          <div className="tl-snap-guide" style={{ transform: `translateX(${msToX(snapMs)}px)` }} />
        )}
        {playheadX >= -1 && playheadX <= width + 1 && (
          <div className="playhead" style={{ transform: `translateX(${playheadX}px)` }}>
            <span className="playhead-handle">{formatMs(currentMs)}</span>
          </div>
        )}
      </div>

      <div className="tl-overview" onPointerDown={onOverviewDown} title={t("نقشهٔ کل صوت — بکشید تا جابه‌جا شوید", "Whole-file map — drag to navigate")}>
        <canvas ref={overviewRef} />
        <span className="tl-overview-window" style={{ left: `${windowLeft}%`, width: `${Math.max(0.6, windowWidth)}%` }} />
        {totalMs > 0 && <span className="tl-overview-playhead" style={{ left: `${(currentMs / totalMs) * 100}%` }} />}
      </div>

      {!compact && (
        <div className="tiny muted timeline-hint">
          {hasClips
            ? t(
                "فقط سطر انتخاب‌شده (زرد) قابل جابه‌جایی است: وسطش را بکشید تا جابه‌جا شود، لبه‌ها را بکشید تا شروع/پایان دقیق شود. سطرهای دیگر قفل‌اند · Ctrl + چرخ = بزرگ‌نمایی · چرخ = حرکت · Alt = بدون چسبیدن",
                "Only the selected (yellow) clip is editable: drag its body to move it, its edges to trim start/end. Other clips are locked · Ctrl + wheel zooms · wheel pans · Alt disables snapping",
              )
            : t("کلیک یا کشیدن روی موج = جابه‌جایی نوک پخش · Ctrl + چرخ ماوس = بزرگ‌نمایی", "Click or drag the waveform to move the playhead · Ctrl + wheel zooms")}
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Clip layer (memoised: the playhead moving does not re-render clips) */
/* ------------------------------------------------------------------ */

type Translate = (fa: string, en: string) => string;

const ClipLayer = memo(function ClipLayer({
  clips,
  edit,
  view,
  width,
  onClipDown,
  t,
}: {
  clips: TimelineClip[];
  edit: EditPreview | null;
  view: View;
  width: number;
  onClipDown: (event: React.PointerEvent, clip: TimelineClip, mode: EditMode) => void;
  t: Translate;
}): React.ReactElement {
  const span = (width / Math.max(0.0001, view.zoom)) * 1000;
  const viewEnd = view.startMs + span;
  const toX = (ms: number): number => ((ms - view.startMs) * view.zoom) / 1000;
  return (
    <>
      {clips.map((clip) => {
        const live = edit && edit.id === clip.id ? { ...clip, startMs: edit.startMs, endMs: edit.endMs, endDerived: clip.endDerived && !edit.recordEnd } : clip;
        if (live.endMs < view.startMs || live.startMs > viewEnd) return null;
        const left = toX(live.startMs);
        const right = toX(live.endMs);
        const shownLeft = Math.max(-6, left);
        const shownRight = Math.min(width + 6, right);
        const pixels = right - left;
        const editing = edit?.id === clip.id;
        const classes = [
          "tl-clip",
          `tone-${clip.tone}`,
          clip.selected ? "is-selected" : "is-locked",
          clip.problem ? "has-problem" : "",
          live.endDerived ? "is-derived-end" : "",
          editing ? "is-editing" : "",
          pixels < 34 ? "is-narrow" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={clip.id}
            className={classes}
            data-clip-id={clip.id}
            style={{ transform: `translateX(${shownLeft}px)`, width: Math.max(3, shownRight - shownLeft) }}
            onPointerDown={clip.selected ? (event) => onClipDown(event, clip, "move") : undefined}
            title={`${clip.number}. ${clip.text}\n${formatMs(live.startMs)} → ${formatMs(live.endMs)}${live.endDerived ? ` (${t("پایان خودکار", "automatic end")})` : ""}`}
          >
            <span className="tl-clip-label">
              <b>{clip.number}</b>
              {pixels >= 60 && clip.badge ? <i>{clip.badge}</i> : null}
              {pixels >= 80 ? <span>{clip.text}</span> : null}
            </span>
            {clip.selected && left >= -6 && (
              <span className="tl-handle tl-handle-start" onPointerDown={(event) => onClipDown(event, clip, "start")} title={t("کشیدن = شروع دقیق", "Drag = exact start")} />
            )}
            {clip.selected && right <= width + 6 && (
              <span className="tl-handle tl-handle-end" onPointerDown={(event) => onClipDown(event, clip, "end")} title={t("کشیدن = پایان دقیق", "Drag = exact end")} />
            )}
            {editing && (
              <span className="tl-clip-readout">
                {formatMs(live.startMs)} → {formatMs(live.endMs)} · {((live.endMs - live.startMs) / 1000).toFixed(3)}s
              </span>
            )}
          </div>
        );
      })}
    </>
  );
});

function DropGhost({ preview, view, width, t }: { preview: DropPreview; view: View; width: number; t: Translate }): React.ReactElement {
  const toX = (ms: number): number => ((ms - view.startMs) * view.zoom) / 1000;
  const left = Math.max(-6, toX(preview.startMs));
  const right = Math.min(width + 6, toX(preview.endMs));
  return (
    <div
      className={`tl-clip tl-drop tone-${preview.payload.tone}${preview.ok ? "" : " is-invalid"}`}
      style={{ transform: `translateX(${left}px)`, width: Math.max(6, right - left) }}
    >
      <span className="tl-clip-label">
        <b>{preview.payload.number}</b>
        <span>{preview.payload.text}</span>
      </span>
      <span className="tl-clip-readout">
        {preview.ok
          ? `${formatMs(preview.startMs)} → ${formatMs(preview.endMs)}${preview.clamped ? ` · ${t("داخل جای مجاز", "pulled into its slot")}` : ""}`
          : t("جا ندارد: ترتیب سطرها باید حفظ شود", "No room: the line order must be kept")}
      </span>
    </div>
  );
}
