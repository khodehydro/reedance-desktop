import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isReeTalkContent, type DraftContent, type ProjectContent, type ProjectDetail } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { OverviewTab } from "./OverviewTab";
import { ReeTalkOverviewTab } from "./ReeTalkOverviewTab";
import { LyricsTab } from "./LyricsTab";
import { StoryTab } from "./StoryTab";
import { TimelineTab, type TimelineLine } from "./TimelineTab";
import { LearningTab } from "./LearningTab";
import { QuizTab } from "./QuizTab";
import { ReviewExportTab } from "./ReviewExportTab";
import { Badge, Button, Callout, Spinner, Tabs, useToast } from "./ui";

export type UpdateContent = (mutator: (draft: DraftContent) => void) => void;

const STATE_LABEL: Record<string, { fa: string; en: string; tone: "muted" | "info" | "warn" | "ok" }> = {
  "raw-imported": { fa: "پیش‌نویس وارد‌شده", en: "raw imported", tone: "muted" },
  "audio-selected": { fa: "صوت انتخاب‌شده", en: "audio selected", tone: "info" },
  "sync-incomplete": { fa: "سینک ناتمام", en: "sync incomplete", tone: "warn" },
  "review-ready": { fa: "آمادهٔ خروجی", en: "ready to export", tone: "info" },
  approved: { fa: "آمادهٔ خروجی", en: "ready to export", tone: "ok" },
};

type TabId = "overview" | "timeline" | "lyrics" | "story" | "learning" | "quiz" | "review";

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
  const { t } = useLang();
  const toast = useToast();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [content, setContent] = useState<ProjectContent | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const pendingRef = useRef<DraftContent | null>(null);

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
    pendingRef.current = content as DraftContent;
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

  const reload = useCallback(async () => {
    await flush();
    await load();
  }, [flush, load]);

  // Stable timeline rows for ReeTalk projects (new identity only when the
  // content or marks actually change — TimelineTab resyncs on identity).
  const turnLines: TimelineLine[] = useMemo(() => {
    if (!content || !isReeTalkContent(content)) return [];
    return content.turns.map((turn) => ({
      id: turn.id,
      text: turn.text,
      translationEn: turn.translation.en,
      badge: turn.speakerId,
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
                { id: "review", label: t("خروجی", "Export") },
              ]
        }
      />

      {tab === "overview" && reetalk ? (
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
      ) : (
        <ReviewExportTab
          detail={detail}
          onChanged={reload}
          onOpenTimeline={() => setTab("timeline")}
          onOpenStats={onOpenStats}
        />
      )}
    </div>
  );
}
