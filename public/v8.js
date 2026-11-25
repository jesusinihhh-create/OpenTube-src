/* OpenTube v8: unlisted/private sharing, reports, About tab, announcement banner, notifications bell
   and a full admin panel. Uses globals from app.js / ui.js / settings.js / extras.js / v7.js. */
let curVideo = null, adminTab = "overview", adminQ = "";

/* ---------- unlisted links ---------- */
const shareKey = () => (/-k-([a-f0-9]+)/.exec(location.hash) || [])[1] || "";
const shareQ = () => (shareKey() ? "?k=" + shareKey() : "");
const shareLink = (id, key) => `${location.origin}${location.pathname}#watch-${id}-k-${key}`;
function shareUrl() {
  const v = curVideo; if (!v) return location.href;
  if (v.visibility === "private") return "";
  if (v.visibility === "unlisted") { const k = v.share_key || shareKey(); return k ? shareLink(v.id, k) : location.href; }
  return location.origin + location.pathname + location.hash.replace(/-k-[a-f0-9]+/, "");
}
function shareLinkModal(id, key) {
  const url = shareLink(id, key);
  modal(`<h2>Unlisted video published</h2><p>Only people with this link can watch it. It does not appear on Home, your channel, search or Trending.</p><code class="key">${esc(url)}</code><div class="row end"><button id="slCopy">Copy link</button><button class="up" data-go="watch-${id}-k-${key}" data-close>Open video</button></div>`);
  $("#slCopy").onclick = () => navigator.clipboard.writeText(url).then(() => toast("Link copied"));
}

/* ---------- channel About tab ---------- */
function aboutTab(c, vs) {
  const views = vs.reduce((a, v) => a + (v.views || 0), 0);
  return `<div class="about"><p>${esc(c.descr || "No description yet.")}</p>
  <div class="meta">📅 Joined ${c.created ? new Date(c.created).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "recently"}</div>
  <div class="meta">👥 ${Number(c.subscribers || 0).toLocaleString()} subscribers</div>
  <div class="meta">▶ ${vs.length} videos · ${views.toLocaleString()} views</div></div>`;
}

/* ---------- announcement banner ---------- */
function showAnnouncement() {
  const old = $("#announce"); if (old) old.remove();
  const t = (cfg.announcement || "").trim();
  if (!t || ls("ann_dismissed", "") === t) return;
  const d = document.createElement("div"); d.id = "announce";
  d.innerHTML = `<span>📣 ${esc(t)}</span><button aria-label="Dismiss">✕</button>`;
  document.body.prepend(d);
  d.querySelector("button").onclick = () => { sv("ann_dismissed", t); d.remove(); };
}

/* ---------- notifications bell (new uploads from subscriptions + live now) ---------- */
const bell = document.createElement("button");
bell.id = "bell"; bell.setAttribute("aria-label", "Notifications"); bell.innerHTML = '🔔<b id="bellN"></b>';
$("#acc").before(bell);
let bellSeen = ls("bellSeen", 0); if (!bellSeen) { bellSeen = Date.now(); sv("bellSeen", bellSeen); }
const bellVideos = () => vids.filter((v) => subs.includes(v.channel_id) && v.date > bellSeen);
const bellLive = () => [...liveIds].filter((id) => subs.includes(id));
function updateBell() { const n = bellVideos().length + bellLive().length, b = $("#bellN"); if (b) { b.textContent = n > 9 ? "9+" : n || ""; b.classList.toggle("on", !!n); } }
bell.onclick = async () => {
  await refresh();
  const items = bellVideos().slice(0, 15), lives = bellLive();
  modal(`<h2>Notifications</h2>${lives.map((id) => `<div class="pk-item" data-go="live-${id}" data-close><span>🔴 ${esc(liveNames[id] || "A channel")} is live now</span><small>Live</small></div>`).join("")}${items.map((v) => `<div class="pk-item" data-go="watch-${v.id}" data-close><span>${esc(v.channel || "")}: ${esc(v.title)}</span><small>${ago(v.date)}</small></div>`).join("") || (lives.length ? "" : '<p class="meta">Nothing new. Subscribe to channels to see their new videos here.</p>')}<div class="row end"><button data-close>Close</button></div>`);
  bellSeen = Date.now(); sv("bellSeen", bellSeen); updateBell();
};
setInterval(updateBell, 30000); addEventListener("hashchange", () => setTimeout(updateBell, 800)); setTimeout(updateBell, 1500);

/* ---------- report a video ---------- */
function reportModal(id) {
  modal(`<h2>Report this video</h2><label>Reason<select id="rpR"><option value="spam">Spam or misleading</option><option value="harmful">Harmful or abusive</option><option value="copyright">Copyright</option><option value="other">Something else</option></select></label><label>Details (optional)<textarea id="rpD" rows="3" maxlength="300"></textarea></label><div class="row end"><button data-close>Cancel</button><button class="up" id="rpS">Send report</button></div><div class="meta" id="rpM"></div>`);
  $("#rpS").onclick = async () => { try { await send("POST", `/videos/${id}/report`, { reason: $("#rpR").value, detail: $("#rpD").value }); M.close(); toast("Thanks. An admin will review it."); } catch (e) { $("#rpM").textContent = e.message; } };
}

/* ---------- admin panel ---------- */
const MB = (b) => (b / 1048576).toFixed(1) + " MB";
async function adminPage() {
  if (!cfg.admin) return go("home");
  $("#chips").style.display = "none";
  const tabs = [["overview", "Overview"], ["videos", "Videos"], ["channels", "Channels"], ["reports", "Reports"], ["comments", "Comments"], ["site", "Site"], ["activity", "Activity"]];
  const T = (h, empty) => (h ? `<table class="table">${h}</table>` : `<p class="meta">${empty}</p>`);
  let body = "";
  if (adminTab === "overview") {
    const s = await api("/admin/overview");
    const box = (n, l) => `<div><b>${n}</b>${l}</div>`;
    body = `<div class="stats">${box(s.videos, "videos")}${box(s.v_public + " / " + s.v_unlisted + " / " + s.v_private, "public / unlisted / private")}${box(s.channels, "channels")}${box(s.suspended, "suspended")}${box(s.open_reports, "open reports")}${box(s.uploads_24h, "uploads (24h)")}${box(s.comments_24h, "comments (24h)")}${box(Number(s.views).toLocaleString(), "total views")}${box(MB(s.bytes), "video storage")}${box(MB(s.db_bytes), "database size")}</div>`;
  } else if (adminTab === "videos") {
    const l = await api("/admin/videos" + (adminQ ? "?q=" + encodeURIComponent(adminQ) : ""));
    body = `<div class="row"><input id="aq" placeholder="Search title or channel" value="${esc(adminQ)}"><button id="aqb">Search</button></div>` + T(l.map((v) => `<tr><td>${esc(v.title)}<div class="meta">${esc(v.channel || "no channel")} · ${MB(v.size)} · ${v.views} views${v.audience === "kids" ? " · 👶 kids" : v.audience === "adult" ? " · 18+" : ""}${v.reports ? ` · <b class="danger">${v.reports} report${v.reports > 1 ? "s" : ""}</b>` : ""}</div></td><td><select data-avis="${v.id}">${["public", "unlisted", "private"].map((x) => `<option${x === v.visibility ? " selected" : ""}>${x}</option>`).join("")}</select></td><td class="end"><button data-go="watch-${v.id}">Open</button> <button class="danger" data-del="/videos/${v.id}" data-n="video ${esc(v.title)}">Delete</button></td></tr>`).join(""), "No videos found.");
  } else if (adminTab === "channels") {
    const l = await api("/admin/channels");
    body = T(l.map((c) => `<tr><td>${esc(c.name)}${c.suspended ? ' <b class="danger">suspended</b>' : ""}<div class="meta">${c.vcount} videos · ${c.subs} subscribers · joined ${new Date(c.date).toLocaleDateString()}</div></td><td class="end"><button data-go="channel-${c.id}">Open</button> <button data-asus="${c.id}:${c.suspended ? 0 : 1}">${c.suspended ? "Restore" : "Suspend"}</button> <button class="danger" data-del="/channels/${c.id}" data-n="channel ${esc(c.name)}">Delete</button></td></tr>`).join(""), "No channels yet.");
  } else if (adminTab === "reports") {
    const l = await api("/admin/reports");
    body = T(l.map((r) => `<tr><td><b>${esc(r.reason)}</b> on “${esc(r.title)}”<div class="meta">${esc(r.channel || "")} · ${ago(r.date)}${r.detail ? " · " + esc(r.detail) : ""}</div></td><td class="end"><button data-go="watch-${r.video_id}">Open</button> <button data-rep="${r.id}:dismiss">Dismiss</button> <button data-rep="${r.id}:private">Make private</button> <button class="danger" data-rep="${r.id}:delete">Delete video</button></td></tr>`).join(""), "No open reports. 🎉");
  } else if (adminTab === "comments") {
    const l = await api("/admin/comments");
    body = T(l.map((c) => `<tr><td>${esc(c.body)}<div class="meta">on “${esc(c.title)}” · ${ago(c.date)}</div></td><td class="end"><button class="danger" data-del="/comments/${c.id}" data-n="this comment">Delete</button></td></tr>`).join(""), "No comments yet.");
  } else if (adminTab === "site") {
    const s = await api("/admin/settings");
    body = `<section class="set-card"><h2>Site announcement</h2><p class="meta">Shown as a banner to every visitor. Leave empty to hide it.</p><textarea id="asAnn" rows="2" maxlength="240">${esc(s.announcement)}</textarea>
    <label class="set-row"><div><b>Close new channel sign-ups</b><div class="meta">Existing channels keep working. Admins can still create channels.</div></div><span class="sw"><input type="checkbox" id="asLock"${s.lockSignup ? " checked" : ""}><i></i></span></label>
    <div class="row end"><button class="up" id="asSave">Save</button></div></section>
    <section class="set-card"><h2>Backup</h2><p class="meta">Download channels, video details, playlists and comments as a JSON file. Video files and channel keys are not included.</p><button id="asExport">Download backup</button></section>`;
  } else {
    const l = await api("/admin/audit");
    body = T(l.map((a) => `<tr><td><b>${esc(a.action)}</b><div class="meta">${esc(a.detail)}</div></td><td class="meta end">${new Date(a.date).toLocaleString()}</td></tr>`).join(""), "No admin activity yet.");
  }
  $("#view").innerHTML = `<h1>Admin panel</h1><div class="tabs">${tabs.map(([k, n]) => `<button data-atab="${k}" class="${adminTab === k ? "on" : ""}">${n}</button>`).join("")}</div>${body}`;
}
document.addEventListener("click", async (e) => {
  const t = (s) => e.target.closest && e.target.closest(s);
  try {
    if (t("[data-atab]")) { adminTab = t("[data-atab]").dataset.atab; adminPage(); }
    else if (t("#aqb")) { adminQ = $("#aq").value.trim(); adminPage(); }
    else if (t("[data-asus]")) { const [id, on] = t("[data-asus]").dataset.asus.split(":"); await send("POST", `/admin/channels/${id}/suspend`, { suspended: on === "1" }); toast(on === "1" ? "Channel suspended" : "Channel restored"); adminPage(); }
    else if (t("[data-rep]")) { const [id, action] = t("[data-rep]").dataset.rep.split(":"); if (action === "delete" && !confirm("Delete this video permanently?")) return; await send("POST", `/admin/reports/${id}/resolve`, { action }); toast("Report resolved"); adminPage(); }
    else if (t("#asSave")) { await send("PUT", "/admin/settings", { announcement: $("#asAnn").value, lockSignup: $("#asLock").checked }); cfg.announcement = $("#asAnn").value.trim(); cfg.lockSignup = $("#asLock").checked; showAnnouncement(); toast("Site settings saved"); }
    else if (t("#asExport")) { const r = await fetch("/api/admin/export"); if (!r.ok) throw new Error("Export failed"); const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = "opentube-backup.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    else if (t("#rpt")) { const m = /watch-(\d+)/.exec(location.hash); if (m) reportModal(+m[1]); }
    else if (t("#evCopy")) { const m = /watch-(\d+)/.exec(location.hash); if (m && curVideo) navigator.clipboard.writeText(shareLink(+m[1], curVideo.share_key)).then(() => toast("Link copied")); }
    else if (t("#evReset")) {
      const m = /watch-(\d+)/.exec(location.hash); if (!m || !confirm("Reset the link? The old link will stop working.")) return;
      const r = await send("PATCH", "/videos/" + m[1], { title: $("#evT").value, desc: $("#evD").value, category: $("#evC").value, visibility: $("#evV").value, resetKey: true });
      if (curVideo) curVideo.share_key = r.share_key; toast("New link created"); editVideoModal(+m[1]);
    }
  } catch (x) { toast(x.message); }
});
document.addEventListener("change", async (e) => {
  const s = e.target.closest && e.target.closest("[data-avis]"); if (!s) return;
  try { await send("POST", `/admin/videos/${s.dataset.avis}/visibility`, { visibility: s.value }); toast("Visibility set to " + s.value); } catch (x) { toast(x.message); adminPage(); }
});
