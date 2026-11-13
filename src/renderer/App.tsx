import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppInfo, LibraryData, Settings, TargetLanguage } from "@shared/types";
import { api, isMock } from "./api";
import { LangContext, type Lang } from "./i18n";
import { LibraryPage } from "./components/LibraryPage";
import { ProjectPage } from "./components/ProjectPage";
import { Splash } from "./components/Splash";
import { StatsPage } from "./components/StatsPage";
import { SettingsPage } from "./components/SettingsPage";
import {
  Badge,
  Button,
  Callout,
  Field,
  Modal,
  Select,
  Spinner,
  TextInput,
  ToastProvider,
  useToast,
} from "./components/ui";

type View =
  | { name: "library" }
  | { name: "project"; projectId: string }
  | { name: "stats" }
  | { name: "settings" };

const EMPTY_LIBRARY: LibraryData = {
  projects: [],
  exports: [],
  archiveDir: "",
  dataDir: "",
  counts: { songs: 0, projects: 0, exports: 0, published: 0, missing: 0 },
};

const LOCALES: Record<TargetLanguage, string> = { en: "en-GB", es: "es-ES", ko: "ko-KR" };

function AppInner(): React.ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [library, setLibrary] = useState<LibraryData>(EMPTY_LIBRARY);
  const [view, setView] = useState<View>({ name: "library" });
  const [booted, setBooted] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const bootStarted = useRef(Date.now());

  const lang: Lang = settings?.lang ?? "fa";

  const refreshLibrary = useCallback(async () => {
    try {
      const data = await api.library.list();
      setLibrary(data);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    }
  }, [toast]);

  const bootstrap = useCallback(async () => {
    try {
      const [nextInfo, nextSettings, nextLibrary] = await Promise.all([
        api.app.info(),
        api.settings.get(),
        api.library.list(),
      ]);
      setInfo(nextInfo);
      setSettings(nextSettings);
      setLibrary(nextLibrary);
      setBooted(true);
    } catch (error) {
      setFatal(error instanceof Error ? error.message : String(error));
      setBooted(true);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!booted) return;
    const elapsed = Date.now() - bootStarted.current;
    const remaining = Math.max(0, 900 - elapsed);
    const timer = setTimeout(() => setShowSplash(false), remaining);
    return () => clearTimeout(timer);
  }, [booted]);

  useEffect(() => {
    const offLibrary = api.app.onLibraryChanged(() => {
      void refreshLibrary();
    });
    return offLibrary;
  }, [refreshLibrary]);

  const runImport = useCallback(async () => {
    setBusy("import");
    try {
      const outcome = await api.projects.importDraft();
      if (!outcome) return;
      await refreshLibrary();
      setView({ name: "project", projectId: outcome.projectId });
      toast.push(
        lang === "fa"
          ? `پیش‌نویس «${outcome.title}» وارد شد. صوت را جداگانه انتخاب کنید.`
          : `Draft "${outcome.title}" imported. Select the audio separately.`,
        "ok",
      );
      if (outcome.warnings.length) {
        toast.push(
          lang === "fa"
            ? `${outcome.warnings.length} هشدار محتوایی ثبت شد.`
            : `${outcome.warnings.length} content warnings recorded.`,
          "warn",
        );
      }
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  }, [lang, refreshLibrary, toast]);

  const changeLang = useCallback(
    async (next: Lang) => {
      const updated = await api.settings.set({ lang: next });
      setSettings(updated);
    },
    [],
  );

  useEffect(() => {
    const off = api.app.onCommand((command) => {
      if (command === "import-draft") void runImport();
      else if (command === "new-project") setNewProjectOpen(true);
      else if (command === "open-settings") setView({ name: "settings" });
      else if (command === "open-stats") setView({ name: "stats" });
    });
    return off;
  }, [runImport]);

  const ctxValue = useMemo(
    () => ({ lang, setLang: (next: Lang) => void changeLang(next), t: (fa: string, en: string) => (lang === "fa" ? fa : en) }),
    [lang, changeLang],
  );

  const t = ctxValue.t;

  const rescan = useCallback(async () => {
    setBusy("rescan");
    try {
      const report = await api.app.rescan();
      await refreshLibrary();
      toast.push(
        t(
          `اسکن مجدد: ${report.present}/${report.scanned} بسته موجود، ${report.orphans.length} فایل یتیم.`,
          `Rescan: ${report.present}/${report.scanned} packs present, ${report.orphans.length} orphan files.`,
        ),
        report.missing.length ? "warn" : "ok",
      );
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  }, [refreshLibrary, t, toast]);

  return (
    <LangContext.Provider value={ctxValue}>
      <div className="app" dir={lang === "fa" ? "rtl" : "ltr"}>
        {showSplash || !booted ? <Splash fading={booted && !showSplash} /> : null}
        <aside className="sidebar">
          <button className="brand" onClick={() => setView({ name: "library" })} title="Reedance Studio">
            <img src="./logo.png" alt="" />
            <span>
              <strong>Reedance</strong>
              <small>Content Studio</small>
            </span>
          </button>
          <nav className="nav">
            <button
              className={`nav-item${view.name === "library" ? " nav-active" : ""}`}
              onClick={() => setView({ name: "library" })}
            >
              <span className="nav-icon">▤</span>
              <span>{t("کتابخانه", "Library")}</span>
              <span className="nav-count">{library.counts.projects}</span>
            </button>
            <button
              className={`nav-item${view.name === "stats" ? " nav-active" : ""}`}
              onClick={() => setView({ name: "stats" })}
            >
              <span className="nav-icon">◔</span>
              <span>{t("آمار", "Statistics")}</span>
            </button>
            <button
              className={`nav-item${view.name === "settings" ? " nav-active" : ""}`}
              onClick={() => setView({ name: "settings" })}
            >
              <span className="nav-icon">⚙</span>
              <span>{t("تنظیمات", "Settings")}</span>
            </button>
          </nav>

          <div className="sidebar-foot">
            {info ? (
              <div className="sidebar-meta">
                <Badge tone={info.safeStorage ? "info" : "warn"} title={info.dataDir}>
                  {info.safeStorage ? t("کلید محافظت‌شده", "protected keys") : t("کلید بدون محافظت", "unprotected keys")}
                </Badge>
                <span className="tiny">v{info.version}</span>
              </div>
            ) : null}
            <button
              className="hydro"
              onClick={() => setView({ name: "settings" })}
              title={t("دربارهٔ برنامه", "About the app")}
            >
              developed with <span aria-hidden="true">❤️</span> by <strong>HYDRO team</strong>
            </button>
          </div>
        </aside>

        <main className="workspace">
          <header className="topbar">
            <div className="crumbs">
              {view.name !== "library" ? (
                <button className="crumb-back" onClick={() => setView({ name: "library" })}>
                  ‹ {t("کتابخانه", "Library")}
                </button>
              ) : null}
              <span className="crumb-current">
                {view.name === "library"
                  ? t("کتابخانهٔ محتوا", "Content library")
                  : view.name === "stats"
                    ? t("آمار و گزارش", "Statistics")
                    : view.name === "settings"
                      ? t("تنظیمات و کلیدها", "Settings & keys")
                      : t("ویرایش پروژه", "Project editor")}
              </span>
            </div>
            <div className="topbar-actions">
              {isMock ? <Badge tone="warn">{t("پیش‌نمایش مرورگر", "browser preview")}</Badge> : null}
              <div className="lang-switch" role="group" aria-label="language">
                <button className={lang === "fa" ? "active" : ""} onClick={() => void changeLang("fa")}>
                  فا
                </button>
                <button className={lang === "en" ? "active" : ""} onClick={() => void changeLang("en")}>
                  EN
                </button>
              </div>
            </div>
          </header>

          <div className="content">
            {fatal ? (
              <Callout tone="bad" title={t("خطای راه‌اندازی", "Startup error")}>
                {fatal}
              </Callout>
            ) : null}
            {!booted ? (
              <Spinner label={t("در حال آماده‌سازی استودیو…", "Preparing the studio…")} />
            ) : view.name === "library" ? (
              <LibraryPage
                library={library}
                info={info}
                busy={busy}
                onRefresh={refreshLibrary}
                onRescan={rescan}
                onImport={runImport}
                onNewProject={() => setNewProjectOpen(true)}
                onOpenProject={(projectId) => setView({ name: "project", projectId })}
                onStats={() => setView({ name: "stats" })}
              />
            ) : view.name === "project" ? (
              <ProjectPage
                key={view.projectId}
                projectId={view.projectId}
                onBack={() => setView({ name: "library" })}
                onRefreshLibrary={refreshLibrary}
                onOpenStats={() => setView({ name: "stats" })}
              />
            ) : view.name === "stats" ? (
              <StatsPage />
            ) : (
              <SettingsPage
                info={info}
                settings={settings}
                onSettings={setSettings}
                onRefreshLibrary={refreshLibrary}
                onBootInfo={() => void api.app.info().then(setInfo)}
              />
            )}
          </div>
        </main>

        <NewProjectModal
          open={newProjectOpen}
          onClose={() => setNewProjectOpen(false)}
          onCreated={async (projectId) => {
            setNewProjectOpen(false);
            await refreshLibrary();
            setView({ name: "project", projectId });
          }}
        />
      </div>
    </LangContext.Provider>
  );
}

function NewProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => Promise<void>;
}): React.ReactElement {
  const [songId, setSongId] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [language, setLanguage] = useState<TargetLanguage>("en");
  const [level, setLevel] = useState<"A1" | "A2" | "B1" | "B2" | "C1" | "C2">("A1");
  const [locale, setLocale] = useState("en-GB");
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    setLocale(LOCALES[language]);
  }, [language]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      const outcome = await api.projects.createEmpty({
        songId: songId.trim(),
        title: title.trim(),
        artist: artist.trim(),
        targetLanguage: language,
        locale,
        level,
      });
      toast.push(`Project "${outcome.title}" created`, "ok");
      setSongId("");
      setTitle("");
      setArtist("");
      await onCreated(outcome.projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      open={open}
      title="New content project"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!songId.trim() || !title.trim()}>
            Create project
          </Button>
        </>
      }
    >
      <p className="muted">
        A blank project lets you author the lesson inside the studio. The song id is permanent; audio is selected from
        this computer afterwards.
      </p>
      <div className="form-grid">
        <Field label="songId (slug)" hint="lowercase letters, digits, dashes — immutable">
          <TextInput value={songId} onChange={setSongId} placeholder="quiet-step" mono />
        </Field>
        <Field label="Title">
          <TextInput value={title} onChange={setTitle} placeholder="Quiet Step" />
        </Field>
        <Field label="Artist / credits">
          <TextInput value={artist} onChange={setArtist} placeholder="Reedance Originals" />
        </Field>
        <Field label="Target language">
          <Select
            value={language}
            onChange={(value) => setLanguage(value)}
            options={[
              { value: "en", label: "English (en)" },
              { value: "es", label: "Español (es)" },
              { value: "ko", label: "한국어 (ko)" },
            ]}
          />
        </Field>
        <Field label="Locale" hint="pronunciation/typography hint">
          <TextInput value={locale} onChange={setLocale} mono />
        </Field>
        <Field label="Level">
          <Select
            value={level}
            onChange={setLevel}
            options={(["A1", "A2", "B1", "B2", "C1", "C2"] as const).map((item) => ({ value: item, label: item }))}
          />
        </Field>
      </div>
      {error ? <Callout tone="bad" title="Could not create the project">{error}</Callout> : null}
    </Modal>
  );
}

export default function App(): React.ReactElement {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
