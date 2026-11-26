import React, { useEffect, useState } from "react";
import type { DraftContent, ProjectDetail } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { CoverBox } from "./CoverBox";
import { formatBytes, formatDate, formatSeconds, shortHash } from "../format";
import { Button, Callout, Field, KeyValue, Mono, Section, Select, TextArea, TextInput, useToast } from "./ui";
import type { UpdateContent } from "./ProjectPage";

export function OverviewTab({
  detail,
  content,
  update,
  reload,
  onOpenTimeline,
}: {
  detail: ProjectDetail;
  content: DraftContent;
  update: UpdateContent;
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

  const media = detail.media;
  // Only the technical gates are shown: review flags, the rights checklist and
  // the approval are no longer part of the workflow.
  const gates = detail.preflight.gates.filter((gate) =>
    ["audio", "duration", "timed", "timing", "content"].includes(gate.key),
  );

  return (
    <div className="tab-body">
      <Section
        title={t("صوت انتخاب‌شده از سیستم", "Audio selected from this computer")}
        description={t(
          "فایل در پوشهٔ پروژه کپی می‌شود؛ حذف یا تعویض فایل مبدأ بعداً صدای خروجی را تغییر نمی‌دهد.",
          "The file is copied into the project folder; deleting or replacing the original later cannot change the export.",
        )}
        actions={
          <Button variant="primary" size="sm" onClick={() => void selectAudio()} disabled={busy !== null}>
            {media ? t("تعویض صوت", "Replace audio") : t("انتخاب فایل آهنگ", "Select audio file")}
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
              "تا انتخاب صوت، تایم‌لاین و خروجی قفل‌اند؛ اما همهٔ محتوای آموزشی همین حالا قابل ویرایش است. فایل خام ایجنت هرگز صوت ندارد.",
              "Timeline and export stay locked until audio is selected, but all lesson content is already editable. The agent draft never contains audio.",
            )}
          </Callout>
        )}
      </Section>

      <Section
        title={t("شناسنامه و اعتبارها", "Identity and credits")}
        description={t(
          "این مقادیر در lesson.json داخل بستهٔ نهایی می‌روند؛ عنوان/هنرمند/سطح الزامی‌اند.",
          "These values go into lesson.json inside the final pack; title, artist and level are required.",
        )}
      >
        <div className="form-grid">
          <Field label="title">
            <TextInput value={content.title} onChange={(value) => update((draft) => void (draft.title = value))} />
          </Field>
          <Field label="artist" hint={t("برای export الزامی", "required for export")}>
            <TextInput
              value={content.artist ?? ""}
              onChange={(value) => update((draft) => void (draft.artist = value))}
            />
          </Field>
          <Field
            label="level"
            hint={content.level ? undefined : t("در پیش‌نویس تعیین نشده؛ قبل از خروجی یکی را انتخاب کنید", "not set in the draft; choose one before export")}
          >
            <Select
              value={content.level ?? ""}
              onChange={(value) => update((draft) => void (draft.level = value === "" ? undefined : value))}
              options={[
                ...(content.level ? [] : [{ value: "" as const, label: t("— انتخاب کنید —", "— choose —") }]),
                ...(["A1", "A2", "B1", "B2", "C1", "C2"] as const).map((item) => ({ value: item, label: item })),
              ]}
            />
          </Field>
          <Field label="locale" hint={t("مثل en-GB یا es-ES", "e.g. en-GB or es-ES")}>
            <TextInput value={content.locale} onChange={(value) => update((draft) => void (draft.locale = value))} mono />
          </Field>
          <Field label={t("اعتبار متن", "lyrics credit")} wide>
            <TextInput
              value={content.credits?.lyrics ?? ""}
              onChange={(value) =>
                update((draft) => {
                  draft.credits = { ...(draft.credits ?? {}), lyrics: value };
                })
              }
            />
          </Field>
          <Field label={t("یادداشت انتشار (فارسی)", "notice (FA)")} wide>
            <TextArea
              value={content.credits?.noticeFa ?? ""}
              rows={2}
              dir="rtl"
              onChange={(value) =>
                update((draft) => {
                  draft.credits = { ...(draft.credits ?? {}), noticeFa: value };
                })
              }
            />
          </Field>
          <Field label={t("یادداشت انتشار (انگلیسی)", "notice (EN)")} wide>
            <TextArea
              value={content.credits?.noticeEn ?? ""}
              rows={2}
              dir="ltr"
              onChange={(value) =>
                update((draft) => {
                  draft.credits = { ...(draft.credits ?? {}), noticeEn: value };
                })
              }
            />
          </Field>
          <Field label={t("سلب مسئولیت فارسی", "disclaimer FA")} wide>
            <TextArea
              value={content.disclaimerFa ?? ""}
              rows={2}
              dir="rtl"
              onChange={(value) => update((draft) => void (draft.disclaimerFa = value))}
            />
          </Field>
          <Field label={t("سلب مسئولیت انگلیسی", "disclaimer EN")} wide>
            <TextArea
              value={content.disclaimerEn ?? ""}
              rows={2}
              dir="ltr"
              onChange={(value) => update((draft) => void (draft.disclaimerEn = value))}
            />
          </Field>
          <Field label={t("یادداشت داخلی پروژه", "internal notes")} wide hint={t("در بستهٔ نهایی نمی‌رود.", "never shipped in the pack.")}>
            <TextArea value={content.notes ?? ""} rows={2} onChange={(value) => update((draft) => void (draft.notes = value))} />
          </Field>
        </div>
      </Section>

      <Section
        title={t("ادعای منبع فایل خام", "Source claims from the raw draft")}
        description={t(
          "این فقط ادعای ایجنت است، نه مجوز انتشار. مدرک حقوق صوت/متن در تب بازبینی ثبت می‌شود.",
          "This is the agent's claim, not a licence. Audio/text evidence is recorded in the review tab.",
        )}
      >
        <div className="two-col">
          <div className="mini-panel">
            <h3>{t("متن", "Lyrics")}</h3>
            <p>{content.sources.lyrics.description}</p>
            <div className="row gap-sm">
              <Mono>{content.sources.lyrics.rightsStatus}</Mono>
              {content.sources.lyrics.sourceReference ? <Mono>{content.sources.lyrics.sourceReference}</Mono> : null}
            </div>
          </div>
          <div className="mini-panel">
            <h3>{t("درس", "Lesson")}</h3>
            <p>{content.sources.lesson.description}</p>
            <div className="row gap-sm">
              <Mono>{content.sources.lesson.rightsStatus}</Mono>
              {content.sources.lesson.sourceReference ? <Mono>{content.sources.lesson.sourceReference}</Mono> : null}
            </div>
          </div>
        </div>
        <p className="tiny">
          {t("شناسهٔ خام:", "Raw snapshot:")} <Mono title={detail.rawJsonPath}>{shortHash(detail.rawSha256)}</Mono> ·{" "}
          {t("دسته‌های ثبت‌شده:", "recorded revision snapshots:")} {detail.revisionCount}
        </p>
      </Section>

      <Section title={t("آمادگی خروجی", "Export readiness")} actions={
        <Button size="sm" variant="ghost" onClick={onOpenTimeline}>
          {t("رفتن به تایم‌لاین", "Open timeline")}
        </Button>
      }>
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
