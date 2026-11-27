import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { resolveTimings, type ResolvedTiming } from "@shared/timing";
import type { LyricMark } from "@shared/types";
import { api } from "../api";
import { formatMs } from "../format";
import { useLang } from "../i18n";

/**
 * "Play the part of the song this card is about."
 *
 * One hidden <audio> per project page. A card asks for a set of line / turn
 * ids; the player plays continuously from the earliest start to the latest
 * effective end (the same rule as ReeTalk question evidence on Android) and
 * stops exactly at that end. Timings are the operator's own marks resolved
 * the way the export resolves them, so what you hear is what ships.
 */

export interface SegmentUnit {
  id: string;
  /** 1-based number shown in pickers. */
  number: number;
  text: string;
  /** Speaker name (ReeTalk) or language badge (song). */
  badge?: string;
  /** True when the unit must not be linked from learning content. */
  locked?: boolean;
}

interface SegmentAudioValue {
  units: SegmentUnit[];
  hasAudio: boolean;
  playingKey: string | null;
  timing(id: string): ResolvedTiming | undefined;
  rangeFor(ids: readonly string[]): { startMs: number; endMs: number } | null;
  play(key: string, ids: readonly string[]): void;
  stop(): void;
}

const SegmentAudioContext = createContext<SegmentAudioValue | null>(null);

export function SegmentAudioProvider({
  projectId,
  units,
  marks,
  durationMs,
  hasAudio,
  audioSha,
  children,
}: {
  projectId: string;
  units: SegmentUnit[];
  marks: LyricMark[];
  durationMs: number;
  hasAudio: boolean;
  audioSha: string | null;
  children: React.ReactNode;
}): React.ReactElement {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    if (!hasAudio) return undefined;
    void api.media.playUrl(projectId, "audio").then((value) => {
      if (active) setUrl(value ? `${value}?v=${audioSha ?? ""}` : null);
    });
    return () => {
      active = false;
    };
  }, [projectId, hasAudio, audioSha]);

  const timings = useMemo(() => {
    const byId: Record<string, { startMs: number | null; endMs: number | null }> = {};
    for (const mark of marks) byId[mark.lineId] = { startMs: mark.startMs, endMs: mark.endMs };
    const resolved = resolveTimings(
      units.map((unit) => unit.id),
      byId,
      durationMs,
    );
    return new Map(resolved.map((timing) => [timing.id, timing]));
  }, [units, marks, durationMs]);

  const rangeFor = useCallback(
    (ids: readonly string[]) => {
      const ranges = ids
        .map((id) => timings.get(id))
        .filter((timing): timing is ResolvedTiming => !!timing && timing.startMs !== null && timing.endMs !== null && timing.endMs > timing.startMs);
      if (ranges.length === 0) return null;
      return {
        startMs: Math.min(...ranges.map((range) => range.startMs as number)),
        endMs: Math.max(...ranges.map((range) => range.endMs as number)),
      };
    },
    [timings],
  );

  const stop = useCallback(() => {
    stopAtRef.current = null;
    audioRef.current?.pause();
    setPlayingKey(null);
  }, []);

  const play = useCallback(
    (key: string, ids: readonly string[]) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (playingKey === key && !audio.paused) {
        stop();
        return;
      }
      const range = rangeFor(ids);
      if (!range) return;
      audio.currentTime = range.startMs / 1000;
      stopAtRef.current = range.endMs;
      setPlayingKey(key);
      void audio.play().catch(() => setPlayingKey(null));
    },
    [playingKey, rangeFor, stop],
  );

  // Stop exactly at the range end (timeupdate alone is ~250 ms coarse).
  useEffect(() => {
    if (!playingKey) return undefined;
    let frame = 0;
    const tick = (): void => {
      const audio = audioRef.current;
      const stopAt = stopAtRef.current;
      if (audio && stopAt !== null && audio.currentTime * 1000 >= stopAt) {
        audio.pause();
        stopAtRef.current = null;
        setPlayingKey(null);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playingKey]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const value = useMemo<SegmentAudioValue>(
    () => ({
      units,
      hasAudio: hasAudio && !!url,
      playingKey,
      timing: (id) => timings.get(id),
      rangeFor,
      play,
      stop,
    }),
    [units, hasAudio, url, playingKey, timings, rangeFor, play, stop],
  );

  return (
    <SegmentAudioContext.Provider value={value}>
      <audio ref={audioRef} src={url ?? undefined} preload="metadata" onPause={() => setPlayingKey(null)} hidden />
      {children}
    </SegmentAudioContext.Provider>
  );
}

const EMPTY: SegmentAudioValue = {
  units: [],
  hasAudio: false,
  playingKey: null,
  timing: () => undefined,
  rangeFor: () => null,
  play: () => undefined,
  stop: () => undefined,
};

export function useSegmentAudio(): SegmentAudioValue {
  return useContext(SegmentAudioContext) ?? EMPTY;
}

/** ▶ button that plays the song/dialogue part linked to a card. */
export function PlaySegment({
  playKey,
  ids,
  compact,
}: {
  playKey: string;
  ids: readonly string[];
  compact?: boolean;
}): React.ReactElement {
  const { t } = useLang();
  const audio = useSegmentAudio();
  const range = audio.rangeFor(ids);
  const playing = audio.playingKey === playKey;
  const reason = ids.length === 0
    ? t("به سطری وصل نیست", "not linked to a line")
    : !audio.hasAudio
      ? t("صوت انتخاب نشده", "no audio selected")
      : !range
        ? t("سطرهای وصل‌شده هنوز زمان ندارند", "linked lines are not timed yet")
        : null;
  const label = range ? `${formatMs(range.startMs)} – ${formatMs(range.endMs)}` : reason ?? "";
  return (
    <button
      type="button"
      className={`seg-play${playing ? " is-playing" : ""}${compact ? " is-compact" : ""}`}
      disabled={!!reason}
      onClick={() => audio.play(playKey, ids)}
      title={reason ?? t(`پخش ${label}`, `Play ${label}`)}
      aria-label={playing ? t("توقف", "Stop") : t("پخش قسمت مربوط", "Play the linked part")}
    >
      <span className="seg-play-icon" aria-hidden="true">{playing ? "■" : "▶"}</span>
      {compact ? null : <span className="seg-play-label" dir="ltr">{label}</span>}
    </button>
  );
}

/**
 * Pick the line(s)/turn(s) a card belongs to. `multiple` = chips + add menu;
 * single = one select. Locked units (foreign-language song lines) are shown
 * disabled because they must not be taught.
 */
export function UnitLinker({
  value,
  onChange,
  multiple,
  label,
  unitName,
}: {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  label?: string;
  unitName?: { fa: string; en: string };
}): React.ReactElement {
  const { t } = useLang();
  const { units } = useSegmentAudio();
  const name = unitName ?? { fa: "سطر", en: "line" };
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const unitLabel = (unit: SegmentUnit): string =>
    `${unit.number}. ${unit.badge ? `[${unit.badge}] ` : ""}${unit.text.length > 60 ? `${unit.text.slice(0, 57)}…` : unit.text}`;
  const available = units.filter((unit) => !value.includes(unit.id));

  if (!multiple) {
    const current = value[0] ?? "";
    return (
      <div className="unit-linker">
        {label ? <span className="unit-linker-label">{label}</span> : null}
        <select
          className="input unit-select"
          dir="ltr"
          value={current}
          onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}
        >
          <option value="">— {t(`بدون ${name.fa}`, `no ${name.en}`)} —</option>
          {current && !byId.has(current) ? <option value={current}>{current} ({t("ناموجود", "missing")})</option> : null}
          {units.map((unit) => (
            <option key={unit.id} value={unit.id} disabled={unit.locked && unit.id !== current}>
              {unitLabel(unit)}
              {unit.locked ? ` — ${t("زبان دیگر، آموزش داده نمی‌شود", "other language, not taught")}` : ""}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="unit-linker">
      {label ? <span className="unit-linker-label">{label}</span> : null}
      <div className="unit-chips">
        {value.map((id) => {
          const unit = byId.get(id);
          return (
            <span key={id} className={`unit-chip${!unit ? " is-missing" : unit.locked ? " is-locked" : ""}`} dir="ltr" title={unit?.text ?? id}>
              <b>{unit ? unit.number : "?"}</b>
              <span>{unit ? unit.text : id}</span>
              <button type="button" onClick={() => onChange(value.filter((item) => item !== id))} aria-label={t("برداشتن", "Remove")}>
                ×
              </button>
            </span>
          );
        })}
        <select
          className="input unit-add"
          dir="ltr"
          value=""
          onChange={(event) => {
            const id = event.target.value;
            if (!id) return;
            // Keep the conversation / song order regardless of click order.
            const order = new Map(units.map((unit, index) => [unit.id, index]));
            onChange([...value, id].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)));
          }}
        >
          <option value="">+ {t(`افزودن ${name.fa}`, `add ${name.en}`)}</option>
          {available.map((unit) => (
            <option key={unit.id} value={unit.id} disabled={unit.locked}>
              {unitLabel(unit)}
              {unit.locked ? ` — ${t("زبان دیگر", "other language")}` : ""}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
