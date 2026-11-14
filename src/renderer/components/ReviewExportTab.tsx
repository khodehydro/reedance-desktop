import React, { useState } from "react";
import type { ExportOutcome, ExportSummary, ProjectDetail } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatBytes, formatDate, shortHash } from "../format";
import { Badge, Button, Callout, CopyButton, Field, Mono, Section, TextInput, useToast } from "./ui";

/**
 * Export is one button.
 *
 * Keys, version and the manifest base URL are resolved by the main process, so
 * there is no key picker, no approval ceremony and no gate checklist here. The
 * only things that stop an export are the ones that would make the package
 * wrong: missing audio, unmeasured duration, untimed or out-of-order lines, or
 * invalid lesson content — and those are reported as a short sentence.
 */
export function ReviewExportTab({
  detail,
  onChanged,
  onOpenTimeline,
}: {
  detail: ProjectDetail;
  onChanged: () => Promise<void>;
  onOpenTimeline: () => void;
  onOpenStats?: () => void;
}): React.ReactElement {
  const { t } = useLang();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportOutcome | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [displayVersion, setDisplayVersion] = useState("1.0.0");
  const [manifestBaseUrl, setManifestBaseUrl] = useState("");
  const [filling, setFilling] = useState(false);
  const [password, setPasswordState] = useState("");

  React.useEffect(() => {
    void api.keys.password().then(setPasswordState);
  }, []);

  const lineCount = detail.content.lyrics.length;
  const timedCount = detail.marks.filter((mark) => mark.startMs !== null).length;
  const audioReady = !!detail.media && detail.media.durationMs > 0;
  const ready = audioReady && timedCount === lineCount && lineCount > 0;

  const runExport = async (): Promise<void> => {
    setBusy(true);
    try {
      const outcome = await api.exports.quick(detail.summary.projectId, {
        displayVersion: advanced ? displayVersion.trim() || undefined : undefined,
        manifestBaseUrl: advanced ? manifestBaseUrl.trim() : undefined,
      });
      setResult(outcome);
      await onChanged();
      toast.push(
        t(
          `فایل خروجی ساخته شد: ${outcome.packPath.split(/[\\/]/).pop() ?? ""}`,
          `Export written: ${outcome.packPath.split(/[\\/]/).pop() ?? ""}`,
        ),
        "ok",
      );
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(false);
    }
  };

  const fillTimings = async (): Promise<void> => {
    setFilling(true);
    try {
      await api.marks.distribute(detail.summary.projectId);
      await onChanged();
      toast.push(
        t(
          "زمان‌ها یکنواخت توزیع شد. اگر جایی دقیق نیست، در تایم‌لاین اصلاح کنید.",
          "Times were spread evenly. Adjust anything that feels off in the timeline.",
        ),
        "ok",
      );
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setFilling(false);
    }
  };

  const openFolder = async (target: string): Promise<void> => {
    try {
      await api.app.showItemInFolder(target);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    }
  };

  const exports: ExportSummary[] = detail.exports;

  return (
    <div className="tab-body">
      <Section
        title={t("ساخت فایل خروجی", "Build the output file")}
        description={t(
          "یک کلیک: بستهٔ .rdpack به‌همراه latest.json امضاشده در پوشهٔ آرشیو ساخته می‌شود. کلیدها و نسخه را خود برنامه مدیریت می‌کند.",
          "One click: the .rdpack plus a signed latest.json are written to the archive folder. The app manages the keys and the version.",
        )}
      >
        <div className="export-hero">
          <div className="export-hero-text">
            <div className="export-checks">
              <Badge tone={audioReady ? "ok" : "warn"}>
                {audioReady ? t("صوت آماده", "audio ready") : t("صوت انتخاب نشده", "no audio yet")}
              </Badge>
              <Badge tone={timedCount === lineCount ? "ok" : "warn"}>
                {t(`${timedCount}/${lineCount} سطر زمان‌دار`, `${timedCount}/${lineCount} lines timed`)}
              </Badge>
              <Badge tone="info">{t(`نسخهٔ بعدی: ${detail.preflight.nextVersionCode}`, `next version: ${detail.preflight.nextVersionCode}`)}</Badge>
            </div>
            <p className="muted tiny">
              {ready
                ? t(
                    "همه‌چیز آماده است؛ دکمه را بزنید.",
                    "Everything needed is in place — press the button.",
                  )
                : audioReady
                  ? t(
                      "برای خروجی، همهٔ سطرها باید زمان شروع داشته باشند.",
                      "Every lyric line needs a start time before exporting.",
                    )
                  : t(
                      "اول فایل صوتی را از سیستم انتخاب کنید.",
                      "Select the audio file from your system first.",
                    )}
            </p>
          </div>
          <div className="export-hero-actions">
            {!audioReady ? (
              <Button variant="ghost" onClick={onOpenTimeline}>
                {t("رفتن به صوت و تایم‌لاین", "Go to audio & timeline")}
              </Button>
            ) : timedCount !== lineCount ? (
              <>
                <Button variant="ghost" onClick={onOpenTimeline}>
                  {t("رفتن به تایم‌لاین", "Go to the timeline")}
                </Button>
                <Button onClick={() => void fillTimings()} disabled={filling}>
                  {filling
                    ? t("در حال پرکردن…", "Filling…")
                    : t(`پرکردن خودکار ${lineCount - timedCount} سطر`, `Auto-fill ${lineCount - timedCount} lines`)}
                </Button>
              </>
            ) : null}
            <Button variant="primary" onClick={() => void runExport()} disabled={busy}>
              {busy ? t("در حال ساخت…", "Building…") : t("دریافت فایل خروجی", "Get the output file")}
            </Button>
          </div>
        </div>

        {result ? (
          <div className="export-result">
            <div className="row between wrap gap">
              <h3>{t("آماده است ✓", "Done ✓")}</h3>
              <Badge tone={result.usedTestKeys ? "warn" : "ok"}>{result.usedTestKeys ? "test keys" : "studio keys"}</Badge>
            </div>
            <div className="kv">
              <div>
                <dt>file</dt>
                <dd>
                  <Mono>{result.packPath.split(/[\\/]/).pop()}</Mono>
                </dd>
              </div>
              <div>
                <dt>{t("حجم", "size")}</dt>
                <dd>{formatBytes(result.packSize)}</dd>
              </div>
              <div>
                <dt>sha256</dt>
                <dd>
                  <Mono>{shortHash(result.packSha256, 20)}</Mono>
                  <CopyButton value={result.packSha256} label={t("کپی", "copy")} />
                </dd>
              </div>
              <div>
                <dt>latest.json</dt>
                <dd>
                  <Mono>{shortHash(result.manifestSha256, 16)}</Mono>
                </dd>
              </div>
              <div>
                <dt>{t("مسیر", "path")}</dt>
                <dd className="path-cell">
                  <Mono>{result.packPath}</Mono>
                </dd>
              </div>
            </div>
            <div className="row gap-sm wrap">
              <Button onClick={() => void openFolder(result.packPath)}>{t("نمایش در پوشه", "Show in folder")}</Button>
              <CopyButton value={result.packPath} label={t("کپی مسیر", "Copy path")} />
              {result.manifestUrlHint ? (
                <CopyButton value={result.manifestUrlHint} label={t("کپی نشانی انتشار", "Copy publish URL")} />
              ) : null}
            </div>
            <div className="password-row">
              <span className="tiny muted">{t("رمز فایل (همین را در اندروید وارد کنید)", "file password (enter this in the Android app)")}</span>
              <Mono>{password}</Mono>
              <CopyButton value={password} label={t("کپی", "copy")} />
            </div>
            {result.manifestUrlHint ? (
              <p className="tiny">
                {t("نشانی انتشار:", "publish URL:")} <Mono>{result.manifestUrlHint}</Mono>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="advanced-toggle">
          <button className="link" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? t("بستن تنظیمات پیشرفته", "Hide advanced options") : t("تنظیمات پیشرفته (اختیاری)", "Advanced options (optional)")}
          </button>
        </div>
        {advanced ? (
          <div className="form-grid">
            <Field label="displayVersion" hint={t("پیش‌فرض 1.0.0", "defaults to 1.0.0")}>
              <TextInput value={displayVersion} onChange={setDisplayVersion} mono />
            </Field>
            <Field
              label={t("نشانی پایهٔ میزبانی", "hosting base URL")}
              hint={t("خالی بگذارید اگر جایی منتشر نمی‌کنید", "leave empty when nothing is hosted")}
              wide
            >
              <TextInput value={manifestBaseUrl} onChange={setManifestBaseUrl} mono dir="ltr" />
            </Field>
          </div>
        ) : null}

        {!ready ? (
          <Callout tone="warn" title={t("هنوز آماده نیست", "Not ready yet")}>
            {audioReady
              ? t(
                  `${lineCount - timedCount} سطر بدون زمان شروع مانده است.`,
                  `${lineCount - timedCount} line(s) still have no start time.`,
                )
              : t("هیچ فایل صوتی برای این پروژه کپی نشده است.", "No audio has been copied for this project yet.")}
          </Callout>
        ) : null}
      </Section>

      <Section
        title={t("نسخه‌های این آهنگ", "Versions of this song")}
        description={t(
          "فایل‌های قبلی پاک نمی‌شوند؛ هر بار یک نسخهٔ تازه با شمارهٔ بعدی ساخته می‌شود.",
          "Older files are kept; every export creates the next version code.",
        )}
      >
        {exports.length === 0 ? (
          <p className="muted tiny">{t("هنوز خروجی‌ای ساخته نشده است.", "No export has been built yet.")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("نسخه", "version")}</th>
                  <th>{t("تاریخ", "date")}</th>
                  <th>{t("حجم", "size")}</th>
                  <th>sha256</th>
                  <th>{t("وضعیت", "state")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exports.map((item) => (
                  <tr key={item.exportId}>
                    <td>
                      <Mono>v{item.versionCode}</Mono> <span className="tiny">{item.displayVersion}</span>
                    </td>
                    <td className="tiny">{formatDate(item.exportedAt)}</td>
                    <td>{formatBytes(item.packSize)}</td>
                    <td className="tiny">
                      <Mono>{shortHash(item.packSha256, 14)}</Mono>
                    </td>
                    <td>
                      <Badge tone={item.publication ? "ok" : "muted"}>
                        {item.publication ? t("منتشرشده", "published") : t("فقط ساخته‌شده", "built")}
                      </Badge>
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => void openFolder(item.packPath)}>
                        {t("پوشه", "folder")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
