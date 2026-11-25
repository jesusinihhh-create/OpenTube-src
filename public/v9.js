/* OpenTube v9: made-for-kids / age-restricted audiences, Kids mode with PIN, threaded comments with
   replies, likes and pins, Community posts, search results page, Studio, subscriptions in the menu
   and a Help and policies page. Uses globals from the earlier scripts. */
let cxSort = "top", cxLiked = ls("cxl", []), pxLiked = ls("pxl", []), sf = { type: "all", date: "any", dur: "any", sort: "rel" }, sT = 0;

/* ---------- Kids mode ---------- */
async function pinHash(p) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("opentube:" + p)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function kidsGate(p, j) {
  if (!st.kidsMode) return j;
  if (Array.isArray(j) && /^\/videos/.test(p)) return j.filter((v) => v.audience === "kids");
  if (j && /^\/videos\/\d+(\?|$)/.test(p) && j.audience && j.audience !== "kids") throw new Error("This video isn’t available in Kids mode.");
  return j;
}
const applyKids = () => { document.documentElement.dataset.kids = st.kidsMode ? "1" : ""; };
applyKids();
function familySection() {
  const on = !!st.kidsMode;
  return `<section class="set-card"><h2>Family</h2><div class="set-row"><div><b>Kids mode ${on ? "is on" : ""}</b><div class="meta">Shows only videos marked “made for kids”, blocks age-restricted videos and hides Live, Gaming and Upload.${ls("pinh", "") ? " A PIN is needed to turn it off." : ""}</div></div><button id="kmBtn" class="${on ? "danger" : "up"}">${on ? "Turn off" : "Turn on"}</button></div></section>`;
}
function kidsModal(turnOn) {
  modal(`<h2>${turnOn ? "Turn on Kids mode" : "Turn off Kids mode"}</h2><p class="meta">${turnOn ? "Optional: set a 4-digit PIN that is needed to turn Kids mode off again." : "Enter your PIN to turn Kids mode off."}</p><input id="kmPin" inputmode="numeric" maxlength="4" placeholder="${turnOn ? "PIN (optional)" : "PIN"}" autocomplete="off"><div class="row end"><button data-close>Cancel</button><button class="up" id="kmOk">${turnOn ? "Turn on" : "Turn off"}</button></div><div class="meta" id="kmMsg"></div>`);
  $("#kmOk").onclick = async () => {
    const p = $("#kmPin").value.trim();
    if (turnOn) { if (p && !/^\d{4}$/.test(p)) return ($("#kmMsg").textContent = "The PIN must be 4 digits."); sv("pinh", p ? await pinHash(p) : ""); st.kidsMode = true; }
    else { const h = ls("pinh", ""); if (h && (await pinHash(p)) !== h) return ($("#kmMsg").textContent = "Wrong PIN."); st.kidsMode = false; }
    saveSt(); applyKids(); M.close(); toast(st.kidsMode ? "Kids mode on" : "Kids mode off"); go("home");
  };
}

/* ---------- watch page additions (audience, adult gate, comments) ---------- */
let o9 = 0;
new MutationObserver(() => { clearTimeout(o9); o9 = setTimeout(onView9, 90); }).observe($("#view"), { childList: true, subtree: true });
function onView9() {
  const pv = $("#pv");
  if (pv && !pv.dataset.y && curVideo) { pv.dataset.y = 1; watchExtras(pv, curVideo); }
  const cm = $("#comm"); if (cm && !cm.dataset.y) { cm.dataset.y = 1; mountPosts(cm); }
}
function watchExtras(pv, v) {
  const h1 = $("#view h1"), host = pv.closest(".ot-player");
  if (v.audience === "kids" && h1) h1.insertAdjacentHTML("beforebegin", '<span class="visb big">👶 Made for kids</span>');
  if (v.audience === "adult" && !sessionStorage.getItem("adultOk") && host) {
    pv.pause();
    const g = document.createElement("div"); g.className = "adultgate";
    g.innerHTML = '<div><h2>Age-restricted video</h2><p>This video may be inappropriate for some users. Continue only if you are 18 or older.</p><div class="row" style="justify-content:center"><button class="up" id="agOk">I’m 18 or older</button><button id="agNo">Go back</button></div></div>';
    host.append(g);
    pv.addEventListener("play", () => { if ($(".adultgate")) pv.pause(); });
    $("#agOk").onclick = () => { sessionStorage.setItem("adultOk", "1"); g.remove(); pv.play(); };
    $("#agNo").onclick = () => history.back();
  }
  if ($("#cc")) mountComments(v);
}

/* ---------- comments: authors, replies, likes, pins, sorting ---------- */
async function mountComments(v) {
  [$("#cc"), $(".cm"), $("#cl")].forEach((e) => e && e.classList.add("hide-old"));
  const sec = document.createElement("section"); sec.id = "cmx"; $("#cl").after(sec);
  await cxLoad(v.id);
}
async function cxLoad(id) {
  const sec = $("#cmx"); if (!sec) return;
  const qs = new URLSearchParams(); if (shareKey()) qs.set("k", shareKey());
  let r; try { r = await api(`/videos/${id}/thread?${qs}`); } catch (e) { sec.innerHTML = `<p class="meta">${esc(e.message)}</p>`; return; }
  if (r.disabled) { sec.innerHTML = '<h3>Comments</h3><p class="meta">💬 Comments are turned off for videos made for kids.</p>'; return; }
  const reps = {}; r.comments.filter((c) => c.parent_id).forEach((c) => (reps[c.parent_id] = reps[c.parent_id] || []).push(c));
  const top = r.comments.filter((c) => !c.parent_id).sort((a, b) => (b.pinned - a.pinned) || (cxSort === "top" ? (b.likes - a.likes) || (b.t - a.t) : b.t - a.t));
  const mod = canManage(curVideo.channel_id);
  const one = (c, rep) => `<div class="cx${rep ? " rep" : ""}">${av(c.author || "Guest", rep ? 28 : 38, c.channel_id)}<div class="cx-b"><div class="meta">${c.pinned ? "📌 Pinned · " : ""}<b>${esc(c.author || "Guest")}</b> · ${ago(c.t)}</div><div class="cx-t">${esc(c.body)}</div><div class="row cx-a"><button data-cxl="${c.id}" class="${cxLiked.includes(c.id) ? "on" : ""}">👍 ${c.likes}</button>${rep ? "" : `<button data-cxr="${c.id}">Reply</button>`}${mod && !rep ? `<button data-cxp="${c.id}">${c.pinned ? "Unpin" : "Pin"}</button>` : ""}${mod || (me && c.channel_id === me.id) ? `<button data-cxd="${c.id}">Delete</button>` : ""}</div>${rep ? "" : `<div id="rb${c.id}"></div><div class="cx-reps">${(reps[c.id] || []).map((x) => one(x, 1)).join("")}</div>`}</div></div>`;
  sec.innerHTML = `<div class="row"><h3 class="grow">${r.comments.length} comments</h3><select id="cxS"><option value="top"${cxSort === "top" ? " selected" : ""}>Top comments</option><option value="new"${cxSort === "new" ? " selected" : ""}>Newest first</option></select></div>
  <div class="cx-in">${av(me ? me.name : "Guest", 38, me && me.id)}<input id="cxI" placeholder="Add a comment as ${esc(me ? me.name : "Guest")}…" maxlength="300"><button class="up" id="cxB">Comment</button></div><div id="cxL">${top.map((c) => one(c)).join("")}</div>`;
}
async function cxSend(body, parent) {
  if (!body.trim()) return;
  try { await send("POST", `/videos/${curVideo.id}/thread`, { body, parent_id: parent || undefined }); await cxLoad(curVideo.id); } catch (e) { toast(e.message); }
}

/* ---------- Community posts ---------- */
async function mountPosts(el) {
  const ch = +el.dataset.ch, mine = canManage(ch); let l = [];
  try { l = await api(`/channels/${ch}/posts`); } catch (e) {}
  el.innerHTML = `${mine ? `<div class="post-new"><textarea id="pxT" rows="3" maxlength="1000" placeholder="Share an update with your subscribers"></textarea><div class="row end"><button class="up" id="pxB" data-ch="${ch}">Post</button></div></div>` : ""}${l.length ? l.map((p) => `<article class="post"><div class="meta">${ago(p.created)}</div><p>${esc(p.body)}</p><div class="row"><button data-pxl="${p.id}" class="${pxLiked.includes(p.id) ? "on" : ""}">👍 ${p.likes}</button>${mine ? `<button class="danger" data-pxd="${p.id}">Delete</button>` : ""}</div></article>`).join("") : empty("No community posts", mine ? "Share news with your subscribers." : "This channel hasn’t posted yet.")}`;
}

/* ---------- search results page ---------- */
const searchSoon = () => { clearTimeout(sT); sT = setTimeout(searchPage, 250); };
async function searchPage() {
  $("#chips").style.display = "none";
  const t = term.trim().toLowerCase(); if (!t) return go("home");
  if (!vids.length) await refresh();
  const [chs, pls] = await Promise.all([api("/channels"), api("/playlists")]); chs.forEach((c) => (chInfo[c.id] = c));
  const hit = (s) => (s || "").toLowerCase().includes(t), now = Date.now(), DAY = 864e5;
  let vs = vids.filter((v) => hit(v.title) || hit(v.channel) || hit(v.desc));
  if (sf.type === "shorts") vs = vs.filter((v) => v.is_short);
  if (sf.date !== "any") vs = vs.filter((v) => now - v.date < { today: DAY, week: 7 * DAY, month: 30 * DAY }[sf.date]);
  if (sf.dur === "short") vs = vs.filter((v) => v.duration < 240); else if (sf.dur === "mid") vs = vs.filter((v) => v.duration >= 240 && v.duration <= 1200); else if (sf.dur === "long") vs = vs.filter((v) => v.duration > 1200);
  const score = (v) => (v.title.toLowerCase().startsWith(t) ? 3 : 0) + (hit(v.title) ? 2 : 0) + (hit(v.channel) ? 1 : 0);
  vs.sort(sf.sort === "date" ? (a, b) => b.date - a.date : sf.sort === "views" ? (a, b) => b.views - a.views : (a, b) => score(b) - score(a) || b.views - a.views);
  const cs = ["all", "channels"].includes(sf.type) ? chs.filter((c) => hit(c.name) || hit(c.descr)) : [], ps = ["all", "playlists"].includes(sf.type) ? pls.filter((p) => hit(p.title)) : [];
  if (["channels", "playlists"].includes(sf.type)) vs = [];
  const opt = (k, list) => `<select data-sfk="${k}">${list.map(([v, n]) => `<option value="${v}"${sf[k] === v ? " selected" : ""}>${n}</option>`).join("")}</select>`;
  const vrow = (v) => `<div class="sr" data-go="watch-${v.id}" tabindex="0"><div class="th" style="background-image:url('${v.thumb || ""}')"><b>${dur(v.duration)}</b></div><div><h3>${esc(v.title)}</h3><div class="meta">${v.views} views · ${ago(v.date)}</div><div class="meta">${v.channel ? `<span class="lnk" data-go="channel-${v.channel_id}">${esc(v.channel)}</span>` : ""}</div><div class="meta">${esc((v.desc || "").slice(0, 140))}</div></div></div>`;
  const any = cs.length + ps.length + vs.length;
  $("#view").innerHTML = `<h2>Results for “${esc(term)}”</h2><div class="chips">${[["all", "All"], ["videos", "Videos"], ["shorts", "Shorts"], ["channels", "Channels"], ["playlists", "Playlists"]].map(([k, n]) => `<button data-sft="${k}" class="${sf.type === k ? "on" : ""}">${n}</button>`).join("")}</div>
  <div class="row">${opt("date", [["any", "Any date"], ["today", "Today"], ["week", "This week"], ["month", "This month"]])}${opt("dur", [["any", "Any length"], ["short", "Under 4 min"], ["mid", "4 to 20 min"], ["long", "Over 20 min"]])}${opt("sort", [["rel", "Relevance"], ["date", "Newest"], ["views", "Most viewed"]])}</div>
  ${cs.map((c) => `<div class="sr" data-go="channel-${c.id}" tabindex="0">${av(c.name, 72, c.id)}<div><h3>${esc(c.name)}</h3><div class="meta">${c.vcount} videos</div><div class="meta">${esc(c.descr || "")}</div></div></div>`).join("")}
  ${ps.map((p) => `<div class="sr" data-go="playlist-${p.id}" tabindex="0"><div class="th" style="background-image:url('${p.thumb || ""}')"><b>${p.count} videos</b></div><div><h3>${esc(p.title)}</h3><div class="meta">Playlist · ${esc(p.channel || "")}</div></div></div>`).join("")}
  ${vs.map(vrow).join("")}${any ? "" : empty("No results", "Try different words or clear the filters.")}`;
}
document.addEventListener("change", (e) => { const s = e.target.closest && e.target.closest("[data-sfk]"); if (s) { sf[s.dataset.sfk] = s.value; searchPage(); } });
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter" && $("#q").value.trim()) { term = $("#q").value; go("search"); } });
$("#sb").addEventListener("click", () => { if ($("#q").value.trim()) { term = $("#q").value; go("search"); } });

/* ---------- Studio ---------- */
async function studioPage() {
  $("#chips").style.display = "none";
  if (!me) { $("#view").innerHTML = empty("Sign in to open Studio", "Create or sign in to a channel to manage your videos.", '<button class="up" data-acc>Sign in</button>'); return; }
  const [c, vs] = await Promise.all([api("/channels/" + me.id), api("/videos?channel=" + me.id)]);
  const sum = (k) => vs.reduce((a, v) => a + (v[k] || 0), 0), box = (n, l) => `<div><b>${Number(n).toLocaleString()}</b>${l}</div>`;
  $("#view").innerHTML = `<h1>Channel Studio</h1><div class="row"><button class="up" data-up>⬆ Upload</button><button data-go="channel-${me.id}">View channel</button><button data-go="settings">Channel settings</button></div>
  <div class="stats">${box(vs.length, "videos")}${box(sum("views"), "views")}${box(sum("likes"), "likes")}${box(sum("ccount"), "comments")}${box(c.subscribers || 0, "subscribers")}</div>
  ${vs.length ? `<table class="table">${vs.map((v) => `<tr><td><div class="sr mini-sr"><div class="th" style="background-image:url('${v.thumb || ""}')"><b>${dur(v.duration)}</b></div><div><b>${esc(v.title)}</b><div class="meta">${v.visibility === "private" ? "🔒 Private" : v.visibility === "unlisted" ? "🔗 Unlisted" : "🌍 Public"} · ${v.audience === "kids" ? "👶 Made for kids" : v.audience === "adult" ? "18+" : "General audience"} · ${ago(v.date)}</div><div class="meta">${v.views} views · ${v.likes} likes · ${v.ccount || 0} comments</div></div></div></td><td class="end"><button data-go="watch-${v.id}">Watch</button> <button data-evs="${v.id}">Edit</button> <button class="danger" data-del="/videos/${v.id}" data-n="video ${esc(v.title)}">Delete</button></td></tr>`).join("")}</table>` : empty("No videos yet", "Upload your first video to see it here.")}`;
}

/* ---------- subscriptions list in the menu ---------- */
const navS = document.createElement("div"); navS.id = "navsubs"; $("nav").append(navS);
let navSig = "";
function renderNavSubs() {
  const ids = subs.filter((id) => chInfo[id]);
  const sig = ids.map((i) => i + chInfo[i].name + chInfo[i].emoji + chInfo[i].color).join() + "|" + [...liveIds].join();
  if (sig === navSig) return; navSig = sig;
  navS.innerHTML = ids.length ? `<hr><div class="navh">Subscriptions</div>${ids.map((id) => `<a data-go="channel-${id}">${av(chInfo[id].name, 24, id)}<span>${esc(chInfo[id].name)}</span>${isLive(id) ? '<i class="ldot"></i>' : ""}</a>`).join("")}` : "";
}
setInterval(renderNavSubs, 3000);

/* ---------- Help and policies ---------- */
function helpPage() {
  $("#chips").style.display = "none";
  const S = (h, p) => `<section class="set-card"><h2>${h}</h2>${p.map((x) => `<p>${x}</p>`).join("")}</section>`;
  $("#view").innerHTML = `<h1>Help and policies</h1>
  ${S("About OpenTube", ["A video site with no ads, no tracking and no phone verification. Make a channel with just a name, upload videos, go live, and share them."])}
  ${S("Public, unlisted and private", ["<b>Public</b> videos appear everywhere. <b>Unlisted</b> videos are hidden from Home, channels and search, and only people with the link can watch them. <b>Private</b> videos can only be watched by you and the site admins."])}
  ${S("Made for kids and age-restricted", ["When you upload you say whether a video is made for kids. Videos made for kids have comments turned off and show in Kids mode. Age-restricted (18+) videos ask viewers to confirm their age and are blocked in Kids mode.", "Kids mode is in Settings, Family. It can be locked with a 4-digit PIN on that device."])}
  ${S("Community guidelines", ["Be kind. No spam, scams or harassment, no content that harms or exploits people, and no copyright-infringing uploads. Use the ⚑ Report button on a video to tell the admins. Admins can make videos private, delete them or suspend channels."])}
  ${S("Privacy", ["Your watch history, likes, subscriptions and settings are stored in your own browser. Videos, channels, comments and community posts you create are stored on this site’s server. Channel keys are stored only as hashes. There is no advertising and no third-party tracking."])}
  ${S("Your channel key", ["Your channel key is your sign-in. Save it somewhere safe. You can rotate it in Settings if you think it leaked."])}`;
}

/* ---------- clicks ---------- */
document.addEventListener("click", async (e) => {
  const t = (s) => e.target.closest && e.target.closest(s);
  try {
    if (t("#kmBtn")) kidsModal(!st.kidsMode);
    else if (t("[data-sft]")) { sf.type = t("[data-sft]").dataset.sft; searchPage(); }
    else if (t("[data-evs]")) editVideoModal(+t("[data-evs]").dataset.evs);
    else if (t("#cxB")) { const i = $("#cxI"); await cxSend(i.value); }
    else if (t("[data-cxl]")) {
      const id = +t("[data-cxl]").dataset.cxl, on = !cxLiked.includes(id), b = t("[data-cxl]");
      const r = await send("POST", `/comments/${id}/like`, { delta: on ? 1 : -1 });
      cxLiked = on ? [...cxLiked, id] : cxLiked.filter((x) => x !== id); sv("cxl", cxLiked); b.textContent = "👍 " + r.likes; b.classList.toggle("on", on);
    }
    else if (t("[data-cxr]")) { const id = t("[data-cxr]").dataset.cxr; $("#rb" + id).innerHTML = `<div class="cx-in"><input id="rin${id}" placeholder="Add a reply…" maxlength="300"><button class="up" data-cxs="${id}">Reply</button></div>`; $("#rin" + id).focus(); }
    else if (t("[data-cxs]")) { const id = +t("[data-cxs]").dataset.cxs; await cxSend($("#rin" + id).value, id); }
    else if (t("[data-cxd]")) { if (confirm("Delete this comment?")) { await send("DELETE", "/comments/" + t("[data-cxd]").dataset.cxd); await cxLoad(curVideo.id); } }
    else if (t("[data-cxp]")) { await send("POST", `/comments/${t("[data-cxp]").dataset.cxp}/pin`); await cxLoad(curVideo.id); }
    else if (t("#pxB")) { await send("POST", `/channels/${t("#pxB").dataset.ch}/posts`, { body: $("#pxT").value }); toast("Posted"); mountPosts($("#comm")); }
    else if (t("[data-pxl]")) {
      const b = t("[data-pxl]"), id = +b.dataset.pxl, on = !pxLiked.includes(id), r = await send("POST", `/posts/${id}/like`, { delta: on ? 1 : -1 });
      pxLiked = on ? [...pxLiked, id] : pxLiked.filter((x) => x !== id); sv("pxl", pxLiked); b.textContent = "👍 " + r.likes; b.classList.toggle("on", on);
    }
    else if (t("[data-pxd]")) { if (confirm("Delete this post?")) { await send("DELETE", "/posts/" + t("[data-pxd]").dataset.pxd); mountPosts($("#comm")); } }
  } catch (x) { toast(x.message); }
});
document.addEventListener("change", (e) => { if (e.target.id === "cxS") { cxSort = e.target.value; cxLoad(curVideo.id); } });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.id === "cxI") $("#cxB").click();
  else if (e.target.id && e.target.id.startsWith("rin")) { const b = e.target.parentElement.querySelector("[data-cxs]"); if (b) b.click(); }
});
