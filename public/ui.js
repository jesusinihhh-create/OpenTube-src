/* OpenTube v2: appearance, phone/tablet navigation, touch gestures, sharing and PWA.
   Loaded after app.js and uses its globals (ls, sv, modal, M, toast, adminModal). */
const UI_DEFAULT = { theme: "auto", accent: "#d9262c", amoled: false, compact: false, motion: true };
let uiPrefs = Object.assign({}, UI_DEFAULT, ls("ui", {}));
const ACCENTS = ["#d9262c", "#ff6a00", "#f5b301", "#1fa971", "#1e88e5", "#8e44ec", "#e91e8c"];
function applyUI() {
  const r = document.documentElement;
  r.style.setProperty("--ac", uiPrefs.accent);
  if (uiPrefs.theme === "auto") delete r.dataset.theme; else r.dataset.theme = uiPrefs.theme;
  r.dataset.amoled = uiPrefs.amoled ? "1" : "0";
  r.dataset.density = uiPrefs.compact ? "compact" : "";
  r.dataset.motion = uiPrefs.motion ? "" : "off";
}
const saveUI = () => { sv("ui", uiPrefs); applyUI(); };
applyUI();

/* skeleton placeholders shown while a list loads */
function skel() {
  return `<div class="grid">${Array(8).fill('<div><div class="sk th"></div><div class="sk ln"></div><div class="sk ln s"></div></div>').join("")}</div>`;
}

/* appearance sheet */
let installEvt = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });
function palModal() {
  modal(`<h2>Appearance</h2><b>Theme</b><div class="row">${["auto", "light", "dark"].map((t) => `<button data-th="${t}" class="${uiPrefs.theme === t ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
  <b>Accent colour</b><div class="row">${ACCENTS.map((c) => `<button class="swatch${uiPrefs.accent === c ? " on" : ""}" data-ac="${c}" style="background:${c}" aria-label="Accent ${c}"></button>`).join("")}</div>
  <label class="chk"><input type="checkbox" id="u-amo"${uiPrefs.amoled ? " checked" : ""}> Pure black in dark mode</label>
  <label class="chk"><input type="checkbox" id="u-den"${uiPrefs.compact ? " checked" : ""}> Compact video grid</label>
  <label class="chk"><input type="checkbox" id="u-mot"${!uiPrefs.motion ? " checked" : ""}> Reduce motion</label>
  <div class="row end"><button data-go="settings" data-close>All settings</button>${installEvt ? '<button id="u-inst">Install app</button>' : ""}<button class="up" data-close>Done</button></div>`);
  $$("[data-th]").forEach((b) => (b.onclick = () => { uiPrefs.theme = b.dataset.th; saveUI(); palModal(); }));
  $$("[data-ac]").forEach((b) => (b.onclick = () => { uiPrefs.accent = b.dataset.ac; saveUI(); palModal(); }));
  $("#u-amo").onchange = (e) => { uiPrefs.amoled = e.target.checked; saveUI(); };
  $("#u-den").onchange = (e) => { uiPrefs.compact = e.target.checked; saveUI(); };
  $("#u-mot").onchange = (e) => { uiPrefs.motion = !e.target.checked; saveUI(); };
  if ($("#u-inst")) $("#u-inst").onclick = () => { installEvt.prompt(); installEvt = null; M.close(); };
}
$("#pal").onclick = palModal;
$("#tb").addEventListener("click", () => { uiPrefs.theme = document.documentElement.dataset.theme || "auto"; sv("ui", uiPrefs); });

/* phone menu, search overlay, route classes */
const nav = $("nav"), body = document.body;
const closeNav = () => body.classList.remove("nav-open");
$("#menu").onclick = () => body.classList.toggle("nav-open");
$("#scrim").onclick = closeNav;
const closeSearch = () => body.classList.remove("search-open");
$("#sbm").onclick = () => { body.classList.add("search-open"); $("#q").focus(); };
$("#q").addEventListener("blur", () => setTimeout(() => { if (!$("#q").value) closeSearch(); }, 200));
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") { closeSearch(); $("#q").blur(); } });
function syncRoute() {
  const r = (location.hash.slice(1) || "home").split("-")[0];
  body.classList.toggle("on-watch", r === "watch");
  body.dataset.page = r;
  closeNav();
}
addEventListener("hashchange", syncRoute); syncRoute();
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-act]");
  if (a) {
    const k = a.dataset.act;
    if (k === "menu") body.classList.toggle("nav-open");
    else { closeNav(); if (k === "pal") palModal(); else if (k === "adm") adminModal(); }
  }
  const d = e.target.closest(".desc"); if (d) d.classList.toggle("open");
});
/* edge swipe opens the menu on phones, swipe left closes it */
let sx = 0, sy = 0;
addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
addEventListener("touchend", (e) => {
  const t = e.changedTouches[0], dx = t.clientX - sx;
  if (innerWidth > 699 || Math.abs(t.clientY - sy) > 60) return;
  if (sx < 22 && dx > 70 && !$(".shorts-feed")) body.classList.add("nav-open");
  else if (dx < -70 && body.classList.contains("nav-open")) closeNav();
}, { passive: true });
addEventListener("keydown", (e) => {
  if (e.key === "/" && !e.target.matches("input,textarea,select")) { e.preventDefault(); $("#q").focus(); }
  if (e.key === "Escape") closeNav();
});

/* player: double-tap to seek 10s, tap to play/pause, controls hide while playing */
const coarse = matchMedia("(pointer:coarse)");
let tapAt = 0, tapSide = 0, tapTimer = 0, idleTimer = 0;
const toggle = (v) => (v.paused ? v.play() : v.pause());
function ripple(player, side) {
  let el = player.querySelector(".ot-tap." + (side < 0 ? "l" : "r"));
  if (!el) { el = document.createElement("div"); el.className = "ot-tap " + (side < 0 ? "l" : "r"); player.append(el); }
  el.textContent = side < 0 ? "⏪ 10s" : "10s ⏩";
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
}
document.addEventListener("click", (e) => {
  if (e.target.id !== "pv") return;
  const v = e.target, player = v.closest(".ot-player"), r = v.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, side = x < .35 ? -1 : x > .65 ? 1 : 0, now = Date.now();
  clearTimeout(tapTimer);
  if (!coarse.matches) return toggle(v);
  if (side && side === tapSide && now - tapAt < 320) {
    tapAt = 0; v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + 10 * side));
    if (player) ripple(player, side); return;
  }
  tapAt = now; tapSide = side; tapTimer = setTimeout(() => toggle(v), 300);
});
document.addEventListener("dblclick", (e) => { if (!coarse.matches && e.target.id === "pv" && $("#fs")) $("#fs").click(); });
function wake(e) {
  const p = e.target.closest && e.target.closest(".ot-player"); if (!p) return;
  p.classList.remove("idle"); clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { const v = p.querySelector("video"); if (v && !v.paused && document.activeElement.tagName !== "SELECT") p.classList.add("idle"); }, 2800);
}
["pointermove", "pointerdown", "keydown"].forEach((t) => document.addEventListener(t, wake));
document.addEventListener("pause", (e) => { const p = e.target.closest && e.target.closest(".ot-player"); if (p) p.classList.remove("idle"); }, true);

/* share */
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#shr")) return;
  const title = ($("#view h1") || {}).textContent || "OpenTube";
  try {
    if (navigator.share) await navigator.share({ title, url: location.href });
    else { await navigator.clipboard.writeText(location.href); toast("Link copied"); }
  } catch (x) {}
});

/* installable app + offline shell */
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

/* v3: header shadow on scroll + cursor spotlight on thumbnails */
addEventListener("scroll", () => document.querySelector("header").classList.toggle("scrolled", scrollY > 8), { passive: true });
document.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  const t = e.target.closest && e.target.closest(".card .th"); if (!t) return;
  const r = t.getBoundingClientRect();
  t.style.setProperty("--mx", e.clientX - r.left + "px"); t.style.setProperty("--my", e.clientY - r.top + "px");
});
