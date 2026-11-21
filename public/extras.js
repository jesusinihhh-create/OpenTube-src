/* OpenTube v6 extras: command palette, clickable timestamps, sleep timer, ambient glow,
   media keys, trending, watch stats, scroll helpers, shortcuts help and a hidden surprise. */
st = Object.assign({ ambient: true, autoPip: false }, st);
let stats = Object.assign({ sec: 0 }, ls("stats", {}));
const fmtDur = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const typing = (e) => e.target.matches && e.target.matches("input,textarea,select");

/* ---------- command palette (Ctrl/Cmd + K) ---------- */
let pkItems = [], pkSel = 0, chanCache = { t: 0, list: [] };
const PK_GO = [["🏠 Home", "home"], ["⚡ Shorts", "shorts"], ["🔥 Trending", "trending"], ["🎬 Premieres", "premieres"], ["📺 Subscriptions", "subs"], ["👥 Channels", "channels"], ["📚 Playlists", "playlists"], ["🔖 Watch later", "saved"], ["🔴 Live", "live"], ["👍 Liked videos", "liked"], ["🕘 History", "history"], ["⚙️ Settings", "settings"]];
function pkCommands() {
  const c = PK_GO.map(([t, h]) => ({ t, k: "Go to", run: () => go(h) }));
  c.push(
    { t: "🎲 Surprise me (random video)", k: "Action", run: () => { if (vids.length) go("watch-" + vids[Math.floor(Math.random() * vids.length)].id); else toast("No videos yet"); } },
    { t: "🌗 Toggle light / dark", k: "Action", run: () => $("#tb").click() },
    { t: "🎨 Appearance", k: "Action", run: palModal },
    { t: "⬆️ Upload a video", k: "Action", run: uploadModal },
    { t: me ? "👤 My account" : "👤 Sign in or create a channel", k: "Action", run: accountModal },
    { t: "🔗 Copy link at current time", k: "Action", run: copyTimeLink },
    { t: "😴 Sleep timer: 15 minutes", k: "Action", run: () => setSleep(15) },
    { t: "😴 Sleep timer: 30 minutes", k: "Action", run: () => setSleep(30) },
    { t: "😴 Sleep timer: 60 minutes", k: "Action", run: () => setSleep(60) },
    { t: "⌨️ Keyboard shortcuts", k: "Help", run: showKeys });
  return c;
}
function pkRender(q) {
  q = q.trim().toLowerCase();
  const toks = q.split(/\s+/).filter(Boolean);
  const pool = [...pkCommands(),
    ...chanCache.list.map((c) => ({ t: "👥 " + c.name, k: "Channel", run: () => go("channel-" + c.id) })),
    ...vids.map((v) => ({ t: v.title, k: "Video" + (v.channel ? " · " + v.channel : ""), run: () => go("watch-" + v.id) }))];
  let out = pool;
  if (toks.length) {
    out = pool.map((x) => { const h = (x.t + " " + x.k).toLowerCase(); return toks.every((t) => h.includes(t)) ? { x, s: x.t.toLowerCase().includes(toks[0]) ? (x.t.toLowerCase().indexOf(toks[0]) === 0 ? 0 : 1) : 2 } : null; })
      .filter(Boolean).sort((a, b) => a.s - b.s).map((o) => o.x);
  } else out = pool.slice(0, 12);
  pkItems = out.slice(0, 12); pkSel = 0; pkPaint();
}
function pkPaint() {
  $("#pkl").innerHTML = pkItems.length ? pkItems.map((x, i) => `<div class="pk-item${i === pkSel ? " on" : ""}" data-pk="${i}" role="option"><span>${esc(x.t)}</span><small>${esc(x.k)}</small></div>`).join("") : '<p class="meta" style="padding:10px">Nothing matches.</p>';
  const on = $(".pk-item.on"); if (on) on.scrollIntoView({ block: "nearest" });
}
function pkRun(i) { const x = pkItems[i]; if (!x) return; M.close(); setTimeout(x.run, 30); }
async function openPalette() {
  if (Date.now() - chanCache.t > 60000) { try { chanCache = { t: Date.now(), list: await api("/channels") }; } catch (e) {} }
  modal(`<input id="pk" class="pk-in" placeholder="Type a command, video or channel…" autocomplete="off" aria-label="Command palette"><div id="pkl" class="pk-list" role="listbox"></div><div class="meta pk-hint">↑ ↓ move · Enter open · Esc close</div>`);
  const input = $("#pk"); input.focus(); pkRender("");
  input.oninput = () => pkRender(input.value);
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { pkSel = Math.min(pkSel + 1, pkItems.length - 1); pkPaint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { pkSel = Math.max(pkSel - 1, 0); pkPaint(); e.preventDefault(); }
    else if (e.key === "Enter") pkRun(pkSel);
  };
}
addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
  else if (e.key === "?" && !typing(e)) showKeys();
});
const kb = document.createElement("button"); kb.id = "kbtn"; kb.setAttribute("aria-label", "Command palette"); kb.innerHTML = "<kbd>Ctrl</kbd><kbd>K</kbd>";
$("#upb").before(kb); kb.onclick = openPalette;
function showKeys() {
  const rows = [["Ctrl/⌘ K", "Command palette"], ["/", "Search"], ["K", "Play / pause"], ["J / L", "Back / forward 10s"], ["M", "Mute"], ["F", "Fullscreen"], ["T", "Theater mode"], ["N", "Next video"], ["?", "This list"]];
  modal(`<h2>Keyboard shortcuts</h2>${rows.map(([k, d]) => `<div class="set-row"><span>${d}</span><kbd>${k}</kbd></div>`).join("")}<div class="row end"><button class="up" data-close>Close</button></div>`);
}

/* ---------- sleep timer + time links ---------- */
let sleepT = 0, sleepEnd = 0;
function setSleep(min) {
  clearTimeout(sleepT); sleepEnd = 0;
  if (!min) return toast("Sleep timer off");
  sleepEnd = Date.now() + min * 60000;
  sleepT = setTimeout(() => { document.querySelectorAll("video").forEach((v) => v.pause()); sleepEnd = 0; toast("😴 Sleep timer finished. Playback paused."); }, min * 60000);
  toast(`😴 Sleep timer set for ${min} minutes`);
}
function copyTimeLink() {
  const v = $("#pv"); if (!v) return toast("Open a video first");
  const url = location.origin + location.pathname + location.hash.replace(/-t-\d+/, "") + "-t-" + Math.floor(v.currentTime);
  navigator.clipboard.writeText(url).then(() => toast("Link copied at " + dur(v.currentTime)), () => toast("Couldn’t copy the link"));
}
document.addEventListener("loadedmetadata", (e) => {
  if (e.target.id !== "pv") return;
  const m = /-t-(\d+)/.exec(location.hash); if (!m) return;
  setTimeout(() => { e.target.currentTime = Math.min(+m[1], e.target.duration || 1e9); }, 0);
}, true);
const TS = /(^|[^\d:])((?:(\d{1,2}):)?([0-5]?\d):([0-5]\d))(?![\d:])/g;
function linkTimes(root) {
  root.querySelectorAll(".desc:not([data-ts]),.cmt:not([data-ts])").forEach((el) => {
    el.dataset.ts = 1;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach((n) => {
      const t = n.nodeValue; TS.lastIndex = 0; if (!TS.test(t)) return; TS.lastIndex = 0;
      const f = document.createDocumentFragment(); let i = 0, m;
      while ((m = TS.exec(t))) {
        f.append(t.slice(i, m.index) + m[1]);
        const a = document.createElement("a"); a.className = "ts"; a.href = "#"; a.textContent = m[2];
        a.dataset.t = (+(m[3] || 0)) * 3600 + (+m[4]) * 60 + (+m[5]); f.append(a);
        i = m.index + m[0].length;
      }
      f.append(t.slice(i)); n.replaceWith(f);
    });
  });
}
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest(".ts"); if (!a) return;
  e.preventDefault(); const v = $("#pv"); if (!v) return;
  v.currentTime = +a.dataset.t; v.play(); v.scrollIntoView({ behavior: "smooth", block: "center" });
});

/* ---------- ambient glow, picture-in-picture, media keys (run when a video page appears) ---------- */
let ambTimer = 0;
function ambient(v) {
  clearInterval(ambTimer);
  const pl = v.closest(".ot-player");
  if (!pl || !st.ambient || !uiPrefs.motion || matchMedia("(max-width:699px)").matches || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  const host = pl.parentElement; host.style.position = "relative";
  const c = document.createElement("canvas"); c.className = "amb"; c.width = 32; c.height = 18; host.prepend(c);
  const g = c.getContext("2d");
  ambTimer = setInterval(() => {
    if (!document.body.contains(c)) return clearInterval(ambTimer);
    c.style.height = pl.offsetHeight + "px";
    try { g.drawImage(v, 0, 0, 32, 18); } catch (e) {}
  }, 500);
}
function mediaKeys(v) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: ($("#view h1") || {}).textContent || "OpenTube", artist: (($("#view .row b") || {}).textContent) || "OpenTube", artwork: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }] });
    const A = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    A("seekbackward", () => { v.currentTime -= 10; }); A("seekforward", () => { v.currentTime += 10; });
    A("play", () => v.play()); A("pause", () => v.pause());
    A("nexttrack", nextHash ? () => { location.hash = nextHash; } : null);
  } catch (e) {}
}
let obT = 0;
function onView() {
  linkTimes($("#view"));
  const v = $("#pv"); if (!v || v.dataset.x) return; v.dataset.x = 1;
  v.autoPictureInPicture = !!st.autoPip;
  ambient(v); mediaKeys(v);
}
new MutationObserver(() => { clearTimeout(obT); obT = setTimeout(onView, 80); }).observe($("#view"), { childList: true, subtree: true });

/* ---------- watch-time stats ---------- */
document.addEventListener("timeupdate", (e) => {
  const v = e.target; if (v.id !== "pv" || v.paused) return;
  const d = v.currentTime - (v._lt === undefined ? v.currentTime : v._lt); v._lt = v.currentTime;
  if (d > 0 && d < 1.5) stats.sec += d;
}, true);
setInterval(() => sv("stats", stats), 15000);
addEventListener("pagehide", () => sv("stats", stats));

/* ---------- Trending (views and likes, weighted toward recent uploads) ---------- */
async function trendingPage() {
  $("#chips").style.display = "none";
  $("#view").innerHTML = skel(); await refresh();
  const score = (v) => ((v.views || 0) + 3 * (v.likes || 0) + 1) / Math.pow((Date.now() - v.date) / 864e5 + 2, 1.2);
  const l = vids.filter((v) => !v.is_short).sort((a, b) => score(b) - score(a)).slice(0, 24);
  $("#view").innerHTML = `<h1>🔥 Trending</h1>` + (l.length ? grid(l.map((v, i) => card(v).replace("<b>", `<i class="rank">${i + 1}</i><b>`)).join("")) : empty("Nothing trending yet", "Upload and watch some videos to get things moving."));
}

/* ---------- settings page additions ---------- */
function toolsSection() {
  const left = sleepEnd ? Math.max(1, Math.ceil((sleepEnd - Date.now()) / 60000)) : 0;
  return `<section class="set-card"><h2>Tools and stats</h2>
    <div class="set-row"><div><b>Sleep timer</b><div class="meta">${left ? `Playback pauses in about ${left} min.` : "Pause playback automatically after a while."}</div></div><div class="row">${[15, 30, 60].map((m) => `<button data-sleep="${m}">${m} min</button>`).join("")}${left ? '<button data-sleep="0" class="danger">Off</button>' : ""}</div></div>
    <div class="set-row"><div><b>Command palette</b><div class="meta">Jump anywhere or run actions. Shortcut: Ctrl / ⌘ K.</div></div><button id="pkOpen">Open</button></div>
    <div class="set-row"><div><b>Keyboard shortcuts</b><div class="meta">Press ? anywhere to see them.</div></div><button id="keysOpen">Show</button></div>
    <div class="set-row"><div><b>Your stats</b><div class="meta">${fmtDur(stats.sec)} watched on this device · ${Object.keys(seen).length} videos · ${subs.length} subscriptions · ${liked.length} liked</div></div></div>
  </section>`;
}
document.addEventListener("click", (e) => {
  const s = e.target.closest && e.target.closest("[data-sleep]");
  if (s) { setSleep(+s.dataset.sleep); if (location.hash === "#settings") settingsPage(); }
  if (e.target.closest && e.target.closest("#pkOpen")) openPalette();
  if (e.target.closest && e.target.closest("#keysOpen")) showKeys();
});

/* ---------- scroll progress, back to top, connection toasts ---------- */
const sp = document.createElement("div"); sp.id = "sprog";
const tt = document.createElement("button"); tt.id = "totop"; tt.setAttribute("aria-label", "Back to top"); tt.textContent = "↑";
document.body.append(sp, tt);
tt.onclick = () => scrollTo({ top: 0, behavior: "smooth" });
addEventListener("scroll", () => {
  const h = document.documentElement.scrollHeight - innerHeight;
  sp.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
  tt.classList.toggle("show", scrollY > 900);
}, { passive: true });
addEventListener("offline", () => toast("You’re offline"));
addEventListener("online", () => { toast("Back online"); pollLive(); });

/* ---------- hidden surprise: ↑ ↑ ↓ ↓ ← → ← → B A ---------- */
const KON = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]; let kp = 0;
document.addEventListener("keydown", (e) => {
  if (typing(e)) { kp = 0; return; }
  kp = e.key.toLowerCase() === KON[kp].toLowerCase() ? kp + 1 : e.key === KON[0] ? 1 : 0;
  if (kp === KON.length) { kp = 0; const on = document.documentElement.classList.toggle("disco"); toast(on ? "🪩 Disco mode on" : "Disco mode off"); }
});
