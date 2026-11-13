import type {
  DraftContent,
  ExportOutcome,
  ExportSummary,
  KeyRecord,
  LibraryData,
  LyricMark,
  MediaInfo,
  PreflightGate,
  PreflightReport,
  ProjectDetail,
  ProjectSummary,
  RightsChecklist,
  Settings,
  StatsReport,
  StudioApi,
} from "@shared/types";

/**
 * Browser-only preview bridge.
 *
 * `npm run dev` serves the renderer outside Electron so the layout can be
 * reviewed in a browser. This mock keeps every gate and every mutation in
 * memory and never touches a real file. It is never bundled into the packaged
 * app path (the preload bridge always wins when `window.reedance` exists) and
 * the UI shows a "browser preview" banner whenever it is active.
 */
const SETTINGS: Settings = {
  archiveDir: "(browser preview) no archive on disk",
  lang: "fa",
  theme: "dark",
  reducedMotion: false,
  allowTestKeys: true,
  defaultManifestBaseUrl: "https://content.example.com/reedance",
};

const NOW = new Date().toISOString();

function makeDemoContent(): DraftContent {
  const lines: DraftContent["lyrics"] = [
    {
      id: "line-1",
      text: "Streetlights paint the empty road",
      translationFa: "چراغ‌های خیابان جادهٔ خالی را رنگ می‌زنند",
      translationEn: "Streetlights colour the empty road",
      tokens: [
        { surface: "Streetlights", translationFa: "چراغ‌های خیابان", translationEn: "street lamps" },
        { surface: "paint", translationFa: "رنگ می‌زنند", translationEn: "colour", lexemeId: "en:paint" },
        { surface: "the", translationFa: "—", translationEn: "the article" },
        { surface: "empty", translationFa: "خالی", translationEn: "empty", lexemeId: "en:empty" },
        { surface: "road", translationFa: "جاده", translationEn: "road", lexemeId: "en:road" },
      ],
    },
    {
      id: "line-2",
      text: "I keep your voice inside my head",
      translationFa: "صدایت را در سرم نگه می‌دارم",
      translationEn: "I hold your voice in my mind",
      tokens: [
        { surface: "I", translationFa: "من", translationEn: "I" },
        { surface: "keep", translationFa: "نگه می‌دارم", translationEn: "keep", lexemeId: "en:keep" },
        { surface: "your", translationFa: "ـَت", translationEn: "your" },
        { surface: "voice", translationFa: "صدا", translationEn: "voice", lexemeId: "en:voice" },
        { surface: "inside", translationFa: "درون", translationEn: "inside" },
        { surface: "my", translationFa: "ـَم", translationEn: "my" },
        { surface: "head", translationFa: "سر", translationEn: "head", lexemeId: "en:head" },
      ],
    },
    {
      id: "line-3",
      text: "Every quiet step is a promise",
      translationFa: "هر قدم آرام یک وعده است",
      translationEn: "Each calm step is a promise",
      tokens: [
        { surface: "Every", translationFa: "هر", translationEn: "every" },
        { surface: "quiet", translationFa: "آرام", translationEn: "calm", lexemeId: "en:quiet" },
        { surface: "step", translationFa: "قدم", translationEn: "step", lexemeId: "en:step" },
        { surface: "is", translationFa: "است", translationEn: "is" },
        { surface: "a", translationFa: "یک", translationEn: "a" },
        { surface: "promise", translationFa: "وعده", translationEn: "promise", lexemeId: "en:promise" },
      ],
    },
    {
      id: "line-4",
      text: "We are learning how to stay",
      translationFa: "ما داریم یاد می‌گیریم چطور بمانیم",
      translationEn: "We are learning to remain",
      tokens: [
        { surface: "We", translationFa: "ما", translationEn: "we" },
        { surface: "are", translationFa: "هستیم", translationEn: "are" },
        { surface: "learning", translationFa: "یاد می‌گیریم", translationEn: "learning", lexemeId: "en:learn" },
        { surface: "how", translationFa: "چگونه", translationEn: "how" },
        { surface: "to", translationFa: "که", translationEn: "to" },
        { surface: "stay", translationFa: "بمانیم", translationEn: "stay", lexemeId: "en:stay" },
      ],
    },
    {
      id: "line-5",
      text: "Midnight avenue, hold the light",
      translationFa: "خیابان نیمه‌شب، نور را نگه دار",
      translationEn: "Midnight avenue, keep the light",
      tokens: [
        { surface: "Midnight", translationFa: "نیمه‌شب", translationEn: "midnight", lexemeId: "en:midnight" },
        { surface: "avenue", translationFa: "خیابان", translationEn: "avenue", lexemeId: "en:avenue" },
        { surface: "hold", translationFa: "نگه دار", translationEn: "hold", lexemeId: "en:keep" },
        { surface: "the", translationFa: "—", translationEn: "the article" },
        { surface: "light", translationFa: "نور", translationEn: "light", lexemeId: "en:light" },
      ],
    },
    {
      id: "line-6",
      text: "Tomorrow starts inside this room",
      translationFa: "فردا از درون همین اتاق شروع می‌شود",
      translationEn: "Tomorrow begins in this room",
      tokens: [
        { surface: "Tomorrow", translationFa: "فردا", translationEn: "tomorrow" },
        { surface: "starts", translationFa: "شروع می‌شود", translationEn: "begins" },
        { surface: "inside", translationFa: "درون", translationEn: "inside" },
        { surface: "this", translationFa: "این", translationEn: "this" },
        { surface: "room", translationFa: "اتاق", translationEn: "room", lexemeId: "en:room" },
      ],
    },
  ];

  return {
    draftSchemaVersion: 1,
    songId: "midnight-avenue",
    targetLanguage: "en",
    locale: "en-GB",
    title: "Midnight Avenue",
    artist: "Reedance Originals",
    level: "B1",
    createdAt: NOW,
    generator: "Reedance content agent (demo fixture)",
    sources: {
      lyrics: { description: "Original demo lyrics written for this repository", rightsStatus: "documented" },
      lesson: { description: "Lesson written by the content agent", rightsStatus: "documented" },
    },
    credits: {
      lyrics: "Original demo text — Reedance",
      noticeFa: "این درس برای نمایش جریان کاری استودیو ساخته شده است.",
      noticeEn: "This lesson exists to demonstrate the studio workflow.",
    },
    disclaimerFa: "صدای این نمونه تولیدشده و بی‌کلام است و متن آن خوانده نشده است.",
    disclaimerEn: "The demo audio is instrumental; the lyrics are not sung.",
    lyrics: lines,
    vocabulary: [
      {
        lexemeId: "en:quiet",
        lemma: "quiet",
        normalizedKey: "quiet",
        translationFa: "آرام",
        translationEn: "calm",
        ipa: "/ˈkwaɪət/",
        faReading: "کوایِت",
        partFa: "صفت",
        partEn: "adjective",
        tone: "mint",
        example: { text: "A quiet room.", translationFa: "اتاقی آرام.", translationEn: "A calm room." },
      },
      {
        lexemeId: "en:keep",
        lemma: "keep",
        normalizedKey: "keep",
        translationFa: "نگه داشتن",
        translationEn: "to keep",
        ipa: "/kiːp/",
        faReading: "کیپ",
        partFa: "فعل",
        partEn: "verb",
        tone: "blue",
        example: { text: "Keep the light on.", translationFa: "نور را روشن نگه دار.", translationEn: "Leave the light on." },
        tables: [
          {
            titleFa: " صرف keep",
            titleEn: "Conjugation of keep",
            columns: ["subject", "present", "past"],
            rows: [
              ["I", "keep", "kept"],
              ["you", "keep", "kept"],
              ["she", "keeps", "kept"],
            ],
            rowHeader: true,
          },
        ],
      },
      {
        lexemeId: "en:learn",
        lemma: "learn",
        normalizedKey: "learn",
        translationFa: "یاد گرفتن",
        translationEn: "to learn",
        ipa: "/lɜːn/",
        faReading: "لِرن",
        partFa: "فعل",
        partEn: "verb",
        tone: "amber",
        example: { text: "We learn together.", translationFa: "با هم یاد می‌گیریم.", translationEn: "We study together." },
      },
      {
        lexemeId: "en:promise",
        lemma: "promise",
        normalizedKey: "promise",
        translationFa: "وعده",
        translationEn: "promise",
        partFa: "اسم",
        partEn: "noun",
        tone: "rose",
        example: { text: "That is a promise.", translationFa: "این یک وعده است.", translationEn: "That is a commitment." },
      },
      {
        lexemeId: "en:midnight",
        lemma: "midnight",
        normalizedKey: "midnight",
        translationFa: "نیمه‌شب",
        translationEn: "midnight",
        partFa: "اسم",
        partEn: "noun",
        tone: "coral",
        example: { text: "It is midnight.", translationFa: "نیمه‌شب است.", translationEn: "It is twelve at night." },
      },
      {
        lexemeId: "en:room",
        lemma: "room",
        normalizedKey: "room",
        translationFa: "اتاق",
        translationEn: "room",
        partFa: "اسم",
        partEn: "noun",
        tone: "apricot",
        example: { text: "The room is warm.", translationFa: "اتاق گرم است.", translationEn: "The room feels warm." },
      },
    ],
    grammar: [
      {
        id: "keep-object-adjective",
        conceptId: "en:keep-object",
        tagFa: "ساختار جمله",
        tagEn: "Sentence pattern",
        titleFa: "keep + مفعول + صفت",
        titleEn: "keep + object + adjective",
        bodyFa: "پس از keep می‌توان مفعول و سپس صفت آورد تا ادامهٔ یک حالت را نشان دهیم.",
        bodyEn: "An object followed by an adjective after keep expresses maintaining a state.",
        example: { text: "I keep hope alive.", translationFa: "امید را زنده نگه می‌دارم.", translationEn: "I preserve hope." },
        tone: "blue",
        takeawayFa: "keep حالت را حفظ می‌کند.",
        takeawayEn: "keep preserves a state.",
        check: {
          promptFa: "کدام جمله درست است؟",
          promptEn: "Which sentence is correct?",
          answerFa: "She keeps the light on.",
          answerEn: "She keeps the light on.",
        },
        tables: [
          {
            titleFa: "الگوی keep",
            titleEn: "The keep pattern",
            columns: ["فاعل", "فعل", "مفعول", "صفت"],
            rows: [
              ["I", "keep", "hope", "alive"],
              ["you", "keep", "the room", "warm"],
            ],
            rowHeader: true,
            footerFa: "صفت وضعیت مفعول را توضیح می‌دهد.",
            footerEn: "The adjective describes the object state.",
          },
        ],
      },
      {
        id: "present-continuous",
        tagFa: "زمان",
        tagEn: "Tense",
        titleFa: "حال استمراری",
        titleEn: "Present continuous",
        bodyFa: "برای کارهای در حال انجام از am/is/are + فعلing استفاده می‌کنیم.",
        bodyEn: "Use am/is/are + verb-ing for actions happening now.",
        example: { text: "We are learning how to stay.", translationFa: "ما داریم یاد می‌گیریم چطور بمانیم.", translationEn: "We learn how to remain." },
        tone: "mint",
        tables: [
          {
            titleFa: "ساخت حال استمراری",
            titleEn: "Present continuous forms",
            columns: ["subject", "be", "verb-ing"],
            rows: [
              ["I", "am", "learning"],
              ["she", "is", "learning"],
              ["we", "are", "learning"],
            ],
          },
        ],
      },
    ],
    idioms: [
      {
        id: "hold-the-light",
        text: "hold the light",
        translationFa: "امید را زنده نگه داشتن",
        translationEn: "to keep hope alive",
        contextFa: "در متن به معنی نگه‌داشتن امید است.",
        contextEn: "In the lyric it means keeping hope.",
        lineId: "line-5",
        tone: "amber",
      },
    ],
    sentences: [
      {
        id: "sentence-stay",
        text: "We are learning how to stay.",
        translationFa: "ما داریم یاد می‌گیریم چطور بمانیم.",
        translationEn: "We are learning to remain.",
        contextFa: "در گفت‌وگوی روزمره.",
        contextEn: "Useful in everyday conversation.",
        lineId: "line-4",
      },
      {
        id: "sentence-promise",
        text: "Every step is a promise.",
        translationFa: "هر قدم یک وعده است.",
        translationEn: "Each step is a commitment.",
        lineId: "line-3",
      },
    ],
    vocabularyTables: [
      {
        titleFa: "واژگان کلیدی",
        titleEn: "Key vocabulary",
        columns: ["word", "fa"],
        rows: [
          ["quiet", "آرام"],
          ["keep", "نگه داشتن"],
        ],
        rowHeader: false,
      },
    ],
    questions: [
      {
        id: "q-quiet",
        type: "choice",
        skillFa: "درک واژه",
        skillEn: "Meaning",
        promptFa: "quiet در متن یعنی چه؟",
        promptEn: "What does quiet mean?",
        explanationFa: "quiet یعنی آرام.",
        explanationEn: "Quiet means calm.",
        lineId: "line-3",
        relatedLexemeIds: ["en:quiet"],
        options: [
          { id: "fast", fa: "سریع", en: "fast" },
          { id: "calm", fa: "آرام", en: "calm" },
          { id: "loud", fa: "بلند", en: "loud" },
        ],
        correctId: "calm",
      },
      {
        id: "q-match",
        type: "match",
        skillFa: "واژگان",
        skillEn: "Vocabulary",
        promptFa: "واژه و معنی را وصل کن.",
        promptEn: "Match each word with its meaning.",
        explanationFa: "هر واژه یک معنی دارد.",
        explanationEn: "Each word maps to one meaning.",
        pairs: [
          { id: "p-quiet", text: "quiet", fa: "آرام", en: "calm", lexemeId: "en:quiet" },
          { id: "p-keep", text: "keep", fa: "نگه داشتن", en: "keep", lexemeId: "en:keep" },
          { id: "p-room", text: "room", fa: "اتاق", en: "room", lexemeId: "en:room" },
        ],
      },
      {
        id: "q-order",
        type: "order",
        skillFa: "ساخت جمله",
        skillEn: "Sentence order",
        promptFa: "جمله را مرتب کن.",
        promptEn: "Put the sentence in order.",
        explanationFa: "ترتیب درست: We are learning how to stay.",
        explanationEn: "Correct order: We are learning how to stay.",
        chunks: [
          { id: "c1", text: "We" },
          { id: "c2", text: "are learning" },
          { id: "c3", text: "how to stay" },
        ],
      },
      {
        id: "q-typing",
        type: "typing",
        skillFa: "املای واژه",
        skillEn: "Spelling",
        promptFa: "واژهٔ جاافتاده را بنویس.",
        promptEn: "Type the missing word.",
        explanationFa: "واژهٔ درست quiet است.",
        explanationEn: "The missing word is quiet.",
        context: "Every ___ step is a promise.",
        accepted: ["quiet"],
        relatedLexemeIds: ["en:quiet"],
      },
    ],
  };
}

function makeDemoAudio(): Blob {
  const sampleRate = 8000;
  const seconds = 24;
  const samples = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const beat = Math.sin(2 * Math.PI * 110 * t) * 0.18 + Math.sin(2 * Math.PI * 220 * t) * 0.07;
    const pulse = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.5 * t);
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, beat * pulse)) * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function createMockBridge(): StudioApi {
  const content = makeDemoContent();
  const audioBlob = makeDemoAudio();
  const audioUrl = URL.createObjectURL(audioBlob);
  let rights: RightsChecklist = {
    audioRights: false,
    lyricsRights: true,
    coverRights: false,
    offlineDownloadAllowed: false,
    demoAudioDisclosure: true,
    evidenceRef: "",
    notes: "",
    audioCredit: "",
    coverCredit: "",
  };
  const media: MediaInfo = {
    audioPath: "browser-preview://midnight-avenue/audio.wav",
    audioFileName: "audio.wav",
    audioSha256: "4d3b8a6f1e2c9a7b5d8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e",
    mimeType: "audio/wav",
    extension: "wav",
    durationMs: 24000,
    bytes: 384044,
    importedAt: NOW,
    sourceName: "midnight-avenue-demo.wav",
  };
  let marks: LyricMark[] = content.lyrics.map((line, index) => ({
    lineId: line.id,
    startMs: index * 4000,
    endMs: (index + 1) * 4000 - 250,
    reviewed: index < 2,
    reviewedAudioSha: index < 2 ? media.audioSha256 : null,
    reviewedLineSha: index < 2 ? "reviewed" : null,
  }));
  let approvedAt: string | null = null;
  let approvedBy: string | null = null;
  let exportsList: ExportSummary[] = [];
  let settings = { ...SETTINGS };
  const keys: KeyRecord[] = [
    {
      keyId: "enc-test-preview",
      kind: "enc",
      createdAt: NOW,
      testOnly: true,
      protection: "none",
      fingerprint: "0a1b2c3d4e5f6071",
    },
    {
      keyId: "sig-test-preview",
      kind: "sig",
      createdAt: NOW,
      testOnly: true,
      protection: "none",
      publicKeyBase64url: "preview-pinned-public-key",
      fingerprint: "1f2e3d4c5b6a7988",
    },
  ];

  const lineHash = (line: DraftContent["lyrics"][number]): string =>
    JSON.stringify([line.text, line.translationFa, line.translationEn, line.tokens]);

  const reviewedCount = (): number =>
    marks.filter((mark) => {
      const line = content.lyrics.find((candidate) => candidate.id === mark.lineId);
      return (
        mark.startMs !== null &&
        mark.reviewedAudioSha === media.audioSha256 &&
        !!line &&
        mark.reviewedLineSha === lineHash(line)
      );
    }).length;

  const gates = (): PreflightGate[] => {
    const timed = marks.filter((mark) => mark.startMs !== null);
    const ascending = timed.every((mark, index) => index === 0 || (mark.startMs ?? 0) > (timed[index - 1].startMs ?? 0));
    return [
      { key: "audio", labelFa: "فایل صوتی انتخاب شده است", labelEn: "Audio selected", ok: true, detail: media.audioFileName },
      { key: "duration", labelFa: "مدت صوت измер شده", labelEn: "Duration measured", ok: true, detail: `${media.durationMs} ms` },
      { key: "timed", labelFa: "همهٔ سطرها زمان دارند", labelEn: "All lines timed", ok: timed.length === content.lyrics.length, detail: `${timed.length}/${content.lyrics.length}` },
      { key: "timing", labelFa: "زمان‌ها صعودی‌اند", labelEn: "Timings ascending", ok: ascending, detail: ascending ? "ok" : "out of order" },
      { key: "content", labelFa: "محتوا بدون خطاست", labelEn: "Content valid", ok: true, detail: "0" },
    ];
  };

  const preflight = (): PreflightReport => ({
    projectId: "prj-preview",
    canExport: gates().filter((gate) => ["audio", "duration", "timed", "timing", "content"].includes(gate.key)).every((gate) => gate.ok),
    gates: gates(),
    issues: [],
    nextVersionCode: exportsList.length + 1,
    contentHash: "preview-content-hash",
    timelineHash: JSON.stringify(marks.map((mark) => mark.startMs)),
    audioSha256: media.audioSha256,
  });

  const summary = (): ProjectSummary => ({
    projectId: "prj-preview",
    songId: content.songId,
    targetLanguage: content.targetLanguage,
    locale: content.locale,
    title: content.title,
    artist: content.artist ?? "",
    level: content.level ?? "",
    state: approvedAt ? "approved" : reviewedCount() === content.lyrics.length ? "review-ready" : "sync-incomplete",
    createdAt: NOW,
    updatedAt: new Date().toISOString(),
    approvedAt,
    approvedBy,
    audio: {
      fileName: media.audioFileName,
      sha256: media.audioSha256,
      durationMs: media.durationMs,
      bytes: media.bytes,
      mimeType: media.mimeType,
      hasCover: false,
    },
    lineCount: content.lyrics.length,
    timedCount: marks.filter((mark) => mark.startMs !== null).length,
    reviewedCount: reviewedCount(),
    exportCount: exportsList.length,
    latestExportVersion: exportsList[0]?.versionCode ?? null,
    issueCount: 0,
    warningCount: 0,
  });

  const detail = (): ProjectDetail => ({
    summary: summary(),
    content: JSON.parse(JSON.stringify(content)) as DraftContent,
    marks: marks.map((mark) => ({ ...mark })),
    media,
    rights,
    rawSha256: "preview",
    rawJsonPath: "(browser preview) no snapshot",
    contentEditedAt: new Date().toISOString(),
    revisionCount: approvedAt ? 1 : 0,
    issues: [],
    warnings: [],
    exports: exportsList,
    preflight: preflight(),
  });

  const library = (): LibraryData => ({
    projects: [summary()],
    exports: exportsList,
    archiveDir: settings.archiveDir,
    dataDir: "(browser preview) memory only",
    counts: {
      songs: 1,
      projects: 1,
      exports: exportsList.length,
      published: exportsList.filter((item) => item.publication).length,
      missing: 0,
    },
  });

  const mockExport = (options: {
    encryptionKeyId: string;
    signatureKeyId: string;
    displayVersion: string;
    manifestBaseUrl: string;
    useTestKeys: boolean;
  }): ExportOutcome => {
          const versionCode = exportsList.length + 1;
          const sha = Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
          exportsList = [
            {
              exportId: `exp-preview-${versionCode}`,
              projectId: "prj-preview",
              songId: content.songId,
              targetLanguage: content.targetLanguage,
              title: content.title,
              versionCode,
              displayVersion: options.displayVersion,
              packPath: `(preview)/en/${content.songId}/v${String(versionCode).padStart(6, "0")}-${sha}.rdpack`,
              packSha256: sha,
              packSize: 412000,
              manifestPath: "(preview)/latest.json",
              manifestSha256: sha,
              encryptionKeyId: options.encryptionKeyId,
              signatureKeyId: options.signatureKeyId,
              exportedAt: new Date().toISOString(),
              usedTestKeys: true,
              fileState: "present",
              superseded: false,
              publication: null,
            },
            ...exportsList.map((item) => ({ ...item, superseded: true })),
          ];
          return {
            exportId: `exp-preview-${versionCode}`,
            versionCode,
            displayVersion: options.displayVersion,
            packPath: `(preview)/v${versionCode}.rdpack`,
            packSha256: sha,
            packSize: 412000,
            manifestPath: "(preview)/latest.json",
            manifestSha256: sha,
            manifestUrlHint: `${options.manifestBaseUrl}/${content.targetLanguage}/${content.songId}/latest.json`,
            usedTestKeys: true,
            verification: {
              packLength: 412000,
              packSha256: sha,
              audioSha256: media.audioSha256,
              lessonSchemaOk: true,
              signatureVerified: true,
              zipEntries: ["lesson.json", "audio.wav"],
              nonceBase64url: "previewnonce",
            },
          };
  };

  return {
    app: {
      info: async () => ({
        version: "1.0.0 (browser preview)",
        electron: "—",
        chrome: navigator.userAgent,
        node: "—",
        platform: "browser preview",
        dataDir: "(browser preview) memory only",
        archiveDir: settings.archiveDir,
        safeStorage: false,
        keyCount: keys.length,
        testKeysOnly: true,
      }),
      rescan: async () => ({ scanned: 0, present: 0, missing: [], orphans: [], warnings: ["Browser preview: no archive folder."] }),
      openExternal: async () => undefined,
      showItemInFolder: async () => undefined,
      saveTextFile: async () => null,
      onLibraryChanged: () => () => undefined,
      onCommand: () => () => undefined,
    },
    settings: {
      get: async () => settings,
      set: async (patch) => {
        settings = { ...settings, ...patch };
        return settings;
      },
      pickFolder: async () => "(browser preview) memory only",
    },
    library: { list: async () => library() },
    projects: {
      importDraft: async () => null,
      createEmpty: async () => ({ projectId: "prj-preview", songId: content.songId, title: content.title, issues: [], warnings: [] }),
      get: async () => detail(),
      saveContent: async (_projectId, next) => {
        Object.assign(content, next);
        return detail();
      },
      saveRights: async (_projectId, next) => {
        rights = { ...rights, ...next };
        return detail();
      },
      remove: async () => undefined,
    },
    media: {
      selectAudio: async () => ({ media, warnings: [], durationSource: "container" }),
      selectCover: async () => ({ media, warnings: [], durationSource: "container" }),
      removeCover: async () => ({ media, warnings: [], durationSource: "container" }),
      reportDuration: async () => ({ media, warnings: [], durationSource: "container" }),
      playUrl: async () => audioUrl,
      bytes: async () => audioBlob.arrayBuffer(),
    },
    marks: {
      save: async (_projectId, patch) => {
        for (const item of patch) {
          const existing = marks.find((mark) => mark.lineId === item.lineId);
          if (!existing) continue;
          if (existing.startMs !== item.startMs || existing.endMs !== item.endMs) {
            existing.startMs = item.startMs;
            existing.endMs = item.endMs;
            existing.reviewedAudioSha = null;
            existing.reviewedLineSha = null;
          }
        }
        return detail();
      },
      setReviewed: async (_projectId, lineIds, reviewed) => {
        for (const lineId of lineIds) {
          const mark = marks.find((candidate) => candidate.lineId === lineId);
          const line = content.lyrics.find((candidate) => candidate.id === lineId);
          if (!mark || !line) continue;
          mark.reviewedAudioSha = reviewed ? media.audioSha256 : null;
          mark.reviewedLineSha = reviewed ? lineHash(line) : null;
        }
        return detail();
      },
    },
    review: {
      approve: async (_projectId, input) => {
        approvedAt = new Date().toISOString();
        approvedBy = input.approver;
        return detail();
      },
      revoke: async () => {
        approvedAt = null;
        approvedBy = null;
        return detail();
      },
    },
    exports: {
      preflight: async () => preflight(),
      run: async (_projectId, options) => mockExport(options),
      quick: async (_projectId, input) =>
        mockExport({
          encryptionKeyId: "enc-studio-preview",
          signatureKeyId: "sig-studio-preview",
          displayVersion: input?.displayVersion ?? "1.0.0",
          manifestBaseUrl: input?.manifestBaseUrl ?? "",
          useTestKeys: false,
        }),
      verify: async () => ({ ...preflight(), verified: true, detail: ["Browser preview: nothing is written to disk."] }),
      stage: async () => null,
      publish: async (_exportId, manifestUrl) => ({
        exportId: "exp-preview",
        manifestUrl,
        remotePackSha256: exportsList[0]?.packSha256 ?? "",
        remoteManifestSha256: exportsList[0]?.manifestSha256 ?? "",
        verifiedAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
      }),
      openFolder: async () => undefined,
    },
    keys: {
      list: async () => keys,
      generateTest: async () => keys,
      importFromFile: async () => keys,
      backup: async () => null,
    },
    stats: {
      get: async (scope): Promise<StatsReport> => ({
        generatedAt: new Date().toISOString(),
        scope: scope.scope,
        targetLanguage: scope.targetLanguage ?? "all",
        sourcesHash: "preview-sources-hash",
        songs: 1,
        versions: exportsList.length,
        languages: [
          {
            targetLanguage: "en",
            songs: 1,
            versions: exportsList.length,
            uniqueLexemes: new Set(content.vocabulary.map((word) => word.normalizedKey)).size,
            lexemeEntries: content.vocabulary.length,
            sentences: content.sentences.length,
            grammarCards: content.grammar.length,
            idioms: content.idioms.length,
            lyricLines: content.lyrics.length,
            questions: content.questions.length,
            vocabTables: content.vocabularyTables.length,
            published: 0,
            missingFiles: 0,
          },
        ],
        notices: ["Browser preview: numbers are computed from the in-memory demo project."],
      }),
      save: async () => null,
    },
  };
}
