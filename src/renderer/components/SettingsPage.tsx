import React, { useEffect, useState } from "react";
import type { AppInfo, Settings, ThemeMode } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatDate } from "../format";
import { Button, Callout, Field, KeyValue, Mono, Section, TextInput, useToast } from "./ui";

/**
 * Settings stays small on purpose: language, appearance, where exports go and
 * an optional hosting base URL. The export encryption and signing keys are
 * embedded in the app itself; the operator never sees or manages them.
 */
export function SettingsPage({
  info,
  settings,
  onSettings,
  onRefreshLibrary,
  onBootInfo,
}: {
  info: AppInfo | null;
  settings: Settings | null;
  onSettings: (settings: Settings) => void;
  onRefreshLibrary: () => Promise<void>;
  onBootInfo: () => void;
}): React.ReactElement {
  const { t, lang, setLang } = useLang();
  const toast = useToast();
  const [archiveDir, setArchiveDir] = useState(settings?.archiveDir ?? "");
  const [manifestBase, setManifestBase] = useState(settings?.defaultManifestBaseUrl ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) {
      setArchiveDir(settings.archiveDir);
      setManifestBase(settings.defaultManifestBaseUrl);
    }
  }, [settings]);

  const save = async (patch: Partial<Settings> = {}): Promise<void> => {
    setBusy(true);
    try {
      const next = await api.settings.set({
        archiveDir,
        defaultManifestBaseUrl: manifestBase,
        ...patch,
      });
      onSettings(next);
      await onRefreshLibrary();
      toast.push(t("ذخیره شد.", "Saved."), "ok");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(false);
    }
  };

  const pickArchive = async (): Promise<void> => {
    const folder = await api.settings.pickFolder(t("پوشهٔ خروجی‌ها", "Output folder"));
    if (folder) setArchiveDir(folder);
  };

  const setTheme = async (theme: ThemeMode): Promise<void> => {
    if (!settings) return;
    const next = await api.settings.set({ theme });
    onSettings(next);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("تنظیمات", "Settings")}</h1>
          <p className="muted">
            {t(
              "چند تنظیم ساده: ظاهر، زبان و محل ذخیرهٔ فایل‌های خروجی.",
              "A few simple settings: appearance, language and where output files are stored.",
            )}
          </p>
        </div>
      </div>

      <Section title={t("ظاهر", "Appearance")}>
        <div className="theme-cards">
          {(
            [
              { id: "dark" as ThemeMode, fa: "تیره", en: "Dark", icon: "☾" },
              { id: "light" as ThemeMode, fa: "روشن", en: "Light", icon: "☀" },
              { id: "system" as ThemeMode, fa: "مطابق سیستم", en: "System", icon: "◐" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              className={`theme-card${(settings?.theme ?? "dark") === option.id ? " theme-card-active" : ""}`}
              onClick={() => void setTheme(option.id)}
            >
              <span className="theme-card-icon">{option.icon}</span>
              <span>{t(option.fa, option.en)}</span>
            </button>
          ))}
        </div>
        <Field label={t("زبان رابط", "interface language")}>
          <div className="row gap-sm">
            <Button size="sm" variant={lang === "fa" ? "primary" : "ghost"} onClick={() => setLang("fa")}>
              فارسی
            </Button>
            <Button size="sm" variant={lang === "en" ? "primary" : "ghost"} onClick={() => setLang("en")}>
              English
            </Button>
          </div>
        </Field>
      </Section>

      <Section
        title={t("خروجی", "Output")}
        description={t(
          "فایل‌های ساخته‌شده در این پوشه نگه داشته می‌شوند تا نسخه‌های قبلی از دست نروند.",
          "Built packs are kept in this folder so older versions are never lost.",
        )}
      >
        <div className="form-grid">
          <Field label={t("پوشهٔ خروجی‌ها", "output folder")} wide>
            <div className="row gap-sm">
              <TextInput value={archiveDir} onChange={setArchiveDir} mono dir="ltr" />
              <Button size="sm" variant="ghost" onClick={() => void pickArchive()}>
                {t("انتخاب…", "Choose…")}
              </Button>
            </div>
          </Field>
          <Field
            label={t("نشانی پایهٔ میزبانی (اختیاری)", "hosting base URL (optional)")}
            hint={t("اگر جایی منتشر نمی‌کنید خالی بگذارید.", "Leave empty when nothing is hosted.")}
            wide
          >
            <TextInput value={manifestBase} onChange={setManifestBase} mono dir="ltr" />
          </Field>
        </div>
        <div className="row gap-sm">
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {t("ذخیره", "Save")}
          </Button>
        </div>
      </Section>

      <Section title={t("دربارهٔ برنامه", "About")}>
        <div className="about">
          <img src="./logo.png" alt="Reedance" className="about-logo" />
          <div>
            <h3>Reedance Studio</h3>
            <p className="muted tiny">
              {t(
                "ورود پیش‌نویس، انتخاب صوت، سینک لیریک و ساخت بستهٔ .rdpack با یک دکمه.",
                "Import a draft, choose audio, sync lyrics and build a .rdpack with one button.",
              )}
            </p>
          </div>
        </div>
        <KeyValue
          items={[
            { label: t("نسخه", "version"), value: `v${info?.version ?? "—"}` },
            { label: "Electron", value: info?.electron ?? "—", mono: true },
            { label: t("دادهٔ محلی", "local data"), value: <Mono>{info?.dataDir ?? "—"}</Mono> },
            { label: t("پوشهٔ خروجی", "output"), value: <Mono>{info?.archiveDir ?? "—"}</Mono> },
            { label: t("ساخته", "built"), value: info ? formatDate(new Date().toISOString()) : "—" },
          ]}
        />
        <p className="tiny hydro-line">
          developed with <span aria-hidden="true">❤️</span> by <strong>HYDRO team</strong>
        </p>
      </Section>
    </div>
  );
}
