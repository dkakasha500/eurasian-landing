/* ============================================================
   Serverless-функция доставки лида в Telegram-группу.
   Платформа: Vercel (файл api/lead.js → маршрут /api/lead).

   Переменные окружения (задаются в кабинете Vercel, НЕ в коде):
     TELEGRAM_BOT_TOKEN  — токен бота от @BotFather
     TELEGRAM_CHAT_ID    — id группы (отрицательный, напр. -1001234567890)
     LEAD_TOKEN_SECRET   — (необязательно) отдельный секрет для анти-бот токена;
                           если не задан, ключ выводится из токена бота.

   Маршруты:
     GET  /api/lead  → выдаёт подписанный анти-бот токен (страница берёт его при загрузке)
     POST /api/lead  → принимает лид ТОЛЬКО с валидным токеном и с того же домена

   Анти-бот логика (капчи нет, для человека незаметно):
     • токен = <время выдачи>.<HMAC-SHA256>, подделать без серверного ключа нельзя;
     • лид принимается, если токену ≥ 2.5 с (боты постят мгновенно) и ≤ 3 ч
       (страница сама обновляет токен, пока открыта);
     • Origin/Referer запроса должен совпадать с хостом сайта (прямые запросы
       с чужих доменов отклоняются; если браузер не прислал ни того, ни другого —
       решает токен);
     • honeypot-поле «website»: заполнено → бот, тихо отвечаем ok.

   Формат сообщения:
     🟦 Новый лид (B2B, Узбекистан)
     Контакт: <телефон или @username>
     Получен: 2026-08-04 14:24        ← время по Алматы (UTC+5)

   + inline-кнопка «Написать в Telegram»:
     @username → https://t.me/username
     телефон   → https://t.me/+<цифры> (откроется, если номер есть в Telegram)
   ============================================================ */

const crypto = require("crypto");

const TOKEN_MIN_AGE_MS = 2500;        // раньше человек физически не успеет: ввод + кнопка + свайп
const TOKEN_MAX_AGE_MS = 3 * 3600e3;  // клиент обновляет токен каждые 40 минут, пока страница открыта

/* Ключ подписи. Отдельный секрет не обязателен: по умолчанию выводится из
   токена бота (он и так хранится только на сервере), через SHA-256 — сам
   токен бота из подписи восстановить нельзя. */
function tokenKey() {
  const base = process.env.LEAD_TOKEN_SECRET || process.env.TELEGRAM_BOT_TOKEN || "";
  return crypto.createHash("sha256").update("lead-token:" + base).digest();
}
function signToken(ts) {
  const sig = crypto.createHmac("sha256", tokenKey()).update(String(ts)).digest("hex").slice(0, 32);
  return ts + "." + sig;
}
/* null = токен валиден, иначе код причины. */
function verifyToken(token) {
  const m = /^(\d{10,16})\.([a-f0-9]{32})$/.exec(String(token || ""));
  if (!m) return "token_missing";
  const ts = Number(m[1]);
  const expected = signToken(ts).split(".")[1];
  const a = Buffer.from(m[2]), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "token_invalid";
  const age = Date.now() - ts;
  if (age < TOKEN_MIN_AGE_MS) return "token_too_fresh";
  if (age > TOKEN_MAX_AGE_MS) return "token_expired";
  return null;
}
/* Запрос пришёл с нашего же домена? Отклоняем только явное несовпадение. */
function sameSite(req) {
  const host = String(req.headers.host || "").toLowerCase();
  let src = req.headers.origin || req.headers.referer || "";
  if (src === "null") src = req.headers.referer || ""; // приватные режимы шлют Origin: null
  if (!src) return true; // браузер не прислал заголовков — решает токен
  try { return new URL(src).host.toLowerCase() === host; } catch (e) { return false; }
}

/* Нормализация контакта. Правило то же, что у клиента (validateContact):
   телефон ≥ 9 цифр ИЛИ любой текст ≥ 3 символов — сервер НИКОГДА не отбрасывает
   то, что уже принял клиент (иначе человек увидит «спасибо», а лид пропадёт).
   Управляющие/невидимые/bidi-символы вырезаем, пробелы схлопываем.

   Телефоны: «+» подставляем только там, где уверены в коде страны:
     • ≥ 11 цифр без «+»  → «+» + цифры как есть  (998901234567 → +998901234567)
     • ровно LOCAL_PHONE_DIGITS цифр без кода → «+» + DEFAULT_COUNTRY_CODE + цифры
                                                (901234567 → +998901234567)
     • иначе оставляем как ввели (не выдумываем код страны). */
const DEFAULT_COUNTRY_CODE = "998"; // Узбекистан; при переносе на другой сайт — поменять
const LOCAL_PHONE_DIGITS = 9;       // длина местного номера без кода страны
function cleanContact(raw) {
  let v = String(raw || "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (v.length < 3) return null;
  if (/^[+\d][\d\s\-()]*$/.test(v)) {
    const digits = v.replace(/\D/g, "");
    if (digits.length < 9) return null;
    if (!v.startsWith("+")) {
      if (digits.length >= 11) v = "+" + v.replace(/^\s+/, "");
      else if (digits.length === LOCAL_PHONE_DIGITS) v = "+" + DEFAULT_COUNTRY_CODE + " " + v;
    }
    return v;
  }
  if (v.replace(/^@+/, "").length < 3) return null; // как на клиенте: «@ab» — слишком коротко
  return v; // Telegram-хэндл, имя + телефон, ссылка t.me — как есть
}
/* Ключ дедупликации: для телефонов — только цифры (+998 90 123 45 67 = +998901234567). */
function dedupeKey(contact) {
  return /^[+\d][\d\s\-()]*$/.test(contact) ? contact.replace(/\D/g, "") : contact.toLowerCase();
}

/* Лимиты (best-effort, в памяти тёплого инстанса функции):
   • тот же контакт повторно в течение 10 мин — в группу не дублируем;
   • > 20 лидов с одного IP за 10 мин — 429.
   Это не замена WAF (инстансов может быть несколько), но режет наивный спам
   и случайные повторные отправки. Для настоящего флуда — Vercel Firewall. */
const WINDOW_MS = 10 * 60e3, IP_LIMIT = 20; // 20/10 мин: мобильные операторы сажают тысячи людей за один IP
const recentContacts = new Map(); // dedupeKey(contact) → ts
const ipHits = new Map();         // ip → [ts, ...]
function prune(now) {
  for (const [k, ts] of recentContacts) if (now - ts > WINDOW_MS) recentContacts.delete(k);
  for (const [k, arr] of ipHits) { const a = arr.filter(t => now - t <= WINDOW_MS); a.length ? ipHits.set(k, a) : ipHits.delete(k); }
}
function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || String(req.headers["x-real-ip"] || "") || "unknown";
}

/* Отправка в Telegram с одним повтором (429 / 5xx / сеть). */
async function sendTelegram(token, payload) {
  let last = "send_failed";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2500) // не висим до maxDuration функции
      });
      const j = await tg.json().catch(() => ({}));
      if (j && j.ok) return null;
      last = "telegram_error";
      const retryable = tg.status === 429 || tg.status >= 500;
      if (!retryable) return last;
    } catch (e) { last = "send_failed"; }
    await new Promise(r => setTimeout(r, 700));
  }
  return last;
}

/* Время по Алматы. Основной путь — Intl с таймзоной; запасной — фикс. UTC+5
   (Казахстан с 2024 года живёт на едином UTC+5 без перевода часов). */
function almatyTime() {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Almaty",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    }).format(new Date());                       // "2026-08-04 14:24"
  } catch (e) {
    return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
  }
}

/* Ссылка на чат с тем, кто оставил контакт. */
function contactLink(contact) {
  var v = String(contact || "").trim();
  var phoneLike = /^[+\d][\d\s\-()]*$/.test(v);
  if (phoneLike) {
    var digits = v.replace(/\D/g, "");
    return digits.length >= 11 ? "https://t.me/+" + digits : null; // без кода страны ссылка бессмысленна
  }
  var handle = v.replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "");
  return handle ? "https://t.me/" + handle : null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) return res.status(500).json({ ok: false, error: "not_configured" });

  // Выдача анти-бот токена (страница запрашивает при загрузке и обновляет раз в 40 мин).
  if (req.method === "GET") return res.status(200).json({ ok: true, token: signToken(Date.now()), minAge: TOKEN_MIN_AGE_MS });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  // Тело может прийти строкой (sendBeacon) или объектом (fetch JSON).
  let data = req.body;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { data = {}; } }
  data = data || {};

  // Honeypot: скрытое поле заполнено — бот, тихо отвечаем ok.
  if (data.website) return res.status(200).json({ ok: true, skipped: "honeypot" });

  const contact = cleanContact(data.contact);
  const ip = clientIp(req);
  // Любой отказ — в логи функции (Vercel → Logs): лид не пропадает бесследно.
  const reject = (code, error) => {
    console.warn("LEAD_REJECTED " + JSON.stringify({ error, contact: contact || String(data.contact || "").slice(0, 120), ip, at: new Date().toISOString() }));
    return res.status(code).json({ ok: false, error });
  };

  // Анти-бот: тот же домен + валидный, «выдержанный» токен.
  if (!sameSite(req)) return reject(403, "bad_origin");
  const tokenError = verifyToken(data.token);
  if (tokenError) return reject(403, tokenError);
  if (!contact) return reject(400, "no_contact");

  const now = Date.now();
  prune(now);
  const hits = ipHits.get(ip) || [];
  if (hits.length >= IP_LIMIT) return reject(429, "rate_limited");
  const key = dedupeKey(contact);
  if (recentContacts.has(key)) return res.status(200).json({ ok: true, skipped: "duplicate" });

  const text =
    "🟦 Новый лид (B2B, Узбекистан)\n" +
    "Контакт: " + contact + "\n" +
    "Получен: " + almatyTime();

  const link = contactLink(contact);
  const payload = {
    chat_id: CHAT_ID,
    text: text,
    disable_web_page_preview: true
  };
  if (link) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: "✍️ Написать в Telegram", url: link }]]
    };
  }

  const err = await sendTelegram(TOKEN, payload);
  if (err) {
    // Лид не пропадает бесследно: контакт остаётся в логах функции (Vercel → Logs).
    console.error("LEAD_NOT_DELIVERED " + JSON.stringify({ contact, form: data.form_location || "", at: new Date().toISOString(), error: err }));
    return res.status(502).json({ ok: false, error: err });
  }
  hits.push(now); ipHits.set(ip, hits);
  recentContacts.set(key, now);
  return res.status(200).json({ ok: true });
};

// Для автотестов: подпись токена с произвольной временной меткой.
module.exports.signToken = signToken;
