import React, { useEffect, useState } from "react";
import type { AppInfo, KeyRecord, Settings } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatDate } from "../format";
import {
  Badge,
  Button,
  Callout,
  CopyButton,
  Field,
  KeyValue,
  Mono,
  Section,
  TextInput,
  Toggle,
  useToast,
} from "./ui";

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
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [passphrase, setPassphrase] = useState("");
  const [archiveDir, setArchiveDir] = useState(settings?.archiveDir ?? "");
  const [manifestBase, setManifestBase] = useState(settings?.defaultManifestBaseUrl ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api.keys.list().then(setKeys);
  }, []);

  useEffect(() => {
    if (settings) {
      setArchiveDir(settings.archiveDir);
      setManifestBase(settings.defaultManifestBaseUrl);
    }
  }, [settings]);

  const saveArchive = async (): Promise<void> => {
    if (!settings) return;
    setBusy("archive");
    try {
      const next = await api.settings.set({ archiveDir, defaultManifestBaseUrl: manifestBase });
      onSettings(next);
      await onRefreshLibrary();
      onBootInfo();
      toast.push(t("تنظیمات ذخیره شد.", "Settings saved."), "ok");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const pickArchive = async (): Promise<void> => {
    const folder = await api.settings.pickFolder(t("پوشهٔ بایگانی خروجی‌ها", "Archive output folder"));
    if (folder) setArchiveDir(folder);
  };

  const generateTestKeys = async (): Promise<void> => {
    setBusy("keys");
    try {
      const next = await api.keys.generateTest();
      setKeys(next);
      toast.push(
        t(
          "کلیدهای آزمایشی ساخته شد. این کلیدها فقط برای آزمون جریان‌اند و خروجی‌شان قابل انتشار نیست.",
          "Test keys created. They are only for exercising the flow and their output must not be published.",
        ),
        "warn",
      );
      onBootInfo();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const importKeys = async (): Promise<void> => {
    setBusy("keys");
    try {
      const next = await api.keys.importFromFile();
      setKeys(next);
      toast.push(t("کلیدها وارد شدند.", "Keys imported."), "ok");
      onBootInfo();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const backup = async (): Promise<void> => {
    setBusy("backup");
    try {
      const path = await api.keys.backup(passphrase);
      if (path) toast.push(t(`پشتیبان رمزدار ذخیره شد: ${path}`, `Encrypted backup saved: ${path}`), "ok");
      setPassphrase("");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("تنظیمات، کلیدها و دربارهٔ برنامه", "Settings, keys and about")}</h1>
          <p className="muted">
            {t(
              "کلید خصوصی امضا و کلید AES فقط روی همین دستگاه می‌مانند؛ هیچ کلیدی در بستهٔ نصبی یا خروجی نیست.",
              "The Ed25519 private key and the AES key stay on this machine; no key is embedded in the installer or in an export.",
            )}
          </p>
        </div>
      </div>

      <Section title={t("عمومی", "General")}>
        <div className="form-grid">
          <Field label={t("پوشهٔ بایگانی خروجی‌ها", "archive output folder")} wide hint={t("فایل‌های نسخه‌دار در این مسیر ساخته می‌شوند.", "versioned packs are written here.")}>
            <div className="row gap-sm">
              <TextInput value={archiveDir} onChange={setArchiveDir} mono dir="ltr" />
              <Button size="sm" variant="ghost" onClick={() => void pickArchive()}>
                {t("انتخاب…", "Choose…")}
              </Button>
            </div>
          </Field>
          <Field label={t("نشانی پایهٔ manifest پیش‌فرض", "default manifest base URL")} wide hint={t("مثل https://content.example.com/reedance", "e.g. https://content.example.com/reedance")}>
            <TextInput value={manifestBase} onChange={setManifestBase} mono dir="ltr" />
          </Field>
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
          <Field label={t("حرکت کمتر", "reduced motion")} hint={t("انیمیشن‌های تزئینی را خاموش می‌کند.", "turns off decorative animation.")}>
            <Toggle
              checked={settings?.reducedMotion ?? false}
              onChange={async (value) => {
                if (!settings) return;
                const next = await api.settings.set({ reducedMotion: value });
                onSettings(next);
              }}
              label={t("کاهش حرکت", "reduce motion")}
            />
          </Field>
        </div>
        <div className="row gap-sm">
          <Button variant="primary" onClick={() => void saveArchive()} disabled={busy !== null}>
            {t("ذخیرهٔ تنظیمات", "Save settings")}
          </Button>
        </div>
      </Section>

      <Section
        title={t("کلیدهای رمزنگاری و امضا", "Encryption and signing keys")}
        description={t(
          "AES-256 برای بسته و Ed25519 برای latest.json. کلید عمومی امضا باید در APK پین شود؛ کلید تازه یعنی نیاز به اپ سازگار.",
          "AES-256 for the pack and Ed25519 for latest.json. The public signing key must be pinned in the Android app; a new key needs a compatible app.",
        )}
        actions={
          <div className="row gap-sm">
            <Button size="sm" variant="ghost" onClick={() => void generateTestKeys()} disabled={busy !== null}>
              {t("ساخت کلید آزمایشی", "Generate test keys")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void importKeys()} disabled={busy !== null}>
              {t("ورود از فایل", "Import from file")}
            </Button>
          </div>
        }
      >
        {keys.length === 0 ? (
          <Callout tone="warn" title={t("کلیدی وجود ندارد", "No key yet")}>
            {t("برای خروجی، حداقل یک کلید AES و یک کلید امضا لازم است.", "At least one AES key and one signing key are required to export.")}
          </Callout>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>keyId</th>
                  <th>{t("نوع", "kind")}</th>
                  <th>{t("محافظت", "protection")}</th>
                  <th>{t("اثر انگشت", "fingerprint")}</th>
                  <th>{t("کلید عمومی", "public key")}</th>
                  <th>{t("ساخت", " created")}</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.keyId}>
                    <td>
                      <Mono>{key.keyId}</Mono>
                      {key.testOnly ? <Badge tone="warn">TEST</Badge> : null}
                    </td>
                    <td>{key.kind === "enc" ? "AES-256-GCM" : "Ed25519"}</td>
                    <td>
                      <Badge tone={key.protection === "safeStorage" ? "ok" : "warn"}>
                        {key.protection === "safeStorage" ? t("سیستم‌عامل", "OS protected") : t("بدون محافظت", "unprotected")}
                      </Badge>
                    </td>
                    <td className="tiny">
                      <Mono>{key.fingerprint ?? "—"}</Mono>
                    </td>
                    <td className="tiny">
                      {key.publicKeyBase64url ? (
                        <>
                          <Mono>{key.publicKeyBase64url.slice(0, 22)}…</Mono>
                          <CopyButton value={key.publicKeyBase64url} label={t("کپی", "copy")} />
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="tiny">{formatDate(key.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="form-grid backup-grid">
          <Field
            label={t("پشتیبان رمزدار کلیدها", "encrypted key backup")}
            hint={t("رمز عبور حداقل ۱۰ نویسه؛ فایل را جدا از خروجی‌ها نگه دارید.", "at least 10 characters; keep the file away from the exports.")}
            wide
          >
            <div className="row gap-sm">
              <TextInput value={passphrase} onChange={setPassphrase} type="text" />
              <Button size="sm" onClick={() => void backup()} disabled={busy !== null || passphrase.length < 10}>
                {t("پشتیبان‌گیری", "Back up")}
              </Button>
            </div>
          </Field>
        </div>
        <Callout tone="info" title={t("یادآوری مهم", "Important reminder")}>
          {t(
            "گم‌شدن کلید امضا یا AES، انتشار و رمزگشایی نسخه‌های بعدی را متوقف می‌کند. رمزنگاری فایل توزیعی جایگزین DRM نیست؛ کلید توزیع در برنامهٔ اندروید قابل استخراج است.",
            "Losing the signing or AES key stops future releases and decryption. Encrypting the distributed file is not DRM; the distribution key can be extracted from the Android app.",
          )}
        </Callout>
      </Section>

      <Section title={t("دربارهٔ برنامه", "About the app")}>
        <div className="about">
          <img src="./logo.png" alt="Reedance" className="about-logo" />
          <div>
            <h3>Reedance Studio</h3>
            <p className="muted">
              {t(
                "استودیوی محتوای ری‌دنس: ورود پیش‌نویس محتوایی، انتخاب صوت از سیستم، سینک سطر‌به‌سطر لیریک، بازبینی انسانی و ساخت بستهٔ رمزنگاری‌شدهٔ .rdpack و latest.json امضاشده.",
                "Reedance content studio: import a content-only draft, select audio from the system, sync lyrics line by line, review, and build an encrypted .rdpack plus a signed latest.json.",
              )}
            </p>
            <div className="row gap-sm">
              <Button size="sm" variant="ghost" onClick={() => void api.app.openExternal("https://github.com/khodehydro/reedance")}>
                {t("مستندات و مخزن", "Docs & repository")}
              </Button>
            </div>
          </div>
        </div>
        <KeyValue
          items={[
            { label: t("نسخهٔ برنامه", "app version"), value: `v${info?.version ?? "—"}` },
            { label: "Electron", value: info?.electron ?? "—", mono: true },
            { label: "Chromium", value: info?.chrome?.split(" ")[0] ?? "—", mono: true },
            { label: "Node", value: info?.node ?? "—", mono: true },
            { label: t("سیستم‌عامل", "platform"), value: info?.platform ?? "—" },
            { label: t("دادهٔ محلی", "local data"), value: <Mono>{info?.dataDir ?? "—"}</Mono> },
            { label: t("بایگانی خروجی", "archive"), value: <Mono>{info?.archiveDir ?? "—"}</Mono> },
            { label: t("کلیدها", "keys"), value: `${info?.keyCount ?? 0}${info?.testKeysOnly ? t(" (همه آزمایشی)", " (all test)") : ""}` },
          ]}
        />
        <p className="tiny">
          {t(
            "این برنامه مخصوص استودیوی ویندوز است. آیکن‌ها و ساختار بصری از پروتوتایپ وب همین پروژه الهام گرفته‌اند؛ لوگو همان فایل مخزن است.",
            "This app is the Windows content studio. Icons and layout are inspired by this project's web prototype; the logo is the repository file.",
          )}
        </p>
        <p className="tiny hydro-line">
          developed with <span aria-hidden="true">❤️</span> by <strong>HYDRO team</strong>
        </p>
      </Section>
    </div>
  );
}
