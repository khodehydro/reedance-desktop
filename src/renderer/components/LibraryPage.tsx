import React, { useMemo, useState } from "react";
import type { AppInfo, ExportSummary, LibraryData, ProjectSummary, TargetLanguage } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatBytes, formatDate, formatSeconds, shortHash, versionLabel } from "../format";
import { Badge, Button, Callout, Empty, Mono, Progress, Section, useToast } from "./ui";

const LANGUAGES: { id: TargetLanguage | "all"; fa: string; en: string; flag: string }[] = [
  { id: "all", fa: "همه", en: "All", flag: "◍" },
  { id: "en", fa: "انگلیسی", en: "English", flag: "EN" },
  { id: "es", fa: "اسپانیایی", en: "Spanish", flag: "ES" },
  { id: "ko", fa: "کره‌ای", en: "Korean", flag: "KO" },
];

const STATE_LABEL: Record<ProjectSummary["state"], { fa: string; en: string; tone: "muted" | "info" | "warn" | "ok" }> = {
  "raw-imported": { fa: "پیش‌نویس وارد‌شده", en: "raw imported", tone: "muted" },
  "audio-selected": { fa: "صوت انتخاب‌شده", en: "audio selected", tone: "info" },
  "sync-incomplete": { fa: "سینک ناتمام", en: "sync incomplete", tone: "warn" },
  "review-ready": { fa: "آمادهٔ تأیید", en: "review ready", tone: "info" },
  approved: { fa: "تأییدشده", en: "approved", tone: "ok" },
};

export function LibraryPage({
  library,
  info,
  busy,
  onRefresh,
  onRescan,
  onImport,
  onNewProject,
  onOpenProject,
  onStats,
}: {
  library: LibraryData;
  info: AppInfo | null;
  busy: string | null;
  onRefresh: () => Promise<void>;
  onRescan: () => Promise<void>;
  onImport: () => Promise<void>;
  onNewProject: () => void;
  onOpenProject: (projectId: string) => void;
  onStats: () => void;
}): React.ReactElement {
  const { t, lang } = useLang();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<TargetLanguage | "all">("all");
  const [verifying, setVerifying] = useState<string | null>(null);

  const projects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library.projects.filter((project) => {
      if (language !== "all" && project.targetLanguage !== language) return false;
      if (!needle) return true;
      return `${project.title} ${project.songId} ${project.artist}`.toLowerCase().includes(needle);
    });
  }, [library.projects, language, query]);

  const exports = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library.exports.filter((item) => {
      if (language !== "all" && item.targetLanguage !== language) return false;
      if (!needle) return true;
      return `${item.title} ${item.songId} ${item.displayVersion}`.toLowerCase().includes(needle);
    });
  }, [library.exports, language, query]);

  const verifyExport = async (item: ExportSummary): Promise<void> => {
    setVerifying(item.exportId);
    try {
      const report = await api.exports.verify(item.exportId);
      if (report.verified) {
        toast.push(t(`بستهٔ ${versionLabel(item.versionCode)} سالم است.`, `Pack ${versionLabel(item.versionCode)} verified.`), "ok");
      } else {
        toast.push(`${t("بسته سالم نیست", "Pack verification failed")}: ${report.detail.join(" · ")}`, "bad");
      }
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setVerifying(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("کتابخانهٔ محتوا", "Content library")}</h1>
          <p className="muted">
            {t(
              "پیش‌نویس خام ایجنت را وارد کنید، صوت را از سیستم انتخاب کنید، لیریک را روی تایم‌لاین هم‌زمان کنید و بستهٔ رمزنگاری‌شده بسازید.",
              "Import an agent draft, pick the audio from this computer, align lyrics on the timeline, and build the encrypted pack.",
            )}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="primary" onClick={() => void onImport()} disabled={busy === "import"}>
            {busy === "import" ? "…" : t("ورود پیش‌نویس", "Import draft")}
          </Button>
          <Button onClick={onNewProject}>{t("پروژهٔ خالی", "New project")}</Button>
          <Button variant="ghost" onClick={() => void onRefresh()}>
            {t("تازه‌سازی", "Refresh")}
          </Button>
        </div>
      </div>

      <div className="stat-strip">
        <StatCard label={t("آهنگ‌ها", "Songs")} value={library.counts.songs} />
        <StatCard label={t("پروژه‌ها", "Projects")} value={library.counts.projects} />
        <StatCard label={t("نسخه‌های صادرشده", "Exported versions")} value={library.counts.exports} />
        <StatCard label={t("منتشرشده", "Published")} value={library.counts.published} tone={library.counts.published ? "ok" : "muted"} />
        <StatCard
          label={t("فایل گم‌شده", "Missing files")}
          value={library.counts.missing}
          tone={library.counts.missing ? "bad" : "muted"}
        />
      </div>

      <div className="toolbar">
        <input
          className="input search"
          placeholder={t("جست‌وجوی نام، songId یا هنرمند…", "Search title, songId or artist…")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="filter-chips" role="group">
          {LANGUAGES.map((item) => (
            <button
              key={item.id}
              className={`chip${language === item.id ? " chip-active" : ""}`}
              onClick={() => setLanguage(item.id)}
            >
              <span className="chip-flag">{item.flag}</span>
              {t(item.fa, item.en)}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <span className="archive-path" title={library.archiveDir}>
            {t("پوشهٔ بایگانی", "Archive")}: <Mono>{library.archiveDir || "—"}</Mono>
          </span>
          <Button variant="ghost" size="sm" onClick={() => void onRescan()} disabled={busy === "rescan"}>
            {busy === "rescan" ? "…" : t("اسکن مجدد", "Rescan")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onStats}>
            {t("آمار", "Statistics")}
          </Button>
        </div>
      </div>

      {!info?.safeStorage ? (
        <Callout tone="warn" title={t("محافظت کلید در این سیستم‌عامل در دسترس نیست", "OS key protection is unavailable")}>
          {t(
            "کلیدها بدون رمزنگاری سیستمی ذخیره می‌شوند. پیش از انتشار، کلیدها را با گذرواژه پشتیبان‌گیری کنید.",
            "Keys are stored without OS-level encryption. Back them up with a passphrase before publishing.",
          )}
        </Callout>
      ) : null}

      {projects.length === 0 ? (
        <Empty
          title={t("هنوز پروژه‌ای نیست", "No projects yet")}
          body={t(
            "فایل .rddraft.json ساختهٔ ایجنت را وارد کنید یا یک پروژهٔ خالی بسازید. ورود پیش‌نویس مجوز انتشار نیست.",
            "Import the agent's .rddraft.json or start a blank project. Importing a draft is not a publishing licence.",
          )}
          action={
            <div className="row gap">
              <Button variant="primary" onClick={() => void onImport()}>
                {t("ورود پیش‌نویس", "Import draft")}
              </Button>
              <Button onClick={onNewProject}>{t("پروژهٔ خالی", "New project")}</Button>
            </div>
          }
        />
      ) : (
        <div className="project-grid">
          {projects.map((project) => (
            <article key={project.projectId} className="project-card">
              <header>
                <div>
                  <h3>{project.title || "(untitled)"}</h3>
                  <div className="project-sub">
                    <Mono>{project.songId}</Mono>
                    <span>·</span>
                    <span>{project.targetLanguage.toUpperCase()}</span>
                    <span>·</span>
                    <span>{project.level || "—"}</span>
                  </div>
                </div>
                <Badge tone={STATE_LABEL[project.state].tone}>{t(STATE_LABEL[project.state].fa, STATE_LABEL[project.state].en)}</Badge>
              </header>

              <div className="project-metrics">
                <div>
                  <span className="metric-label">{t("صوت", "Audio")}</span>
                  <span className="metric-value">
                    {project.audio ? `${formatSeconds(project.audio.durationMs)} · ${formatBytes(project.audio.bytes)}` : t("انتخاب نشده", "not selected")}
                  </span>
                </div>
                <div>
                  <span className="metric-label">{t("سینک سطرها", "Timed lines")}</span>
                  <span className="metric-value">
                    {project.timedCount}/{project.lineCount}
                  </span>
                  <Progress value={project.timedCount} max={project.lineCount} tone="info" />
                </div>
                <div>
                  <span className="metric-label">{t("بازبینی", "Reviewed")}</span>
                  <span className="metric-value">
                    {project.reviewedCount}/{project.lineCount}
                  </span>
                  <Progress value={project.reviewedCount} max={project.lineCount} tone="ok" />
                </div>
                <div>
                  <span className="metric-label">{t("نسخه‌ها", "Versions")}</span>
                  <span className="metric-value">
                    {project.latestExportVersion ? versionLabel(project.latestExportVersion) : "—"}
                  </span>
                </div>
              </div>

              {project.issueCount > 0 ? (
                <div className="inline-warn">
                  {t(`${project.issueCount} خطای محتوایی`, `${project.issueCount} content errors`)}
                </div>
              ) : null}

              <footer>
                <Button size="sm" variant="primary" onClick={() => onOpenProject(project.projectId)}>
                  {t("باز کردن", "Open")}
                </Button>
                <span className="tiny">{formatDate(project.updatedAt)}</span>
              </footer>
            </article>
          ))}
        </div>
      )}

      <Section
        title={t("همهٔ نسخه‌ها و فایل‌های خروجی", "All versions and output files")}
        description={t(
          "«آخرین نسخه» را با «همهٔ نسخه‌ها» اشتباه نگیرید؛ نسخه‌های قدیمی به‌عنوان superseded علامت می‌خورند.",
          "Do not confuse the latest version with all versions; older packs are marked superseded.",
        )}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void onRefresh()}>
            {t("تازه‌سازی", "Refresh")}
          </Button>
        }
      >
        {exports.length === 0 ? (
          <p className="muted">
            {t(
              "هنوز بستهٔ رمزنگاری‌شده‌ای ساخته نشده است. خروجی فقط پس از تأیید نهایی ممکن است.",
              "No encrypted pack has been built yet. Export is unlocked only after final approval.",
            )}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("آهنگ", "Song")}</th>
                  <th>{t("نسخه", "Version")}</th>
                  <th>{t("حجم / هش", "Size / hash")}</th>
                  <th>{t("کلیدها", "Keys")}</th>
                  <th>{t("وضعیت", "State")}</th>
                  <th>{t("تاریخ", "Date")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exports.map((item) => (
                  <tr key={item.exportId}>
                    <td>
                      <button className="link" onClick={() => onOpenProject(item.projectId)}>
                        {item.title}
                      </button>
                      <div className="tiny">
                        <Mono>{item.songId}</Mono> · {item.targetLanguage.toUpperCase()}
                      </div>
                    </td>
                    <td>
                      <Mono>{versionLabel(item.versionCode)}</Mono>
                      <div className="tiny">{item.displayVersion}</div>
                    </td>
                    <td>
                      <div>{formatBytes(item.packSize)}</div>
                      <div className="tiny">
                        <Mono title={item.packSha256}>{shortHash(item.packSha256)}</Mono>
                      </div>
                    </td>
                    <td className="tiny">
                      <div>{item.encryptionKeyId}</div>
                      <div>{item.signatureKeyId}</div>
                      {item.usedTestKeys ? <Badge tone="warn">TEST</Badge> : null}
                    </td>
                    <td>
                      <div className="badge-stack">
                        {item.fileState === "missing" ? (
                          <Badge tone="bad">{t("فایل گم‌شده", "missing")}</Badge>
                        ) : item.superseded ? (
                          <Badge tone="muted">{t("منسوخ", "superseded")}</Badge>
                        ) : (
                          <Badge tone="info">{t("آخرین", "latest")}</Badge>
                        )}
                        {item.publication ? <Badge tone="ok">{t("منتشرشده", "published")}</Badge> : null}
                      </div>
                    </td>
                    <td className="tiny">{formatDate(item.exportedAt)}</td>
                    <td>
                      <div className="row gap-sm">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={item.fileState === "missing" || verifying === item.exportId}
                          onClick={() => void verifyExport(item)}
                        >
                          {verifying === item.exportId ? "…" : t("بررسی", "Verify")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void api.exports.openFolder(item.exportId)}>
                          {t("پوشه", "Folder")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p className="tiny foot-note">
        {t(
          `دادهٔ محلی: ${library.dataDir || "—"} · زبان رابط ${lang === "fa" ? "فارسی" : "English"}`,
          `Local data: ${library.dataDir || "—"} · interface ${lang === "fa" ? "Persian" : "English"}`,
        )}
      </p>
    </div>
  );
}

function StatCard({ label, value, tone = "info" }: { label: string; value: number; tone?: "info" | "ok" | "muted" | "bad" }): React.ReactElement {
  return (
    <div className={`stat-card stat-${tone}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
