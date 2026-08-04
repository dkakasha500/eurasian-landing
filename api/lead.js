/* ============================================================
   Serverless-функция доставки лида в Telegram-группу.
   Платформа: Vercel (файл api/lead.js → маршрут POST /api/lead).

   Переменные окружения (задаются в кабинете Vercel, НЕ в коде):
     TELEGRAM_BOT_TOKEN  — токен бота от @BotFather
     TELEGRAM_CHAT_ID    — id группы (отрицательный, напр. -1001234567890)

   Формат сообщения:
     🟦 Новый лид (B2B, Узбекистан)
     Контакт: <телефон или @username>
     Получен: 2026-08-04 14:24        ← время по Алматы (UTC+5)

   + inline-кнопка «Написать в Telegram»:
     @username → https://t.me/username
     телефон   → https://t.me/+<цифры> (откроется, если номер есть в Telegram)
   ============================================================ */

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) return res.status(500).json({ ok: false, error: "not_configured" });

  // Тело может прийти строкой (sendBeacon) или объектом (fetch JSON).
  let data = req.body;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { data = {}; } }
  data = data || {};

  // Honeypot: скрытое поле заполнено — бот, тихо отвечаем ok.
  if (data.website) return res.status(200).json({ ok: true, skipped: "honeypot" });

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
