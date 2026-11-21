# راهنمای استفاده — Reedance Studio

## نصب

1. فایل `Reedance-Studio-Setup-1.0.6-x64.exe` را اجرا کنید.
2. چون فایل با گواهی تجاری امضا نشده است، ویندوز SmartScreen هشدار می‌دهد: **More info → Run anyway**.
3. مسیر نصب را انتخاب کنید (نصب برای کاربر جاری، بدون نیاز به دسترسی مدیر).
4. میان‌بر روی دسکتاپ و منوی استارت ساخته می‌شود.

نسخهٔ فایل: `1.0.6` — SHA-256:
`a6b7d757d847129f7b1b7171383b2826593fc697c7dc77f2bf627c88b245bf18`

## زبان‌ها

پیش‌نویس‌های `en`، `es`، `ko` و `tr` پذیرفته می‌شوند. زبان **ترکی** یک افزونهٔ سمت استودیو است: قرارداد v1 فقط `en/es/ko` را فهرست می‌کند، بنابراین بسته‌های `tr` با یک هشدار مشخص می‌شوند و باید فقط روی نسخه‌ای از اپ اندروید منتشر شوند که `tr` را می‌پذیرد. اگر پیش‌نویس فیلد `level` نداشته باشد (مثل بعضی فایل‌های ترکی)، در تب «نمای کلی» سطح A1–C2 را انتخاب کنید؛ تا آن زمان خروجی قفل است.

## جریان کار

| مرحله | در برنامه | شرط عبور |
| --- | --- | --- |
| ۱. ورود پیش‌نویس | «ورود پیش‌نویس» → فایل `*.rddraft.json` | ساختار و قواعد محتوایی بدون خطا؛ هیچ timing/مدیایی در فایل نباشد |
| ۲. انتخاب صوت | تب «صوت» → انتخاب فایل از سیستم | کپی محلی، هش SHA-256، کدک و مدت اندازه‌گیری شود |
| ۳. سینک لیریک | تب «تایم‌لاین» → دکمهٔ **توزیع یکنواخت** یا ثبت دستی با `M` | هر سطر زمان شروع دارد، زمان‌ها صعودی و داخل مدت صوت‌اند |
| ۴. خروجی | تب «خروجی» → دکمهٔ **دریافت فایل خروجی** | ساخت `.rdpack` (کلید `enc-main`) + `latest.json` امضاشده؛ بدون هیچ رمزی؛ همه‌ی داخلی بسته با حداکثر سطح DEFLATE فشرده می‌شود |

سینک لیریک: محور تایم‌لاین **از چپ به راست** است (همان جهت پخش). روی تایم‌لاین **خط عموی نارنجی (نوک پخش)** و **خط عموی آبی (خط ثبت)** نمایش داده می‌شود: خط آبی را با کشیدن یا کلیک روی waveform جابه‌جا کنید تا زمانش تغییر کند (همزمان صدا هم به همان نقطه می‌رود)، سپس دکمهٔ **⏱ ثبت شروع سطر (M)** زمان شروع سطر انتخابی را روی همان نقطه ثبت می‌کند. هر سطر را هم می‌توانید مستقیماً از **⏱ ثبت شروع** کناری ثبت کنید. بزرگ‌نمایی با اسلایدر «بزرگ‌نمایی»، چرخ‌ماوس روی تایم‌لاین یا دکمهٔ **هم‌راست‌سازی** انجام می‌شود؛ برای جای‌گذاری دقیق، خط آبی را با کشیدن دقیق جابه‌جا کنید.

اگر ۴۰ سطر یا بیشتر دارید، از دکمهٔ «توزیع یکنواخت N سطر» (در تایم‌لاین یا در تب خروجی) استفاده کنید: زمان شروع همهٔ سطرها به‌طور یکنواخت روی مدت صوت پخش می‌شود و بعد فقط سطرهایی که دقیق نیستند را اصلاح می‌کنید.

## بخش داستان

هر آهنگ می‌تواند بخش داستان هم داشته باشد. در تب **«داستان»**:

- **نام داستان** و **صفحات** داستان را می‌نویسید؛ صفحات را ↑/↓ جابه‌جا و حذف می‌کنید.
- هر سطر داستان همان چهار بخش لیریک دارد: **متن**، **ترجمهٔ فارسی**، **ترجمهٔ انگلیسی** و **توکن‌های کلمه‌به‌کلمه** (با دکمهٔ «ساخت خودکار از متن»).
- **صدای متن داستان**: یک فایل صوتی از روی کامپیوتر خودتان (**mp3، m4a یا wav**) را هم مثل صوت آهنگ به پروژه اضافه می‌کنید؛ می‌توانید آن را پخش کنید، حذف کنید یا با دکمهٔ «انتخاب صوت دیگر» عوض کنید. این صدا در خروجی به صورت `story.<نوع>` و در `lesson.json` با شناسه و مدت آن ثبت می‌شود.
- دکمهٔ **صدای صفحه / صدایی این سطر** متن را با صدای سیستم می‌خواند، تا روایت را أثناء نویسه‌کشی بررسی کنید (این فقط پیش‌نمایش است؛ صدایی که در بسته می‌رود، همان فایل انتخابی شماست).
- داستان زمان‌بندی ندارد: با آهنگ سینک نمی‌شود و در خروجی به شکلی که اپ اندروید می‌خواند (`story.title` + `story.pages` با ترجمه هر سطر و کلمه‌به‌کلمه) وارد `lesson.json` می‌شود. داستانی که هیچ سطری ندارد خارج می‌شود.

کلید رمزنگاری بسته‌ها یک کلید توزیع ثابت (`enc-main`) است که اپ اندروید هم دارد؛ کلید امضا خودکار ساخته می‌شود. بازبینی/تأیید انسانی و چک‌لیست حقوق از جریان کار حذف شده است. فقط سه چیز خروجی را قفل می‌کند: نبودِ صوت، مدت نامشخص، و سطرهای بدون زمان یا زمان‌های نامرتب.

اگر صوت را عوض کنید، همهٔ زمان‌ها پاک می‌شوند و باید دوباره سینک کنید؛ این رفتار عمدی است.
ظاهر برنامه از دکمهٔ ☾/☀ بالای صفحه بین تیره، روشن و «مطابق سیستم» جابه‌جا می‌شود.

## رمز؟ هیچ رمزی وجود ندارد

فایل خروجی را که گرفتید، همان را به اپ اندروید بدهید؛ اپ خودش بازش می‌کند. نه رمزی ساخته می‌شود، نه پرسیده می‌شود، نه جایی کپی می‌کنید.

«تنظیمات → کلید رمزنگاری فایل‌ها» فقط می‌گوید بسته‌ها با کدام کلید رمز می‌شوند: شناسهٔ `enc-main`، منبع کلید و یک اثر انگشت کوتاه (هیچ بایتی از کلید نمایش داده نمی‌شود).

- اگر بج **کلید تستی** را دیدید، یعنی کلید واقعی هنوز نصب نشده و خروجی‌ها فقط برای آزمایش‌اند. فایل کلید را از مالک پروژه بگیرید و با دکمهٔ «وارد کردن فایل کلید» بارگذاری کنید؛ از آن به بعد بج **کلید نصب‌شده** می‌شود و همهٔ خروجی‌ها با کلید انتشار رمز می‌شوند.
- لازم نیست چیزی را در اندروید وارد کنید؛ کلید از قبل داخل خود اپ اندروید است.
- این رمزنگاری جلوی دستکاری و پخش بی‌قاعده را می‌گیرد، ولی DRM نیست: هر دستگاهی که کلید را داشته باشد می‌تواند فایل را باز کند.

جزئیات فنی (قالب بایت‌به‌بایت، منبع کلید، مسیر اندروید) در `docs/CRYPTO.md`.

## انتشار

تب «کتابخانه» هر نسخه، حجم، هش، وضعیت (`ساخته‌شده`/`تأییدشده`/`منتشرشده`/`ناموفق`) و فایل‌های گم‌شده را نشان می‌دهد. «بازبینی آرشیو» فایل‌ها را دوباره اسکن می‌کند. انتشار، `latest.json` میزبانی‌شده روی HTTPS را با امضای محلی مقایسه می‌کند.

## آمار

آمار به تفکیک `targetLanguage` است و واژگان را با `DISTINCT(normalizedKey)` می‌شمارد؛ «جمله» با «سطر لیریک» و «کارت گرامر» با «مفهوم گرامری» یکی نیست. خروجی CSV/JSON از همان صفحه ذخیره می‌شود.

## میان‌برهای تایم‌لاین

`Space` پخش/توقف · `M` ثبت زمان برای سطر انتخابی و رفتن به سطر بعد · `←/→` جابه‌جایی ۱۰۰ میلی‌ثانیه (با `Shift` یک ثانیه) · `J/K` سطر قبل/بعد · `A/B` تعیین نقطهٔ حلقه · چرخ ماوس روی خط‌کش برای بزرگ‌نمایی.

---

# Reedance Studio — user guide (English)

Install `Reedance-Studio-Setup-1.0.6-x64.exe`, accept the SmartScreen warning (**More info → Run anyway**) because the build is not code-signed, and launch *Reedance Studio*.

The pipeline is deliberately linear: import a content-only `.rddraft.json`, pick the audio from your machine, mark every lyric line on the waveform, then press **Get the output file**. Keys are generated and protected by the app; there is no key picker and no approval ceremony. Export is only blocked by a missing audio file, an unmeasured duration or untimed lines. Replacing the audio clears the marks so stale timings can never be exported. Every byte inside the pack (lesson.json, song audio, cover, story audio) is written with maximum-level DEFLATE, so the `.rdpack` is tighter than a standard ZIP of the same content. Theme: ☾/☀ in the top bar (dark, light, system).

There is no password to create or copy: the studio seals packs with the fixed `enc-main` distribution key that the Android app also carries. Until a real key is provisioned the studio uses the published test key, and those exports are permanently marked as test and must not be published.

Supported target languages are en, es, ko and tr. Turkish is a studio-side
extension over the pinned v1 contract and is flagged in the UI; Turkish packs
must only be published to an Android build that accepts `tr`. Drafts without a
`level` (common in the Turkish set) need one chosen in the overview tab before
export unlocks.

Long songs: use **Distribute N lines** (timeline or export tab) to lay a starting grid over the audio, then nudge only the lines that need it. The export error now lists only the technical reasons (audio, duration, timings, content), never review or approval.

No password at all: packs are sealed with the fixed `enc-main` key and the Android app already holds it, so the file opens itself on the phone. `Settings → File encryption key` only shows the key id, its source and a short fingerprint. If the badge says **test key**, load the real key file once with the import button; from then on every export uses the publishing key. See `docs/CRYPTO.md`.

Keyboard: `Space` play/pause, `M` capture a mark and advance, `←/→` ±100 ms (`Shift` ±1 s), `J/K` previous/next line, `A/B` loop points.

**Lyric sync.** The timeline axis runs **left to right**, the same direction as playback. The waveform shows an orange **playhead** and a blue **capture line**: drag the capture line (or click the waveform) to move it — the audio follows — then press **⏱ Capture line start (M)** to stamp the selected line's start at that point. You can also press **⏱ Capture start** next to any line directly. Zoom with the zoom slider, the mouse wheel over the timeline, or the **Fit** button; drag the capture line for precise placement.

**Story section.** Every song can also carry a story. In the **Story** tab you write the story title and pages; each page holds lines with the same four fields a lyric line has — text, FA translation, EN translation and word-by-word tokens (use *Rebuild from text*). **Story narration audio**: add an audio file from your own computer (**mp3, m4a or wav**) exactly like the song audio — play, remove or replace it with *Choose another audio*. At export it ships in the pack as `story.<ext>` and is referenced from `lesson.json` with its hash and duration. The **Speak page / Speak line** buttons read the text with the system voice so you can check the narration while authoring (that is only a preview — the audio that ships is the file you selected). Story lines are never timed or synced; at export they enter `lesson.json` in the shape the Android app reads (`story.title` + `story.pages` with per-line and per-word translations). A story with no lines is left out of the pack.
