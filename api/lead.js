/* ============================================================
   Serverless-функция доставки лида в Telegram-группу.
   Платформа: Vercel (файл api/lead.js → маршрут POST /api/lead).
   Node 18+ (глобальный fetch). Для Netlify/Cloudflare — см. LEAD-SETUP.md.

   Переменные окружения (задаются в кабинете хостинга, НЕ в коде):
     TELEGRAM_BOT_TOKEN  — токен бота от @BotFather
     TELEGRAM_CHAT_ID    — id вашей группы (обычно отрицательный, напр. -1001234567890)

   ВАЖНО: токен живёт только здесь, на сервере. В client-side JS его быть не должно.
   Контакт (Telegram/номер) уходит в ВАШУ группу — это ваш CRM, а не рекламный пиксель.
   ============================================================ */

module.exports = async function handler(req, res) {
  // CORS/preflight (обычно same-origin, но не мешает)
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

  // Honeypot: если скрытое поле заполнено — это бот, тихо отвечаем ok.
  if (data.website) return res.status(200).json({ ok: true, skipped: "honeypot" });

  const contact = String(data.contact || "").trim().slice(0, 120);
  if (!contact) return res.status(400).json({ ok: false, error: "no_contact" });

  const a = data.attrib || {};
  const row = (k, v) => (v ? `\n${k}: ${String(v).slice(0, 300)}` : "");

  const text =
    "🟦 Новый лид (B2B, Узбекистан)\n" +
    "Контакт: " + contact +
    row("Форма", data.form_location) +
    row("utm_source", a.utm_source) +
    row("utm_medium", a.utm_medium) +
    row("utm_campaign", a.utm_campaign) +
    row("utm_content", a.utm_content) +
    row("utm_term", a.utm_term) +
    row("fbclid", a.fbclid) +
    row("gclid", a.gclid) +
    row("yclid", a.yclid) +
    row("Referrer", a.referrer) +
    row("Landing", a.landing_page) +
    row("Первый визит", a.first_visit_time) +
    "\nПолучен: " + new Date().toISOString();

  try {
    const tg = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: text, disable_web_page_preview: true })
    });
    const j = await tg.json();
    if (!j.ok) return res.status(502).json({ ok: false, error: "telegram_error", detail: j.description });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "send_failed" });
  }
}
