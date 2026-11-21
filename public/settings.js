/* OpenTube v4: settings page, honest live status, live-aware shelves and alerts.
   Uses globals from app.js / ui.js (st, prefs, uiPrefs, liveIds, subs, pos, seen, liked, me, api, toast...). */
let liveNames = {}, liveViewers = {}, liveReady = false;
const saveSt = () => sv("st", st);

/* ---- live status: poll the server, which checks SSH101 for a real broadcast ---- */
async function pollLive() {
  if (document.hidden && liveReady) return;
  try {
    const r = await api("/live/status"), next = new Set(r.ids);
    const gained = r.ids.filter((id) => !liveIds.has(id));
    const changed = gained.length || [...liveIds].some((id) => !next.has(id));
    liveNames = r.names || {}; liveViewers = r.viewers || {};
    if (liveReady && st.notifyLive) gained.filter((id) => subs.includes(id)).forEach((id) => announceLive(id, liveNames[id]));
    liveIds = next; liveReady = true;
    refreshLiveUi(changed);
  } catch (e) {}
}
function announceLive(id, name) {
  toast(`🔴 ${name} is live now`);
  if ("Notification" in window && Notification.permission === "granted") {
    try { const n = new Notification(`${name} is live on OpenTube`, { icon: "/icon-192.png" }); n.onclick = () => { focus(); location.hash = "live-" + id; }; } catch (e) {}
  }
}
function refreshLiveUi(rerender) {
  const l = $('nav a[data-go="live"]'), n = st.liveUi ? liveIds.size : 0;
  if (l) {
    let b = l.querySelector(".navlive"); if (!b) { b = document.createElement("b"); b.className = "navlive"; l.append(b); }
    b.textContent = n || "";
  }
  const r = (location.hash.slice(1) || "home").split("-")[0];
  if (rerender && ["channels", "channel"].includes(r)) route();
}
setInterval(pollLive, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLive(); });

/* ---- pieces used by pages in app.js ---- */
function liveTab(c, id, mine) {
  const s = c.stream, live = !!s && (s.live || isLive(id));
  const setup = mine ? `<button class="up" data-go="live">${s ? "Manage stream" : "Set up live streaming"}</button>` : "";
  if (!s) return empty("No live stream", mine ? "Connect a free SSH101 channel to broadcast from OBS." : "This channel hasn’t set up live streaming yet.", setup);
  return `<div class="live-tab${live ? " on-air" : ""}"><div class="live-thumb big">${live ? '<i class="livepill">● LIVE</i>' : '<i class="offpill">OFFLINE</i>'}<span>${live ? "▶" : "⏸"}</span></div><div><h2>${esc(s.title)}</h2><p class="meta">${live ? `${Number(s.viewers || 0).toLocaleString()} watching now · ` : "Not broadcasting right now · "}${esc(s.quality)}</p><div class="row">${live ? `<button class="up livebtn" data-go="live-${id}">● Watch live now</button>` : `<button data-go="live-${id}">Open stream page</button>`}${setup}</div>${live ? "" : '<p class="meta">Subscribe to this channel and keep OpenTube open to get an alert the moment it goes live.</p>'}</div></div>`;
}
function shelves(l) {
  let h = "";
  if (st.liveUi && liveIds.size && !term) h += `<h2 class="shelf-h">🔴 Live now</h2><div class="stories">${[...liveIds].map((id) => `<div class="story" data-go="live-${id}" tabindex="0">${avl(liveNames[id] || "?", 64, id)}<span>${esc(liveNames[id] || "")}</span><small>${Number(liveViewers[id] || 0)} watching</small></div>`).join("")}</div>`;
  if (st.remember && !term) {
    const c = l.filter((v) => pos[v.id] && v.duration && pos[v.id] < v.duration - 5 && seen[v.id]).sort((a, b) => seen[b.id] - seen[a.id]).slice(0, 8);
    if (c.length) h += `<h2 class="shelf-h">Continue watching</h2><div class="shelf">${c.map((v) => card(v)).join("")}</div>`;
  }
  return h;
}

/* ---- settings page ---- */
function exportData() {
  const blob = new Blob([JSON.stringify({ settings: st, playback: prefs, appearance: uiPrefs, liked, history: seen, subscriptions: subs, resume: pos }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "opentube-my-data.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function settingsPage() {
  $("#chips").style.display = "none";
  const row = (k, t, hint, src, on) => `<label class="set-row"><div><b>${t}</b><div class="meta">${hint}</div></div><span class="sw"><input type="checkbox" data-${src}="${k}"${on ? " checked" : ""}><i></i></span></label>`;
  const sel = (k, t, hint, src, opts, cur) => `<div class="set-row"><div><b>${t}</b><div class="meta">${hint}</div></div><select data-${src}="${k}">${opts.map(([v, n]) => `<option value="${v}"${String(cur) === String(v) ? " selected" : ""}>${n}</option>`).join("")}</select></div>`;
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const act = (id, label, cls) => `<button id="${id}"${cls ? ` class="${cls}"` : ""}>${label}</button>`;
  $("#view").innerHTML = `<h1>Settings</h1>
  ${yourChannelSection()}
  <section class="set-card"><h2>Appearance</h2>
    ${sel("theme", "Theme", "Follow your device, or force light or dark.", "uip", [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]], uiPrefs.theme)}
    <div class="set-row"><div><b>Accent colour</b><div class="meta">Tints buttons, glow and the aurora background.</div></div><div class="row">${ACCENTS.map((c) => `<button class="swatch${uiPrefs.accent === c ? " on" : ""}" data-ac="${c}" style="background:${c}" aria-label="Accent ${c}"></button>`).join("")}</div></div>
    ${row("amoled", "Pure black", "True black in dark mode. Saves battery on OLED screens.", "uip", uiPrefs.amoled)}
    ${row("compact", "Compact grid", "Show more videos per row.", "uip", uiPrefs.compact)}
    ${row("neon", "Neon gaming glow", "Cyan and magenta glow on the whole site.", "uip", uiPrefs.neon)}
    ${row("motion", "Animations and glow", "Turn off for a calmer, faster interface.", "uip", uiPrefs.motion)}
  </section>
  <section class="set-card"><h2>Playback</h2>
    ${row("auto", "Autoplay next video", "Continue with the next video or playlist item.", "pref", prefs.auto)}
    ${row("autoplay", "Start playing when a video opens", "Off means you press play yourself.", "st", st.autoplay)}
    ${row("remember", "Remember where I stopped", "Resume videos and show Continue watching on Home.", "st", st.remember)}
    ${sel("speed", "Default speed", "Used for every video.", "pref", [[0.5, "0.5×"], [0.75, "0.75×"], [1, "Normal"], [1.25, "1.25×"], [1.5, "1.5×"], [2, "2×"]], prefs.speed)}
    ${row("ambient", "Ambient glow", "A soft glow around the player that matches the video (desktop and tablet).", "st", st.ambient)}
    ${row("autoPip", "Auto picture-in-picture", "Keep playing in a small window when you switch tabs (supported browsers).", "st", st.autoPip)}
  </section>
  <section class="set-card"><h2>Home feed</h2>
    ${sel("defaultSort", "Default order", "How Home is sorted when you open it.", "st", [["new", "Newest first"], ["top", "Most viewed"]], st.defaultSort)}
    ${row("hideShorts", "Hide Shorts on Home", "Shorts stay in the Shorts tab.", "st", st.hideShorts)}
  </section>
  <section class="set-card"><h2>Live</h2>
    ${row("liveUi", "Live badges and ring", "Red ring, LIVE label and the Live now row when channels are on air.", "st", st.liveUi)}
    ${row("notifyLive", "Alert me when a subscribed channel goes live", "Works while OpenTube is open in a tab.", "st", st.notifyLive)}
    <div class="set-row"><div><b>Browser notifications</b><div class="meta">${perm === "granted" ? "Enabled on this device." : perm === "denied" ? "Blocked. Allow notifications for this site in your browser settings." : perm === "unsupported" ? "Not supported by this browser." : "Get a pop-up even when the tab is in the background."}</div></div>${perm === "default" ? act("enNotif", "Enable") : ""}</div>
  </section>
  <section class="set-card"><h2>Account and data</h2>
    <div class="set-row"><div><b>${me ? esc(me.name) : "Not signed in"}</b><div class="meta">${me ? "Your channel key is saved on this device. Keep a copy to sign in elsewhere." : "Create a channel or sign in with a channel key to upload and go live."}</div></div><div class="row">${me ? act("cpKey", "Copy key") + act("soBtn", "Sign out") : '<button class="up" data-acc>Sign in</button>'}</div></div>
    <div class="set-row"><div><b>On this device</b><div class="meta">Watch history, resume points and likes are stored in this browser only.</div></div><div class="row">${act("clrHist", "Clear history")}${act("clrPos", "Clear resume points")}${act("clrLike", "Clear likes")}</div></div>
    <div class="set-row"><div><b>Your data</b><div class="meta">Download your settings, likes, history and subscriptions as a file.</div></div><div class="row">${act("exportBtn", "Export")}${act("resetBtn", "Reset settings", "danger")}</div></div>
  </section>
  ${toolsSection()}
  <section class="set-card"><h2>App</h2>
    <div class="set-row"><div><b>Install OpenTube</b><div class="meta">${installEvt ? "Add it to your home screen for a full-screen app." : "Use your browser menu, Add to Home Screen / Install app."}</div></div>${installEvt ? act("instBtn", "Install", "up") : ""}</div>
    ${cfg.appsUrl ? `<div class="set-row"><div><b>Get the apps</b><div class="meta">Download OpenTube for Windows (.exe) and Android (.apk).</div></div><a class="btn up" href="${esc(cfg.appsUrl)}" target="_blank" rel="noopener">Download</a></div>` : ""}
    <div class="set-row"><div><b>Refresh app files</b><div class="meta">Clears the offline cache if something looks outdated.</div></div>${act("refreshApp", "Refresh")}</div>
    ${cfg.admin ? `<div class="set-row"><div><b>Admin</b><div class="meta">Moderation tools and storage stats.</div></div><button data-go="admin">Open panel</button></div>` : ""}
    <div class="set-row"><div><b>Keyboard shortcuts</b><div class="meta">K play · J / L ±10s · M mute · F fullscreen · T theater · N next · / search</div></div></div>
    <p class="meta">OpenTube v4 · no ads, no tracking, no phone verification.</p>
  </section>`;
  const bind = (attr, obj, save, after) => $$(`[data-${attr}]`).forEach((el) => (el.onchange = () => {
    const k = el.dataset[attr];
    obj()[k] = el.type === "checkbox" ? el.checked : (el.value !== "" && !isNaN(+el.value) ? +el.value : el.value);
    save(); if (after) after(k);
  }));
  bind("st", () => st, saveSt, (k) => { if (k === "liveUi") refreshLiveUi(); });
  bind("pref", () => prefs, () => sv("prefs", prefs));
  bind("uip", () => uiPrefs, saveUI);
  $$("[data-ac]").forEach((b) => (b.onclick = () => { uiPrefs.accent = b.dataset.ac; saveUI(); settingsPage(); }));
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on("#enNotif", async () => { const p = await Notification.requestPermission(); toast(p === "granted" ? "Alerts enabled" : "Alerts are blocked in your browser"); settingsPage(); });
  on("#cpKey", () => navigator.clipboard.writeText(me.key).then(() => toast("Channel key copied")));
  on("#soBtn", () => { me = null; sv("me", null); hdr(); toast("Signed out"); settingsPage(); });
  on("#clrHist", () => { if (confirm("Clear watch history on this device?")) { seen = {}; sv("seen", seen); toast("History cleared"); } });
  on("#clrPos", () => { if (confirm("Forget where you stopped in every video?")) { pos = {}; sv("pos", pos); toast("Resume points cleared"); } });
  on("#clrLike", () => { if (confirm("Clear the list of videos you liked?")) { liked = []; sv("liked", liked); toast("Likes cleared"); } });
  on("#exportBtn", exportData);
  on("#resetBtn", () => { if (confirm("Reset all settings to defaults?")) { ["st", "prefs", "ui"].forEach((k) => localStorage.removeItem(k)); location.reload(); } });
  on("#instBtn", () => { installEvt.prompt(); installEvt = null; settingsPage(); });
  on("#refreshApp", async () => { try { (await navigator.serviceWorker.getRegistrations()).forEach((r) => r.unregister()); (await caches.keys()).forEach((k) => caches.delete(k)); } catch (e) {} location.reload(); });
}
