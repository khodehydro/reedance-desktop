import React, { useEffect, useState } from "react";
import type { MediaInfo, ProjectDetail, ReetalkDraft } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { CoverBox } from "./CoverBox";
import { formatBytes, formatDate, formatSeconds, shortHash } from "../format";
import { Button, Callout, KeyValue, Mono, Section, useToast } from "./ui";

/**
 * Read-only overview for a ReeTalk dialogue project: the content arrives
 * validated from the content agent and is never edited here — only the
 * recorded audio and the mandatory cover are managed from this tab.
 */
export function ReeTalkOverviewTab({
  detail,
  content,
  reload,
  onOpenTimeline,
}: {
  detail: ProjectDetail;
  content: ReetalkDraft;
  reload: () => Promise<void>;
  onOpenTimeline: () => void;
}): React.ReactElement {
  const { t } = useLang();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCoverUrl(null);
    if (!detail.media?.coverPath) return undefined;
    void api.media.playUrl(detail.summary.projectId, "cover").then((url) => {
      if (active) setCoverUrl(url);
    });
    return () => {
      active = false;
    };
  }, [detail.media?.coverPath, detail.summary.projectId]);

  const selectAudio = async (): Promise<void> => {
    setBusy("audio");
    try {
      const outcome = await api.media.selectAudio(detail.summary.projectId);
      if (outcome) {
        toast.push(
          t(
            `صوت «${outcome.media.audioFileName}» کپی و ثبت شد. زمان‌های قبلی نیازمند بازبینی‌اند.`,
            `Audio "${outcome.media.audioFileName}" copied and recorded. Previous timings now need review.`,
          ),
          outcome.warnings.length ? "warn" : "ok",
        );
        for (const warning of outcome.warnings) toast.push(warning.message, "warn");
      }
      await reload();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const selectCover = async (): Promise<void> => {
    setBusy("cover");
    try {
      await api.media.selectCover(detail.summary.projectId);
      await reload();
      toast.push(t("کاور ثبت شد.", "Cover recorded."), "ok");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const removeCover = async (): Promise<void> => {
    setBusy("cover");
    try {
      await api.media.removeCover(detail.summary.projectId);
      await reload();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const media: MediaInfo | null = detail.media;
  const gates = detail.preflight.gates.filter((gate) => ["audio", "duration", "timed", "timing", "cover", "content"].includes(gate.key));
  const questionsByStage = {
    gist: content.learning.questions.filter((question) => question.stage === "gist").length,
    detail: content.learning.questions.filter((question) => question.stage === "detail").length,
    review: content.learning.questions.filter((question) => question.stage === "review").length,
  };
  const grammarTables = content.learning.grammar.reduce((total, card) => total + card.tables.length, 0);

  return (
    <div className="tab-body">
      <Section
        title={t("شناسنامهٔ مکالمه", "Dialogue identity")}
        description={t(
          "این مقادیر از پیش‌نویس محتوا می‌آیند و داخل dialogue.json بستهٔ نهایی می‌روند؛ در استودیو فقط‌خواندنی‌اند.",
          "These values come from the content agent's draft and ship inside dialogue.json; they are read-only here.",
        )}
      >
        <KeyValue
          items={[
            { label: t("عنوان", "title"), value: `${content.title.fa} — ${content.title.en}` },
            { label: "dialogueId", value: <Mono>{content.dialogueId}</Mono> },
            { label: "categoryId", value: <Mono>{content.categoryId}</Mono> },
            { label: t("زبان مقصد", "target"), value: <Mono>{content.targetLanguage} · {content.locale}</Mono> },
            { label: t("سطح", "level"), value: content.level },
            {
              label: t("گویندگان", "speakers"),
              value: content.speakers.map((speaker) => `${speaker.name} (${speaker.id}, ${speaker.gender})`).join(" · "),
            },
            { label: t("تعداد نوبت", "turns"), value: `${content.turns.length}` },
            { label: t("هدف آموزشی", "objective"), value: `${content.objective.fa} — ${content.objective.en}` },
          ]}
        />
        <p className="tiny">
          {t("شناسهٔ خام:", "Raw snapshot:")} <Mono title={detail.rawJsonPath}>{shortHash(detail.rawSha256)}</Mono> ·{" "}
          {t("دسته‌های ثبت‌شده:", "recorded revision snapshots:")} {detail.revisionCount} ·{" "}
          {t("نسخهٔ محتوا:", "content version:")} v{String(detail.preflight.nextVersionCode).padStart(6, "0")}
        </p>
      </Section>

      <Section
        title={t("صوت ضبط‌شده و کاور", "Recorded audio and cover")}
        description={t(
          "خروجی ری‌تاک دقیقاً سه فایل دارد: dialogue.json، صوت گویندگان و یک کاور. کاور برای ری‌تاک الزامی است.",
          "A ReeTalk pack holds exactly three files: dialogue.json, the recorded dialogue audio and one cover. The cover is mandatory.",
        )}
        actions={
          <Button variant="primary" size="sm" onClick={() => void selectAudio()} disabled={busy !== null}>
            {media ? t("تعویض صوت", "Replace audio") : t("انتخاب صوت ضبط‌شده", "Select recorded audio")}
          </Button>
        }
      >
        {media ? (
          <div className="media-grid">
            <KeyValue
              items={[
                { label: t("نام فایل", "file"), value: <Mono>{media.audioFileName}</Mono> },
                { label: t("منبع اصلی", "source"), value: media.sourceName },
                { label: t("نوع", "mime"), value: media.mimeType },
                { label: t("حجم", "size"), value: formatBytes(media.bytes) },
                { label: t("مدت", "duration"), value: `${formatSeconds(media.durationMs)} (${media.durationMs} ms)` },
                { label: t("هش SHA-256", "sha256"), value: <Mono title={media.audioSha256}>{shortHash(media.audioSha256)}</Mono> },
                { label: t("وارد‌شده در", "imported"), value: formatDate(media.importedAt) },
              ]}
            />
            <CoverBox
              coverUrl={coverUrl}
              media={detail.media}
              busy={busy !== null}
              onSelect={() => void selectCover()}
              onRemove={() => void removeCover()}
            />
          </div>
        ) : (
          <Callout tone="warn" title={t("صوت هنوز انتخاب نشده است", "No audio selected yet")}>
            {t(
              "تا انتخاب صوت گویندگان، تایم‌لاین و خروجی قفل‌اند. فایل خام ایجنت هرگز صوت ندارد؛ صوت را خودت ضبط و انتخاب می‌کنی.",
              "Timeline and export stay locked until the recorded dialogue audio is selected. The agent draft never ships audio; you record and select it here.",
            )}
          </Callout>
        )}
        {!media?.coverPath ? (
          <Callout tone="bad" title={t("کاور الزامی است", "Cover is mandatory")}>
            {t(
              "بستهٔ ری‌تاک بدون کاور ساخته نمی‌شود: یک تصویر مجوزدار با نسبت تقریبی ۵:۳ انتخاب کن.",
              "No cover, no ReeTalk pack: pick a licensed image at roughly a 5:3 ratio.",
            )}
          </Callout>
        ) : null}
      </Section>

      <Section
        title={t("بلوک‌های یادگیری", "Learning blocks")}
        description={t(
          "خلاصهٔ محتوای آموزشی مکالمه؛ ویرایش در استودیو انجام نمی‌شود.",
          "Summary of the dialogue's learning content; it is not edited in the studio.",
        )}
      >
        <div className="stat-grid">
          <div className="stat-tile">
            <span className="stat-value">{content.learning.words.length}</span>
            <span className="stat-label">{t("واژه", "words")}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{content.learning.grammar.length}</span>
            <span className="stat-label">{t("دستور زبان (+ جدول)", "grammar (+tables)")}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{content.learning.phrases.length}</span>
            <span className="stat-label">{t("عبارت", "phrases")}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{content.turns.length}</span>
            <span className="stat-label">{t("نوبت گفت‌وگو", "dialogue turns")}</span>
          </div>
        </div>
        <p className="tiny">
          {t("جدول‌های دستور زبان:", "grammar tables:")} {grammarTables} · {t("سؤال‌ها:", "questions:")}{" "}
          {t(`درک کلی ${questionsByStage.gist} · جزئی ${questionsByStage.detail} · مرور ${questionsByStage.review}`, `gist ${questionsByStage.gist} · detail ${questionsByStage.detail} · review ${questionsByStage.review}`)}
        </p>
      </Section>

      <Section
        title={t("آمادگی خروجی", "Export readiness")}
        actions={
          <Button size="sm" variant="ghost" onClick={onOpenTimeline}>
            {t("رفتن به تایم‌لاین", "Open timeline")}
          </Button>
        }
      >
        <ul className="gate-list">
          {gates.map((gate) => (
            <li key={gate.key} className={gate.ok ? "gate-ok" : "gate-blocked"}>
              <span className="gate-dot">{gate.ok ? "✓" : "•"}</span>
              <span className="gate-label">{t(gate.labelFa, gate.labelEn)}</span>
              <span className="gate-detail">{gate.detail}</span>
            </li>
          ))}
        </ul>
        {detail.issues.length ? (
          <Callout tone="bad" title={t(`${detail.issues.length} خطای محتوایی`, `${detail.issues.length} content errors`)}>
            <ul className="issue-list">
              {detail.issues.slice(0, 12).map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  <Mono>{issue.path}</Mono> {issue.message}
                </li>
              ))}
            </ul>
          </Callout>
        ) : null}
        {detail.warnings.length ? (
          <Callout tone="warn" title={t("هشدارها", "Warnings")}>
            <ul className="issue-list">
              {detail.warnings.slice(0, 8).map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  <Mono>{issue.path}</Mono> {issue.message}
                </li>
              ))}
            </ul>
          </Callout>
        ) : null}
      </Section>
    </div>
  );
}
