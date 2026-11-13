# راهنمای استفاده — Reedance Studio

## نصب

1. فایل `Reedance-Studio-Setup-1.0.0-x64.exe` را اجرا کنید.
2. چون فایل با گواهی تجاری امضا نشده است، ویندوز SmartScreen هشدار می‌دهد: **More info → Run anyway**.
3. مسیر نصب را انتخاب کنید (نصب برای کاربر جاری، بدون نیاز به دسترسی مدیر).
4. میان‌بر روی دسکتاپ و منوی استارت ساخته می‌شود.

نسخهٔ فایل: `1.0.0` — SHA-256:
`41eedbc0da1e322e57e0168cfe5e70f59885406da0d8dd5d075524714ff9125b`

## جریان کار

| مرحله | در برنامه | شرط عبور |
| --- | --- | --- |
| ۱. ورود پیش‌نویس | «ورود پیش‌نویس» → فایل `*.rddraft.json` | ساختار و قواعد محتوایی بدون خطا؛ هیچ timing/مدیایی در فایل نباشد |
| ۲. انتخاب صوت | تب «صوت» → انتخاب فایل از سیستم | کپی محلی، هش SHA-256، کدک و مدت اندازه‌گیری شود |
| ۳. سینک لیریک | تب «تایم‌لاین» | هر سطر زمان شروع دارد، زمان‌ها صعودی و داخل مدت صوت‌اند |
| ۴. بازبینی | دکمهٔ ✓ کنار هر سطر + چک‌لیست حقوق | همهٔ سطرها با همین صوت تأیید شوند، مدرک حقوق ثبت شود |
| ۵. تأیید نهایی | «ثبت تأیید انسانی» | فقط وقتی همهٔ گیت‌ها سبز باشند |
| ۶. خروجی | تب «بازبینی و خروجی» | ساخت `.rdpack` رمزنگاری‌شده + `latest.json` امضاشده |

اگر صوت را عوض کنید، همهٔ زمان‌ها و تأیید باطل می‌شوند؛ این رفتار عمدی است و در هشدار برنامه هم نوشته می‌شود.
اگر محتوا، زمان‌ها یا چک‌لیست حقوق بعد از تأیید تغییر کند، تأیید خودکار باطل می‌شود.

## کلیدها

- کلیدهای **آزمایشی** فقط برای تمرین جریان‌اند و خروجی‌شان هرگز «منتشرشده» ثبت نمی‌شود.
- برای انتشار واقعی: «تنظیمات → کلیدها → ساخت کلید تولیدی»، سپس از کلیدهای تولیدی پشتیبان رمزدار بگیرید.
- کلید خصوصی امضا و کلید AES فقط روی همین رایانه می‌مانند. گم شدن‌شان یعنی نسخه‌های بعدی منتشر یا رمزگشایی نمی‌شوند.

## انتشار

تب «کتابخانه» هر نسخه، حجم، هش، وضعیت (`ساخته‌شده`/`تأییدشده`/`منتشرشده`/`ناموفق`) و فایل‌های گم‌شده را نشان می‌دهد. «بازبینی آرشیو» فایل‌ها را دوباره اسکن می‌کند. انتشار، `latest.json` میزبانی‌شده روی HTTPS را با امضای محلی مقایسه می‌کند.

## آمار

آمار به تفکیک `targetLanguage` است و واژگان را با `DISTINCT(normalizedKey)` می‌شمارد؛ «جمله» با «سطر لیریک» و «کارت گرامر» با «مفهوم گرامری» یکی نیست. خروجی CSV/JSON از همان صفحه ذخیره می‌شود.

## میان‌برهای تایم‌لاین

`Space` پخش/توقف · `M` ثبت زمان برای سطر انتخابی و رفتن به سطر بعد · `←/→` جابه‌جایی ۱۰۰ میلی‌ثانیه (با `Shift` یک ثانیه) · `J/K` سطر قبل/بعد · `A/B` تعیین نقطهٔ حلقه · چرخ ماوس روی خط‌کش برای بزرگ‌نمایی.

---

# Reedance Studio — user guide (English)

Install `Reedance-Studio-Setup-1.0.0-x64.exe`, accept the SmartScreen warning (**More info → Run anyway**) because the build is not code-signed, and launch *Reedance Studio*.

The pipeline is deliberately linear: import a content-only `.rddraft.json`, pick the audio from your machine, mark every lyric line on the waveform, review each line and the rights checklist, record the human approval, then export. The export button stays locked until every gate is green, and any later change to content, timings, rights or audio invalidates the approval.

Keys are local to the machine and protected by the OS keystore when available. TEST keys exist only to exercise the flow: their exports are permanently marked as test and can never be published.

Keyboard: `Space` play/pause, `M` capture a mark and advance, `←/→` ±100 ms (`Shift` ±1 s), `J/K` previous/next line, `A/B` loop points.
