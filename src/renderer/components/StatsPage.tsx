import React, { useCallback, useEffect, useState } from "react";
import type { StatsReport, StatsScope, TargetLanguage } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatDate } from "../format";
import { Badge, Button, Callout, Field, Mono, Section, Select, Spinner, useToast } from "./ui";

const SCOPES: { id: StatsScope["scope"]; fa: string; en: string; hintFa: string; hintEn: string }[] = [
  {
    id: "latest-published",
    fa: "آخرین منتشرشده",
    en: "latest published",
    hintFa: "پیش‌فرض: برای هر آهنگ جدیدترین نسخهٔ منتشرشدهٔ سالم یک‌بار شمرده می‌شود.",
    hintEn: "Default: only the newest verified published pack per song is counted.",
  },
  {
    id: "latest-exported",
    fa: "آخرین خروجی",
    en: "latest exported",
    hintFa: "جدیدترین بستهٔ ساخته‌شده برای هر آهنگ، حتی اگر منتشر نشده باشد.",
    hintEn: "Newest built pack per song, even when it is not published yet.",
  },
  {
    id: "drafts",
    fa: "پیش‌نویس‌ها",
    en: "drafts",
    hintFa: "پروژه‌های در حال ویرایش؛ این عدد با تعداد بستهٔ منتشرشده یکی نیست.",
    hintEn: "Projects being edited; these numbers are not published content.",
  },
  {
    id: "all-versions",
    fa: "همهٔ نسخه‌ها",
    en: "all versions",
    hintFa: "جمع تاریخچه است و نسخهٔ قدیمی هم شمرده می‌شود؛ با آمار پیش‌فرض مقایسه نکنید.",
    hintEn: "A history total that includes superseded versions; do not compare it with the default scope.",
  },
];

export function StatsPage(): React.ReactElement {
  const { t } = useLang();
  const toast = useToast();
  const [scope, setScope] = useState<StatsScope["scope"]>("latest-published");
  const [language, setLanguage] = useState<TargetLanguage | "all">("all");
  const [report, setReport] = useState<StatsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.stats.get({ scope, targetLanguage: language });
      setReport(next);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setLoading(false);
    }
  }, [language, scope, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (format: "csv" | "json"): Promise<void> => {
    setBusy(format);
    try {
      const path = await api.stats.save({ scope, targetLanguage: language }, format);
      if (path) toast.push(t(`ذخیره شد: ${path}`, `Saved: ${path}`), "ok");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const current = SCOPES.find((item) => item.id === scope) ?? SCOPES[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("آمار و گزارش‌ها", "Statistics and reports")}</h1>
          <p className="muted">
            {t(
              "واژگان یکتا با DISTINCT(normalizedKey) در هر زبان شمرده می‌شود؛ جمله‌ها با سطرهای لیریک و کارت گرامر با مفاهیم گرامری یکی نیستند.",
              "Unique vocabulary uses DISTINCT(normalizedKey) per language; sentences are not lyric lines, and grammar cards are not grammar concepts.",
            )}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            {t("تازه‌سازی", "Refresh")}
          </Button>
          <Button onClick={() => void save("csv")} disabled={busy !== null}>
            CSV
          </Button>
          <Button onClick={() => void save("json")} disabled={busy !== null}>
            JSON
          </Button>
        </div>
      </div>

      <div className="toolbar">
        <div className="filter-chips">
          {SCOPES.map((item) => (
            <button key={item.id} className={`chip${scope === item.id ? " chip-active" : ""}`} onClick={() => setScope(item.id)}>
              {t(item.fa, item.en)}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <Field label={t("زبان مقصد", "target language")}>
            <Select
              value={language}
              onChange={setLanguage}
              options={[
                { value: "all", label: t("همه", "all") },
                { value: "en", label: "English" },
                { value: "es", label: "Español" },
                { value: "ko", label: "한국어" },
              ]}
            />
          </Field>
        </div>
      </div>

      <Callout tone="info" title={t("دامنهٔ گزارش", "Report scope")}>
        {t(current.hintFa, current.hintEn)}
      </Callout>

      {loading && !report ? (
        <Spinner label={t("در حال محاسبه…", "Computing…")} />
      ) : report ? (
        <>
          <div className="stat-strip">
            <div className="stat-card stat-info">
              <span className="stat-value">{report.songs}</span>
              <span className="stat-label">{t("آهنگ", "songs")}</span>
            </div>
            <div className="stat-card stat-info">
              <span className="stat-value">{report.versions}</span>
              <span className="stat-label">{t("نسخه", "versions")}</span>
            </div>
            <div className="stat-card stat-muted">
              <span className="stat-value">{report.languages.reduce((total, item) => total + item.uniqueLexemes, 0)}</span>
              <span className="stat-label">{t("واژهٔ یکتا (جمع زبان‌ها)", "unique lexemes (all)")}</span>
            </div>
            <div className="stat-card stat-muted">
              <span className="stat-value">{report.languages.reduce((total, item) => total + item.sentences, 0)}</span>
              <span className="stat-label">{t("جملهٔ کاربردی", "sentences")}</span>
            </div>
          </div>

          <Section
            title={t("به تفکیک زبان", "By language")}
            description={`${t("تولید در", "generated")} ${formatDate(report.generatedAt)} · ${t("هش منابع", "sources hash")} ${report.sourcesHash.slice(0, 16)}…`}
          >
            {report.languages.length === 0 ? (
              <p className="muted">
                {t(
                  "برای این دامنه داده‌ای نیست. اگر هنوز چیزی منتشر نشده، دامنهٔ «آخرین خروجی» یا «پیش‌نویس‌ها» را ببینید.",
                  "No data for this scope. If nothing is published yet, try the latest-exported or drafts scope.",
                )}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("زبان", "language")}</th>
                      <th>{t("آهنگ", "songs")}</th>
                      <th>{t("نسخه", "versions")}</th>
                      <th>{t("واژهٔ یکتا", "unique lexemes")}</th>
                      <th>{t("مدخل واژه", "lexeme entries")}</th>
                      <th>{t("جمله", "sentences")}</th>
                      <th>{t("کارت گرامر", "grammar cards")}</th>
                      <th>{t("اصطلاح", "idioms")}</th>
                      <th>{t("سطر متن", "lyric lines")}</th>
                      <th>{t("سؤال", "questions")}</th>
                      <th>{t("جدول واژه", "vocab tables")}</th>
                      <th>{t("منتشرشده", "published")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.languages.map((item) => (
                      <tr key={item.targetLanguage}>
                        <td>
                          <Badge tone="info">{item.targetLanguage.toUpperCase()}</Badge>
                        </td>
                        <td>{item.songs}</td>
                        <td>{item.versions}</td>
                        <td className="strong">{item.uniqueLexemes}</td>
                        <td>{item.lexemeEntries}</td>
                        <td>{item.sentences}</td>
                        <td>{item.grammarCards}</td>
                        <td>{item.idioms}</td>
                        <td>{item.lyricLines}</td>
                        <td>{item.questions}</td>
                        <td>{item.vocabTables}</td>
                        <td>{item.published}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ul className="notice-list">
              {report.notices.map((notice, index) => (
                <li key={index}>{notice}</li>
              ))}
            </ul>
            <p className="tiny">
              {t("هش مجموعهٔ منابع:", "sources hash:")} <Mono>{report.sourcesHash}</Mono>
            </p>
          </Section>
        </>
      ) : null}
    </div>
  );
}
