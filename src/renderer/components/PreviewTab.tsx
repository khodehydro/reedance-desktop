import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DraftContent,
  ProjectContent,
  ProjectDetail,
  ReetalkDraft,
  ReetalkQuestion,
  ReetalkTable,
  ReetalkTableCell,
} from "@shared/types";
import {
  activeIndexAt,
  isBlockingProblem,
  problemLabel,
  resolveTimings,
  revealedCountAt,
  type ResolvedTiming,
} from "@shared/timing";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatMs } from "../format";
import { Badge, Button } from "./ui";

/* ================================================================== */
/* Shared: palette, player, readiness                                  */
/* ================================================================== */

/** Android `DialoguePalette` tones: paper, ink, accent, onAccent, alt (light / dark). */
const PAPERS = [
  { id: "system", fa: "سیستم", en: "System", light: ["#fbfcff", "#1a1c20", "#3d5f93", "#ffffff", "#4f6354"], dark: ["#17191d", "#e8ebf1", "#b8cbfa", "#21304f", "#b5d8ca"] },
  { id: "sepia", fa: "کاهی", en: "Sepia", light: ["#f7ebd4", "#302219", "#784617", "#fff5e8", "#615325"], dark: ["#241c14", "#ffebd5", "#f3be81", "#412808", "#d9c394"] },
  { id: "blue", fa: "آبی", en: "Blue", light: ["#e5f1f6", "#182d3a", "#225a79", "#f0faff", "#22625b"], dark: ["#14242d", "#e2f4ff", "#9cd2f7", "#113247", "#a9d9d1"] },
  { id: "peach", fa: "هلویی", en: "Peach", light: ["#ffe7dc", "#3e231f", "#973e30", "#fff5f1", "#785014"], dark: ["#33211d", "#ffebe1", "#ffaf97", "#47221c", "#ffcc85"] },
  { id: "mint", fa: "نعنایی", en: "Mint", light: ["#e2f7e9", "#17332b", "#17664b", "#f3fff8", "#4b612b"], dark: ["#142d27", "#defff1", "#87e2ba", "#153a2c", "#c7e892"] },
  { id: "lavender", fa: "یاسی", en: "Lavender", light: ["#f2e7fc", "#302347", "#65449b", "#fff7ff", "#8a3f70"], dark: ["#2b203b", "#f6ebff", "#d7baff", "#39234e", "#f4b4d8"] },
] as const;

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
function mix(a: string, b: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const channel = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return `rgb(${channel(r1, r2)}, ${channel(g1, g2)}, ${channel(b1, b2)})`;
}

/** The Android chat wallpaper motif (DialogueWallpaper.kt), tiled as an SVG pattern. */
const WALLPAPER_PATH =
  "M12,29 C5,23 9,12 18,12 H32 C43,12 46,28 35,32 H25 L17,38 V32 Z M19,22 H32 M72,12 C84,2 94,19 85,26 C77,32 68,21 75,16 C80,13 84,17 81,20 " +
  "M122,33 Q122,43 132,44 Q121,45 120,55 Q120,45 111,44 Q121,43 122,33 M42,61 C47,52 57,55 61,62 C66,53 80,56 80,65 C80,74 69,81 61,85 C52,79 36,70 42,61 " +
  "M95,82 Q103,71 111,81 T130,79 M94,89 Q103,79 111,89 T130,87 M10,99 C18,92 18,110 27,104 S35,102 37,107 " +
  "M51,121 Q56,106 72,111 Q83,117 76,128 Q71,135 61,131 L54,135 L55,128 Q50,126 51,121 M109,121 Q109,128 116,129 Q109,130 108,137 Q107,130 101,129 Q108,128 109,121";

function wallpaper(accent: string): string {
  const stroke = encodeURIComponent(accent);
  const tile = `<path d='${WALLPAPER_PATH}' fill='none' stroke='${stroke}' stroke-opacity='0.19' stroke-width='1.25' stroke-linecap='round'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='144' height='288' viewBox='0 0 144 288'>` +
    `${tile}<g transform='translate(72 144)'>${tile}</g><g transform='translate(-72 144)'>${tile}</g></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/"/g, "'")}")`;
}

function paletteStyle(paperIndex: number, dark: boolean): React.CSSProperties {
  const [paper, ink, accent, onAccent, alt] = PAPERS[paperIndex][dark ? "dark" : "light"];
  const neutral = (amount: number) => mix(paper, ink, amount);
  return {
    ["--ph-paper" as string]: paper,
    ["--ph-ink" as string]: ink,
    ["--ph-ink-soft" as string]: mix(ink, paper, 0.25),
    ["--ph-accent" as string]: accent,
    ["--ph-on-accent" as string]: onAccent,
    ["--ph-alt" as string]: alt,
    ["--ph-surface" as string]: neutral(0.08),
    ["--ph-surface-high" as string]: neutral(0.13),
    ["--ph-outline" as string]: neutral(0.27),
    ["--ph-primary-container" as string]: mix(paper, accent, 0.3),
    ["--ph-secondary-container" as string]: mix(paper, alt, 0.17),
    ["--ph-wallpaper" as string]: wallpaper(accent),
  };
}

interface Player {
  audio: React.ReactElement;
  playing: boolean;
  ms: number;
  durationMs: number;
  speed: number;
  ended: boolean;
  setSpeed: (speed: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  playRange: (startMs: number, endMs: number) => void;
  setVolume: (volume: number) => void;
  failed: boolean;
}

/** One page-owned player, like the Android reader: range playback stops exactly at the range end. */
function usePlayer(projectId: string, storedDuration: number, onRangeEnd?: () => void): Player {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const rangeEndRef = useRef(onRangeEnd);
  rangeEndRef.current = onRangeEnd;
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ms, setMs] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [elementMs, setElementMs] = useState(0);

  useEffect(() => {
    let active = true;
    void api.media.playUrl(projectId, "audio").then((value) => {
      if (active) setUrl(value);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    const tick = (): void => {
      const audio = audioRef.current;
      if (!audio) return;
      let now = audio.currentTime * 1000;
      const stopAt = stopAtRef.current;
      if (stopAt !== null && now >= stopAt) {
        audio.pause();
        audio.currentTime = stopAt / 1000;
        now = stopAt;
        stopAtRef.current = null;
        rangeEndRef.current?.();
      }
      setMs(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setEnded(false);
    void audio.play().catch(() => setFailed(true));
  }, []);
  const pause = useCallback(() => audioRef.current?.pause(), []);
  const seek = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    stopAtRef.current = null;
    audio.currentTime = Math.max(0, value) / 1000;
    setMs(Math.max(0, value));
    setEnded(false);
  }, []);
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      stopAtRef.current = null;
      play();
    } else audio.pause();
  }, [play]);
  const playRange = useCallback(
    (startMs: number, endMs: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = startMs / 1000;
      setMs(startMs);
      stopAtRef.current = endMs;
      play();
    },
    [play],
  );

  const audio = (
    <audio
      ref={audioRef}
      src={url ?? undefined}
      preload="auto"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => {
        setPlaying(false);
        setEnded(true);
      }}
      onError={() => setFailed(true)}
      onLoadedMetadata={(event) => {
        event.currentTarget.playbackRate = speed;
        const duration = event.currentTarget.duration;
        if (Number.isFinite(duration) && duration > 0) setElementMs(Math.round(duration * 1000));
      }}
    />
  );

  return {
    audio,
    playing,
    ms,
    durationMs: storedDuration > 0 ? storedDuration : elementMs,
    speed,
    ended,
    failed,
    setSpeed: (value) => {
      setSpeedState(value);
      if (audioRef.current) audioRef.current.playbackRate = value;
    },
    toggle,
    play,
    pause,
    seek,
    playRange,
    setVolume: (volume) => {
      if (audioRef.current) audioRef.current.volume = volume;
    },
  };
}

function useCoverUrl(detail: ProjectDetail): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!detail.media?.coverPath) {
      setUrl(null);
      return undefined;
    }
    void api.media.playUrl(detail.summary.projectId, "cover").then((value) => {
      if (active) setUrl(value ? `${value}?v=${detail.media?.coverSha256 ?? ""}` : null);
    });
    return () => {
      active = false;
    };
  }, [detail.media?.coverPath, detail.media?.coverSha256, detail.summary.projectId]);
  return url;
}

function marksRecord(detail: ProjectDetail): Record<string, { startMs: number | null; endMs: number | null }> {
  const map: Record<string, { startMs: number | null; endMs: number | null }> = {};
  for (const mark of detail.marks) map[mark.lineId] = { startMs: mark.startMs, endMs: mark.endMs };
  return map;
}

function PhoneFrame({ children, style, dark }: { children: React.ReactNode; style?: React.CSSProperties; dark: boolean }): React.ReactElement {
  return (
    <div className={`phone${dark ? " phone-dark" : ""}`} style={style}>
      <div className="phone-notch" />
      <div className="phone-status" dir="ltr">
        <span>9:41</span>
        <span className="phone-status-icons">▂▄▆ ◔ ▮</span>
      </div>
      <div className="phone-screen">{children}</div>
      <div className="phone-home" />
    </div>
  );
}

/* ================================================================== */
/* Entry                                                               */
/* ================================================================== */

/**
 * Android simulator: plays the project the way the phone will — the same
 * audio file, the same exported timings (recorded end → next start → audio
 * end) and the same reading modes — so a broken sync is caught here instead
 * of after exporting and installing a pack.
 */
export function PreviewTab({
  detail,
  content,
  onOpenTimeline,
  onOpenExport,
}: {
  detail: ProjectDetail;
  content: ProjectContent;
  onOpenTimeline: () => void;
  onOpenExport: () => void;
}): React.ReactElement {
  const { t } = useLang();
  const reetalk = "contentType" in content && content.contentType === "reetalk";
  const lines = useMemo(
    () => (reetalk ? (content as ReetalkDraft).turns.map((turn) => turn.id) : (content as DraftContent).lyrics.map((line) => line.id)),
    [content, reetalk],
  );
  const durationMs = detail.media?.durationMs ?? 0;
  const timings = useMemo(() => resolveTimings(lines, marksRecord(detail), durationMs), [lines, detail, durationMs]);

  if (!detail.media) {
    return (
      <div className="tab-body">
        <div className="callout callout-warn">
          {t("برای شبیه‌سازی ابتدا فایل صوتی را انتخاب و خطوط را زمان‌گذاری کنید.", "Select the audio and time the lines before simulating.")}{" "}
          <Button size="sm" variant="ghost" onClick={onOpenTimeline}>
            {t("برو به تایم‌لاین", "Open the timeline")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-body preview-tab">
      <div className="preview-layout">
        <div className="preview-stage">
          {reetalk ? (
            <ReeTalkSimulator detail={detail} draft={content as ReetalkDraft} timings={timings} />
          ) : (
            <SongSimulator detail={detail} draft={content as DraftContent} timings={timings} />
          )}
        </div>
        <Readiness detail={detail} timings={timings} kind={reetalk ? "reetalk" : "song"} onOpenTimeline={onOpenTimeline} onOpenExport={onOpenExport} />
      </div>
    </div>
  );
}

function Readiness({
  detail,
  timings,
  kind,
  onOpenTimeline,
  onOpenExport,
}: {
  detail: ProjectDetail;
  timings: ResolvedTiming[];
  kind: "song" | "reetalk";
  onOpenTimeline: () => void;
  onOpenExport: () => void;
}): React.ReactElement {
  const { t, lang } = useLang();
  const timed = timings.filter((timing) => timing.startMs !== null).length;
  const problems = timings.filter((timing) => timing.problems.length > 0);
  const blocking = problems.filter((timing) => timing.problems.some((problem) => isBlockingProblem(problem, kind)));
  const derived = timings.filter((timing) => timing.endSource === "next" || timing.endSource === "duration").length;
  const failedGates = detail.preflight.gates.filter((gate) => !gate.ok);
  const unit = kind === "reetalk" ? t("نوبت", "turn") : t("سطر", "line");

  return (
    <aside className="preview-side">
      <section className="preview-card">
        <h3>{t("آمادگی خروجی", "Export readiness")}</h3>
        <div className="row gap-sm wrap">
          <Badge tone={detail.preflight.canExport ? "ok" : "bad"}>
            {detail.preflight.canExport ? t("آمادهٔ خروجی", "ready to export") : t("هنوز آماده نیست", "not ready yet")}
          </Badge>
          <Badge tone={timed === timings.length ? "ok" : "warn"}>
            {t("زمان‌دار", "timed")} {timed}/{timings.length}
          </Badge>
          {derived > 0 && (
            <Badge tone="muted">
              {t("پایان خودکار", "auto ends")} {derived}
            </Badge>
          )}
        </div>
        {failedGates.length > 0 && (
          <ul className="preview-list">
            {failedGates.map((gate) => (
              <li key={gate.key}>
                <span className="dot dot-bad" /> {lang === "fa" ? gate.labelFa : gate.labelEn}
                {gate.detail ? <span className="tiny muted"> — {gate.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="row gap-sm wrap">
          <Button size="sm" variant="ghost" onClick={onOpenTimeline}>
            {t("اصلاح در تایم‌لاین", "Fix in the timeline")}
          </Button>
          <Button size="sm" variant={detail.preflight.canExport ? "primary" : "ghost"} onClick={onOpenExport}>
            {t("رفتن به خروجی", "Go to export")}
          </Button>
        </div>
      </section>

      <section className="preview-card">
        <h3>
          {t("بررسی زمان‌بندی", "Timing check")}{" "}
          {blocking.length > 0 ? <Badge tone="bad">{blocking.length}</Badge> : <Badge tone="ok">✓</Badge>}
        </h3>
        {problems.length === 0 ? (
          <p className="tiny muted">{t(`همهٔ ${unit}‌ها زمان معتبر دارند.`, `Every ${unit} has a valid time.`)}</p>
        ) : (
          <ul className="preview-list preview-problems">
            {problems.slice(0, 40).map((timing) => (
              <li key={timing.id}>
                <button type="button" className="link-btn" onClick={onOpenTimeline}>
                  {unit} {timing.index + 1}
                </button>
                : {timing.problems.map((problem) => problemLabel(problem, lang === "fa" ? "fa" : "en")).join(" · ")}
              </li>
            ))}
          </ul>
        )}
        <p className="tiny muted">
          {t(
            "شبیه‌ساز دقیقاً همان زمان‌هایی را پخش می‌کند که در بسته می‌رود: پایانِ ثبت‌نشده = شروع سطر بعد، و آخرین سطر = پایان صوت.",
            "The simulator plays exactly the timings that ship: a missing end = the next line's start, the last line = the end of the audio.",
          )}
        </p>
      </section>
    </aside>
  );
}

/* ================================================================== */
/* ReeTalk: chat reader                                                */
/* ================================================================== */

type SpeakerMode = "both" | "mute" | "listen" | "role";
const MODES: SpeakerMode[] = ["both", "mute", "listen", "role"];
const MODE_FLAGS: Record<SpeakerMode, { audio: boolean; messages: boolean }> = {
  both: { audio: true, messages: true },
  mute: { audio: false, messages: true },
  listen: { audio: true, messages: false },
  role: { audio: false, messages: false },
};
type Translation = "original" | "sentence" | "word";
const SPEEDS = [0.75, 1, 1.25, 1.5];

function ReeTalkSimulator({ detail, draft, timings }: { detail: ProjectDetail; draft: ReetalkDraft; timings: ResolvedTiming[] }): React.ReactElement {
  const { t } = useLang();
  const coverUrl = useCoverUrl(detail);
  const [tab, setTab] = useState(0);
  const [started, setStarted] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [singleTurn, setSingleTurn] = useState<number | null>(null);
  const [modes, setModes] = useState<[SpeakerMode, SpeakerMode]>(["both", "both"]);
  const [hideAll, setHideAll] = useState(false);
  const [listMode, setListMode] = useState(true);
  const [translation, setTranslation] = useState<Translation>("original");
  const [font, setFont] = useState(1);
  const [paper, setPaper] = useState(0);
  const [dark, setDark] = useState(true);
  const [appearance, setAppearance] = useState(false);
  const player = usePlayer(detail.summary.projectId, detail.media?.durationMs ?? 0, () => setSingleTurn(null));
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const speakerIndex = useMemo(() => new Map(draft.speakers.map((speaker, index) => [speaker.id, index])), [draft.speakers]);
  const active = player.playing ? activeIndexAt(timings, player.ms) : -1;
  const untimed = timings.filter((timing) => timing.startMs === null).length;

  /* Continuous playback reveals bubbles as their start is reached (Android behaviour). */
  useEffect(() => {
    if (player.playing && singleTurn === null) {
      const count = revealedCountAt(timings, player.ms);
      setRevealed((current) => Math.max(current, count));
    }
  }, [player.ms, player.playing, singleTurn, timings]);

  /* Per-speaker audio: a muted speaker's turn still advances in its time. */
  useEffect(() => {
    const turn = active >= 0 ? draft.turns[active] : null;
    const index = turn ? speakerIndex.get(turn.speakerId) ?? 0 : -1;
    player.setVolume(index >= 0 && !MODE_FLAGS[modes[index]].audio ? 0 : 1);
  }, [active, modes, draft.turns, speakerIndex, player]);

  /* Keep the newest bubble in view. */
  useEffect(() => {
    const box = messagesRef.current;
    if (box && listMode && typeof box.scrollTo === "function") box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [revealed, listMode, translation]);

  const playPause = (): void => {
    if (player.playing) {
      player.pause();
      return;
    }
    setStarted(true);
    setSingleTurn(null);
    const lastEnd = timings.reduce((max, timing) => Math.max(max, timing.endMs ?? 0), 0);
    if (player.ended || (lastEnd > 0 && player.ms >= lastEnd - 5)) {
      setRevealed(0);
      player.seek(0);
    }
    player.play();
  };

  const selectTurn = (index: number): void => {
    const timing = timings[index];
    if (!timing || timing.startMs === null || timing.endMs === null) return;
    setSingleTurn(index);
    player.playRange(timing.startMs, timing.endMs);
  };

  const playEvidence = (question: ReetalkQuestion): void => {
    const indexes = question.evidenceTurnIds.map((id) => draft.turns.findIndex((turn) => turn.id === id)).filter((index) => index >= 0);
    const ranges = indexes.map((index) => timings[index]).filter((timing) => timing.startMs !== null && timing.endMs !== null);
    if (ranges.length === 0) return;
    player.playRange(Math.min(...ranges.map((range) => range.startMs as number)), Math.max(...ranges.map((range) => range.endMs as number)));
  };

  const tabs = [t("چت", "Chat"), t("لغات", "Words"), t("گرامر", "Grammar"), t("اصطلاحات", "Phrases"), t("سؤالات", "Questions")];
  const visibleTurns = draft.turns.slice(0, revealed).map((turn, index) => ({ turn, index }));
  const messages = listMode ? visibleTurns : visibleTurns.slice(-2);
  const activeSpeaker = active >= 0 ? speakerIndex.get(draft.turns[active].speakerId) ?? 0 : -1;
  const modeLabel = (mode: SpeakerMode): string =>
    ({ both: t("صدا و پیام", "Audio and messages"), mute: t("بی‌صدا", "Muted"), listen: t("فقط صدا", "Audio only"), role: t("نقش‌آفرینی", "Role-play") })[mode];
  const translationLabel = { original: t("متن اصلی", "Original"), sentence: t("ترجمهٔ جمله", "Sentence"), word: t("کلمه‌به‌کلمه", "Word by word") }[translation];

  return (
    <div className="preview-phone-wrap">
      <PhoneFrame style={paletteStyle(paper, dark)} dark={dark}>
        {player.audio}
        <div className="ph-appbar">
          <span className="ph-back">‹</span>
          <div className="ph-title">
            <strong>{draft.title.fa}</strong>
            <span dir="ltr">{draft.title.en}</span>
          </div>
          <span className="ph-chip">{draft.level}</span>
        </div>
        <div className="ph-pills">
          {tabs.map((label, index) => (
            <button key={label} type="button" className={`ph-pill${tab === index ? " is-on" : ""}`} onClick={() => setTab(index)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 0 ? (
          <>
            {player.failed && <div className="ph-error">{t("فایل صوتی پخش نشد.", "Could not play the recording.")}</div>}
            {untimed > 0 && (
              <div className="ph-warning">
                {t(`${untimed} نوبت زمان ندارد و در گوشی نمایش داده نمی‌شود.`, `${untimed} turn(s) have no time and will not appear on the phone.`)}
              </div>
            )}
            <div className="ph-chat">
              {hideAll ? (
                <div className="ph-hidden-all">
                  <ListeningWave listening={activeSpeaker >= 0 && MODE_FLAGS[modes[activeSpeaker]].audio} />
                  <span>{t("پیام‌ها پنهان‌اند", "Messages hidden")}</span>
                </div>
              ) : (
                <div className={`ph-messages${listMode ? "" : " is-pair"}`} ref={messagesRef}>
                  {messages.map(({ turn, index }) => {
                    const speaker = speakerIndex.get(turn.speakerId) ?? 0;
                    const flags = MODE_FLAGS[modes[speaker]];
                    return (
                      <div key={turn.id} className={`ph-bubble-row side-${speaker}`} dir="ltr">
                        <button
                          type="button"
                          className={`ph-bubble speaker-${speaker}${index === active ? " is-active" : ""}${flags.messages ? "" : " is-hidden"} font-${font}`}
                          onClick={() => selectTurn(index)}
                          title={`${formatMs(timings[index]?.startMs ?? null)} → ${formatMs(timings[index]?.endMs ?? null)}`}
                        >
                          {!flags.messages ? (
                            <span className="ph-dots">...</span>
                          ) : (
                            <>
                              {index === active && flags.audio && <ListeningWave listening compact />}
                              {translation === "word" ? (
                                <span className="ph-words">
                                  {turn.tokens.map((token, tokenIndex) => (
                                    <span key={`${turn.id}-${tokenIndex}`} className="ph-word">
                                      <span>{token.surface}</span>
                                      <span className="ph-gloss" dir="rtl">
                                        {token.gloss.fa}
                                      </span>
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="ph-text">{turn.text}</span>
                              )}
                              {translation === "sentence" && (
                                <span className="ph-meaning" dir="rtl">
                                  {turn.translation.fa}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {!started && revealed === 0 && !hideAll && (
                <div className="ph-cover">
                  {coverUrl ? <img src={coverUrl} alt="" /> : <div className="ph-cover-missing">{t("کاور انتخاب نشده", "No cover selected")}</div>}
                </div>
              )}
              {!started && revealed === 0 && <div className="ph-hint">{t("برای شروع گفت‌وگو روی پخش بزن", "Tap play to start the dialogue")}</div>}
            </div>

            <div className="ph-player" dir="ltr">
              {draft.speakers.slice(0, 2).map((speaker, index) => (
                <button
                  key={speaker.id}
                  type="button"
                  className={`ph-avatar side-${index}`}
                  onClick={() =>
                    setModes((current) => {
                      const next = [...current] as [SpeakerMode, SpeakerMode];
                      next[index] = MODES[(MODES.indexOf(current[index]) + 1) % MODES.length];
                      return next;
                    })
                  }
                  title={t("تغییر حالت این گوینده", "Change this speaker's mode")}
                >
                  <span className={`ph-avatar-face tone-${index}`}>{speaker.gender === "woman" ? "👩" : "👨"}</span>
                  <span className="ph-avatar-name">{speaker.name}</span>
                  <span className="ph-avatar-mode">{modeLabel(modes[index])}</span>
                </button>
              ))}
              <button type="button" className="ph-play" onClick={playPause} aria-label={player.playing ? "pause" : "play"}>
                {player.playing ? "❚❚" : "▶"}
              </button>
            </div>
            <div className="ph-controls">
              <button type="button" className={`ph-control${player.speed !== 1 ? " is-on" : ""}`} onClick={() => player.setSpeed(SPEEDS[(SPEEDS.indexOf(player.speed) + 1) % SPEEDS.length])} title={t("سرعت پخش", "Playback speed")}>
                {player.speed}×
              </button>
              <button type="button" className={`ph-control${listMode ? "" : " is-on"}`} onClick={() => setListMode((value) => !value)} title={listMode ? t("لیست", "List") : t("دو پیام آخر", "Last two messages")}>
                {listMode ? "☰" : "⧉"}
              </button>
              <button type="button" className={`ph-control${hideAll ? " is-on" : ""}`} onClick={() => setHideAll((value) => !value)} title={t("نمایش یا پنهان‌کردن پیام‌ها", "Show or hide messages")}>
                {hideAll ? "◡" : "◉"}
              </button>
              <button
                type="button"
                className={`ph-control${translation !== "original" ? " is-on" : ""}`}
                onClick={() => setTranslation((value) => (value === "original" ? "sentence" : value === "sentence" ? "word" : "original"))}
                title={translationLabel}
              >
                {translation === "original" ? "Aa" : translation === "sentence" ? "فا" : "w/w"}
              </button>
              <button type="button" className={`ph-control${appearance ? " is-on" : ""}`} onClick={() => setAppearance((value) => !value)} title={t("تنظیمات ظاهر چت", "Chat appearance")}>
                ⚙
              </button>
            </div>
            {appearance && (
              <div className="ph-sheet">
                <strong>{t("ظاهر چت", "Chat appearance")}</strong>
                <button type="button" onClick={() => setFont((value) => (value + 1) % 3)}>
                  {t("اندازهٔ نوشته", "Text size")}: {[t("کوچک", "Small"), t("متوسط", "Medium"), t("بزرگ", "Large")][font]}
                </button>
                <button type="button" onClick={() => setDark((value) => !value)}>
                  {t("نور", "Brightness")}: {dark ? t("کم", "Dim") : t("عادی", "Normal")}
                </button>
                <button type="button" onClick={() => setPaper((value) => (value + 1) % PAPERS.length)}>
                  {t("پس‌زمینه", "Background")}: {t(PAPERS[paper].fa, PAPERS[paper].en)}
                </button>
                <button type="button" className="ph-sheet-close" onClick={() => setAppearance(false)}>
                  {t("بستن", "Close")}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="ph-learning">
            {tab === 1 &&
              draft.learning.words.map((word) => (
                <article key={word.id} className="ph-card">
                  <div className="ph-card-head" dir="ltr">
                    <strong>{word.text}</strong>
                    <span className="ph-ipa">{word.pronunciation.ipa}</span>
                  </div>
                  <div className="ph-reading">{word.pronunciation.faReading}</div>
                  <div>{word.meaning.fa}</div>
                  <Example text={word.example.text} fa={word.example.translation.fa} />
                </article>
              ))}
            {tab === 2 &&
              draft.learning.grammar.map((grammar) => (
                <article key={grammar.id} className="ph-card">
                  <strong>{grammar.title.fa}</strong>
                  <p>{grammar.explanation.fa}</p>
                  <Example text={grammar.example.text} fa={grammar.example.translation.fa} />
                  {grammar.tables.map((table, index) => (
                    <PhoneTable key={index} table={table} />
                  ))}
                  <div className="ph-takeaway">💡 {grammar.takeaway.fa}</div>
                </article>
              ))}
            {tab === 3 &&
              draft.learning.phrases.map((phrase) => (
                <article key={phrase.id} className="ph-card">
                  <div className="ph-card-head" dir="ltr">
                    <strong>{phrase.text}</strong>
                    <span className="ph-ipa">{phrase.pronunciation.ipa}</span>
                  </div>
                  <div className="ph-reading">{phrase.pronunciation.faReading}</div>
                  <div>{phrase.meaning.fa}</div>
                  <div className="ph-context">{phrase.context.fa}</div>
                  <Example text={phrase.example.text} fa={phrase.example.translation.fa} />
                </article>
              ))}
            {tab === 4 &&
              draft.learning.questions.map((question) => <QuestionCard key={question.id} question={question} onEvidence={() => playEvidence(question)} />)}
          </div>
        )}
      </PhoneFrame>
      <div className="preview-caption tiny muted">
        {t("روی هر پیام بزنید تا فقط همان نوبت پخش شود و درست در پایانش بایستد.", "Tap a message to replay just that turn — it must stop exactly at its end.")}
        {singleTurn !== null && (
          <>
            {" "}
            · {t("در حال پخش نوبت", "playing turn")} {singleTurn + 1}
          </>
        )}
        {" · "}
        <span dir="ltr">
          {formatMs(player.ms)} / {formatMs(player.durationMs)}
        </span>
      </div>
    </div>
  );
}

function ListeningWave({ listening, compact = false }: { listening: boolean; compact?: boolean }): React.ReactElement {
  const bars = compact ? 5 : 9;
  return (
    <span className={`ph-wave${compact ? " is-compact" : ""}${listening ? " is-listening" : ""}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} style={{ animationDelay: `${index * 0.11}s` }} />
      ))}
    </span>
  );
}

function Example({ text, fa }: { text: string; fa: string }): React.ReactElement {
  return (
    <div className="ph-example">
      <div dir="ltr">{text}</div>
      <div className="ph-meaning">{fa}</div>
    </div>
  );
}

function cellText(cell: ReetalkTableCell): { text: string; ltr: boolean } {
  return "text" in cell ? { text: cell.text, ltr: true } : { text: cell.fa, ltr: false };
}

function PhoneTable({ table }: { table: ReetalkTable }): React.ReactElement {
  return (
    <div className="ph-table-wrap">
      <div className="ph-table-title">{table.title.fa}</div>
      <table className="ph-table">
        <thead>
          <tr>
            {table.columns.map((column, index) => (
              <th key={index}>{column.fa}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => {
                const value = cellText(cell);
                return (
                  <td key={cellIndex} dir={value.ltr ? "ltr" : "rtl"}>
                    {value.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuestionCard({ question, onEvidence }: { question: ReetalkQuestion; onEvidence: () => void }): React.ReactElement {
  const { t } = useLang();
  const [answer, setAnswer] = useState<string | null>(null);
  const stage = { gist: t("برداشت کلی", "Gist"), detail: t("جزئیات", "Detail"), review: t("مرور", "Review") }[question.stage];
  return (
    <article className="ph-card">
      <span className="ph-chip">{stage}</span>
      <strong className="ph-question">{question.prompt.fa}</strong>
      {question.options.map((option) => {
        const marker = answer !== null && option.id === question.correctOptionId ? "✓ " : option.id === answer ? "✕ " : "";
        return (
          <button
            key={option.id}
            type="button"
            className={`ph-option${answer !== null && option.id === question.correctOptionId ? " is-correct" : ""}${option.id === answer && option.id !== question.correctOptionId ? " is-wrong" : ""}`}
            disabled={answer !== null}
            onClick={() => setAnswer(option.id)}
          >
            {marker}
            {option.text.fa}
          </button>
        );
      })}
      {answer !== null && (
        <>
          <p className="ph-explanation">{question.explanation.fa}</p>
          <button type="button" className="ph-evidence" onClick={onEvidence}>
            ▶ {t("شنیدن نوبت‌های شاهد", "Hear the evidence turns")}
          </button>
        </>
      )}
    </article>
  );
}

/* ================================================================== */
/* Song: lyric player                                                  */
/* ================================================================== */

function SongSimulator({ detail, draft, timings }: { detail: ProjectDetail; draft: DraftContent; timings: ResolvedTiming[] }): React.ReactElement {
  const { t } = useLang();
  const coverUrl = useCoverUrl(detail);
  const player = usePlayer(detail.summary.projectId, detail.media?.durationMs ?? 0);
  const [mode, setMode] = useState(0);
  const [dark, setDark] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const active = activeIndexAt(timings, player.ms);

  /* Auto-scroll the active line to the middle of the list. */
  useEffect(() => {
    const list = listRef.current;
    if (!list || active < 0) return;
    const row = list.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (row && typeof list.scrollTo === "function") list.scrollTo({ top: row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2, behavior: "smooth" });
  }, [active]);

  const progress = player.durationMs > 0 ? Math.min(100, (player.ms / player.durationMs) * 100) : 0;

  return (
    <div className="preview-phone-wrap">
      <PhoneFrame style={paletteStyle(0, dark)} dark={dark}>
        {player.audio}
        <div className="ph-song-head">
          {coverUrl ? <img src={coverUrl} alt="" /> : <div className="ph-song-cover-missing">♪</div>}
          <div>
            <strong dir="auto">{draft.title}</strong>
            <span dir="auto">{draft.artist ?? ""}</span>
          </div>
        </div>
        <div className="ph-pills">
          {[t("متن اصلی", "Original"), t("ترجمهٔ جمله", "Sentence"), t("کلمه‌به‌کلمه", "Word by word")].map((label, index) => (
            <button key={label} type="button" className={`ph-pill${mode === index ? " is-on" : ""}`} onClick={() => setMode(index)}>
              {label}
            </button>
          ))}
        </div>
        <div className="ph-lyrics" ref={listRef}>
          {draft.lyrics.map((line, index) => {
            const timing = timings[index];
            const playable = timing?.startMs !== null && timing?.endMs !== null;
            return (
              <div key={line.id} data-index={index} className={`ph-lyric${index === active ? " is-active" : ""}${playable ? "" : " is-untimed"}`} dir="ltr">
                <button
                  type="button"
                  className="ph-lyric-play"
                  disabled={!playable}
                  onClick={() => playable && player.playRange(timing.startMs as number, timing.endMs as number)}
                  title={playable ? `${formatMs(timing.startMs)} → ${formatMs(timing.endMs)}` : t("زمان ندارد", "untimed")}
                >
                  ▶
                </button>
                <div className="ph-lyric-body">
                  <div className="ph-words">
                    {(line.tokens.length > 0 ? line.tokens : [{ surface: line.text, translationFa: "", translationEn: "" }]).map((token, tokenIndex) => (
                      <span key={tokenIndex} className="ph-word">
                        <span className="ph-lyric-word">{token.surface}</span>
                        {mode === 2 && (
                          <span className="ph-gloss" dir="rtl">
                            {token.translationFa}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                  {mode === 1 && (
                    <div className="ph-meaning" dir="rtl">
                      {line.translationFa}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="ph-mini" dir="ltr">
          <button type="button" className="ph-play small" onClick={player.toggle} aria-label={player.playing ? "pause" : "play"}>
            {player.playing ? "❚❚" : "▶"}
          </button>
          <div
            className="ph-progress"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              player.seek(((event.clientX - rect.left) / rect.width) * player.durationMs);
            }}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <span className="ph-time">{formatMs(player.ms).slice(0, 5)}</span>
          <button type="button" className="ph-control" onClick={() => player.setSpeed(SPEEDS[(SPEEDS.indexOf(player.speed) + 1) % SPEEDS.length])}>
            {player.speed}×
          </button>
          <button type="button" className="ph-control" onClick={() => setDark((value) => !value)} title={t("روشن / تیره", "Light / dark")}>
            ◐
          </button>
        </div>
      </PhoneFrame>
      <div className="preview-caption tiny muted">
        {t("سطر فعال با زمان‌بندی خروجی جلو می‌رود؛ «▶» هر سطر فقط همان بازه را پخش می‌کند.", "The active line follows the exported timing; each ▶ plays only that line's range.")}{" "}
        <span dir="ltr">
          {formatMs(player.ms)} / {formatMs(player.durationMs)}
        </span>
      </div>
    </div>
  );
}
