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

1. Откройте сайт, заполните любую из форм валидно (`@name` или `+998…` от 9 цифр) → нажмите «Отправить заявку» → проведите ползунок вправо до конца.
2. В DevTools → Network: при загрузке страницы `GET /api/lead` (выдача анти-бот токена), после свайпа `POST /api/lead` со статусом **200**.
3. В вашей Telegram-группе придёт сообщение «🟦 Новый лид…» с контактом, временем по Алматы и кнопкой «Написать в Telegram».
4. Если 500 `not_configured` — не заданы переменные окружения. Если 502 `telegram_error` — проверьте, что бот добавлен в группу и `chat_id` верный (с минусом). 403 `token_*` / `bad_origin` — запрос пришёл не со страницы сайта (см. раздел «Анти-бот» ниже).

## Анти-бот защита (без капчи)

Слой 1 — **на странице**: заявка уходит только после свайпа бегунка «Проведите вправо» до конца. Вести можно **только сам бегунок** — клик по дорожке ничего не переключает (бегунок лишь коротко «подёргивается» как подсказка); тап, рывок короче 100 мс и программная отправка формы не проходят. Доступность: стрелки/Enter на бегунке, для экранных читалок — скрытая кнопка «Подтвердить отправку». Плюс скрытое honeypot-поле `website`.

Слой 2 — **на сервере** (`api/lead.js`), закрывает прямые запросы к API минуя сайт:
- при загрузке страница получает `GET /api/lead` → подписанный токен `<время>.<HMAC>`; ключ подписи выводится из `TELEGRAM_BOT_TOKEN` (или из отдельной переменной `LEAD_TOKEN_SECRET`, если задать);
- `POST /api/lead` принимается только с валидным токеном возрастом **от 2.5 с до 3 ч** (страница обновляет его раз в 40 мин, пока открыта);
- `Origin`/`Referer` запроса должен совпадать с хостом сайта; если браузер их не прислал — решает токен, лид не теряется.

Слой 3 — **гигиена на сервере**: контакт нормализуется по тому же правилу, что на клиенте (телефон ≥ 9 цифр или любой текст от 3 символов — сервер никогда не отбрасывает то, что уже принял клиент), управляющие/невидимые/bidi-символы вырезаются; телефону подставляется «+» (≥ 11 цифр — как есть; ровно 9 цифр — с кодом страны `DEFAULT_COUNTRY_CODE`, по умолчанию 998); один и тот же контакт (в любом написании) повторно в течение 10 минут в группу не дублируется; больше 20 лидов с одного IP за 10 минут → 429 (порог высокий намеренно: мобильные операторы сажают тысячи людей за один IP). Эти лимиты живут в памяти тёплого инстанса функции (best-effort) — от наивного спама и случайных повторов защищают, от целевого флуда — нет: для этого включите **Vercel Firewall** (Attack Challenge Mode / rate-limit правило на `/api/lead`).

**Надёжность доставки.** Страница ждёт ответ сервера (до 4 с) и только потом уводит на «спасибо»; если сервер не принял токен (истёк) — берёт новый и повторяет один раз; при молчании сети уходит по жёсткому дедлайну 7 с (запрос `keepalive` доживает сам). Сервер повторяет отправку в Telegram один раз при 429/5xx; если оба раза не удалось — контакт пишется в логи функции строкой `LEAD_NOT_DELIVERED {...}`; каждый отказ (403/400/429) — строкой `LEAD_REJECTED {...}` с контактом. Логи: Vercel → проект → Logs. Учтите срок хранения (Hobby ≈ 1 час, Pro ≈ 1 день) — если лиды критичны, подключите Log Drain или проверяйте логи оперативно.

Следствие: ручной `curl -X POST /api/lead …` без токена теперь получает 403 — так и задумано. Для ручного сообщения в группу используйте Telegram Bot API напрямую (`sendMessage` с вашим токеном бота).

Что защита **не** закрывает (честно): живых людей с кликферм (они свайпнут) и бота, написанного специально под этот сайт и исполняющего его JavaScript в реальном браузере с паузой ≥ 2.5 с. Против этого работают только капча или WAF — для B2B-лендинга это сознательно не сделано, чтобы не резать конверсию.

Варианты для Netlify/Cloudflare ниже приведены в базовом виде **без** токен-проверки — при переезде перенесите логику `signToken`/`verifyToken`/`sameSite`/`cleanContact` из `api/lead.js`.

---

## Перенос на другой сайт (шаблон)

Слайдер и анти-бот защита сделаны переносимыми. Порядок:

1. **Разметка формы.** Каждая форма должна иметь: `<form class="lead-form" data-form-location="…">`, поле `<input name="contact">`, кнопку `<button type="submit">`, скрытое honeypot-поле `<input class="hp-field" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">`, необязательный блок ошибки `.field-error`. На `<body>` — `data-page="index"` (страница с формами) / `data-page="thank-you"`.
2. **JS.** Из `script.js` перенести блоки: CONFIG (`THANK_YOU_URL`, `LEAD_ENDPOINT`), `validateContact`/`saveLeadLocally`, весь блок «Доставка лида + анти-бот токен» (`fetchLeadToken`, `ensureAgedToken`, `sendLead`, `submitLead`), блок «Слайдер-подтверждение» (`SLIDE_TEXT`, `SWIPE_*`, `createSlideConfirm`, `bindLeadForm`) и в инициализации: `document.querySelectorAll("form.lead-form").forEach(bindLeadForm); fetchLeadToken(); setInterval(fetchLeadToken, LEAD_TOKEN_REFRESH_MS);` + обработчик `pageshow`. Тексты слайдера — в `SLIDE_TEXT` (одно место). Если на новом сайте нет `trackEvent`, оставьте заглушку `function trackEvent(){}`.
3. **CSS.** Скопировать блок «Слайдер-подтверждение отправки» из конца `styles.css` целиком (включая `.sr-only`). Он самодостаточен: у всех переменных есть fallback-значения (`var(--primary, #2f63e6)` и т. д.) — при желании подставьте цвета нового сайта; иконки — inline-SVG с `currentColor`, перекрашиваются сами. Разметку слайдера JS создаёт сам — в HTML ничего добавлять не нужно. Правило `.lead-form button[type="submit"][hidden] { display:none }` обязательно: без него кнопка не скроется, если у неё задан свой `display`.
4. **Сервер.** Скопировать `api/lead.js`; поменять текст сообщения, таймзону в `almatyTime()` и `DEFAULT_COUNTRY_CODE`/`LOCAL_PHONE_DIGITS` под страну; в Vercel задать `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID` (отдельный секрет для токена не нужен). Клиент и сервер согласованы через `minAge` в ответе `GET /api/lead` — константу менять только на сервере.
5. **Проверка** — шаг 5 выше. Если сайт не на Vercel — см. варианты Netlify/Cloudflare.

---

## Что уже сделано в коде сайта

- `script.js`: константа `LEAD_ENDPOINT = "/api/lead"`; функция `deliverLead()` шлёт контакт на эндпоинт через `sendBeacon`/`fetch(keepalive)` — запрос переживает редирект на thank-you; вызывается в `submitLead()`.
- Формы (hero/bottom/popup) получили скрытое honeypot-поле `name="website"`; заполненные ботом отправки тихо игнорируются и на сервере, и на клиенте.
- Контакт по-прежнему **не уходит** в пиксели — только в `localStorage` (для теста) и на ваш `/api/lead`.

## Приватность

- Токен бота — только на сервере (env). Не в client-side коде, не в репозитории.
- В рекламные пиксели уходят только нейтральные параметры (page, form_location, utm_*). Telegram/номер — нет.
- В группу вы шлёте контакт осознанно (это ваш CRM). Соблюдайте локальные требования по обработке персональных данных.
