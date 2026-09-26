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
  const src = req.headers.origin || req.headers.referer || "";
  if (!src) return true; // браузер не прислал заголовков — решает токен
  try { return new URL(src).host.toLowerCase() === host; } catch (e) { return false; }
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
    return digits ? "https://t.me/+" + digits : null;
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
  if (req.method === "GET") return res.status(200).json({ ok: true, token: signToken(Date.now()) });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  // Тело может прийти строкой (sendBeacon) или объектом (fetch JSON).
  let data = req.body;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { data = {}; } }
  data = data || {};

  // Honeypot: скрытое поле заполнено — бот, тихо отвечаем ok.
  if (data.website) return res.status(200).json({ ok: true, skipped: "honeypot" });

  // Анти-бот: тот же домен + валидный, «выдержанный» токен.
  if (!sameSite(req)) return res.status(403).json({ ok: false, error: "bad_origin" });
  const tokenError = verifyToken(data.token);
  if (tokenError) return res.status(403).json({ ok: false, error: tokenError });

  let contact = String(data.contact || "").trim().slice(0, 120);
  if (!contact) return res.status(400).json({ ok: false, error: "no_contact" });

  // Телефон без "+" в начале — добавляем "+" сами (единый вид: +996036730).
  if (/^\d[\d\s\-()]*$/.test(contact)) contact = "+" + contact;

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

  try {
    const tg = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await tg.json();
    if (!j.ok) return res.status(502).json({ ok: false, error: "telegram_error", detail: j.description });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "send_failed" });
  }
};

// Для автотестов: подпись токена с произвольной временной меткой.
module.exports.signToken = signToken;
