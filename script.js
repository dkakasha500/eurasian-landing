/* ============================================================
   B2B Landing — script.js
   ------------------------------------------------------------
   ВАЖНЫЕ НАСТРОЙКИ — меняйте только этот блок CONFIG.
   ============================================================ */

/* >>> 1. Telegram для кнопок/иконки на thank-you (единственная ссылка). */
const TELEGRAM_TARGET = "https://t.me/Eurasian_Peptides";

/* >>> 2. Текст сообщения Telegram (не PII, не медицинские данные). */
const CONTACT_MESSAGE =
  "Здравствуйте. Уточняю наличие и условия поставки для клиники в Узбекистане.";

/* >>> 3. Куда вести после отправки формы. */
const THANK_YOU_URL = "thank-you.html";

/* >>> 4. Номер счётчика Яндекс.Метрики. 0 = выключено. */
const YM_COUNTER_ID = 0; /* например: 12345678 */

/* >>> 5. Эндпоинт доставки лида менеджеру (ваша serverless-функция → Telegram-группа).
   Контакт уходит СЮДА (на ваш сервер), а НЕ в рекламные пиксели.
   Если функция ещё не задеплоена — сайт продолжит работать (лид сохранится локально). */
const LEAD_ENDPOINT = "/api/lead";

/* ============================================================
   АНАЛИТИКА — РАСШИРЕННАЯ КАРТА СОБЫТИЙ
   ------------------------------------------------------------
   Единая точка — trackEvent(). Отправляет во все подключённые
   системы (Meta Pixel / Google Tag / Яндекс.Метрика) безопасно.

   ПРИВАТНОСТЬ: в пиксель уходят ТОЛЬКО нейтральные параметры из
   белого списка. Telegram-username, телефон, имя и любые
   персональные/медицинские данные НИКОГДА не передаются.

   Карта событий:
     Page:   view_landing (index), view_thank_you (thank-you)
     Form:   form_start, form_error (index);
             lead_submit — отправляется на THANK-YOU при загрузке
             (форма на index ставит флаг в sessionStorage; так Lead
             гарантированно доходит и не дублируется при обновлении)
     CTA:    click_primary_cta, click_secondary_cta,
             click_floating_telegram_gate (index), click_telegram (thank-you)
     Scroll: scroll_25, scroll_50, scroll_75, scroll_90
     Time:   time_10s, time_30s, time_60s

   Маппинг на стандартные события Meta:
     view_landing / view_thank_you → PageView
     lead_submit                   → Lead
     click_telegram                → Contact
     остальные                     → trackCustom (нейтральные)
   ============================================================ */

/* Белый список параметров (защита от утечки PII). */
var ALLOWED_PARAMS = [
  "page", "event_source", "form_location", "cta_location", "funnel_step",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"
];
function sanitizeParams(params) {
  var safe = {};
  if (!params) return safe;
  ALLOWED_PARAMS.forEach(function (k) {
    if (params[k] !== undefined && params[k] !== null && params[k] !== "") safe[k] = params[k];
  });
  return safe;
}

/* Дедупликация: одно событие — один раз за загрузку страницы. */
var _once = {};
function firedOnce(key) { if (_once[key]) return true; _once[key] = true; return false; }

/* Надёжный helper: не ломает сайт, если система аналитики не подключена. */
function trackEvent(eventName, params) {
  var safe = sanitizeParams(params || {});
  console.log("trackEvent →", eventName, safe);

  // --- Meta Pixel (fbq) ---
  try {
    if (typeof fbq === "function") {
      if (eventName === "view_landing" || eventName === "view_thank_you") fbq("track", "PageView", safe);
      else if (eventName === "lead_submit") fbq("track", "Lead", safe);
      else if (eventName === "click_telegram") fbq("track", "Contact", safe);
      else fbq("trackCustom", eventName, safe);
    }
  } catch (e) { console.warn("fbq error:", e); }

  // --- Google Tag (gtag.js) ---
  try { if (typeof gtag === "function") gtag("event", eventName, safe); }
  catch (e) { console.warn("gtag error:", e); }

  // --- Яндекс.Метрика (ym) ---
  try { if (typeof ym === "function" && YM_COUNTER_ID) ym(YM_COUNTER_ID, "reachGoal", eventName, safe); }
  catch (e) { console.warn("ym error:", e); }
}

/* ============================================================
   UTM / атрибуция — сохраняем при ПЕРВОМ заходе (персистит и на thank-you).
   Персональных данных тут нет — только источники трафика.
   ============================================================ */
function captureAttribution() {
  try {
    var stored = {};
    try { stored = JSON.parse(localStorage.getItem("b2b_attrib") || "{}"); } catch (e) { stored = {}; }
    var q = new URLSearchParams(location.search);
    var g = function (k) { return (q.get(k) || "").slice(0, 200); };
    var out = Object.assign({}, stored);

    // utm/click-id: заполняем ПУСТЫЕ поля из текущего URL,
    // но НИКОГДА не перезаписываем уже сохранённое значение пустым.
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "yclid"]
      .forEach(function (k) { var cur = g(k); if (!out[k] && cur) out[k] = cur; });

    // first-touch: referrer / landing / время — фиксируются один раз (первый заход).
    if (!out.referrer)         out.referrer = (document.referrer || "").slice(0, 300);
    if (!out.landing_page)     out.landing_page = (location.pathname + location.search).slice(0, 300);
    if (!out.first_visit_time) out.first_visit_time = new Date().toISOString();

    localStorage.setItem("b2b_attrib", JSON.stringify(out));
  } catch (e) { console.warn("attribution error:", e); }
}
/* В payload события — только utm_* (fbclid/gclid/yclid в пиксель НЕ шлём). */
function getUtmForPayload() {
  try {
    var a = JSON.parse(localStorage.getItem("b2b_attrib") || "{}");
    return {
      utm_source: a.utm_source || "", utm_medium: a.utm_medium || "", utm_campaign: a.utm_campaign || "",
      utm_content: a.utm_content || "", utm_term: a.utm_term || ""
    };
  } catch (e) { return {}; }
}

/* ============================================================
   Telegram-ссылка
   ============================================================ */
function buildTelegramLink() {
  var raw = (TELEGRAM_TARGET || "").trim();
  var base = /^https?:\/\//i.test(raw) ? raw : "https://t.me/" + raw.replace(/^@+/, "");
  var sep = base.indexOf("?") === -1 ? "?" : "&";
  return base + sep + "text=" + encodeURIComponent(CONTACT_MESSAGE);
}

/* ============================================================
   Валидация / локальное сохранение (контакт в пиксель НЕ уходит)
   ============================================================ */
function validateContact(value) {
  var v = (value || "").trim();
  if (!v) return false;
  if (/^[+\d][\d\s\-()]*$/.test(v)) return v.replace(/\D/g, "").length >= 9; // телефон ≥ 9 цифр
  return v.replace(/^@+/, "").length >= 3;                                    // Telegram-хэндл
}
function saveLeadLocally(contact) {
  var lead = { contact: contact, ts: new Date().toISOString() };
  try {
    var leads = JSON.parse(localStorage.getItem("b2b_leads") || "[]");
    leads.push(lead);
    localStorage.setItem("b2b_leads", JSON.stringify(leads));
    localStorage.setItem("b2b_last_contact", contact);
  } catch (e) { console.warn("localStorage недоступен:", e); }
  console.log("Заявка (сохранено локально, в пиксель НЕ отправляется):", contact);
}

/* ============================================================
   Доставка лида менеджеру + анти-бот токен.
   Контакт уходит на ВАШ эндпоинт (→ Telegram-группа), а НЕ в пиксели.

   Токен: страница при загрузке получает у /api/lead подписанный
   токен; сервер принимает лид только с валидным токеном возрастом
   ≥ minAge (боты постят мгновенно). Прямые запросы к API без
   страницы отклоняются. Для человека всё незаметно.

   Надёжность: отправка ждёт ответ сервера (до 4 с); если сервер
   не принял токен — берём новый и повторяем один раз. Что бы ни
   случилось с сетью, человек уходит на thank-you не позже чем
   через LEAD_HARD_DEADLINE_MS.
   ============================================================ */
var LEAD_TOKEN = null;                    // { value, at, minAge }
var LEAD_TOKEN_DEFAULT_MIN_AGE = 2500;    // если сервер не прислал minAge
var LEAD_TOKEN_STALE_MS = 2.5 * 3600e3;   // старше — берём новый (сервер живёт 3 ч)
var LEAD_TOKEN_REFRESH_MS = 40 * 60e3;    // фоновое обновление, пока страница открыта
var LEAD_SEND_TIMEOUT_MS = 4000;          // ждём ответ сервера не дольше
var LEAD_HARD_DEADLINE_MS = 9000;         // абсолютный предел ожидания перед редиректом

function fetchLeadToken() {
  try {
    return fetch(LEAD_ENDPOINT, { method: "GET", cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.token) LEAD_TOKEN = { value: j.token, at: Date.now(), minAge: Number(j.minAge) || LEAD_TOKEN_DEFAULT_MIN_AGE };
      })
      .catch(function () {});
  } catch (e) { return Promise.resolve(); }
}

/* Возвращает Promise<string|null>: токен, «выдержанный» до минимального возраста.
   Токен фиксируется в момент вызова — фоновое обновление его не подменит. */
function ensureAgedToken(budgetMs) {
  var budget = typeof budgetMs === "number" ? Math.max(0, budgetMs) : 6000;
  var t = LEAD_TOKEN;
  var stale = !t || (Date.now() - t.at) > LEAD_TOKEN_STALE_MS;
  var get = stale
    ? Promise.race([fetchLeadToken(), new Promise(function (r) { setTimeout(r, Math.min(3000, budget)); })]).then(function () { return LEAD_TOKEN; })
    : Promise.resolve(t);
  var started = Date.now();
  return get.then(function (tok) {
    if (!tok) return null;
    var wait = Math.max(0, tok.minAge - (Date.now() - tok.at));
    var left = Math.max(0, budget - (Date.now() - started));
    return new Promise(function (r) { setTimeout(function () { r(tok.value); }, Math.min(wait, left)); });
  });
}

/* POST лида с ожиданием ответа. keepalive — запрос доживёт, даже если страница уйдёт.
   Резолвится всегда: { ok, error }. */
function sendLead(payload) {
  return new Promise(function (resolve) {
    var settled = false;
    var done = function (r) { if (!settled) { settled = true; resolve(r); } };
    var timer = setTimeout(function () { done({ ok: false, error: "timeout" }); }, LEAD_SEND_TIMEOUT_MS);
    try {
      fetch(LEAD_ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), keepalive: true, credentials: "same-origin"
      }).then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
        .then(function (j) { clearTimeout(timer); done({ ok: !!(j && j.ok), error: (j && j.error) || (j && j.ok ? "" : "http") }); })
        .catch(function () { clearTimeout(timer); done({ ok: false, error: "network" }); });
    } catch (e) { clearTimeout(timer); done({ ok: false, error: "network" }); }
  });
}

/* Успешная отправка: контакт локально + на ваш эндпоинт (с токеном); редирект.
   Событие lead_submit (Meta Lead) отправляется НЕ здесь, а на thank-you.html
   при загрузке — так конверсия гарантированно успевает уйти (нет гонки с редиректом).
   Здесь только ставим флаг для thank-you. */
function submitLead(contact, loc) {
  saveLeadLocally(contact);

  var attrib = {};
  try { attrib = JSON.parse(localStorage.getItem("b2b_attrib") || "{}"); } catch (e) {}
  var payload = { contact: contact, form_location: loc, page: "index", attrib: attrib, ts: new Date().toISOString() };

  var gone = false;
  function go() {
    if (gone) return; gone = true;
    try { sessionStorage.setItem("b2b_pending_lead", JSON.stringify({ form_location: loc, ts: Date.now() })); } catch (e) {}
    window.location.href = THANK_YOU_URL;
  }
  var startedAt = Date.now();
  var hardDeadline = setTimeout(go, LEAD_HARD_DEADLINE_MS);
  var left = function () { return LEAD_HARD_DEADLINE_MS - (Date.now() - startedAt); };

  ensureAgedToken(left() - LEAD_SEND_TIMEOUT_MS)
    .then(function (token) { payload.token = token || ""; return sendLead(payload); })
    .then(function (r) {
      if (r.ok || !/^token_/.test(r.error || "")) return r;
      // Сервер не принял токен (истёк / не был получен) — новый токен, выдержка, один повтор
      // в пределах оставшегося бюджета времени.
      LEAD_TOKEN = null;
      return ensureAgedToken(left() - 1500).then(function (token) { payload.token = token || ""; return sendLead(payload); });
    })
    .then(function (r) {
      if (!r.ok) console.warn("lead not accepted by server:", r.error);
      clearTimeout(hardDeadline); go();
    })
    .catch(function () { clearTimeout(hardDeadline); go(); });
}

/* ============================================================
   Слайдер-подтверждение отправки («проведите вправо»).
   Защита от мусорных заявок: случайный тап или автоклик не
   отправляет форму — после нажатия кнопки появляется ползунок,
   и заявка уходит только после осознанного свайпа до конца.

   Что считается свайпом: ползунок доведён до ≥97 % за ≥3 отсчёта
   движения и ≥100 мс с момента захвата. Одиночный тап по краю
   дорожки — 1 отсчёт за 0 мс — не проходит: бегунок доезжает и
   плавно откатывается (человек видит, что нужно именно провести).
   Клавиатура (доступность): стрелки ведут ползунок, Enter/Space
   на нём — подтверждение; откат для клавиатурных шагов не делаем.
   ============================================================ */
var SLIDE_TEXT = {
  hint:    "Проведите вправо, чтобы отправить",
  aria:    "Проведите вправо, чтобы отправить заявку",
  sending: "Отправляем…"
};
var SWIPE_MIN_SAMPLES = 3;   // минимум отсчётов движения
var SWIPE_MIN_MS = 100;      // минимум длительности жеста
var SWIPE_DONE_AT = 97;      // порог «доведён до конца», %

function createSlideConfirm(form, submitBtn, onConfirm) {
  var wrap = document.createElement("div");
  wrap.className = "slide-confirm";
  wrap.hidden = true;

  var range = document.createElement("input");
  range.type = "range";
  range.className = "slide-confirm__range";
  range.min = "0"; range.max = "100"; range.step = "1"; range.value = "0";
  range.setAttribute("aria-label", SLIDE_TEXT.aria);

  var label = document.createElement("span");
  label.className = "slide-confirm__label";
  label.textContent = SLIDE_TEXT.hint;

  wrap.appendChild(range);
  wrap.appendChild(label);
  // Ставим сразу под кнопкой (в hero кнопка внутри .field-row — тогда под всей строкой),
  // чтобы слайдер появлялся ровно там, куда смотрит человек, а не в конце формы.
  var anchor = submitBtn ? (submitBtn.closest(".field-row") || submitBtn) : null;
  if (anchor && anchor.parentNode) anchor.insertAdjacentElement("afterend", wrap);
  else form.appendChild(wrap);

  var confirmed = false;
  var rafId = null;
  var gesture = { start: 0, samples: 0, viaKey: false };
  var now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };
  // Экранные читалки (VoiceOver/TalkBack) двигают ползунок без pointer/keyboard-событий:
  // приходят только input/change. Такое ведение считаем осознанным и не откатываем.
  var isAssistive = function () { return !gesture.start && !gesture.viaKey; };
  var swipeDone = function () {
    return (Number(range.value) || 0) >= SWIPE_DONE_AT &&
      (gesture.viaKey || isAssistive() ||
       (gesture.samples >= SWIPE_MIN_SAMPLES && (now() - gesture.start) >= SWIPE_MIN_MS));
  };

  // --p — заливка дорожки (в %), --pn — то же число без единиц (для затухания подписи).
  function setFill(v) { wrap.style.setProperty("--p", v + "%"); wrap.style.setProperty("--pn", String(v)); }

  function stopAnim() {
    if (rafId !== null && window.cancelAnimationFrame) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // Плавный откат в начало (value у range через CSS не анимируется — ведём вручную).
  function animateBack() {
    stopAnim();
    var from = Number(range.value) || 0;
    if (!from || !window.requestAnimationFrame) { range.value = "0"; setFill(0); return; }
    var dur = 240, start = null;
    function step(t) {
      if (start === null) start = t;
      var k = Math.min(1, (t - start) / dur);
      var e = 1 - Math.pow(1 - k, 3); // ease-out
      var v = Math.round(from * (1 - e));
      range.value = String(v); setFill(v);
      if (k < 1) { rafId = requestAnimationFrame(step); }
      else { rafId = null; }
    }
    rafId = requestAnimationFrame(step);
  }

  function reset() {
    stopAnim();
    confirmed = false;
    gesture = { start: 0, samples: 0, viaKey: false };
    range.disabled = false;
    range.value = "0"; setFill(0);
    wrap.classList.remove("is-confirmed");
    label.textContent = SLIDE_TEXT.hint;
    wrap.hidden = true;
    if (submitBtn) { submitBtn.hidden = false; submitBtn.disabled = false; submitBtn.removeAttribute("aria-busy"); }
  }

  function show() {
    if (confirmed) return;
    stopAnim();
    gesture = { start: 0, samples: 0, viaKey: false };
    range.value = "0"; setFill(0);
    wrap.hidden = false;
    if (submitBtn) submitBtn.hidden = true;
    // Фокус — на ползунок: на телефоне это закрывает клавиатуру (иначе она перекрывает слайдер),
    // с клавиатуры можно сразу вести стрелками / подтвердить Enter.
    try { range.focus({ preventScroll: true }); } catch (e) { try { range.focus(); } catch (e2) {} }
    // Показываем целиком (в модалке не скроллим — она фиксирована и сама помещается на экран).
    try { if (!wrap.closest(".modal") && wrap.scrollIntoView) wrap.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) {}
  }

  function complete() {
    if (confirmed) return;
    stopAnim();
    confirmed = true;
    range.value = "100"; setFill(100);
    range.disabled = true;
    wrap.classList.add("is-confirmed");
    label.textContent = SLIDE_TEXT.sending;
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {} // лёгкий отклик (Android)
    onConfirm(reset);
  }

  // Начало жеста: точка отсчёта времени и счётчик движений; откат прерывается.
  // pointerdown — основной; touchstart/mousedown — запасные для старых браузеров
  // (если pointerdown уже был < 50 мс назад, повторно жест не сбрасываем).
  ["pointerdown", "touchstart", "mousedown"].forEach(function (evt) {
    range.addEventListener(evt, function () {
      if (confirmed) return;
      stopAnim();
      if (gesture.start && now() - gesture.start < 50) return;
      gesture = { start: now(), samples: 0, viaKey: false };
    }, { passive: true });
  });

  // Клавиатура: шаги стрелками не откатываем; Enter / Space — подтверждение.
  range.addEventListener("keydown", function (e) {
    if (confirmed) return;
    stopAnim();
    gesture.viaKey = true;
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); complete(); }
  });

  range.addEventListener("input", function () {
    if (confirmed) return;
    gesture.samples += 1;
    setFill(Number(range.value) || 0);
    if (swipeDone()) complete();
    // иначе — тап/телепорт или ещё слишком рано: решим при отпускании
  });

  // Отпустили. Быстрый флик до упора (значение «залипло» на 100, новых input нет) —
  // проверяем ещё раз здесь; иначе плавно возвращаем в начало.
  ["change", "pointerup", "pointercancel", "lostpointercapture", "touchend", "touchcancel", "mouseup"].forEach(function (evt) {
    range.addEventListener(evt, function () {
      if (confirmed || gesture.viaKey || isAssistive()) return;
      if (swipeDone()) { complete(); return; }
      animateBack();
    });
  });

  return {
    show: show,
    reset: reset,
    isVisible: function () { return !wrap.hidden; }
  };
}

/* Единый биндинг для всех форм (hero / bottom / popup):
   form_start (1 раз), form_error (каждая неудача),
   click_primary_cta (клик по кнопке) → слайдер-подтверждение → отправка.
   lead_submit (Meta Lead) уходит на thank-you. */
function bindLeadForm(form) {
  var input = form.querySelector('input[name="contact"]');
  if (!input) return;
  var errorEl = form.querySelector(".field-error");
  var loc = form.getAttribute("data-form-location") || "form";
  var submitBtn = form.querySelector('button[type="submit"]');
  var honeypot = form.querySelector('[name="website"]'); // антиспам-ловушка
  var submitting = false; // после подтверждения свайпом форма «заморожена» до редиректа

  function showError() {
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    if (errorEl) errorEl.hidden = false;
    trackEvent("form_error", { page: "index", form_location: loc, funnel_step: "lead_form" });
  }

  // Финальная отправка — только после свайпа. Контакт могли изменить,
  // пока ползунок был на экране, поэтому проверяем ещё раз.
  var slider = createSlideConfirm(form, submitBtn, function (resetSlider) {
    if (submitting) return;
    if (honeypot && honeypot.value) { resetSlider(); return; }
    if (!validateContact(input.value)) {
      resetSlider();
      showError();
      input.focus();
      return;
    }
    submitting = true;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.setAttribute("aria-busy", "true"); }
    submitLead(input.value.trim(), loc);
  });

  input.addEventListener("input", function () {
    if (submitting) return;
    if (!firedOnce("form_start:" + loc)) {
      trackEvent("form_start", { page: "index", form_location: loc, funnel_step: "lead_form" });
    }
    input.classList.remove("is-invalid");
    input.setAttribute("aria-invalid", "false");
    if (errorEl) errorEl.hidden = true;
    // Контакт изменили — прячем ползунок и возвращаем кнопку (нужна повторная проверка).
    if (slider.isVisible()) slider.reset();
  });

  if (submitBtn) {
    submitBtn.addEventListener("click", function () {
      if (submitting) return;
      trackEvent("click_primary_cta", { page: "index", cta_location: loc, funnel_step: "lead_form" });
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitting) return;
    if (honeypot && honeypot.value) return; // honeypot заполнен — бот, тихо игнорируем
    if (!validateContact(input.value)) {
      showError();
      input.focus();
      return;
    }
    input.classList.remove("is-invalid");
    input.setAttribute("aria-invalid", "false");
    if (errorEl) errorEl.hidden = true;
    // Контакт валиден → показываем ползунок-подтверждение вместо мгновенной отправки.
    slider.show();
  });
}

/* ============================================================
   Прямые Telegram-ссылки (ТОЛЬКО thank-you.html) → click_telegram
   ============================================================ */
function initDirectTelegramLinks() {
  var link = buildTelegramLink();
  document.querySelectorAll("[data-telegram-link]").forEach(function (btn) {
    btn.setAttribute("href", link);
    var lastClick = 0;
    btn.addEventListener("click", function () {
      // Дедуп двойного клика (переход по ссылке при этом НЕ блокируется — нет preventDefault).
      var now = Date.now();
      if (now - lastClick < 800) return;
      lastClick = now;
      trackEvent("click_telegram", {
        page: "thank_you", event_source: "web",
        cta_location: btn.getAttribute("data-cta-location") || "main", funnel_step: "contact"
      });
    });
  });
}

/* ============================================================
   Шлюз-поп-ап (ТОЛЬКО index.html): открыть/закрыть + gate-событие.
   Отправку формы обрабатывает bindLeadForm (форма — тоже .lead-form).
   ============================================================ */
function initContactGate() {
  var modal = document.getElementById("contact-modal");
  if (!modal) return;
  var input = modal.querySelector("#contact-input");
  var errorEl = modal.querySelector("#modal-error");
  var lastFocused = null;

  function open(trigger) {
    lastFocused = trigger || document.activeElement;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    if (input) setTimeout(function () { input.focus(); }, 30);
  }
  function close() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    if (errorEl) errorEl.hidden = true;
    if (input) { input.classList.remove("is-invalid"); input.setAttribute("aria-invalid", "false"); }
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  document.querySelectorAll("[data-gate-open]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (el.hasAttribute("data-floating")) {
        trackEvent("click_floating_telegram_gate", { page: "index", cta_location: "floating", funnel_step: "gate" });
      }
      open(el);
    });
  });
  modal.querySelectorAll("[data-modal-close]").forEach(function (el) { el.addEventListener("click", close); });
  document.addEventListener("keydown", function (e) {
    if (modal.hidden) return;
    if (e.key === "Escape") { close(); return; }
    // Фокус-ловушка: Tab / Shift+Tab циклятся внутри pop-up.
    if (e.key === "Tab") {
      var f = modal.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), a[href], [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

/* Вторичная кнопка "Уточнить условия": click_secondary_cta + скролл к форме. */
function initScrollButtons() {
  document.querySelectorAll("[data-scroll-focus]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      trackEvent("click_secondary_cta", { page: "index", cta_location: "secondary", funnel_step: "cta" });
      var el = document.getElementById(btn.getAttribute("data-scroll-focus"));
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

/* Scroll-depth: scroll_25/50/75/90 — по одному разу, без дублей при обратном скролле. */
function initScrollDepth(PAGE) {
  var marks = [[25, "scroll_25"], [50, "scroll_50"], [75, "scroll_75"], [90, "scroll_90"]];
  function onScroll() {
    var doc = document.documentElement;
    var scrollable = (doc.scrollHeight || document.body.scrollHeight || 0) - window.innerHeight;
    if (scrollable <= 0) return; // страница не прокручивается — событий нет
    var pct = ((window.scrollY || window.pageYOffset || 0) / scrollable) * 100;
    marks.forEach(function (m) {
      if (pct >= m[0] && !firedOnce(m[1])) trackEvent(m[1], { page: PAGE, funnel_step: "scroll" });
    });
    if (_once["scroll_90"]) window.removeEventListener("scroll", onScroll);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* Time-on-page: time_10s/30s/60s — по одному разу; если пользователь ушёл раньше,
   таймер не сработает (контекст страницы уничтожается при переходе). */
function initTimeOnPage(PAGE) {
  [[10000, "time_10s"], [30000, "time_30s"], [60000, "time_60s"]].forEach(function (t) {
    setTimeout(function () {
      if (!firedOnce(t[1])) trackEvent(t[1], { page: PAGE, funnel_step: "time" });
    }, t[0]);
  });
}

/* Прячет floating-иконку у нижнего блока заявки. */
function initFloatingAutohide() {
  var floating = document.querySelector(".floating");
  var anchor = document.getElementById("request");
  if (!floating || !anchor || typeof IntersectionObserver === "undefined") return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) { floating.classList.toggle("floating--tucked", entry.isIntersecting); });
  }, { threshold: 0.18 });
  io.observe(anchor);
}

/* Кнопка "Копировать" (thank-you). */
function fallbackCopy(text) {
  try {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "absolute"; ta.style.left = "-9999px";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
  } catch (e) { console.warn("Копирование недоступно:", e); }
}
function initCopyButtons() {
  document.querySelectorAll("[data-copy-target]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = document.querySelector(btn.getAttribute("data-copy-target"));
      if (!target) return;
      var text = (target.textContent || "").trim();
      var showDone = function () {
        var label = btn.querySelector(".copy-btn__label");
        var prev = label ? label.textContent : null;
        btn.classList.add("is-copied");
        if (label) label.textContent = "Скопировано";
        setTimeout(function () { btn.classList.remove("is-copied"); if (label && prev !== null) label.textContent = prev; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showDone).catch(function () { fallbackCopy(text); showDone(); });
      } else { fallbackCopy(text); showDone(); }
    });
  });
}

/* Деликатные появления блоков при прокрутке. */
function initReveal() {
  var items = document.querySelectorAll(".reveal");
  if (!items.length) return;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || typeof IntersectionObserver === "undefined") {
    items.forEach(function (el) { el.classList.add("is-visible"); });
    return;
  }
  var io = new IntersectionObserver(function (entries, obs) {
    entries.forEach(function (entry) { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); obs.unobserve(entry.target); } });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  items.forEach(function (el) { io.observe(el); });
}

/* ============================================================
   Инициализация по типу страницы (body[data-page])
   ============================================================ */
document.addEventListener("DOMContentLoaded", function () {
  var page = document.body.getAttribute("data-page");
  var PAGE = page === "index" ? "index" : "thank_you";

  captureAttribution();     // UTM/атрибуция при первом заходе (персистит на thank-you)
  initReveal();
  initDirectTelegramLinks();
  initContactGate();
  initScrollButtons();
  initFloatingAutohide();
  initCopyButtons();
  initScrollDepth(PAGE);
  initTimeOnPage(PAGE);

  if (page === "index") {
    if (!firedOnce("view_landing")) {
      trackEvent("view_landing", { page: "index", event_source: "web", funnel_step: "landing" });
    }
    document.querySelectorAll("form.lead-form").forEach(bindLeadForm);
    // Анти-бот токен: берём при загрузке (заодно «прогревает» функцию) и обновляем фоном.
    fetchLeadToken();
    setInterval(fetchLeadToken, LEAD_TOKEN_REFRESH_MS);
    // Вернулись кнопкой «Назад» из bfcache — страница восстановилась в состоянии «Отправляем…».
    // Перезагружаем, чтобы форма и токен были чистыми.
    window.addEventListener("pageshow", function (e) { if (e.persisted) location.reload(); });
  }

  if (page === "thank-you") {
    if (!firedOnce("view_thank_you")) {
      trackEvent("view_thank_you", { page: "thank_you", event_source: "web", funnel_step: "thank_you" });
    }

    /* lead_submit (Meta Lead) — здесь, при попадании на страницу "Спасибо".
       Флаг ставится формой на index и снимается сразу после отправки события,
       поэтому обновление страницы или прямой заход НЕ создают повторный Lead. */
    try {
      var pendingRaw = sessionStorage.getItem("b2b_pending_lead");
      if (pendingRaw) {
        sessionStorage.removeItem("b2b_pending_lead");
        var pending = {};
        try { pending = JSON.parse(pendingRaw) || {}; } catch (e) {}
        trackEvent("lead_submit", Object.assign(
          { page: "thank_you", event_source: "web", form_location: pending.form_location || "form", funnel_step: "lead_form" },
          getUtmForPayload()
        ));
      }
    } catch (e) { console.warn("lead flag error:", e); }
  }
});
