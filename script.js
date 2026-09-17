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

/* Доставка лида менеджеру: контакт уходит на ВАШ эндпоинт (→ Telegram-группа),
   а НЕ в рекламные пиксели. Запрос переживает редирект (sendBeacon / keepalive). */
function deliverLead(payload) {
  try {
    var body = JSON.stringify(payload);
    if (navigator.sendBeacon && navigator.sendBeacon(LEAD_ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    fetch(LEAD_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true
    }).catch(function () {});
  } catch (e) { console.warn("lead delivery error:", e); }
}

/* Успешная отправка: контакт локально + на ваш эндпоинт; редирект.
   Событие lead_submit (Meta Lead) отправляется НЕ здесь, а на thank-you.html
   при загрузке — так конверсия гарантированно успевает уйти (нет гонки с редиректом).
   Здесь только ставим флаг для thank-you. */
function submitLead(contact, loc) {
  saveLeadLocally(contact);

  var attrib = {};
  try { attrib = JSON.parse(localStorage.getItem("b2b_attrib") || "{}"); } catch (e) {}
  deliverLead({ contact: contact, form_location: loc, page: "index", attrib: attrib, ts: new Date().toISOString() });

  try { sessionStorage.setItem("b2b_pending_lead", JSON.stringify({ form_location: loc, ts: Date.now() })); } catch (e) {}

  window.location.href = THANK_YOU_URL;
}

/* ============================================================
   Слайдер-подтверждение отправки («проведите вправо»).
   Защита от мусорных заявок: случайный тап или автоклик не
   отправляет форму — после нажатия кнопки появляется ползунок,
   и заявка уходит только после осознанного свайпа до конца.
   ============================================================ */
var SLIDE_LABEL = "Проведите вправо, чтобы отправить";
function createSlideConfirm(form, submitBtn, onConfirm) {
  var wrap = document.createElement("div");
  wrap.className = "slide-confirm";
  wrap.hidden = true;

  var range = document.createElement("input");
  range.type = "range";
  range.className = "slide-confirm__range";
  range.min = "0"; range.max = "100"; range.step = "1"; range.value = "0";
  range.setAttribute("aria-label", "Проведите вправо, чтобы отправить заявку");

  var label = document.createElement("span");
  label.className = "slide-confirm__label";
  label.textContent = SLIDE_LABEL;

  wrap.appendChild(range);
  wrap.appendChild(label);
  form.appendChild(wrap);

  var confirmed = false;
  var lastV = 0; // последнее «честное» положение ползунка
  function setFill(v) { wrap.style.setProperty("--p", v + "%"); }

  function reset() {
    confirmed = false;
    range.disabled = false;
    range.value = "0"; setFill(0); lastV = 0;
    wrap.classList.remove("is-confirmed");
    label.textContent = SLIDE_LABEL;
    wrap.hidden = true;
    if (submitBtn) submitBtn.hidden = false;
  }

  function show() {
    if (confirmed) return;
    range.value = "0"; setFill(0); lastV = 0;
    wrap.hidden = false;
    if (submitBtn) submitBtn.hidden = true;
  }

  function complete() {
    if (confirmed) return;
    confirmed = true;
    range.value = "100"; setFill(100);
    range.disabled = true;
    wrap.classList.add("is-confirmed");
    label.textContent = "Отправляем…";
    onConfirm(reset);
  }

  range.addEventListener("input", function () {
    if (confirmed) return;
    var v = Number(range.value) || 0;
    // Защита от «телепорта»: одиночный клик по дорожке (в т.ч. по правому
    // краю) скачком меняет значение — это не свайп, откатываем. Настоящее
    // ведение даёт плавную серию небольших приращений.
    if (v - lastV > 45) { range.value = String(lastV); setFill(lastV); return; }
    lastV = v;
    setFill(v);
    if (v >= 97) complete();
  });
  // Отпустили раньше конца — ползунок возвращается в начало.
  ["change", "pointerup", "touchend", "mouseup"].forEach(function (evt) {
    range.addEventListener(evt, function () {
      if (!confirmed && Number(range.value) < 97) { range.value = "0"; setFill(0); lastV = 0; }
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

  function showError() {
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    if (errorEl) errorEl.hidden = false;
    trackEvent("form_error", { page: "index", form_location: loc, funnel_step: "lead_form" });
  }

  // Финальная отправка — только после свайпа. Контакт могли изменить,
  // пока ползунок был на экране, поэтому проверяем ещё раз.
  var slider = createSlideConfirm(form, submitBtn, function (resetSlider) {
    if (honeypot && honeypot.value) { resetSlider(); return; }
    if (!validateContact(input.value)) {
      resetSlider();
      showError();
      input.focus();
      return;
    }
    if (submitBtn) { submitBtn.disabled = true; submitBtn.setAttribute("aria-busy", "true"); }
    submitLead(input.value.trim(), loc);
  });

  input.addEventListener("input", function () {
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
      trackEvent("click_primary_cta", { page: "index", cta_location: loc, funnel_step: "lead_form" });
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
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
      var f = modal.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
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
