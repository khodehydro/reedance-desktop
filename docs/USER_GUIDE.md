# راهنمای استفاده — Reedance Studio

## نصب

1. فایل `Reedance-Studio-Setup-1.0.1-x64.exe` را اجرا کنید.
2. چون فایل با گواهی تجاری امضا نشده است، ویندوز SmartScreen هشدار می‌دهد: **More info → Run anyway**.
3. مسیر نصب را انتخاب کنید (نصب برای کاربر جاری، بدون نیاز به دسترسی مدیر).
4. میان‌بر روی دسکتاپ و منوی استارت ساخته می‌شود.

نسخهٔ فایل: `1.0.1` — SHA-256:
`f5fcfa6596bfad092244037b9fff3897ad8fa32dc5a39454ac8553c69a859119`

## زبان‌ها

پیش‌نویس‌های `en`، `es`، `ko` و `tr` پذیرفته می‌شوند. زبان **ترکی** یک افزونهٔ سمت استودیو است: قرارداد v1 فقط `en/es/ko` را فهرست می‌کند، بنابراین بسته‌های `tr` با یک هشدار مشخص می‌شوند و باید فقط روی نسخه‌ای از اپ اندروید منتشر شوند که `tr` را می‌پذیرد. اگر پیش‌نویس فیلد `level` نداشته باشد (مثل بعضی فایل‌های ترکی)، در تب «نمای کلی» سطح A1–C2 را انتخاب کنید؛ تا آن زمان خروجی قفل است.

## جریان کار

| مرحله | در برنامه | شرط عبور |
| --- | --- | --- |
| ۱. ورود پیش‌نویس | «ورود پیش‌نویس» → فایل `*.rddraft.json` | ساختار و قواعد محتوایی بدون خطا؛ هیچ timing/مدیایی در فایل نباشد |
| ۲. انتخاب صوت | تب «صوت» → انتخاب فایل از سیستم | کپی محلی، هش SHA-256، کدک و مدت اندازه‌گیری شود |
| ۳. سینک لیریک | تب «تایم‌لاین» | هر سطر زمان شروع دارد، زمان‌ها صعودی و داخل مدت صوت‌اند |
| ۴. خروجی | تب «خروجی» → دکمهٔ **دریافت فایل خروجی** | ساخت `.rdpack` + `latest.json` امضاشده با کلیدهای خودکار |

کلیدها را خود برنامه می‌سازد (AES-256 و Ed25519، محافظت‌شده با DPAPI) و بازبینی/تأیید انسانی و چک‌لیست حقوق از جریان کار حذف شده است. فقط سه چیز خروجی را قفل می‌کند: نبودِ صوت، مدت نامشخص، و سطرهای بدون زمان یا زمان‌های نامرتب.

اگر صوت را عوض کنید، همهٔ زمان‌ها پاک می‌شوند و باید دوباره سینک کنید؛ این رفتار عمدی است.
ظاهر برنامه از دکمهٔ ☾/☀ بالای صفحه بین تیره، روشن و «مطابق سیستم» جابه‌جا می‌شود.

## کلیدها

کلیدها کاملاً خودکار هستند: در اولین اجرا ساخته می‌شوند، در پروفایل ویندوز با DPAPI محافظت می‌شوند و برای همهٔ خروجی‌ها دوباره استفاده می‌شوند. هیچ انتخابی لازم نیست. تنها نکته: اگر پروفایل ویندوز پاک شود، بسته‌های قبلی دیگر با همان کلید تأیید نمی‌شوند.

## انتشار

تب «کتابخانه» هر نسخه، حجم، هش، وضعیت (`ساخته‌شده`/`تأییدشده`/`منتشرشده`/`ناموفق`) و فایل‌های گم‌شده را نشان می‌دهد. «بازبینی آرشیو» فایل‌ها را دوباره اسکن می‌کند. انتشار، `latest.json` میزبانی‌شده روی HTTPS را با امضای محلی مقایسه می‌کند.

## آمار

آمار به تفکیک `targetLanguage` است و واژگان را با `DISTINCT(normalizedKey)` می‌شمارد؛ «جمله» با «سطر لیریک» و «کارت گرامر» با «مفهوم گرامری» یکی نیست. خروجی CSV/JSON از همان صفحه ذخیره می‌شود.

## میان‌برهای تایم‌لاین

`Space` پخش/توقف · `M` ثبت زمان برای سطر انتخابی و رفتن به سطر بعد · `←/→` جابه‌جایی ۱۰۰ میلی‌ثانیه (با `Shift` یک ثانیه) · `J/K` سطر قبل/بعد · `A/B` تعیین نقطهٔ حلقه · چرخ ماوس روی خط‌کش برای بزرگ‌نمایی.

---

# Reedance Studio — user guide (English)

Install `Reedance-Studio-Setup-1.0.1-x64.exe`, accept the SmartScreen warning (**More info → Run anyway**) because the build is not code-signed, and launch *Reedance Studio*.

The pipeline is deliberately linear: import a content-only `.rddraft.json`, pick the audio from your machine, mark every lyric line on the waveform, then press **Get the output file**. Keys are generated and protected by the app; there is no key picker and no approval ceremony. Export is only blocked by a missing audio file, an unmeasured duration or untimed lines. Replacing the audio clears the marks so stale timings can never be exported. Theme: ☾/☀ in the top bar (dark, light, system).

Keys are local to the machine and protected by the OS keystore when available. TEST keys exist only to exercise the flow: their exports are permanently marked as test and can never be published.

Supported target languages are en, es, ko and tr. Turkish is a studio-side
extension over the pinned v1 contract and is flagged in the UI; Turkish packs
must only be published to an Android build that accepts `tr`. Drafts without a
`level` (common in the Turkish set) need one chosen in the overview tab before
export unlocks.

Keyboard: `Space` play/pause, `M` capture a mark and advance, `←/→` ±100 ms (`Shift` ±1 s), `J/K` previous/next line, `A/B` loop points.
