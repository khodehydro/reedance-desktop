# راهنمای استفاده — Reedance Studio

## نصب

1. فایل `Reedance-Studio-Setup-1.0.11-x64.exe` را اجرا کنید.
2. چون فایل با گواهی تجاری امضا نشده است، ویندوز SmartScreen هشدار می‌دهد: **More info → Run anyway**.
3. مسیر نصب را انتخاب کنید (نصب برای کاربر جاری، بدون نیاز به دسترسی مدیر).
4. میان‌بر روی دسکتاپ و منوی استارت ساخته می‌شود.

نسخهٔ فایل: `1.0.11` — SHA-256:
`b8f2d1e06f7c158f8a8cecda8dcc2b85b8ab85573a6320509fe47b41ad62251d`

## زبان‌ها

پیش‌نویس‌های `en`، `es`، `ko` و `tr` پذیرفته می‌شوند. زبان **ترکی** یک افزونهٔ سمت استودیو است: قرارداد v1 فقط `en/es/ko` را فهرست می‌کند، بنابراین بسته‌های `tr` با یک هشدار مشخص می‌شوند و باید فقط روی نسخه‌ای از اپ اندروید منتشر شوند که `tr` را می‌پذیرد. اگر پیش‌نویس فیلد `level` نداشته باشد (مثل بعضی فایل‌های ترکی)، در تب «نمای کلی» سطح A1–C2 را انتخاب کنید؛ تا آن زمان خروجی قفل است.

## جریان کار

| مرحله | در برنامه | شرط عبور |
| --- | --- | --- |
| ۱. ورود پیش‌نویس | «ورود پیش‌نویس» → فایل `*.rddraft.json` | ساختار و قواعد محتوایی بدون خطا؛ هیچ timing/مدیایی در فایل نباشد |
| ۲. انتخاب صوت | تب «صوت» → انتخاب فایل از سیستم | کپی محلی، هش SHA-256، کدک و مدت اندازه‌گیری شود |
| ۳. سینک لیریک | تب «تایم‌لاین» → دکمهٔ **توزیع یکنواخت** یا ثبت دستی با `M` | هر سطر زمان شروع دارد، زمان‌ها صعودی و داخل مدت صوت‌اند |
| ۴. خروجی | تب «خروجی» → دکمهٔ **دریافت فایل خروجی** | ساخت `.rdpack` (کلید `enc-main`) + `latest.json` امضاشده؛ بدون هیچ رمزی؛ همه‌ی داخلی بسته با حداکثر سطح DEFLATE فشرده می‌شود |

سینک لیریک (از نسخهٔ 1.0.9): محور تایم‌لاین **از چپ به راست** است و waveform دقیقاً با زمان واقعی فایل هم‌تراز است — طول صوت را خودِ دیکدر صوتی اندازه می‌گیرد و اگر با سربرگ فایل (مثلاً MP3های VBR یا دارای کاور بزرگ) بیش از ۲۵۰ میلی‌ثانیه اختلاف داشت، مقدار دیکدر جایگزین می‌شود. فقط یک خط نارنجی (**نوک پخش**) وجود دارد: با گوش دادن پخش کنید و در لحظهٔ درست **ثبت شروع سطر (M)** را بزنید؛ سطر بعدی خودکار انتخاب می‌شود. **ثبت پایان سطر (E)** پایانِ سطرِ در حال پخش را ثبت می‌کند. این دو دکمهٔ بزرگ در «میز ثبت» زیر waveform کنار متن و ترجمهٔ سطر انتخابی قرار دارند. در جدول سطرها هر سطر دو ستون **شروع** و **پایان** دارد: ⏱ همان زمان را از نوک پخش ثبت می‌کند، می‌توانید زمان را تایپ کنید (Enter) و ▶ صدا را به آن نقطه می‌برد. پایانی که ثبت نکرده‌اید کم‌رنگ و ایتالیک نمایش داده می‌شود: این همان مقداری است که در خروجی پر می‌شود (شروع سطر بعدی، و برای آخرین سطر = پایان صوت). مشکلات (بدون شروع، ترتیب اشتباه، بیرون از صوت، هم‌پوشانی در ReeTalk) کنار همان سطر و روی waveform قرمز نشان داده می‌شوند و قبل از ذخیره جلویشان گرفته می‌شود. سرعت پخش 0.5× تا 1× برای سینک دقیق، بزرگ‌نمایی با دکمه‌ها یا `Ctrl` + چرخ ماوس (حول نشانگر ماوس)، و حلقهٔ A/B برای تکرار یک بازه در دسترس است.

**تایم‌لاین کلیپی (از نسخهٔ 1.0.10، مثل CapCut/InShot)** — هم برای آهنگ و هم برای ReeTalk:
- سطرها در ابتدا روی تایم‌لاین نیستند؛ در فهرست سطرها (سمت راست) با خط‌چین و فیلتر «روی تایم‌لاین نیست» دیده می‌شوند. هر سطر را با ماوس بگیرید (⠿) و روی نوار کلیپ زیر waveform رها کنید؛ پیش‌نمایش آبی محل دقیق را نشان می‌دهد و اگر جا نباشد قرمز می‌شود. `Esc` کشیدن را لغو می‌کند.
- سطرِ رهاشده **انتخاب** می‌شود (کلیپ زرد): دستگیرهٔ چپ = شروع، دستگیرهٔ راست = پایان، و کشیدن بدنهٔ کلیپ آن را با همان طول جابه‌جا می‌کند. هنگام کشیدن، زمان دقیق بالای کلیپ نمایش داده می‌شود.
- با رها کردن سطر بعدی، سطر قبلی **قفل** می‌شود (کم‌رنگ، بدون دستگیره)؛ کلیک یا کشیدن روی آن فقط نوک پخش را جابه‌جا می‌کند و زمانش هرگز عوض نمی‌شود. برای ویرایش دوباره، سطر را در فهرست انتخاب کنید.
- کلیپ هیچ‌وقت از روی همسایه‌هایش رد نمی‌شود. لبه‌ها به نوک پخش و لبهٔ کلیپ‌های دیگر می‌چسبند (🧲؛ نگه‌داشتن `Alt` موقتاً برعکسش می‌کند).
- پنل بازرس: ±۱۰ و ±۱۰۰ میلی‌ثانیه برای هر لبه، تایپ زمان، ⏱ از نوک پخش، «برداشتن از تایم‌لاین» (`Delete`). همهٔ تغییرها با `Ctrl+Z` / `Ctrl+Shift+Z` برمی‌گردند.
- بزرگ‌نمایی تا ۴۰۰۰ پیکسل در ثانیه (هر پیکسل ربع میلی‌ثانیه) بدون به‌هم‌ریختگی: فقط بخش دیده‌شده رسم می‌شود. نوار کوچک پایین (نمای کل فایل) برای پرش سریع است.

**ویرایش بعد از ورود و جایگزینی JSON (از نسخهٔ 1.0.11):**
- **آهنگ:** همهٔ بخش‌ها (متن و توکن‌ها، لغات، گرامر، اصطلاح‌ها و جمله‌ها، سؤال‌ها، داستان) بعد از ورود قابل ویرایش‌اند.
- **ReeTalk:** دو زبانهٔ جدید دارد: **گفت‌وگو و نوبت‌ها** (عنوان، هدف، سطح، نام گوینده‌ها، متن و ترجمهٔ هر نوبت، گوینده، توکن‌ها، افزودن/حذف/جابه‌جایی نوبت) و **آموزش و سؤال** (لغات، گرامر با جدول‌ها، اصطلاحات، سؤال‌ها با مرحله، گزینه‌ها، پاسخ درست و نوبت‌های شاهد). خطاهای هر نوبت یا کارت زیر همان مورد نشان داده می‌شود. شناسهٔ مکالمه، زبان و شناسهٔ گوینده‌ها ثابت می‌مانند.
- دکمهٔ **⟳ جایگزینی JSON** بالای پروژه مثل جایگزینی صوت کار می‌کند: یک فایل تازه برای **همان** آهنگ/مکالمه انتخاب کنید (همان songId/dialogueId و همان زبان).
  - صوت و کاور دست‌نخورده می‌مانند و زمانِ سطرهایی که هنوز وجود دارند حفظ می‌شود.
  - سطرهای تغییرکرده دوباره نیاز به بازبینی دارند و سطرهای جدید باید زمان‌گذاری شوند.
  - پنجرهٔ نتیجه تعداد سطرهای جدید/تغییرکرده/حذف‌شده و **شمارهٔ نسخهٔ بعدی** را نشان می‌دهد؛ خروجی بعدی همیشه نسخهٔ جدید (latest + 1) می‌گیرد.

**سطرهای زبان دیگر (بج زبان):** اگر بخشی از آهنگ به زبانی غیر از زبان اصلی است (مثلاً یک سطر انگلیسی در آهنگ اسپانیایی)، در زبانهٔ «متن و واژه» برای آن سطر **زبان سطر** را انتخاب کنید.
- آن سطر در تایم‌لاین، شبیه‌ساز و اپ اندروید با بج نام زبان نمایش داده می‌شود.
- **آموزش داده نمی‌شود:** توکن‌هایش واژه نمی‌گیرند و هیچ لغت، گرامر، اصطلاح، جمله یا سؤالی نمی‌تواند به آن ارجاع دهد. استودیو این ارجاع‌ها را هنگام انتخاب زبان برمی‌دارد و جلوی اضافه‌کردنشان را می‌گیرد.
- ترجمهٔ جمله و معنی کلمه‌به‌کلمه حفظ می‌شوند.
- در فایل JSON همان فیلد `language` روی سطر است (مثل اندروید).

**پخش قسمت مربوط به هر کارت (▶):** هر کارت لغت، گرامر، اصطلاح، جمله و سؤال یک دکمهٔ ▶ دارد. این دکمه از اولین شروع تا آخرین پایانِ سطرها/نوبت‌های مربوط را پخش می‌کند و دقیقاً همان‌جا می‌ایستد، مثل سؤال‌های ReeTalk.
- **آهنگ:**
  - لغت ← سطرهایی که توکنشان به آن واژه وصل است؛
  - اصطلاح، جمله و سؤال ← `lineId`؛
  - گرامر ← سطرهایی که در کارت انتخاب می‌کنید (فقط برای پخش در استودیو؛ در `lesson.json` نمی‌رود).
- **ReeTalk:** در هر کارت «نوبت‌های شاهد» را انتخاب کنید (دکمهٔ «پیدا کردن در مکالمه» نوبت‌هایی را که آن کلمه در آن‌ها آمده پیشنهاد می‌دهد). این پیوندها در `dialogue.json` به‌صورت `evidenceTurnIds` می‌روند.
- در شبیه‌ساز، آهنگ صفحهٔ جدید **کارت‌ها** دارد و کارت‌های ReeTalk دکمهٔ «شنیدن در مکالمه» دارند.
- قرارداد دقیق برای اپ اندروید: `docs/interop/CARD_AUDIO_AND_LINE_LANGUAGE.md`.

**کاور:** فایل کاور بدون هیچ تغییر اندازه یا فشرده‌سازی، بایت‌به‌بایت در پکیج قرار می‌گیرد. زیر پیش‌نمایش، ابعاد واقعی (مثلاً 1600×1600)، فرمت و حجم نمایش داده می‌شود؛ اگر تصویر منبع کمتر از ۵۱۲ پیکسل باشد هشدار می‌دهد (۱۰۲۴ پیکسل یا بیشتر پیشنهاد می‌شود). حداکثر ابعاد: آهنگ 8192، ReeTalk 4096 پیکسل در هر ضلع.

## شبیه‌ساز اندروید (پیش از خروجی)

تب **📱 شبیه‌ساز اندروید** (یا دکمهٔ Simulator بالای پروژه) همان صفحه‌ای را که کاربر روی گوشی می‌بیند با همین زمان‌بندی‌ها نشان می‌دهد — زمان‌ها با همان قاعدهٔ خروجی محاسبه می‌شوند، پس آنچه اینجا می‌بینید همان است که در اپ دیده می‌شود:

- **آهنگ:** صفحهٔ پخش با کاور، لیریکِ در حال پخش که خودکار اسکرول و برجسته می‌شود، سه حالت «فقط متن / ترجمهٔ جمله / کلمه‌به‌کلمه»، دکمهٔ ▶ برای پخش دقیق هر سطر و مینی‌پلیر با سرعت و تم تیره.
- **ReeTalk:** صفحهٔ چت با کاور پیش از شروع، پیام‌هایی که دقیقاً در زمانِ شروع هر نوبت ظاهر می‌شوند، آواتار دو گوینده با چهار حالت (صدا و پیام / بی‌صدا / فقط صدا / نقش‌آفرینی)، نمای فهرست یا دو پیام آخر، پنهان‌کردن پیام‌ها، ترجمهٔ جمله یا کلمه‌به‌کلمه، اندازهٔ متن و رنگ کاغذ (Sepia، Blue، Peach، Mint، Lavender)، به‌علاوهٔ صفحات لغات، گرامر، اصطلاحات و سؤالات (با پخش نوبتِ شاهد).

کنار گوشی، وضعیت آمادگی خروجی و فهرست ایرادهای زمان‌بندی با دکمهٔ رفتن به تایم‌لاین نمایش داده می‌شود.

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

`Space` پخش/توقف · `M` گذاشتن **شروع** سطر انتخابی روی نوک پخش و رفتن به سطر بعد · `E` ثبت زمان **پایان** · `P` پخش همان سطر · `Delete` برداشتن سطر از تایم‌لاین · `Ctrl+Z` / `Ctrl+Shift+Z` واگرد/ازنو · `+` / `-` بزرگ‌نمایی، `\` نمایش کل فایل · `←/→` جابه‌جایی نوک پخش ۱۰۰ میلی‌ثانیه (با `Shift` یک ثانیه) · `J/K` یا `↑/↓` سطر قبل/بعد · `Ctrl` + چرخ ماوس برای بزرگ‌نمایی حول ماوس، چرخ ساده برای حرکت افقی.

---

# Reedance Studio — user guide (English)

Install `Reedance-Studio-Setup-1.0.11-x64.exe`, accept the SmartScreen warning (**More info → Run anyway**) because the build is not code-signed, and launch *Reedance Studio*.

The pipeline is deliberately linear: import a content-only `.rddraft.json`, pick the audio from your machine, mark every lyric line on the waveform, then press **Get the output file**. Keys are generated and protected by the app; there is no key picker and no approval ceremony. Export is only blocked by a missing audio file, an unmeasured duration or untimed lines. Replacing the audio clears the marks so stale timings can never be exported. Every byte inside the pack (lesson.json, song audio, cover, story audio) is written with maximum-level DEFLATE, so the `.rdpack` is tighter than a standard ZIP of the same content. Theme: ☾/☀ in the top bar (dark, light, system).

There is no password to create or copy: the studio seals packs with the fixed `enc-main` distribution key that the Android app also carries. Until a real key is provisioned the studio uses the published test key, and those exports are permanently marked as test and must not be published.

Supported target languages are en, es, ko and tr. Turkish is a studio-side
extension over the pinned v1 contract and is flagged in the UI; Turkish packs
must only be published to an Android build that accepts `tr`. Drafts without a
`level` (common in the Turkish set) need one chosen in the overview tab before
export unlocks.

Long songs: use **Distribute N lines** (timeline or export tab) to lay a starting grid over the audio, then nudge only the lines that need it. The export error now lists only the technical reasons (audio, duration, timings, content), never review or approval.

No password at all: packs are sealed with the fixed `enc-main` key and the Android app already holds it, so the file opens itself on the phone. `Settings → File encryption key` only shows the key id, its source and a short fingerprint. If the badge says **test key**, load the real key file once with the import button; from then on every export uses the publishing key. See `docs/CRYPTO.md`.

Keyboard: `Space` play/pause, `M` capture the selected line's start and advance, `E` capture the end of the line being played, `P` play the selected line, `←/→` ±100 ms (`Shift` ±1 s), `J/K` or `↑/↓` previous/next line, `Ctrl` + wheel zoom.

**Lyric sync (1.0.9).** The axis runs **left to right** and the waveform is mapped to the real audio time: the decoder measures the duration and replaces the container value when they differ by more than 250 ms (VBR MP3s, big embedded cover art). There is a single orange **playhead**: listen, and press **Capture line start (M)** at the right moment — the next line is selected automatically. **Capture line end (E)** stamps the end of the line being played. Both big buttons live in the capture dock under the waveform next to the selected line's text. Each table row has **Start** and **End** cells: ⏱ stamps from the playhead, typing a time + Enter sets it, ▶ seeks there. An end you did not record is shown faded/italic — that is exactly what the export fills in (next start; last line: audio end). Problems (missing start, out of order, outside the audio, ReeTalk overlap) are flagged on the row and on the waveform and blocked before saving. Use 0.5×–1× speed for precise syncing, zoom with the buttons or `Ctrl` + wheel (anchored on the cursor), and the A/B loop to repeat a span.

**Clip timeline (1.0.10, CapCut/InShot style)** — songs and ReeTalk alike. Lines start *off* the timeline (dashed in the line list, filter "not on timeline"). Grab a line (⠿) and drop it on the clip track under the waveform; a blue ghost previews the exact spot and turns red when there is no room (`Esc` cancels). The dropped line becomes the **selected** clip (yellow): left handle = start, right handle = end, drag the body to move it with the same length, with a live time readout. Dropping the next line **locks** the previous one (faded, no handles): clicking or dragging over it only moves the playhead, never its timing — reselect it in the list to edit it again. Clips never cross their neighbours; edges snap to the playhead and other clip edges (🧲, hold `Alt` to invert). The inspector offers ±10/±100 ms nudges per edge, typed times, ⏱ from the playhead and *Remove from timeline* (`Delete`); everything is undoable (`Ctrl+Z` / `Ctrl+Shift+Z`). Zoom goes to 4000 px/s (0.25 ms per pixel) without breaking — only the visible span is drawn — and the mini-map under the track jumps anywhere in the file.

**Editing after import and Replace JSON (1.0.11).**
- **Songs:** every section stays editable after import.
- **ReeTalk:** two new tabs.
  - **Dialogue & turns:** title, objective, level, speaker names, and each turn's text, translation, speaker and tokens. Turns can be added, removed and reordered.
  - **Learning & questions:** words, grammar with tables, phrases, and questions with stage, options, correct answer and evidence turns.
  - Errors show under the turn or card they belong to.
- **⟳ Replace JSON** works like replacing the audio. Pick an updated file for the *same* song or dialogue (same id and language).
  - Audio, cover and the timings of surviving lines are kept.
  - Changed lines need review again, and new lines need timing.
  - A summary shows the counts and the **next version number**. The next export always gets latest + 1.

**Lines in another language.** In *Lyrics*, set **line language** on a line that is not in the song language.
- The line gets a language badge in the timeline, the simulator and on Android.
- It is **not taught**:
  - its tokens get no lexeme;
  - no word, grammar, phrase, sentence or question may point to it;
  - the studio removes such links when you pick the language and blocks new ones.
- The sentence translation and word-by-word glosses stay.

**▶ on every card.** Words, grammar, phrases, sentences and questions play from the earliest start to the latest end of their linked lines or turns, the same way ReeTalk question evidence plays.
- **Song words** use the lines whose tokens carry the lexeme.
- **Song phrases, sentences and questions** use `lineId`.
- **Song grammar** uses lines you pick (studio-only, stripped from `lesson.json`).
- **ReeTalk cards** use evidence turns, exported as `evidenceTurnIds`.
- In the simulator, songs have a new **Cards** page.
- Android contract: `docs/interop/CARD_AUDIO_AND_LINE_LANGUAGE.md`.

**Cover.** The cover file is shipped byte-for-byte — no resize, no recompression. The preview shows its real resolution, format and size, and warns when the source is under 512 px (1024 px or more recommended). Maximum side: 8192 px for songs, 4096 px for ReeTalk (the Android installer limits).

**Android simulator.** The **📱 Android simulator** tab replays the project the way the phone shows it, using the exact export timings: the song player (cover, auto-scrolling active lyric, original / sentence / word-by-word modes, per-line ▶) or the ReeTalk chat (cover before playback, bubbles revealed at each turn start, speaker modes both / mute / listen / role-play, list or last-two view, hide-all, translations, text size and paper colours, plus the words / grammar / phrases / questions pages). A side panel lists export readiness and timing problems with a jump to the timeline.

**Story section.** Every song can also carry a story. In the **Story** tab you write the story title and pages; each page holds lines with the same four fields a lyric line has — text, FA translation, EN translation and word-by-word tokens (use *Rebuild from text*). **Story narration audio**: add an audio file from your own computer (**mp3, m4a or wav**) exactly like the song audio — play, remove or replace it with *Choose another audio*. At export it ships in the pack as `story.<ext>` and is referenced from `lesson.json` with its hash and duration. The **Speak page / Speak line** buttons read the text with the system voice so you can check the narration while authoring (that is only a preview — the audio that ships is the file you selected). Story lines are never timed or synced; at export they enter `lesson.json` in the shape the Android app reads (`story.title` + `story.pages` with per-line and per-word translations). A story with no lines is left out of the pack.
