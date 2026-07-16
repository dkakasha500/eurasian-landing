# Доставка лидов в Telegram-группу — настройка

Как это работает:

```
Форма на сайте  →  POST /api/lead (ваша serverless-функция)  →  Telegram Bot API  →  ваша группа
```

Контакт (Telegram/номер) уходит **на ваш сервер и в вашу группу** — это ваш CRM.
В рекламные пиксели (Meta/Google/Яндекс) контакт **не передаётся** — там только нейтральные события.

Токен бота хранится **только в переменных окружения на сервере**. В `script.js` его быть не должно.

Если функция ещё не задеплоена — сайт продолжает работать: лид сохраняется в `localStorage`, событие `lead_submit` и редирект отрабатывают. Просто сообщение в группу не придёт, пока не настроите шаги ниже.

---

## Шаг 1. Создать бота и получить токен

1. В Telegram напишите **@BotFather** → `/newbot` → задайте имя и username.
2. Скопируйте **токен** вида `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxx`.

## Шаг 2. Создать группу и узнать её chat_id

1. Создайте группу (или используйте существующую), куда должны падать лиды.
2. **Добавьте бота в группу** как участника.
3. Напишите в группе любое сообщение.
4. Откройте в браузере:
   `https://api.telegram.org/bot<ВАШ_ТОКЕН>/getUpdates`
5. Найдите в ответе `"chat":{"id": -1001234567890, ...}` — это и есть **chat_id** (для групп он отрицательный).
   - Если ответ пустой — напишите в группе ещё раз и обновите страницу.

## Шаг 3. Задать переменные окружения на хостинге

В настройках проекта (Environment Variables) добавьте:

```
TELEGRAM_BOT_TOKEN = 123456789:AAExxxx...   (токен из шага 1)
TELEGRAM_CHAT_ID   = -1001234567890          (chat_id из шага 2)
```

Никогда не коммитьте токен в код/репозиторий.

## Шаг 4. Задеплоить функцию

Функция уже готова: `api/lead.js` (стиль Vercel). Фронтенд шлёт POST на `/api/lead`.

### Vercel
- Положите файл как `api/lead.js` в корень проекта. Маршрут `/api/lead` создастся автоматически.
- Environment Variables — в настройках проекта. Готово.

### Netlify
- Переименуйте/скопируйте функцию в `netlify/functions/lead.js` и замените обёртку на Netlify-стиль:

```js
export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "method_not_allowed" };
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN, CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) return { statusCode: 500, body: "not_configured" };
  let data = {}; try { data = JSON.parse(event.body || "{}"); } catch (e) {}
  if (data.website) return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  const contact = String(data.contact || "").trim().slice(0, 120);
  if (!contact) return { statusCode: 400, body: "no_contact" };
  const a = data.attrib || {}, row = (k, v) => (v ? `\n${k}: ${String(v).slice(0,300)}` : "");
  const text = "🟦 Новый лид (B2B)\nКонтакт: " + contact +
    row("Форма", data.form_location) + row("utm_source", a.utm_source) + row("utm_medium", a.utm_medium) +
    row("utm_campaign", a.utm_campaign) + row("utm_content", a.utm_content) + row("utm_term", a.utm_term) +
    row("fbclid", a.fbclid) + row("gclid", a.gclid) + row("yclid", a.yclid) +
    row("Referrer", a.referrer) + row("Landing", a.landing_page) + "\nПолучен: " + new Date().toISOString();
  const tg = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }) });
  const j = await tg.json();
  return { statusCode: j.ok ? 200 : 502, body: JSON.stringify({ ok: !!j.ok }) };
}
```

- Чтобы фронтенд-путь `/api/lead` работал, добавьте в `netlify.toml`:

```toml
[[redirects]]
  from = "/api/lead"
  to = "/.netlify/functions/lead"
  status = 200
```

### Cloudflare Pages
- Положите файл как `functions/api/lead.js` и используйте сигнатуру Pages Functions:

```js
export async function onRequestPost(context) {
  const { request, env } = context;
  const TOKEN = env.TELEGRAM_BOT_TOKEN, CHAT_ID = env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) return new Response("not_configured", { status: 500 });
  let data = {}; try { data = await request.json(); } catch (e) {}
  if (data.website) return Response.json({ ok: true });
  const contact = String(data.contact || "").trim().slice(0, 120);
  if (!contact) return new Response("no_contact", { status: 400 });
  const a = data.attrib || {}, row = (k, v) => (v ? `\n${k}: ${String(v).slice(0,300)}` : "");
  const text = "🟦 Новый лид (B2B)\nКонтакт: " + contact +
    row("Форма", data.form_location) + row("utm_source", a.utm_source) + row("utm_campaign", a.utm_campaign) +
    row("utm_content", a.utm_content) + row("utm_term", a.utm_term) + row("Landing", a.landing_page);
  const tg = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }) });
  const j = await tg.json();
  return Response.json({ ok: !!j.ok }, { status: j.ok ? 200 : 502 });
}
```

Environment Variables — в настройках Pages.

## Шаг 5. Проверка

1. Откройте сайт, заполните любую из форм валидно (`@name` или `+998…` от 9 цифр) → отправьте.
2. В DevTools → Network должен появиться `POST /api/lead` со статусом **200**.
3. В вашей Telegram-группе придёт сообщение «🟦 Новый лид…» с контактом и UTM.
4. Если 500 `not_configured` — не заданы переменные окружения. Если 502 `telegram_error` — проверьте, что бот добавлен в группу и `chat_id` верный (с минусом).

---

## Что уже сделано в коде сайта

- `script.js`: константа `LEAD_ENDPOINT = "/api/lead"`; функция `deliverLead()` шлёт контакт на эндпоинт через `sendBeacon`/`fetch(keepalive)` — запрос переживает редирект на thank-you; вызывается в `submitLead()`.
- Формы (hero/bottom/popup) получили скрытое honeypot-поле `name="website"`; заполненные ботом отправки тихо игнорируются и на сервере, и на клиенте.
- Контакт по-прежнему **не уходит** в пиксели — только в `localStorage` (для теста) и на ваш `/api/lead`.

## Приватность

- Токен бота — только на сервере (env). Не в client-side коде, не в репозитории.
- В рекламные пиксели уходят только нейтральные параметры (page, form_location, utm_*). Telegram/номер — нет.
- В группу вы шлёте контакт осознанно (это ваш CRM). Соблюдайте локальные требования по обработке персональных данных.
