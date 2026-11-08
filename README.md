# Noctua

*بومة بتشوف في الضلمة.* أداة بتدخل على أي موقع من بره زي مستخدم حقيقي، وتكشف اللي مخفي: الصفحة اللي بتقع، والـ AI اللي بيخرف أو بيرد رد ثابت، والموديل اللي واقع من غير ما حد يحس.

## الطريقة السهلة: برنامج بنافذة (من غير أوامر)

**ويندوز:** دوس دبل كليك على **`Start.bat`**. أول مرة بينزّل اللي محتاجه لوحده (دقيقة أو اتنين)، وبعدها بيفتح نافذة البرنامج على طول.
**ماك أو لينكس:** `sh start.sh`

في النافذة:
1. اكتب رابط الموقع.
2. علّم على اللي عايز تختبره (الموقع والـ API، الواجهة في المتصفح، الموديلات مباشرة).
3. اكتب المفاتيح لو عايز (كلها اختيارية ماعدا اختبار الموديلات).
4. دوس **ابدأ الاختبار**، وشوف النتايج بتظهر لحظة بلحظة.

اللي هتلاقيه:
- **اللي محتاج انتباهك:** قايمة فيها الفشل والتحذيرات بس، وتحت كل واحدة اقتراح بالعربي.
- **انسخ النتيجة:** بينسخ الفشل والتحذيرات في نص واحد تلصقه في الشات، من غير أي مفتاح.
- **إيقاف:** بيوقف الاختبار في أي وقت.
- **الاختبارات السابقة:** كل تشغيل بيتحفظ، وتفتح تقريره الكامل بلقطات الشاشة.
- زرار **EN** بيحوّل الواجهة للإنجليزي.
- لو قفلت نافذة البرنامج، الشاشة السودا بتقفل لوحدها بعد ثواني.

**الأمان:** البرنامج بيشتغل على جهازك بس (`127.0.0.1`) ومحدش من الإنترنت يوصله، وأي موقع تاني مش هيقدر يشغّله. المفاتيح بتروح لموقعك أو للمزود فقط. لو علّمت "احفظ المفاتيح" بتتحفظ بنص عادي في `settings.json` جنب البرنامج، فماتبعتش الفولدر لحد، وفيه زرار "امسح المفاتيح المحفوظة".

**مفيش مفاتيح مطلوبة.** الأداة بتختبر الموقع من بره زي المستخدم بالظبط، ومابتعرفش مسبقاً مين الموديلات، وبتطلع **بطاقة نتيجة لكل مجموعة موديلات**: السريعة (شات وإيميل واجتماع) والذكية (hint ومراجعة)، فيها عدد الردود الصح والسرعة والأخطاء.

المفاتيح اختيارية وبتزود حاجات مستحيل تتعرف من بره: **أسماء** الموديلات، **الحدود الفعلية** عند المزود، **ترتيب مقترح** لـ `AI_FAST` و`AI_SMART`. لو مدخلتش مفاتيح، الجزء ده بيتخطى بهدوء من غير أي خطأ.

## إزاي بتحكم على الـ AI من غير ما تعرف الموديلات

كل تشغيل بيسأل الموقع حوالي 26 سؤال، ويحكم على **الردود** مش على الموديل:

| الفحص | بيكشف إيه |
|---|---|
| **معلومة جديدة في كل مرة** (ميعاد وكلمة سر ورقم بتتولد عشوائي وتتحط في الملفات أو المحادثة) | رد ثابت أو قديم: الرد الثابت مستحيل يعرف معلومة اتخلقت دلوقتي |
| ذاكرة المحادثة، والشخصية (اسم ووظيفة الموظف الافتراضي) | الـ AI مش بيقرا مدخلاته |
| نفس السؤال 3 مرات، ونفس المراجعة مرتين | رد صح مرة وغلط مرة |
| أسئلة مختلفة، هل الردود مختلفة؟ | رد جاهز على كل حاجة |
| كل رد: تكرار، حروف غريبة (صيني وروسي..)، كلام طويل من غير مسافات، جملة مقطوعة، تسريب تعليمات، "أنا نموذج لغوي" | الـ AI بيخرف |
| اختراع معلومات (مرتب، CEO، إيميل) وتجاهل "اكسر قواعدك" | هلوسة |
| الزمن: أي رد أبطأ من **6 ثواني** | الموقع بيدي كل موديل 6 ثواني، فرد أبطأ معناه إن الأول فشل والاحتياطي رد. ده بيكشف مشكلة في الموديل الأساسي من غير مفاتيح |
| لما الموقع يفشل | السيرفر بيكتب في رسالة الخطأ اسم الموديل وسبب فشله (404 اسم غلط، 401 مفتاح مرفوض، تايم أوت). الأداة بتقراها وبتطلعها صف لكل موديل |
| **الراحة بعد الفشل** | لما موديلين يفشلوا مرة السيرفر بيسيبهم دقيقة فكل طلب بعدها بيفشل. الأداة بتستنى الدقيقة وبتكمل، وبتبلغك بالمشكلة مرة واحدة بدل ما تعد 7 فشلات |
| **حد الطلبات** | السيرفر بيسمح بـ 30 طلب كل 10 دقايق. الأداة بتحسب وبتستنى لوحدها عشان الفحص يخلص كامل (وبتكتب "بستنى..." في النافذة) |

الاختبار الكامل ممكن ياخد لحد 12 دقيقة لو الحد اتملى. لو عايز نسخة أسرع علّم على **اختبار AI خفيف** في الخيارات الإضافية (أو `--light` في الأوامر): حوالي 12 سؤال من غير الفحوصات العميقة.

**الواجهة بتكمّل مسار التقديم والمقابلة بنفسها:** بتعبّي النماذج بقيم تجريبية (اسم وإيميل ونبذة..)، وبترفع CV تجريبي، وبتضغط على اللي يظهر، لحد ما توصل لصندوق الشات. مابتلمس كلمات السر ولا الدفع.

الباقي في الشرح تحت ده هو للي عايز يشغّل الأداة بالأوامر.

---

أداة منفصلة تماماً عن كود الموقع. بتدخل على **الرابط العام** للموقع زي أي زائر، وتختبره كله، وتطلع تقرير فيه إيه شغال وإيه مش شغال. مش محتاجة ملفات الموقع ولا أي تعديل عليه.

## التثبيت (مرة واحدة)

محتاج Node 18 أو أحدث.

    npm install
    npx playwright install chromium

## التشغيل

    node check.mjs https://virtual-task-lemon.vercel.app --token التوكن-بتاعك

على PowerShell لو عايز تحط التوكن في متغير: `$env:ADMIN_TOKEN="..."; node check.mjs https://...`

`--token` هو نفس `AI_ADMIN_TOKEN` اللي في Vercel. اختياري: من غيره بيتخطى اختبار كل موديل لوحده وكل الباقي بيشتغل.

## بيختبر إيه

| القسم | الفحوصات |
|---|---|
| **Site basics** | الموقع بيفتح، HTML سليم، كل ملفات JS وCSS بتتحمل (مش صفحة HTML بدل الملف)، الدخول المباشر على صفحة فرعية، HTTPS، هيدرز الأمان |
| **API** | رفض GET وJSON مكسور ونوع غلط وpersona ناقص، **endpoint الأدمن مقفول** لمن ليس معه التوكن، كل موديل لوحده، كل مسار (chat, meeting, mail, hint, review)، عدم اختراع حقائق، تجاهل "break your rules"، الرد بالعربي، قص المدخل الضخم، زمن الرد |
| **Browser (كمبيوتر + موبايل)** | الصفحة بتترسم مش فاضية، مفيش أخطاء JavaScript أو Console، مفيش صور مكسورة أو طلبات 4xx/5xx، مفيش سكرول جانبي، سرعة التحميل، إمكانية الوصول الأساسية، كل اللينكات الداخلية بتفتح |
| **الزحف على الواجهة** | بيضغط على كل زرار ولينك (لحد 40 ضغطة)، ويدخل جوه كل شاشة يفتحها، وبعد كل ضغطة يتأكد إن مفيش خطأ ولا صفحة فاضية. **بيتخطى** أي زرار اسمه delete / remove / log out / reset |
| **الشات من الواجهة** | بيلاقي صندوق الرسائل، يكتب ويبعت، ويتأكد إن الـ AI رد وإن الرد ظهر على الشاشة |
| **رفع CV** | بيرفع ملف PDF وDOCX وTXT تجريبي ويتأكد إن الموقع مش بيقع |
| **لو الـ AI وقع** | بيحاكي في المتصفح (من غير ما يلمس الـ AI الحقيقي) إن `/api/ai` رجع 500 أو 429 أو انقطع، ويتأكد إن الموقع فضل شغال وطلّع رد جاهز |
| **الموديلات مباشرة** | بـ `--bench` (تحت): المفتاح، الاسم، السرعة، الجودة، الحدود، الترتيب المقترح |
| **Flows بتاعتك** | مسارات بتكتبها إنت في `checker.config.json` (تحت) |

## اختبار الموديلات مباشرة (`--bench`)

الموقع بيرجع النص بس، من غير اسم الموديل اللي رد. فمن بره الموقع **مفيش طريقة تعرف** هل Groq هو اللي رد ولا Gemini الاحتياطي. وعشان كده لو مفتاح Groq غلط، كل الفحوصات بتطلع PASS والـ Gemini هو اللي شايل الشغل.

الحل من غير ما تلمس الموقع: الأداة تكلم Groq وGemini **بنفسها** بمفاتيحك، وتسألهم نفس أسئلة الموقع بنفس الـ prompts.

في PowerShell (المفاتيح بتتقرا من النافذة دي بس، ومابتتطبعش ولا بتتحفظ في التقرير):

    $env:GROQ_API_KEY="مفتاح-groq"
    $env:GEMINI_API_KEY="مفتاح-gemini"
    node bench.mjs

وبتختبر الموديلات اللي عندك حالياً (`llama-3.1-8b-instant` و`llama-3.3-70b-versatile` و`gemini-3.5-flash-lite`). لو عايز غيرهم:

    node bench.mjs --models groq:llama-3.1-8b-instant,gemini:اسم-الموديل

ولو عايز تشغّل كل حاجة مع بعض: `node check.mjs https://موقعك --bench`

**بتقولك إيه:**

| الفحص | معناه |
|---|---|
| المفتاح مقبول | لو Groq رفضه (401)، يبقى الموقع عمره ما هيستخدم Groq. اعمل مفتاح جديد |
| الموديل موجود | لو الاسم مش في قايمة حسابك (اتسحب أو مكتوب غلط)، بتعرف قبل ما الموقع يقع |
| السرعة | الوسيط وأبطأ طلب وعدد التوكنز في الثانية. الموقع بيدي كل موديل **6 ثواني** وبعدها يتخطاه، فأي موديل أبطأ من كده بيتعلّم تحذير |
| الجودة | نفس حالات الاختبار (ما يخترعش مرتب، ما يكسرش القواعد، المراجعة تطلع JSON سليم...) |
| الحدود | الحدود الفعلية اللي Groq بيقولها في ردوده (يعني مش لازم تصوّر صفحة Limits) |
| الترتيب المقترح | `AI_FAST` و`AI_SMART` الأنسب، مع خلط المزودين عشان لو واحد وقع التاني يكمّل |

**ملاحظات:**
- التشغيل بيستهلك حوالي 13 طلب لكل موديل من **حصتك عند المزود** (نفس حصة الموقع)، مش من حد الموقع.
- الأداة مش بتقدر تقرا قيم Vercel الحالية. قارن الاقتراح بالموجود عندك وغيّر بس لو مختلف.
- لو الموديلين الأوائل اتعادلوا في الجودة، الأداة بتقولك إنها مش قادرة تفرّق بينهم. ساعتها اختار بحكمتك (في المراجعة والـ hint الموديل الأكبر غالباً أأمن).
- الاختبار قصير. لو الفرق بين موديلين صغير، أعده مرتين قبل ما تقرر.

## معرفة مين رد على الموقع نفسه (اختياري، بيحتاج تعديل في الموقع)

لو عايز الأداة تقولك "الرد جه من groq:llama-3.1-8b-instant" وقت اختبار الموقع، السيرفر لازم يرجّع اسم الموديل. في `server/ai-core.js` جوه `callModel` غيّر السطر ده:

    return c.kind === "review" ? parseReview(raw) : { text: tidy(raw) };

لده:

    const out = c.kind === "review" ? parseReview(raw) : { text: tidy(raw) };
    return { ...out, model: id };

وتأكد إن `api/ai.js` بيرجّع حقل `model` للمتصفح (أو بيحطه في هيدر `X-AI-Model`). الأداة بتقرا الاتنين لوحدها.

بعدها:

    node check.mjs https://موقعك --expect groq

لو حد غير Groq رد، بتطلع WARN: "fallback is answering".
اسم الموديل بيظهر للزوار كمان، وده مش سر خطير بس اعرف إنه بيتعرض.

## قراءة النتيجة

- **FAIL** = حاجة مكسورة فعلاً. السبب بعد السهم، وفي الخطوات اللي فشلت لقطة شاشة في التقرير.
- **WARN** = جودة أو تحسين (رد موديل أضعف من المتوقع، هيدر ناقص). أعد التشغيل مرة قبل ما تقلق.
- **SKIP** = اتخطى لسبب مكتوب (مثلاً الحد المجاني خلص).

التقرير بيتحفظ في `reports/<الوقت>/`: افتح `report.html`، وفيه `report.json` وفولدر `screenshots`.
الأمر بيرجع exit code = 1 لو في أي FAIL، فتقدر تحطه في GitHub Actions.

## الخيارات

    --api-only        الموقع والـ API بس (من غير متصفح)
    --ui-only         الموقع والمتصفح بس (من غير طلبات AI مباشرة)
    --quick           متصفح كمبيوتر بس وضغطات أقل
    --headed          يفتح نافذة المتصفح قدامك وانت بتشوفه
    --max-clicks 80   عدد الضغطات في الكمبيوتر (الافتراضي 40)
    --light           اختبار AI خفيف (من غير الفحوصات العميقة)
    --slow-ms 6000    رد أبطأ من كده معناه إن موديل احتياطي هو اللي ردّ
    --ai-budget 90    سقف لعدد طلبات AI في التشغيل كله
    --gap 1200        الانتظار بين طلبات الـ AI بالميلي ثانية
    --config ملف      ملف إعدادات تاني
    --out فولدر       مكان التقرير

## حد الطلبات

السيرفر بيسمح بـ 30 طلب AI كل 10 دقايق للزائر. الأداة بتتحكم في ده لوحدها: لما تقرّب من الحد بتستنى لحد ما يتصفّر وبتكمل، فالفحص مايتقطعش. وكل اللي بيستهلك من الحد (الـ API والمتصفح) محسوب مع بعض. لو عايز فحص من غير أي انتظار استخدم `--light` أو `--ui-only`.

## إعدادات خاصة بالموقع (`checker.config.json`)

    {
      "ignoreConsole": ["ResizeObserver loop"],   // أخطاء Console تتجاهلها (regex)
      "ignoreUrls": ["googletagmanager"],         // طلبات تتجاهلها لو رجعت 4xx
      "skipClickText": ["Apply now"],             // أزرار ماتضغطش عليها
      "flows": [ ... ]                            // مسارات مخصصة
    }

الـ flow سلسلة خطوات. الـ selectors بتاعة Playwright (`text=Inbox`, `#id`, `.class`):

| خطوة | معناها |
|---|---|
| `{"goto":"/"}` | افتح صفحة |
| `{"click":"text=Send"}` | اضغط |
| `{"fill":["textarea","نص"]}` | اكتب في حقل |
| `{"press":"Enter"}` | اضغط زرار كيبورد |
| `{"upload":["input[type=file]","pdf"]}` | ارفع ملف CV تجريبي (`pdf` أو `docx` أو `txt`) |
| `{"waitApi":"/api/ai"}` | استنى طلب AI وتأكد إنه رجع 200 |
| `{"expectText":"Monday"}` | تأكد إن النص ظاهر |
| `{"expectVisible":"#result"}` | تأكد إن العنصر ظاهر |
| `{"wait":2000}` / `{"screenshot":true}` | انتظر / صوّر |

فيه مثال جاهز في `checker.config.example.json`.

## اختبار الأداة نفسها

    npm run selftest

بيشغّل موقع تجريبي سليم وموقع تجريبي فيه عيوب متعمدة، وكمان Groq وGemini وهميين للـ benchmark (خطأ JavaScript، صورة مكسورة، endpoint أدمن مفتوح، موديل بيخترع مرتب، hint بيرجع 502) ويتأكد إن الأداة بتعدّي الأول وبتمسك التاني.

## حدود الأداة

- الزحف على الواجهة بيعتمد على اللي بيظهر ويتضغط عليه. شاشة محتاجة تسجيل دخول أو خطوات معينة ما بتوصلهاش من نفسها: اكتب لها flow.
- بتتأكد إن الشات بيرد، مش إن الرد عبقري. جودة الرد مختبرة في قسم الـ API بقواعد بسيطة (WARN لما الموديل يتذبذب).
- حركات الضغط ممكن تغيّر حالة جوه الموقع (مثلاً تحاول تعمل Apply). استخدم `skipClickText` لأي زرار مش عايزه يتضغط.


## Continuous monitoring (new)

The app window now has a **Continuous monitoring** card at the top.

- Add a site with its address. Noctua checks it every N minutes (default 5): is it up, how fast, when does the SSL certificate expire. Results and history are kept in the `data/` folder next to the app.
- Optional **deep check** every N minutes (15 or more): the full Noctua test (API and browser) as a background process. It never runs at the same time as a manual test.
- **Alerts** (Telegram bot and/or a Slack/Discord-style https webhook): sent when a site fails two checks in a row, when it recovers, when a deep check has failures. Use "Send test alert" to confirm.
- The page updates live. Saved tokens are never sent back to the page.
- While at least one site is being monitored, Noctua does not close itself when you close the window. Keep the black console window open (or run `node app.mjs --no-open` on a server).
- "Live" means about once a minute at best. A browser deep check takes minutes by design.

Fixed: the app used to close itself after 25 seconds without a signal from the window (for example when the window was minimized). It now waits 3 minutes, and never while monitoring. If the server is gone, the Start button now says so instead of doing nothing.

## What the Watch tab covers (v1.2)

The Watch tab has three screens.

- **Overview**: sites up, 24-hour uptime, average response, and whether this computer has internet. One row per site with a 24-hour health strip.
- **Site details**: for the site you pick: where the time of the last check went (DNS, connect, TLS, server wait, download), a response-time chart (1h / 24h) with outages shaded, uptime and speed for 1h / 24h / 7d / 30d (average, slowest 5%, max), IP, HTTP status, TLS version, certificate issuer and days left, server, size, redirects, page title, security headers, extra pages, a required word, content changes, outages with how long they lasted, and the latest checks. If a check fails, it says at which stage (DNS, connect, TLS, server reply, download).
- **This computer**: internet status (Google, Cloudflare, Microsoft, DNS speed), CPU and memory, Noctua's own memory, scheduler delay, saved data size, and the last alerts sent. Alert settings and Quit live here.

Per-site settings (Site details, bottom): extra paths to check (one per line, for example `/api/health`), a word that must appear on the page, slowest acceptable response, and an alert when the page content changes.

When this computer has no internet, a failed check is not counted as a site outage and no alert is sent. An alert is also sent once when a certificate has fewer than 14 days left.

## Install on this computer (Windows)

Double-click `Install.bat`. It copies Noctua to `%LOCALAPPDATA%\Noctua`, sets it up, adds Desktop and Start Menu icons, and can start it automatically with Windows. It runs without a console window; the "Quit Noctua completely" button stops it. Opening the icon while it is already running just shows the existing window. Run `Install.bat` from a newer zip to update (your data and settings are kept). `Uninstall.bat` removes everything.


## Desktop app (Electron)

Noctua is now a real desktop program: its own window, a tray icon next to the clock, Windows notifications for alerts,
and the monitoring keeps running in the background when you close the window (use Quit in the tray menu to stop it).

- Try it from source: `npm install` then `npm run desktop`.
- Build the installer (run on Windows): `npm install` then `npm run dist`. The result is `dist\Noctua Setup 1.3.0.exe`.
- Data, settings and reports live in `%APPDATA%\Noctua`. If you used the old Install.bat version, your sites and history are copied over on first start.
- The deep browser test uses Microsoft Edge or Google Chrome already on the computer, so nothing else is downloaded.
- The old Install.bat / Start.bat way still works if you prefer it.
