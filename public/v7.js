/* OpenTube v7: Gaming page, channel account settings (name, about, avatar emoji and colour),
   key rotation, video editing and categories. Uses globals from app.js / ui.js / settings.js. */
const CATEGORIES = [["", "No category"], ["gaming", "🎮 Gaming"], ["music", "🎵 Music"], ["learning", "📚 Learning"], ["tech", "💻 Tech"], ["sports", "⚽ Sports"], ["fun", "😂 Fun"], ["news", "📰 News"], ["other", "Other"]];
let uploadCategory = "", gmFilter = "new", gmData = [], acColor = "";
const catOptions = (sel = uploadCategory) => CATEGORIES.map(([v, n]) => `<option value="${v}"${v === sel ? " selected" : ""}>${n}</option>`).join("");
const AV_COLORS = ["", "#d9262c", "#ff6a00", "#f5b301", "#1fa971", "#00b8d9", "#1e88e5", "#8e44ec", "#e91e8c", "#00e5ff"];
async function refreshChInfo() { try { (await api("/channels")).forEach((c) => (chInfo[c.id] = c)); } catch (e) {} }
setInterval(refreshChInfo, 60000);

/* ---------- Gaming page ---------- */
async function gamingPage() {
  $("#chips").style.display = "none"; $("#view").innerHTML = skel();
  const [gv, chs] = await Promise.all([api("/videos?category=gaming"), api("/channels")]);
  chs.forEach((c) => (chInfo[c.id] = c)); gmData = gv;
  const views = gv.reduce((a, v) => a + (v.views || 0), 0), by = {};
  gv.forEach((v) => { if (!v.channel_id) return; const c = (by[v.channel_id] = by[v.channel_id] || { id: v.channel_id, name: v.channel, views: 0, n: 0 }); c.views += v.views || 0; c.n++; });
  const fame = Object.values(by).sort((a, b) => b.views - a.views).slice(0, 5), liveN = st.liveUi ? liveIds.size : 0;
  $("#view").innerHTML = `<div class="gm">
  <section class="gm-hero"><div class="gm-grid"></div>
    <div class="gm-copy"><span class="gm-tag">PLAYER ONE READY</span><h1>GAMING</h1><p>Clips, streams and Shorts from the community. No ads, ever.</p>
      <div class="row"><button class="up" data-gm-upload>⬆ Upload a clip</button><button class="gm-ghost" data-go="live">🔴 Go live</button></div></div>
    <div class="gm-stats"><div><b>${gv.length}</b>clips</div><div><b>${liveN}</b>live now</div><div><b>${views.toLocaleString()}</b>views</div></div>
  </section>
  ${liveN ? `<h2 class="shelf-h">🔴 Live now</h2><div class="stories">${[...liveIds].map((id) => `<div class="story" data-go="live-${id}" tabindex="0">${avl(liveNames[id] || "?", 64, id)}<span>${esc(liveNames[id] || "")}</span><small>${Number(liveViewers[id] || 0)} watching</small></div>`).join("")}</div>` : ""}
  ${fame.length ? `<h2 class="shelf-h">🏆 Top gaming channels</h2><div class="gm-fame">${fame.map((c, i) => `<div class="gm-chan" data-go="channel-${c.id}" tabindex="0"><i>#${i + 1}</i>${avl(c.name, 56, c.id)}<b>${esc(c.name)}</b><small>${c.views.toLocaleString()} views · ${c.n} clip${c.n == 1 ? "" : "s"}</small></div>`).join("")}</div>` : ""}
  <div class="chips gm-chips">${[["new", "Newest"], ["top", "Most viewed"], ["shorts", "Shorts"]].map(([k, n]) => `<button data-gmf="${k}" class="${gmFilter === k ? "on" : ""}">${n}</button>`).join("")}</div>
  <div id="gmgrid"></div></div>`;
  gmPaint();
}
function gmPaint() {
  let l = gmData.slice();
  if (gmFilter === "shorts") l = l.filter((v) => v.is_short);
  l.sort(gmFilter === "top" ? (a, b) => b.views - a.views : (a, b) => b.date - a.date);
  $("#gmgrid").innerHTML = l.length ? grid(l.map((v) => card(v)).join("")) : empty(gmData.length ? "No Shorts yet" : "No gaming clips yet", gmData.length ? "Upload a portrait clip under 3 minutes." : "Upload a video and choose the 🎮 Gaming category.", '<button class="up" data-gm-upload>Upload a clip</button>');
}

/* ---------- channel editing (settings page + Edit channel button) ---------- */
function chFields(c) {
  acColor = c.color || "";
  return `<label class="fld">Channel name<input id="acName" maxlength="40" value="${esc(c.name || "")}"></label>
  <label class="fld">About<textarea id="acDesc" rows="3" maxlength="500">${esc(c.descr || "")}</textarea></label>
  <div class="set-row"><div><b>Avatar emoji</b><div class="meta">Shown inside your avatar. Empty uses your initial.</div></div><input id="acEmoji" class="emo" maxlength="4" value="${esc(c.emoji || "")}"></div>
  <div class="set-row"><div><b>Avatar colour</b><div class="meta">Empty circle means automatic.</div></div><div class="row" id="acColors">${AV_COLORS.map((x) => `<button class="swatch${x === acColor ? " on" : ""}" data-cc="${x}" style="background:${x || "var(--bg2)"}" aria-label="${x || "Automatic"}"></button>`).join("")}</div></div>`;
}
async function chSave(id, msgSel) {
  try {
    const r = await send("PATCH", "/channels/" + id, { name: $("#acName").value, descr: $("#acDesc").value, emoji: $("#acEmoji").value, color: acColor });
    chInfo[id] = Object.assign(chInfo[id] || { id }, r);
    if (me && me.id === id) { me.name = r.name; sv("me", me); hdr(); }
    toast("Channel updated"); return true;
  } catch (e) { $(msgSel).textContent = e.message; return false; }
}
function yourChannelSection() {
  if (!me) return "";
  const c = chInfo[me.id] || { name: me.name };
  return `<section class="set-card"><h2>Your channel</h2>
    <div class="acct-head">${avl(me.name, 72, me.id)}<div><b>${esc(me.name)}</b><div class="meta">Public page: <span class="lnk" data-go="channel-${me.id}">open my channel</span></div></div></div>
    ${chFields(c)}
    <div class="row end"><button class="up" id="acSave">Save changes</button></div><div class="meta" id="acMsg"></div>
    <div class="set-row"><div><b>Channel key</b><div class="meta">Rotate it if you think it leaked. The old key stops working immediately and the new one is shown once.</div></div><button id="acRotate" class="danger">Rotate key</button></div>
  </section>`;
}
async function editChannelModal(id) {
  let c; try { c = await api("/channels/" + id); } catch (e) { return toast(e.message); }
  modal(`<h2>Edit channel</h2>${chFields(c)}<div class="row end"><button data-close>Cancel</button><button class="up" id="ecSave">Save</button></div><div class="meta" id="ecMsg"></div>`);
  $("#ecSave").onclick = async () => { if (await chSave(id, "#ecMsg")) { M.close(); route(); } };
}
async function editVideoModal(id) {
  let v; try { v = await api("/videos/" + id); } catch (e) { return toast(e.message); }
  modal(`<h2>Edit video</h2><label>Title<input id="evT" maxlength="100" value="${esc(v.title)}"></label><label>Description<textarea id="evD" rows="4">${esc(v.desc || "")}</textarea></label><label>Visibility<select id="evV">${[["public", "🌍 Public"], ["unlisted", "🔗 Unlisted (link only)"], ["private", "🔒 Private (only you)"]].map(([k, n]) => `<option value="${k}"${v.visibility === k ? " selected" : ""}>${n}</option>`).join("")}</select></label><label>Category<select id="evC">${catOptions(v.category || "")}</select></label>${v.visibility === "unlisted" && v.share_key ? `<p class="meta">Share link</p><code class="key">${esc(shareLink(id, v.share_key))}</code><div class="row"><button id="evCopy">Copy link</button><button id="evReset">Reset link</button></div>` : ""}<div class="row end"><button data-close>Cancel</button><button class="up" id="evS">Save</button></div><div class="meta" id="evM"></div>`);
  $("#evS").onclick = async () => {
    try { await send("PATCH", "/videos/" + id, { title: $("#evT").value, desc: $("#evD").value, category: $("#evC").value, visibility: $("#evV").value }); M.close(); toast("Video updated"); route(); }
    catch (e) { $("#evM").textContent = e.message; }
  };
}

document.addEventListener("click", async (e) => {
  const t = (s) => e.target.closest && e.target.closest(s);
  if (t("[data-gm-upload]")) { uploadCategory = "gaming"; M.addEventListener("close", () => { uploadCategory = ""; }, { once: true }); uploadModal(); }
  else if (t("[data-gmf]")) { gmFilter = t("[data-gmf]").dataset.gmf; $$("[data-gmf]").forEach((b) => b.classList.toggle("on", b.dataset.gmf === gmFilter)); gmPaint(); }
  else if (t("[data-cc]")) { acColor = t("[data-cc]").dataset.cc; $$("[data-cc]").forEach((b) => b.classList.toggle("on", b.dataset.cc === acColor)); }
  else if (t("#acSave")) { if (await chSave(me.id, "#acMsg")) settingsPage(); }
  else if (t("#acRotate")) {
    if (!confirm("Rotate your channel key? Any device using the old key will be signed out.")) return;
    try {
      const r = await send("POST", `/channels/${me.id}/key`); me.key = r.key; sv("me", me);
      modal(`<h2>New channel key</h2><p>Shown <b>only once</b>. Save it somewhere safe. The old key no longer works.</p><code class="key">${r.key}</code><div class="row end"><button id="cpk2">Copy key</button><button class="up" data-close>Done</button></div>`);
      $("#cpk2").onclick = () => navigator.clipboard.writeText(r.key).then(() => toast("Key copied"));
    } catch (x) { toast(x.message); }
  }
  else if (t("#ce")) { const m = /channel-(\d+)/.exec(location.hash); if (m) editChannelModal(+m[1]); }
  else if (t("#ev")) { const m = /watch-(\d+)/.exec(location.hash); if (m) editVideoModal(+m[1]); }
});
