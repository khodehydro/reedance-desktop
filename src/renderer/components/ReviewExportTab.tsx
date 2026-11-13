import React, { useEffect, useMemo, useState } from "react";
import type { ExportOutcome, ExportSummary, KeyRecord, ProjectDetail, RightsChecklist, Settings } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { formatBytes, formatDate, shortHash, versionLabel } from "../format";
import {
  Badge,
  Button,
  Callout,
  Field,
  KeyValue,
  Modal,
  Mono,
  Section,
  Select,
  TextArea,
  TextInput,
  Toggle,
  useToast,
} from "./ui";

export function ReviewExportTab({
  detail,
  onChanged,
  onOpenTimeline,
  onOpenStats,
}: {
  detail: ProjectDetail;
  onChanged: () => Promise<void>;
  onOpenTimeline: () => void;
  onOpenStats: () => void;
}): React.ReactElement {
  const { t } = useLang();
  const toast = useToast();
  const projectId = detail.summary.projectId;
  const [rights, setRights] = useState<RightsChecklist>(detail.rights);
  const [rightsDirty, setRightsDirty] = useState(false);
  const [approver, setApprover] = useState(detail.summary.approvedBy ?? "");
  const [note, setNote] = useState("");
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [encryptionKeyId, setEncryptionKeyId] = useState("");
  const [signatureKeyId, setSignatureKeyId] = useState("");
  const [displayVersion, setDisplayVersion] = useState("1.0.0");
  const [manifestBaseUrl, setManifestBaseUrl] = useState("");
  const [useTestKeys, setUseTestKeys] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);
  const [publishTarget, setPublishTarget] = useState<ExportSummary | null>(null);
  const [publishUrl, setPublishUrl] = useState("");

  useEffect(() => {
    if (!rightsDirty) setRights(detail.rights);
  }, [detail.rights, rightsDirty]);

  useEffect(() => {
    void (async () => {
      const [nextKeys, nextSettings] = await Promise.all([api.keys.list(), api.settings.get()]);
      setKeys(nextKeys);
      setSettings(nextSettings);
      setManifestBaseUrl((current) => current || nextSettings.defaultManifestBaseUrl);
      const enc = nextKeys.find((key) => key.kind === "enc");
      const sig = nextKeys.find((key) => key.kind === "sig");
      setEncryptionKeyId((current) => current || enc?.keyId || "");
      setSignatureKeyId((current) => current || sig?.keyId || "");
    })();
  }, []);

  const preflight = detail.preflight;
  const encKey = keys.find((key) => key.keyId === encryptionKeyId);
  const sigKey = keys.find((key) => key.keyId === signatureKeyId);
  const testKeySelected = Boolean(encKey?.testOnly || sigKey?.testOnly);

  useEffect(() => {
    if (testKeySelected) setUseTestKeys(false);
  }, [encryptionKeyId, signatureKeyId, testKeySelected]);

  const saveRights = async (): Promise<void> => {
    setBusy("rights");
    try {
      await api.projects.saveRights(projectId, rights);
      setRightsDirty(false);
      await onChanged();
      toast.push(t("چک‌لیست حقوق ذخیره شد.", "Rights checklist saved."), "ok");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const approve = async (): Promise<void> => {
    setBusy("approve");
    try {
      await api.review.approve(projectId, { approver, note });
      await onChanged();
      toast.push(t("تأیید نهایی ثبت شد.", "Final approval recorded."), "ok");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (): Promise<void> => {
    setBusy("approve");
    try {
      await api.review.revoke(projectId);
      await onChanged();
      toast.push(t("تأیید لغو شد.", "Approval revoked."), "warn");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const runExport = async (): Promise<void> => {
    if (!encKey || !sigKey) {
      toast.push(t("ابتدا کلید رمزنگاری و امضا بسازید یا وارد کنید.", "Create or import an encryption and a signing key first."), "warn");
      return;
    }
    setBusy("export");
    setOutcome(null);
    try {
      const result = await api.exports.run(projectId, {
        encryptionKeyId: encKey.keyId,
        signatureKeyId: sigKey.keyId,
        displayVersion,
        manifestBaseUrl,
        useTestKeys,
      });
      setOutcome(result);
      await onChanged();
      toast.push(t(`بستهٔ ${versionLabel(result.versionCode)} ساخته و تأیید شد.`, `Pack ${versionLabel(result.versionCode)} built and verified.`), "ok");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const verifyExport = async (exportId: string): Promise<void> => {
    setBusy(`verify-${exportId}`);
    try {
      const report = await api.exports.verify(exportId);
      toast.push(
        `${report.verified ? t("سالم", "verified") : t("ناسالم", "failed")}: ${report.detail.join(" · ")}`,
        report.verified ? "ok" : "bad",
      );
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const stage = async (exportId: string): Promise<void> => {
    setBusy(`stage-${exportId}`);
    try {
      const bundle = await api.exports.stage(exportId);
      if (bundle) {
        toast.push(
          t(`در پوشهٔ ${bundle.folder} آمادهٔ آپلود شد؛ ابتدا بسته سپس latest.json.`, `Staged in ${bundle.folder} — upload the pack first, then latest.json.`),
          "ok",
        );
      }
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const publish = async (): Promise<void> => {
    if (!publishTarget) return;
    setBusy("publish");
    try {
      const result = await api.exports.publish(publishTarget.exportId, publishUrl);
      toast.push(
        t(
          `انتشار تأیید شد: هش بستهٔ دوردست ${shortHash(result.remotePackSha256)}.`,
          `Publication verified: remote pack hash ${shortHash(result.remotePackSha256)}.`,
        ),
        "ok",
      );
      setPublishTarget(null);
      await onChanged();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setBusy(null);
    }
  };

  const rightsComplete =
    rights.audioRights &&
    rights.lyricsRights &&
    (detail.media?.coverPath ? rights.coverRights : true) &&
    rights.offlineDownloadAllowed &&
    rights.evidenceRef.trim().length > 0;

  const missingGates = useMemo(() => preflight.gates.filter((gate) => !gate.ok), [preflight.gates]);
  const baseManifestUrl = `${manifestBaseUrl.replace(/\/+$/, "")}/${detail.content.targetLanguage}/${detail.content.songId}/latest.json`;

  return (
    <div className="tab-body">
      <Section
        title={t("چک‌لیست حقوق و مجوز", "Rights and licence checklist")}
        description={t(
          "این مدرک در پروژهٔ محلی می‌ماند و وارد بسته نمی‌شود. تأیید بدون مدرک، خروجی را باز نمی‌کند.",
          "This evidence stays in the local project and is never packed. Approval without evidence does not unlock export.",
        )}
        actions={
          <Button variant="primary" size="sm" onClick={() => void saveRights()} disabled={busy !== null}>
            {busy === "rights" ? "…" : t("ذخیرهٔ چک‌لیست", "Save checklist")}
          </Button>
        }
      >
        <div className="checklist">
          <Toggle
            checked={rights.audioRights}
            onChange={(value) => {
              setRights({ ...rights, audioRights: value });
              setRightsDirty(true);
            }}
            label={t("حق انتشار صوتِ انتخاب‌شده تأیید شد", "Right to distribute the selected audio is confirmed")}
            hint={t("صوت را مدیر از سیستم خودش انتخاب کرده است", "the operator selected this audio on this machine")}
          />
          <Toggle
            checked={rights.lyricsRights}
            onChange={(value) => {
              setRights({ ...rights, lyricsRights: value });
              setRightsDirty(true);
            }}
            label={t("حق استفاده از متن/درس تأیید شد", "Right to use the lyrics/lesson text is confirmed")}
          />
          <Toggle
            checked={rights.coverRights}
            onChange={(value) => {
              setRights({ ...rights, coverRights: value });
              setRightsDirty(true);
            }}
            disabled={!detail.media?.coverPath}
            label={t("حق استفاده از کاور تأیید شد", "Right to use the cover is confirmed")}
            hint={detail.media?.coverPath ? undefined : t("کاوری انتخاب نشده", "no cover selected")}
          />
          <Toggle
            checked={rights.offlineDownloadAllowed}
            onChange={(value) => {
              setRights({ ...rights, offlineDownloadAllowed: value });
              setRightsDirty(true);
            }}
            label={t("دانلود و نگهداری آفلاین مجاز است", "Offline download and retention is allowed")}
          />
          <Toggle
            checked={rights.demoAudioDisclosure}
            onChange={(value) => {
              setRights({ ...rights, demoAudioDisclosure: value });
              setRightsDirty(true);
            }}
            label={t("اگر صوت بی‌کلام/نمایشی است، در متن هشدار داده شده", "If the audio is instrumental/demo, the notice says so")}
          />
        </div>
        <div className="form-grid">
          <Field label={t("مدرک/مجوز (شناسه یا نشانی)", "evidence reference")} hint={t("برای تأیید الزامی است", "required for approval")}>
            <TextInput
              value={rights.evidenceRef}
              onChange={(value) => {
                setRights({ ...rights, evidenceRef: value });
                setRightsDirty(true);
              }}
              placeholder="contract-2026-04 / licence #123"
            />
          </Field>
          <Field label={t("اعتبار صوت (credits.audio)", "audio credit (credits.audio)")} hint={t("در درس داخل بسته می‌رود", "goes into the packaged lesson")}>
            <TextInput
              value={rights.audioCredit}
              onChange={(value) => {
                setRights({ ...rights, audioCredit: value });
                setRightsDirty(true);
              }}
              placeholder="Reedance Originals — licensed recording"
            />
          </Field>
          <Field label={t("اعتبار کاور (credits.cover)", "cover credit")}>
            <TextInput
              value={rights.coverCredit}
              onChange={(value) => {
                setRights({ ...rights, coverCredit: value });
                setRightsDirty(true);
              }}
              placeholder="Artwork © HYDRO team"
            />
          </Field>
          <Field label={t("یادداشت بازبینی", "review note")}>
            <TextArea
              value={rights.notes}
              rows={2}
              onChange={(value) => {
                setRights({ ...rights, notes: value });
                setRightsDirty(true);
              }}
            />
          </Field>
        </div>
        {rightsDirty ? <Callout tone="warn" title={t("تغییرات ذخیره نشده", "Unsaved changes")} /> : null}
      </Section>

      <Section
        title={t("بازبینی انسانی و تأیید نهایی", "Human review and final approval")}
        description={t(
          "تأیید به هش محتوا، هش صوت و مجموعهٔ زمان‌ها بسته است؛ هر ویرایش بعدی آن را باطل می‌کند.",
          "Approval is bound to the content hash, audio hash and the whole timing set; any later edit invalidates it.",
        )}
        actions={
          <Button size="sm" variant="ghost" onClick={onOpenTimeline}>
            {t("بررسی روی تایم‌لاین", "Check on the timeline")}
          </Button>
        }
      >
        <div className="review-grid">
          <div className="mini-panel">
            <h3>{t("وضعیت بازبینی", "Review state")}</h3>
            <KeyValue
              items={[
                { label: t("سطرهای زمان‌دار", "timed lines"), value: `${detail.summary.timedCount}/${detail.summary.lineCount}` },
                { label: t("سطرهای بازبینی‌شده", "reviewed lines"), value: `${detail.summary.reviewedCount}/${detail.summary.lineCount}` },
                { label: t("تأیید", "approval"), value: detail.summary.approvedAt ? `${detail.summary.approvedBy} · ${formatDate(detail.summary.approvedAt)}` : t("ثبت نشده", "not recorded") },
                { label: t("هش محتوا", "content hash"), value: <Mono title={preflight.contentHash}>{shortHash(preflight.contentHash)}</Mono> },
                { label: t("هش زمان‌ها", "timeline hash"), value: <Mono title={preflight.timelineHash}>{shortHash(preflight.timelineHash)}</Mono> },
              ]}
            />
          </div>
          <div className="mini-panel">
            <h3>{t("ثبت تأیید", "Record approval")}</h3>
            <Field label={t("نام تأییدکننده", "approver")}>
              <TextInput value={approver} onChange={setApprover} placeholder="Hydro" />
            </Field>
            <Field label={t("یادداشت", "note")}>
              <TextInput value={note} onChange={setNote} placeholder={t("بررسی لیریک و تلفظ انجام شد", "lyrics and pronunciation checked")} />
            </Field>
            <div className="row gap-sm">
              <Button
                variant="primary"
                size="sm"
                disabled={!preflight.canExport || busy !== null}
                onClick={() => void approve()}
                title={preflight.canExport ? "" : t("همهٔ دروازه‌ها باید سبز باشند", "all gates must be green")}
              >
                {t("تأیید نهایی", "Approve")}
              </Button>
              {detail.summary.approvedAt ? (
                <Button variant="danger" size="sm" onClick={() => void revoke()} disabled={busy !== null}>
                  {t("لغو تأیید", "Revoke")}
                </Button>
              ) : null}
            </div>
            {!rightsComplete ? (
              <p className="tiny warn-text">{t("چک‌لیست حقوق ناقص است.", "The rights checklist is incomplete.")}</p>
            ) : null}
          </div>
        </div>

        <ul className="gate-list">
          {preflight.gates.map((gate) => (
            <li key={gate.key} className={gate.ok ? "gate-ok" : "gate-blocked"}>
              <span className="gate-dot">{gate.ok ? "✓" : "•"}</span>
              <span className="gate-label">{t(gate.labelFa, gate.labelEn)}</span>
              <span className="gate-detail">{gate.detail}</span>
            </li>
          ))}
        </ul>
        {missingGates.length ? (
          <Callout tone="warn" title={t(`${missingGates.length} دروازه باز است`, `${missingGates.length} gate(s) still open`)}>
            {missingGates.map((gate) => t(gate.labelFa, gate.labelEn)).join(" · ")}
          </Callout>
        ) : null}
      </Section>

      <Section
        title={t("ساخت بستهٔ رمزنگاری‌شده و manifest", "Build the encrypted pack and manifest")}
        description={t(
          "ZIP فقط شامل lesson.json + صوت انتخاب‌شده (+کاور اختیاری) است؛ سپس AES-256-GCM و امضای Ed25519.",
          "The ZIP holds only lesson.json + the selected audio (optional cover), then AES-256-GCM and an Ed25519 signature.",
        )}
      >
        <div className="form-grid">
          <Field label={t("کلید رمزنگاری (AES-256)", "encryption key (AES-256)")}>
            <Select
              value={encryptionKeyId}
              onChange={setEncryptionKeyId}
              options={
                keys.filter((key) => key.kind === "enc").length
                  ? keys.filter((key) => key.kind === "enc").map((key) => ({ value: key.keyId, label: `${key.keyId}${key.testOnly ? " (TEST)" : ""}` }))
                  : [{ value: "", label: t("کلیدی نیست — در تنظیمات بسازید", "no key — create one in Settings") }]
              }
            />
          </Field>
          <Field label={t("کلید امضا (Ed25519)", "signing key (Ed25519)")}>
            <Select
              value={signatureKeyId}
              onChange={setSignatureKeyId}
              options={
                keys.filter((key) => key.kind === "sig").length
                  ? keys.filter((key) => key.kind === "sig").map((key) => ({ value: key.keyId, label: `${key.keyId}${key.testOnly ? " (TEST)" : ""}` }))
                  : [{ value: "", label: t("کلیدی نیست — در تنظیمات بسازید", "no key — create one in Settings") }]
              }
            />
          </Field>
          <Field label="displayVersion" hint={t("فقط نمایشی؛ نسخهٔ واقعی contentVersionCode است", "display only; the real version is contentVersionCode")}>
            <TextInput value={displayVersion} onChange={setDisplayVersion} mono />
          </Field>
          <Field label={t("نشانی پایهٔ manifest", "manifest base URL")} hint={t("https و دامنهٔ مجاز", "https and the allow-listed domain")}>
            <TextInput value={manifestBaseUrl} onChange={setManifestBaseUrl} mono dir="ltr" />
          </Field>
        </div>
        <p className="tiny">
          {t("نسخهٔ بعدی:", "next version code:")} <Mono>{versionLabel(preflight.nextVersionCode)}</Mono> ·{" "}
          {t("manifest پیشنهادی:", "manifest URL:")} <Mono>{baseManifestUrl}</Mono>
        </p>
        {testKeySelected ? (
          <Toggle
            checked={useTestKeys}
            onChange={setUseTestKeys}
            label={t("استفاده از کلید آزمایشی را تأیید می‌کنم (خروجی قابل انتشار نیست)", "I confirm using TEST-ONLY keys (output cannot be published)")}
          />
        ) : null}
        <div className="row gap-sm wrap">
          <Button variant="primary" onClick={() => void runExport()} disabled={!preflight.canExport || busy !== null || !encKey || !sigKey}>
            {busy === "export" ? t("در حال ساخت بسته…", "building the pack…") : t("ساخت بسته و manifest", "Build pack & manifest")}
          </Button>
          <Button variant="ghost" onClick={onOpenStats}>
            {t("آمار", "Statistics")}
          </Button>
        </div>
        {!preflight.canExport ? (
          <Callout tone="warn" title={t("خروجی قفل است", "Export is locked")}>
            {missingGates.map((gate) => t(gate.labelFa, gate.labelEn)).join(" · ")}
          </Callout>
        ) : null}

        {outcome ? (
          <div className="export-result">
            <h3>{t("بسته ساخته و دوباره باز و بررسی شد", "Pack built, re-opened and verified")}</h3>
            <KeyValue
              items={[
                { label: t("نسخه", "version"), value: <Mono>{versionLabel(outcome.versionCode)}</Mono> },
                { label: t("فایل بسته", "pack file"), value: <Mono>{outcome.packPath}</Mono> },
                { label: t("حجم", "size"), value: formatBytes(outcome.packSize) },
                { label: t("هش", "sha256"), value: <Mono title={outcome.packSha256}>{outcome.packSha256}</Mono> },
                { label: t("manifest", "manifest"), value: <Mono>{outcome.manifestPath}</Mono> },
                { label: t("nonce", "nonce"), value: <Mono>{outcome.verification.nonceBase64url}</Mono> },
                { label: t("ورودی‌های ZIP", "zip entries"), value: <Mono>{outcome.verification.zipEntries.join(", ")}</Mono> },
                { label: t("امضا", "signature"), value: outcome.verification.signatureVerified ? t("تأیید شد", "verified") : t("نامعتبر", "invalid") },
                { label: t("نشانی ثابت", "stable URL"), value: <Mono>{outcome.manifestUrlHint}</Mono> },
              ]}
            />
            {outcome.usedTestKeys ? (
              <Callout tone="bad" title={t("کلید آزمایشی", "Test keys used")}>
                {t("این بسته هرگز نباید منتشر شود.", "This pack must never be published.")}
              </Callout>
            ) : null}
            <div className="row gap-sm wrap">
              <Button size="sm" variant="ghost" onClick={() => void api.exports.openFolder(outcome.exportId)}>
                {t("نمایش در پوشه", "Show in folder")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void verifyExport(outcome.exportId)}>
                {t("بررسی مجدد", "Verify again")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void stage(outcome.exportId)} disabled={busy !== null}>
                {t("آماده‌سازی برای آپلود", "Stage for upload")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={outcome.usedTestKeys}
                onClick={() => {
                  const match = detail.exports.find((item) => item.exportId === outcome.exportId);
                  setPublishTarget(match ?? null);
                  setPublishUrl(outcome.manifestUrlHint);
                }}
              >
                {t("ثبت انتشار (بررسی از راه دور)", "Publish (remote verify)")}
              </Button>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title={t("نسخه‌های این آهنگ", "Versions of this song")}>
        {detail.exports.length === 0 ? (
          <p className="muted">{t("هنوز نسخه‌ای صادر نشده است.", "No version exported yet.")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("نسخه", "version")}</th>
                  <th>{t("حجم", "size")}</th>
                  <th>{t("هش", "sha256")}</th>
                  <th>{t("کلیدها", "keys")}</th>
                  <th>{t("وضعیت", "state")}</th>
                  <th>{t("تاریخ", "date")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.exports.map((item) => (
                  <tr key={item.exportId}>
                    <td>
                      <Mono>{versionLabel(item.versionCode)}</Mono>
                      <div className="tiny">{item.displayVersion}</div>
                    </td>
                    <td>{formatBytes(item.packSize)}</td>
                    <td className="tiny">
                      <Mono title={item.packSha256}>{shortHash(item.packSha256)}</Mono>
                    </td>
                    <td className="tiny">
                      <div>{item.encryptionKeyId}</div>
                      <div>{item.signatureKeyId}</div>
                      {item.usedTestKeys ? <Badge tone="warn">TEST</Badge> : null}
                    </td>
                    <td>
                      <div className="badge-stack">
                        {item.fileState === "missing" ? (
                          <Badge tone="bad">{t("گم‌شده", "missing")}</Badge>
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
                        <Button size="sm" variant="ghost" onClick={() => void verifyExport(item.exportId)} disabled={busy !== null}>
                          {t("بررسی", "Verify")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void stage(item.exportId)} disabled={busy !== null}>
                          {t("آماده‌سازی", "Stage")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={item.usedTestKeys}
                          onClick={() => {
                            setPublishTarget(item);
                            setPublishUrl(
                              `${manifestBaseUrl.replace(/\/+$/, "")}/${item.targetLanguage}/${item.songId}/latest.json`,
                            );
                          }}
                        >
                          {t("انتشار", "Publish")}
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

      <Modal
        open={publishTarget !== null}
        title={t("ثبت انتشار روی هاست HTTPS", "Record publication on the HTTPS host")}
        onClose={() => setPublishTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublishTarget(null)}>
              {t("بستن", "Close")}
            </Button>
            <Button variant="primary" onClick={() => void publish()} disabled={busy !== null || !publishUrl}>
              {busy === "publish" ? "…" : t("بررسی و ثبت", "Verify & record")}
            </Button>
          </>
        }
      >
        <p className="muted">
          {t(
            "ابتدا بستهٔ نسخه‌دار را آپلود کنید، سپس latest.json را جایگزین کنید. برنامه امضا، هش و طول فایل دوردست را دوباره بررسی می‌کند؛ بدون این بررسی «منتشرشده» ثبت نمی‌شود.",
            "Upload the versioned pack first, then replace latest.json. The studio re-downloads the remote pack and checks the signature, hash and length; without that check nothing is marked as published.",
          )}
        </p>
        <Field label="manifest URL">
          <TextInput value={publishUrl} onChange={setPublishUrl} mono dir="ltr" />
        </Field>
        {publishTarget?.publication ? (
          <Callout tone="ok" title={t("قبلاً منتشر شده", "Already published")}>
            {publishTarget.publication.manifestUrl} · {formatDate(publishTarget.publication.publishedAt)}
          </Callout>
        ) : null}
      </Modal>
    </div>
  );
}
