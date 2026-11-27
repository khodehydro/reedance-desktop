import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { alternateLineLanguage, isReeTalkContent, type DraftContent, type ProjectContent, type ProjectDetail, type ReetalkDraft, type ReplaceDraftOutcome } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { OverviewTab } from "./OverviewTab";
import { ReeTalkOverviewTab } from "./ReeTalkOverviewTab";
import { ReeTalkDialogueTab, ReeTalkLearningTab, type UpdateReeTalk } from "./ReeTalkEditors";
import { SegmentAudioProvider, type SegmentUnit } from "./SegmentAudio";
import { languageName } from "../lineLanguage";
import { LyricsTab } from "./LyricsTab";
import { StoryTab } from "./StoryTab";
import { TimelineTab, type TimelineLine } from "./TimelineTab";
import { LearningTab } from "./LearningTab";
import { QuizTab } from "./QuizTab";
import { ReviewExportTab } from "./ReviewExportTab";
import { PreviewTab } from "./PreviewTab";
import { Badge, Button, Callout, Modal, Spinner, Tabs, useToast } from "./ui";

export type UpdateContent = (mutator: (draft: DraftContent) => void) => void;

const STATE_LABEL: Record<string, { fa: string; en: string; tone: "muted" | "info" | "warn" | "ok" }> = {
  "raw-imported": { fa: "پیش‌نویس وارد‌شده", en: "raw imported", tone: "muted" },
  "audio-selected": { fa: "صوت انتخاب‌شده", en: "audio selected", tone: "info" },
  "sync-incomplete": { fa: "سینک ناتمام", en: "sync incomplete", tone: "warn" },
  "review-ready": { fa: "آمادهٔ خروجی", en: "ready to export", tone: "info" },
  approved: { fa: "آمادهٔ خروجی", en: "ready to export", tone: "ok" },
};

type TabId = "overview" | "timeline" | "lyrics" | "story" | "learning" | "quiz" | "dialogue" | "talk-learning" | "preview" | "review";

export function ProjectPage({
  projectId,
  onBack,
  onRefreshLibrary,
  onOpenStats,
}: {
  projectId: string;
  onBack: () => void;
  onRefreshLibrary: () => Promise<void>;
  onOpenStats: () => void;
}): React.ReactElement {
  const { t, lang } = useLang();
  const toast = useToast();
  const [replaced, setReplaced] = useState<ReplaceDraftOutcome | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [content, setContent] = useState<ProjectContent | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const pendingRef = useRef<ProjectContent | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.projects.get(projectId);
      setDetail(next);
      if (!dirtyRef.current) setContent(next.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flush = useCallback(async (): Promise<ProjectDetail | null> => {
    const payload = pendingRef.current;
    if (!payload) return null;
    pendingRef.current = null;
    setSaveState("saving");
    try {
      const next = await api.projects.saveContent(projectId, payload);
      dirtyRef.current = false;
      setDetail(next);
      setSaveState("saved");
      void onRefreshLibrary();
      return next;
    } catch (err) {
      setSaveState("error");
      toast.push(err instanceof Error ? err.message : String(err), "bad");
      return null;
    }
  }, [onRefreshLibrary, projectId, toast]);

  useEffect(() => {
    if (!content || !dirtyRef.current) return undefined;
    pendingRef.current = content;
    setSaveState("dirty");
    const timer = setTimeout(() => {
      void flush();
    }, 800);
    return () => clearTimeout(timer);
  }, [content, flush]);

  const update: UpdateContent = useCallback((mutator) => {
    setContent((current) => {
      if (!current || isReeTalkContent(current)) return current;
      const next = structuredClone(current) as DraftContent;
      mutator(next);
      dirtyRef.current = true;
      pendingRef.current = next;
      return next;
    });
  }, []);

  // ReeTalk content is edited the same way (identity fields stay fixed on the server).
  const updateTalk: UpdateReeTalk = useCallback((mutator) => {
    setContent((current) => {
      if (!current || !isReeTalkContent(current)) return current;
      const next = structuredClone(current) as ReetalkDraft;
      mutator(next);
      dirtyRef.current = true;
      pendingRef.current = next;
      return next;
    });
  }, []);

  /** Replace the JSON (like replacing the audio): same song/dialogue, new content, next export = new version. */
  const replaceJson = useCallback(async () => {
    setReplacing(true);
    try {
      await flush();
      const outcome = await api.projects.replaceDraft(projectId);
      if (!outcome) return;
      dirtyRef.current = false;
      pendingRef.current = null;
      setDetail(outcome.detail);
      setContent(outcome.detail.content);
      setSaveState("idle");
      setReplaced(outcome);
      void onRefreshLibrary();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "bad");
    } finally {
      setReplacing(false);
    }
  }, [flush, onRefreshLibrary, projectId, toast]);

  // Lines / turns the "play this part" buttons can reach.
  const segmentUnits: SegmentUnit[] = useMemo(() => {
    if (!content) return [];
    if (isReeTalkContent(content)) {
      const speakerName = new Map(content.speakers.map((speaker) => [speaker.id, speaker.name]));
      return content.turns.map((turn, index) => ({ id: turn.id, number: index + 1, text: turn.text, badge: speakerName.get(turn.speakerId) ?? turn.speakerId }));
    }
    return content.lyrics.map((line, index) => {
      const foreign = alternateLineLanguage(content.targetLanguage, line);
      return { id: line.id, number: index + 1, text: line.text, badge: foreign ? languageName(foreign, lang) : undefined, locked: !!foreign };
    });
  }, [content, lang]);

  const reload = useCallback(async () => {
    await flush();
    await load();
  }, [flush, load]);

  // Stable timeline rows for ReeTalk projects (new identity only when the
  // content or marks actually change — TimelineTab resyncs on identity).
  const turnLines: TimelineLine[] = useMemo(() => {
    if (!content || !isReeTalkContent(content)) return [];
    const speakerIndex = new Map(content.speakers.map((speaker, index) => [speaker.id, index]));
    const speakerName = new Map(content.speakers.map((speaker) => [speaker.id, speaker.name]));
    return content.turns.map((turn) => ({
      id: turn.id,
      text: turn.text,
      translationEn: turn.translation.en,
      translationFa: turn.translation.fa,
      badge: speakerName.get(turn.speakerId) ?? turn.speakerId,
      tone: (speakerIndex.get(turn.speakerId) === 1 ? 1 : 0) as 0 | 1,
    }));
  }, [content]);

  if (error) {
    return (
      <div className="page">
        <Callout tone="bad" title={t("بارگذاری پروژه ناموفق بود", "Could not load the project")}>
          {error}
        </Callout>
        <Button onClick={onBack}>{t("بازگشت", "Back")}</Button>
      </div>
    );
  }

  if (!detail || !content) {
    return (
      <div className="page">
        <Spinner label={t("بارگذاری پروژه…", "Loading project…")} />
      </div>
    );
  }

  const reetalk = isReeTalkContent(content);
  const summary = detail.summary;
  const state = STATE_LABEL[summary.state] ?? STATE_LABEL["raw-imported"];
  const pageTitle = reetalk ? content.title.fa : content.title || summary.songId;
  const pageLevel = content.level || "—";

  return (
    <div className="page project-page">
      <div className="page-head project-head">
        <div className="project-head-main">
          <button className="crumb-back" onClick={onBack}>
            ‹ {t("کتابخانه", "Library")}
          </button>
          <h1>{pageTitle}</h1>
          <div className="project-sub">
            <span className="mono">{summary.songId}</span>
            <span>·</span>
            <span>{summary.targetLanguage.toUpperCase()}</span>
            <span>·</span>
            <span>{summary.locale}</span>
            <span>·</span>
            <span>{pageLevel}</span>
            {reetalk ? (
              <>
                <span>·</span>
                <span>{t("ری‌تاک", "ReeTalk")}</span>
              </>
            ) : null}
            {detail.media ? (
              <>
                <span>·</span>
                <span>{detail.media.audioFileName}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="project-head-actions">
          <Badge tone={state.tone}>{t(state.fa, state.en)}</Badge>
          <Badge tone={summary.reviewedCount === summary.lineCount ? "ok" : "muted"}>
            {reetalk
              ? t(`زمان‌گذاری ${summary.timedCount}/${summary.lineCount}`, `timed ${summary.timedCount}/${summary.lineCount}`)
              : t(`بازبینی ${summary.reviewedCount}/${summary.lineCount}`, `reviewed ${summary.reviewedCount}/${summary.lineCount}`)}
          </Badge>
          <span className={`save-pill save-${saveState}`}>
            {saveState === "saving"
              ? t("ذخیره…", "saving…")
              : saveState === "saved"
                ? t("ذخیره شد", "saved")
                : saveState === "dirty"
                  ? t("تغییر ذخیره‌نشده", "unsaved")
                  : saveState === "error"
                    ? t("خطای ذخیره", "save error")
                    : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void replaceJson()}
            disabled={replacing}
            title={t(
              "یک JSON تازه برای همین آهنگ/مکالمه انتخاب کنید؛ صوت، کاور و زمان سطرهای بدون تغییر حفظ می‌شود و خروجی بعدی نسخهٔ جدید می‌گیرد.",
              "Pick an updated JSON for the same song/dialogue; audio, cover and the timing of unchanged lines are kept and the next export gets a new version.",
            )}
          >
            ⟳ {t("جایگزینی JSON", "Replace JSON")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTab("preview")} title={t("پیش‌نمایش شبیه صفحهٔ اندروید، قبل از خروجی", "Android-style preview before exporting")}>
            📱 {t("شبیه‌ساز", "Simulator")}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setTab("review")}>
            {t("بازبینی و خروجی", "Review & export")}
          </Button>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={
          reetalk
            ? [
                { id: "overview", label: t("نمای کلی و صوت", "Overview & audio") },
                { id: "timeline", label: t("تایم‌لاین", "Timeline"), badge: `${summary.timedCount}/${summary.lineCount}` },
                { id: "dialogue", label: t("گفت‌وگو و نوبت‌ها", "Dialogue & turns"), badge: content.turns.length },
                {
                  id: "talk-learning",
                  label: t("آموزش و سؤال", "Learning & questions"),
                  badge: content.learning.words.length + content.learning.grammar.length + content.learning.phrases.length + content.learning.questions.length,
                },
                { id: "preview", label: t("شبیه‌ساز اندروید", "Android simulator") },
                { id: "review", label: t("خروجی", "Export") },
              ]
            : [
                { id: "overview", label: t("نمای کلی و صوت", "Overview & audio") },
                { id: "timeline", label: t("تایم‌لاین", "Timeline"), badge: `${summary.timedCount}/${summary.lineCount}` },
                { id: "lyrics", label: t("متن و واژه", "Lyrics") },
                {
                  id: "story",
                  label: t("داستان", "Story"),
                  badge: isReeTalkContent(content) ? 0 : content.story?.pages.reduce((sum, page) => sum + page.lines.length, 0) ?? 0,
                },
                { id: "learning", label: t("آموزش", "Learning") },
                { id: "quiz", label: t("آزمون", "Quiz"), badge: isReeTalkContent(content) ? 0 : content.questions.length },
                { id: "preview", label: t("شبیه‌ساز اندروید", "Android simulator") },
                { id: "review", label: t("خروجی", "Export") },
              ]
        }
      />

      <SegmentAudioProvider
        projectId={projectId}
        units={segmentUnits}
        marks={detail.marks}
        durationMs={detail.media?.durationMs ?? 0}
        hasAudio={!!detail.media}
        audioSha={detail.media?.audioSha256 ?? null}
      >
      {tab === "dialogue" && reetalk ? (
        <ReeTalkDialogueTab content={content} update={updateTalk} issues={[...detail.issues, ...detail.warnings]} />
      ) : tab === "talk-learning" && reetalk ? (
        <ReeTalkLearningTab content={content} update={updateTalk} issues={[...detail.issues, ...detail.warnings]} />
      ) : tab === "overview" && reetalk ? (
        <ReeTalkOverviewTab
          detail={detail}
          content={content}
          reload={reload}
          onOpenTimeline={() => setTab("timeline")}
        />
      ) : tab === "overview" ? (
        <OverviewTab detail={detail} content={content as DraftContent} update={update} reload={reload} onOpenTimeline={() => setTab("timeline")} />
      ) : tab === "timeline" ? (
        <TimelineTab
          detail={detail}
          content={reetalk ? null : (content as DraftContent)}
          lines={reetalk ? turnLines : undefined}
          onChanged={reload}
        />
      ) : tab === "lyrics" ? (
        <LyricsTab content={content as DraftContent} update={update} />
      ) : tab === "story" ? (
        <StoryTab projectId={projectId} content={content as DraftContent} update={update} media={detail.media} onChanged={reload} />
      ) : tab === "learning" ? (
        <LearningTab content={content as DraftContent} update={update} />
      ) : tab === "quiz" ? (
        <QuizTab content={content as DraftContent} update={update} />
      ) : tab === "preview" ? (
        <PreviewTab detail={detail} content={content} onOpenTimeline={() => setTab("timeline")} onOpenExport={() => setTab("review")} />
      ) : (
        <ReviewExportTab
          detail={detail}
          onChanged={reload}
          onOpenTimeline={() => setTab("timeline")}
          onOpenStats={onOpenStats}
        />
      )}
      </SegmentAudioProvider>

      <Modal
        open={!!replaced}
        title={t("JSON جایگزین شد", "JSON replaced")}
        onClose={() => setReplaced(null)}
        footer={
          <>
            <Button onClick={() => setReplaced(null)}>{t("بستن", "Close")}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setReplaced(null);
                setTab("timeline");
              }}
            >
              {t("رفتن به تایم‌لاین", "Open the timeline")}
            </Button>
          </>
        }
      >
        {replaced ? (
          <div className="stack">
            <div className="replace-stats">
              <div><b>{replaced.total}</b><span>{reetalk ? t("نوبت", "turns") : t("سطر", "lines")}</span></div>
              <div className="is-ok"><b>{replaced.timingsKept}</b><span>{t("زمان حفظ شد", "timings kept")}</span></div>
              <div className={replaced.added ? "is-warn" : ""}><b>{replaced.added}</b><span>{t("جدید (نیاز به زمان)", "new (need timing)")}</span></div>
              <div className={replaced.changed ? "is-warn" : ""}><b>{replaced.changed}</b><span>{t("تغییرکرده (نیاز به بازبینی)", "changed (need review)")}</span></div>
              <div><b>{replaced.removed}</b><span>{t("حذف شد", "removed")}</span></div>
            </div>
            <Callout tone="info" title={t(`خروجی بعدی: نسخهٔ ${replaced.nextVersionCode}`, `Next export: version ${replaced.nextVersionCode}`)}>
              {t(
                "صوت و کاور دست‌نخورده ماندند. تأیید قبلی باطل شد؛ بعد از بررسی تایم‌لاین دوباره خروجی بگیرید تا نسخهٔ جدید ساخته شود.",
                "Audio and cover are untouched. The previous approval was cleared; check the timeline and export again to build the new version.",
              )}
            </Callout>
            {replaced.warnings > 0 ? (
              <Callout tone="warn" title={t(`${replaced.warnings} هشدار`, `${replaced.warnings} warning(s)`)}>
                {t("جزئیات در بخش نمای کلی / خروجی آمده است.", "See the overview / export tab for details.")}
              </Callout>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
