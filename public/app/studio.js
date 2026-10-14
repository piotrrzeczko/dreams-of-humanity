// Dream Studio — client. Journal, cast and films live in this browser (IndexedDB).
// The OpenRouter key lives in localStorage and is sent only to our /api, which forwards it to OpenRouter.
(() => {
"use strict";

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ── IndexedDB ───────────────────────────────────────────
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("dreams-of-humanity", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("dreams", { keyPath: "id" });
      d.createObjectStore("cast", { keyPath: "id" });
      d.createObjectStore("videos");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (name, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(name, mode);
      const out = fn(t.objectStore(name));
      t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: name => tx(name, "readonly", s => s.getAll()),
    get: (name, key) => tx(name, "readonly", s => s.get(key)),
    put: (name, val, key) => tx(name, "readwrite", s => key === undefined ? s.put(val) : s.put(val, key)),
    del: (name, key) => tx(name, "readwrite", s => s.delete(key)),
  };
})();

// ── API ─────────────────────────────────────────────────
const KEY = "doh_or_key";
let apiKey = store.get(KEY);

async function api(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: Object.assign({ "content-type": "application/json" }, apiKey ? { authorization: "Bearer " + apiKey } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const err = new Error((data && data.message) || "Request failed");
    err.code = (data && data.error) || "http_" + r.status;
    throw err;
  }
  return data;
}

const ERR = {
  no_key: "Connect your OpenRouter account first.",
  bad_key: "Your OpenRouter key was rejected. Reconnect your account.",
  no_credits: "Your OpenRouter account is out of credits. Top up at openrouter.ai, then try again.",
  rate_limited: "Too many requests at once. Give it a minute.",
  invalid_json: "The answer came back malformed. Try again.",
  too_short: "Tell me a little more, even a few words.",
  upstream_error: "The AI provider returned an error. Try again in a moment.",
};
const errText = e => ERR[e && e.code] || (e && e.message) || "Something went wrong.";

// ── Connect (OpenRouter OAuth PKCE) ─────────────────────
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function connect() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  try { sessionStorage.setItem("doh_pkce", verifier); } catch {}
  const cb = location.origin + "/app/";
  location.href = "https://openrouter.ai/auth?callback_url=" + encodeURIComponent(cb) + "&code_challenge=" + challenge + "&code_challenge_method=S256";
}

async function finishConnect() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return;
  history.replaceState(null, "", location.pathname);
  let verifier = null;
  try { verifier = sessionStorage.getItem("doh_pkce"); sessionStorage.removeItem("doh_pkce"); } catch {}
  if (!verifier) { $("connectMsg").textContent = "The connection expired. Please try again."; return; }
  try {
    const { key } = await api("/api/auth/exchange", { body: { code, code_verifier: verifier } });
    setKey(key);
  } catch (e) { $("connectMsg").textContent = errText(e); }
}

function setKey(k) {
  apiKey = k || null;
  if (k) store.set(KEY, k); else store.del(KEY);
  refreshAccount();
  if (k) loadModels();
}

async function refreshAccount() {
  const chip = $("acctChip");
  $("connectCard").hidden = !!apiKey || currentTab !== "dream";
  if (!apiKey) { chip.textContent = "Not connected"; chip.classList.remove("on"); return; }
  chip.textContent = "Connected"; chip.classList.add("on");
  try {
    const a = await api("/api/account");
    const left = a.limit_remaining != null ? "$" + Number(a.limit_remaining).toFixed(2) + " left on this key" : "no spending limit on this key";
    const used = a.usage != null ? "$" + Number(a.usage).toFixed(2) + " used so far" : "";
    $("acctInfo").textContent = "OpenRouter connected · " + [used, left].filter(Boolean).join(" · ") + ".";
  } catch (e) {
    if (e.code === "bad_key") { setKey(null); $("connectMsg").textContent = ERR.bad_key; }
    else $("acctInfo").textContent = "OpenRouter connected.";
  }
}

$("connectBtn").onclick = connect;
$("manualKeyBtn").onclick = () => { const k = $("manualKey").value.trim(); if (k.length > 10) { $("manualKey").value = ""; setKey(k); } };
$("acctChip").onclick = () => { if (!apiKey) { $("connectCard").scrollIntoView({ behavior: "smooth" }); return; } $("acctCard").hidden = !$("acctCard").hidden; };
$("acctClose").onclick = () => { $("acctCard").hidden = true; };
$("disconnectBtn").onclick = () => { setKey(null); $("acctCard").hidden = true; };

// ── Tabs ────────────────────────────────────────────────
let currentTab = "write";
function tab(name) {
  currentTab = name;
  const tabFor = { entry: "journal", dream: "journal" }[name] || name;
  document.querySelectorAll("[role=tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tabFor));
  document.querySelectorAll("[data-view]").forEach(v => v.hidden = v.dataset.view !== name);
  $("connectCard").hidden = !!apiKey || name !== "dream";
  if (name === "cast") renderCast();
  if (name === "journal") renderJournal();
  if (name === "map") renderMap();
  if (name === "write") renderWriteStats();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll("[role=tab]").forEach(b => b.onclick = () => tab(b.dataset.tab));

// ── Cast ────────────────────────────────────────────────
let cast = [];
async function loadCast() { cast = (await idb.all("cast")).sort((a, b) => a.name.localeCompare(b.name)); $("castCount").textContent = cast.length ? cast.length : ""; castHint(); }

function terms(m) { return [m.name, ...(m.aliases || [])].map(s => String(s).trim().toLowerCase()).filter(Boolean); }
function mentions(text, m) {
  const t = text.toLowerCase();
  return terms(m).some(w => t.includes(w.length > 5 ? w.slice(0, w.length - 2) : w));
}

function castHint() {
  const box = $("castHint");
  if (!cast.length) { box.hidden = true; return; }
  const text = $("dream").value;
  box.replaceChildren(document.createTextNode("Your cast: "));
  cast.forEach((m, i) => { const b = el("b", mentions(text, m) ? "hit" : "", m.name); box.append(b); if (i < cast.length - 1) box.append(document.createTextNode(", ")); });
  box.hidden = false;
}

function renderCast() {
  const list = $("castList"); list.replaceChildren();
  if (!cast.length) {
    const e = el("div", "empty"); e.append(el("div", "moon", "☾"), document.createTextNode("No one yet. Add the person who visits your dreams most often."));
    list.append(e); return;
  }
  cast.forEach(m => {
    const b = el("button", "member"); b.type = "button";
    const g = el("span", "glyph" + (m.kind === "place" ? " place" : ""), m.kind === "place" ? "⌂" : (m.name[0] || "?").toUpperCase());
    const mid = el("div"); mid.append(el("div", "nm", m.name), el("div", "meta", [m.relation, m.locked_description].filter(Boolean).join(" · ")));
    b.append(g, mid, el("span", "uses", m.uses ? m.uses + (m.uses === 1 ? " dream" : " dreams") : ""));
    b.onclick = () => openEditor(m);
    list.append(b);
  });
}

let editing = null, edKind = "person", edPhoto = null;
function setKind(k) {
  edKind = k;
  document.querySelectorAll("[data-k]").forEach(x => x.setAttribute("aria-pressed", x.dataset.k === k));
  $("edRelLabel").textContent = k === "place" ? "What is this place to you?" : "Who are they to you?";
  $("edName").placeholder = k === "place" ? "Dom nad jeziorem" : "Babcia";
  $("edRel").placeholder = k === "place" ? "our summer house" : "my grandmother";
  $("edNotes").placeholder = k === "place" ? "Wooden house, green shutters, a jetty, the lake always misty in the morning…" : "Short grey hair, round glasses, always a blue apron with flowers…";
  $("photoText").textContent = edPhoto ? "Change photo" : "Add a photo (optional)";
  if (!editing) $("edTitle").textContent = k === "place" ? "New place" : "New person";
}
document.querySelectorAll("[data-k]").forEach(b => b.onclick = () => setKind(b.dataset.k));

function openEditor(m, preset) {
  editing = m || null; edPhoto = null;
  const v = m || preset || {};
  $("edName").value = v.name || ""; $("edRel").value = v.relation || "";
  $("edAliases").value = (v.aliases || []).join(", "); $("edNotes").value = v.notes || "";
  $("edLocked").value = v.locked_description || "";
  $("edPhotoPrev").hidden = true; $("edPhotoPrev").removeAttribute("src"); $("edPhoto").value = "";
  $("edWriteMsg").textContent = "";
  $("edDelete").hidden = !m; $("edDelete").textContent = "Remove";
  setKind(v.kind === "place" ? "place" : "person");
  $("edTitle").textContent = m ? "Edit " + m.name : (edKind === "place" ? "New place" : "New person");
  $("castEditor").hidden = false;
  $("castEditor").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("addPerson").onclick = () => openEditor(null, { kind: "person" });
$("addPlace").onclick = () => openEditor(null, { kind: "place" });
$("edClose").onclick = () => { $("castEditor").hidden = true; editing = null; };

$("edPhoto").onchange = async () => {
  const f = $("edPhoto").files[0];
  if (!f) return;
  try {
    edPhoto = await downscale(f, 1024);
    $("edPhotoPrev").src = edPhoto; $("edPhotoPrev").hidden = false;
    $("photoText").textContent = "Change photo";
  } catch { $("edWriteMsg").textContent = "That image couldn't be read."; }
};

function downscale(file, max) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
    img.src = url;
  });
}

$("edWrite").onclick = async () => {
  if (!apiKey) { $("edWriteMsg").textContent = ERR.no_key; return; }
  if (!$("edNotes").value.trim() && !edPhoto) { $("edWriteMsg").textContent = "Add a few words or a photo first."; return; }
  $("edWrite").disabled = true; $("edWriteMsg").textContent = "Writing…";
  try {
    const { result } = await api("/api/describe", { body: { name: $("edName").value, kind: edKind, relation: $("edRel").value, notes: $("edNotes").value, image: edPhoto } });
    if (result.refused) { $("edWriteMsg").textContent = result.message || "We can't save this one."; }
    else { $("edLocked").value = result.locked_description || ""; $("edWriteMsg").textContent = result.summary || "Done. You can edit it."; }
  } catch (e) { $("edWriteMsg").textContent = errText(e); }
  $("edWrite").disabled = false;
};

$("edSave").onclick = async () => {
  const name = $("edName").value.trim();
  const locked = $("edLocked").value.trim();
  if (!name) { $("edWriteMsg").textContent = "Give them a name."; return; }
  if (locked.split(/\s+/).length < 12) { $("edWriteMsg").textContent = "Write the description first, it's what keeps them consistent."; return; }
  const m = Object.assign(editing || { id: uid("c"), at: Date.now(), uses: 0 }, {
    kind: edKind, name, relation: $("edRel").value.trim(),
    aliases: $("edAliases").value.split(",").map(s => s.trim()).filter(Boolean),
    notes: $("edNotes").value.trim(), locked_description: locked,
  });
  await idb.put("cast", m);
  edPhoto = null; editing = null; $("castEditor").hidden = true;
  await loadCast(); renderCast();
};

$("edDelete").onclick = async () => {
  if ($("edDelete").textContent === "Remove") { $("edDelete").textContent = "Tap again to remove"; return; }
  if (editing) await idb.del("cast", editing.id);
  editing = null; $("castEditor").hidden = true; await loadCast(); renderCast();
};

// ── Dream flow ──────────────────────────────────────────
const EXAMPLE = "Byłem w domu babci na wsi, ale kuchnia była ogromna, jak hala dworcowa. Babcia (która nie żyje od 5 lat) stała przy kuchence i smażyła placki, pachniało jabłkami. Nie odwracała się. Chciałem do niej podejść, ale podłoga ciągle się wydłużała. W końcu powiedziała tylko „usiądź, zaraz będzie” i obudziłem się ze ściśniętym gardłem.";
const cards = ["inputCard", "thinkCard", "clarifyCard", "msgCard", "resultCard"];
const show = id => { cards.forEach(c => $(c).hidden = c !== id); $("dreamIntro").hidden = id === "resultCard"; };
let perspective = "mixed", aspect = "9:16", ctl = null, lastReq = null, current = null;

$("exampleMark").hidden = true;
$("dream").addEventListener("input", castHint);
document.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { perspective = b.dataset.p; document.querySelectorAll("[data-p]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
document.querySelectorAll("[data-a]").forEach(b => b.onclick = () => { aspect = b.dataset.a; document.querySelectorAll("[data-a]").forEach(x => x.setAttribute("aria-pressed", x === b)); });

const castPayload = () => cast.map(m => ({ persona_id: m.id, name: m.name, aliases: m.aliases || [], kind: m.kind, relation: m.relation || "", locked_description: m.locked_description }));

async function run(extra) {
  if (!apiKey) { $("inputHint").textContent = ERR.no_key; $("connectCard").scrollIntoView({ behavior: "smooth" }); return; }
  lastReq = extra || null;
  show("thinkCard");
  $("thinkText").textContent = extra && extra.clarification_answer ? "Weaving your answer in…" : "Reading your dream…";
  ctl = new AbortController();
  const steps = ["Finding the emotional core…", "Calling in your cast…", "Planning four shots…", "Writing light and sound…", "Checking what needs transposing…"];
  let i = 0; const t = setInterval(() => { $("thinkText").textContent = steps[i++ % steps.length]; }, 4200);
  try {
    const body = Object.assign({ dream: $("dream").value.trim(), perspective, aspect_ratio: aspect, personas: castPayload() }, extra || {});
    const { result } = await api("/api/process", { body, signal: ctl.signal });
    clearInterval(t);
    await handle(result);
  } catch (e) {
    clearInterval(t);
    if (e.name === "AbortError") return show("inputCard");
    $("msgText").textContent = errText(e);
    $("retryBtn").hidden = !["invalid_json", "upstream_error", "rate_limited"].includes(e.code);
    show("msgCard");
  }
}

async function handle(o) {
  if (o && o.blocked) {
    let m = o.message || "We can't film this one.";
    if (o.reason === "SELF_HARM") m += "\n\nW Polsce: Telefon zaufania 116 123 (dorośli), 116 111 (dzieci i młodzież). W nagłej sytuacji 112.";
    $("msgText").textContent = m; $("retryBtn").hidden = true; return show("msgCard");
  }
  if (o && o.needs_clarification && !(lastReq && lastReq.clarification_answer !== undefined)) {
    $("question").textContent = o.question; $("answer").value = ""; show("clarifyCard"); setTimeout(() => $("answer").focus(), 50); return;
  }
  if (!o || !o.render || !o.render.prompt) { $("msgText").textContent = ERR.invalid_json; $("retryBtn").hidden = false; return show("msgCard"); }
  const used = usedCast(o);
  const base = filmEntry || { id: uid("d"), at: Date.now(), date: today(), dream: $("dream").value.trim(), title: o.title || "Untitled dream" };
  current = Object.assign(base, { perspective, aspect, result: o, castIds: used.map(m => m.id), video: null });
  if (!current.title) current.title = o.title || "Untitled dream";
  await idb.put("dreams", current);
  for (const m of used) { m.uses = (m.uses || 0) + 1; await idb.put("cast", m); }
  await loadCast(); await loadEntries();
  openResult(current);
}

function usedCast(o) {
  const ids = new Set(((o.analysis && o.analysis.characters) || []).map(c => c.persona_id).filter(Boolean));
  return cast.filter(m => ids.has(m.id));
}

const ACTS = ["Threshold", "Encounter", "Ordeal", "Dissolution"];
function parseShots(p) {
  const re = /SHOT\s*(\d)\s*\(([^)]*)\)\s*:\s*/gi; const marks = []; let m;
  while ((m = re.exec(p))) marks.push({ n: +m[1], tc: m[2], start: m.index, body: re.lastIndex });
  return marks.map((k, i) => ({ n: k.n, tc: k.tc.replace(/\s/g, ""), text: p.slice(k.body, i + 1 < marks.length ? marks[i + 1].start : p.length).replace(/Cut to:\s*$/i, "").trim() }));
}

let videoUrl = null;
async function openResult(d) {
  current = d;
  const o = d.result, r = o.render || {}, a = o.analysis || {};
  tab("dream"); show("resultCard");
  $("resTitle").textContent = d.title;
  $("resSummary").textContent = o.summary_for_dreamer || "";
  $("resMeta").textContent = [(r.duration_seconds || 30) + "s", r.aspect_ratio || d.aspect].join(" · ");
  const b = $("resBadges"); b.replaceChildren();
  if (a.dominant_emotion) b.append(el("span", "badge", a.dominant_emotion));
  (a.themes || []).slice(0, 3).forEach(t => b.append(el("span", "badge", t)));
  if (o.privacy && o.privacy.private_only) b.append(el("span", "badge private", "Private only" + (o.privacy.reason && o.privacy.reason !== "null" ? " · " + o.privacy.reason : "")));
  if (r.filter_risk) b.append(el("span", "badge risk-" + r.filter_risk, "Filter risk " + String(r.filter_risk).toLowerCase()));

  const cu = $("castUsed"); cu.replaceChildren();
  const used = cast.filter(m => (d.castIds || []).includes(m.id));
  used.forEach(m => cu.append(el("span", "badge cast", "◐ " + m.name)));
  cu.hidden = !used.length;

  const reel = $("reel"); reel.replaceChildren();
  const shots = parseShots(r.prompt);
  shots.forEach(s => { const x = el("div", "shot"); x.append(el("span", "tc", s.tc), el("span", "act", "Act " + (["I", "II", "III", "IV"][s.n - 1] || s.n) + " · " + (ACTS[s.n - 1] || "")), el("p", null, s.text)); reel.append(x); });
  if (!shots.length) reel.append(el("p", "hint", "The prompt didn't follow the four-shot format; see the full prompt below."));

  const tr = a.transpositions || []; $("transWrap").hidden = !tr.length; const ul = $("trans"); ul.replaceChildren();
  tr.forEach(x => { const li = el("li"); li.append(el("small", null, x.type), document.createTextNode(x.original + " → " + x.rendered_as)); ul.append(li); });

  const sg = (a.persona_suggestions || []).filter(s => s && s.name && !cast.some(m => m.name.toLowerCase() === String(s.name).toLowerCase()));
  $("suggestWrap").hidden = !sg.length; const sb = $("suggest"); sb.replaceChildren();
  sg.forEach(s => {
    const row = el("div", "sugg"); const t = el("span"); t.append(el("b", null, s.name), document.createTextNode(s.relation ? " · " + s.relation : ""));
    const add = el("button", "btn ghost small", "Add to cast"); add.type = "button";
    add.onclick = () => { tab("cast"); openEditor(null, { kind: s.kind === "place" ? "place" : "person", name: s.name, relation: s.relation, aliases: s.aliases || [], locked_description: s.locked_description }); };
    row.append(t, add); sb.append(row);
  });

  const os = a.other_scenes || []; $("otherWrap").hidden = !os.length; $("otherWrap").textContent = os.length ? "Other scenes we could film later: " + os.join(" · ") : "";
  $("prompt").textContent = r.prompt;
  $("copyBtn").textContent = "Copy prompt";
  $("delBtn").textContent = "Remove film";
  filmEntry = d;

  // player
  if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null; }
  $("player").hidden = true; $("video").removeAttribute("src");
  const blob = await idb.get("videos", d.id);
  if (blob) { videoUrl = URL.createObjectURL(blob); $("video").src = videoUrl; $("player").hidden = false; }
  $("softBtn").hidden = true;
  $("renderMsg").textContent = "";
  updateRenderBox();
  if (d.video && ["queued", "pending", "in_progress", "processing"].includes(d.video.status) && !blob) poll(d);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("shapeBtn").onclick = () => { if ($("dream").value.trim().length < 12) { $("inputHint").textContent = ERR.too_short; return; } $("inputHint").textContent = ""; run(); };
$("stopBtn").onclick = () => ctl && ctl.abort();
$("answerBtn").onclick = () => run({ clarification_answer: $("answer").value.trim() || "(no answer)" });
$("answer").addEventListener("keydown", e => { if (e.key === "Enter") $("answerBtn").click(); });
$("skipBtn").onclick = () => run({ clarification_answer: "(the dreamer skipped the question; render with what you have)" });
$("msgBack").onclick = () => show("inputCard");
$("retryBtn").onclick = () => run(lastReq);
$("newBtn").textContent = "Reshape";
$("newBtn").onclick = () => { show("inputCard"); };
$("filmBack").onclick = () => { if (filmEntry) openEntry(filmEntry); else tab("journal"); };
$("copyBtn").onclick = () => {
  const txt = $("prompt").textContent;
  const fallback = () => { const d = $("prompt").closest("details"); d.open = true; const s = getSelection(), rg = document.createRange(); rg.selectNodeContents($("prompt")); s.removeAllRanges(); s.addRange(rg); $("copyBtn").textContent = "Selected, copy it"; };
  try { navigator.clipboard.writeText(txt).then(() => { $("copyBtn").textContent = "Copied ✓"; }, fallback); } catch { fallback(); }
};
$("delBtn").onclick = async () => {
  if ($("delBtn").textContent === "Remove film") { $("delBtn").textContent = "Tap again to remove"; return; }
  if (current) { current.result = null; current.video = null; await idb.put("dreams", current); await idb.del("videos", current.id); }
  await loadEntries(); openEntry(current);
};

// ── Render ──────────────────────────────────────────────
// Approximate published prices, USD per second of video (Oct 2026). Shown as an estimate only.
const PRICES = [
  [/seedance-?2\.5/i, { "480p": 0.103, "720p": 0.231, "1080p": 0.569 }],
  [/seedance.*mini/i, { "480p": 0.04, "720p": 0.08 }],
  [/seedance.*fast/i, { "720p": 0.12 }],
  [/seedance-?2/i, { "480p": 0.07, "720p": 0.15 }],
];
const FALLBACK_MODELS = ["bytedance/seedance-2.5", "bytedance/seedance-2.0", "bytedance/seedance-2.0-mini"];
const maxDur = id => /2\.5/.test(id) ? 30 : /veo/i.test(id) ? 8 : 15;
let models = [];

async function loadModels() {
  const sel = $("modelSel");
  try {
    const { models: list } = await api("/api/video-models");
    models = list.map(m => (typeof m === "string" ? m : m.id || m.slug || m.name)).filter(Boolean);
  } catch { models = []; }
  if (!models.length) models = FALLBACK_MODELS.slice();
  const rank = id => /seedance-?2\.5/i.test(id) ? 0 : /seedance/i.test(id) ? 1 : /kling|veo|wan|ltx|grok|hailuo/i.test(id) ? 2 : 3;
  models.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const prev = store.get("doh_model");
  sel.replaceChildren(...models.map(id => { const o = el("option", null, id + (maxDur(id) < 30 ? " · " + maxDur(id) + "s max" : "")); o.value = id; return o; }));
  sel.value = prev && models.includes(prev) ? prev : models[0];
  updateRenderBox();
}
$("modelSel").onchange = () => { store.set("doh_model", $("modelSel").value); updateRenderBox(); };
$("resSel").onchange = updateRenderBox;

const declared = () => !!store.get("doh_declared_v1");
function updateRenderBox() {
  const id = $("modelSel").value || "", res = $("resSel").value, dur = maxDur(id);
  const p = PRICES.find(([re]) => re.test(id));
  const per = p && p[1][res];
  $("renderEst").textContent = per ? "≈ $" + (per * dur).toFixed(2) + " · " + dur + "s" : dur + "s";
  $("declWrap").hidden = declared();
  const busy = current && current.video && ["queued", "pending", "in_progress", "processing"].includes(current.video.status);
  $("renderBtn").disabled = !current || busy;
  $("renderBtn").textContent = current && current.video && current.video.status === "completed" ? "Render again" : "Render film";
}

$("renderBtn").onclick = () => startRender(false);
$("softBtn").onclick = () => startRender(true);

async function startRender(soft) {
  if (!apiKey) { $("renderMsg").textContent = ERR.no_key; return; }
  if (!declared()) {
    if (!$("declBox").checked) { $("renderMsg").textContent = "Please confirm the private-use declaration first."; return; }
    store.set("doh_declared_v1", new Date().toISOString());
  }
  const d = current, r = d.result.render || {};
  const prompt = soft && d.result.fallback && d.result.fallback.softer_prompt ? d.result.fallback.softer_prompt : r.prompt;
  const model = $("modelSel").value, resolution = $("resSel").value;
  $("renderBtn").disabled = true; $("softBtn").hidden = true;
  setRenderStatus("Sending to " + model + "…");
  try {
    const { id } = await api("/api/render", { body: { prompt, model, resolution, aspect_ratio: r.aspect_ratio || d.aspect, duration: maxDur(model), generate_audio: true } });
    d.video = { id, status: "queued", model, resolution, at: Date.now(), soft: !!soft };
    await idb.put("dreams", d);
    poll(d);
  } catch (e) {
    setRenderStatus(null); $("renderMsg").textContent = errText(e); updateRenderBox();
  }
}

function setRenderStatus(text) {
  $("renderStatus").hidden = !text; $("renderText").textContent = text || "";
}

let polling = null;
async function poll(d) {
  if (polling === d.id) return;
  polling = d.id;
  updateRenderBox();
  const started = d.video.at || Date.now();
  while (polling === d.id) {
    const mins = Math.floor((Date.now() - started) / 60000);
    setRenderStatus("Filming your dream… " + (mins ? mins + " min" : "") + " You can leave this page; it will keep going.");
    try {
      const s = await api("/api/render/" + encodeURIComponent(d.video.id));
      d.video.status = s.status; if (s.cost != null) d.video.cost = s.cost;
      await idb.put("dreams", d);
      if (s.status === "completed") {
        setRenderStatus("Downloading your film…");
        const r = await fetch("/api/render/" + encodeURIComponent(d.video.id) + "/content", { headers: { authorization: "Bearer " + apiKey } });
        if (!r.ok) throw Object.assign(new Error("Download failed"), { code: "upstream_error" });
        const blob = await r.blob();
        await idb.put("videos", blob, d.id);
        polling = null; setRenderStatus(null);
        if (current && current.id === d.id) openResult(d);
        $("renderMsg").textContent = d.video.cost != null ? "Done. This film cost $" + Number(d.video.cost).toFixed(2) + " from your OpenRouter credits." : "Done.";
        return;
      }
      if (s.status === "failed" || s.status === "cancelled" || s.status === "error") {
        polling = null; setRenderStatus(null);
        const msg = s.error && (s.error.message || s.error) || "The video model refused or failed.";
        $("renderMsg").textContent = String(msg) + (d.result.fallback && d.result.fallback.softer_prompt && !d.video.soft ? " You can try the gentler version of the same film." : "");
        $("softBtn").hidden = !(d.result.fallback && d.result.fallback.softer_prompt) || d.video.soft;
        updateRenderBox(); return;
      }
    } catch (e) {
      if (e.code === "bad_key" || e.code === "no_credits") { polling = null; setRenderStatus(null); $("renderMsg").textContent = errText(e); updateRenderBox(); return; }
    }
    await new Promise(r => setTimeout(r, 8000));
  }
}

// ── Entries (the journal) ───────────────────────────────
let entries = [], filmEntry = null, openId = null, jFilter = null;
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
async function loadEntries() {
  entries = (await idb.all("dreams")).map(e => { if (!e.date) e.date = DMap.dateOf(e); return e; });
  entries.sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  $("journalCount").textContent = entries.length || "";
}
async function updateJournalCount() { await loadEntries(); }

function knownLabels() {
  const { stats } = DMap.build(entries, cast);
  const pick = t => [...stats.values()].filter(s => s.type === t && !s.cast).sort((a, b) => b.count - a.count).map(s => s.label);
  return { people: pick("person").slice(0, 60), places: pick("place").slice(0, 60), motifs: pick("motif").slice(0, 80), symbols: pick("symbol").slice(0, 80) };
}

// ── Journal profile: what the analyst has learned from the whole journal ──
// Aliases, named threads, notes for the next analysis and neutral observations.
// Rebuilt by /api/synthesize every few new dreams; kept on this device.
let profile = null;
function loadProfile() {
  try { profile = JSON.parse(store.get("doh_profile") || "null"); } catch { profile = null; }
  DMap.setProfile(profile);
}
function saveProfile(p) { profile = p; store.set("doh_profile", JSON.stringify(p)); DMap.setProfile(p); }
function clearProfile() { profile = null; store.del("doh_profile"); DMap.setProfile(null); }
const analysedReal = () => entries.filter(e => e.analysis && !e.example);
let synthRunning = false;
async function synthesize(force) {
  if (synthRunning) return false;
  const done = entries.filter(e => e.analysis);
  if (done.length < 2) return false;
  synthRunning = true; renderSynthState();
  try {
    const index = done.slice().sort((a, b) => a.date.localeCompare(b.date)).slice(-200).map(e => {
      const a = e.analysis;
      return { id: e.id, date: e.date, title: e.title, people: (a.people || []).map(p => p.label), places: (a.places || []).map(p => p.label),
        symbols: a.symbols || [], events: a.events || [], motifs: a.motifs || [], archetypes: a.archetypes || [], emotions: (a.emotions || []).map(x => x.name) };
    });
    const prev = profile && !profile.example ? { aliases: profile.aliases, threads: profile.threads, notes: profile.notes } : {};
    const { result } = await api("/api/synthesize", { body: { cast: cast.map(m => ({ id: m.id, name: m.name, aliases: m.aliases || [], kind: m.kind })), entries: index, previous: prev } });
    saveProfile(Object.assign({}, result, { at: Date.now(), n: analysedReal().length, example: false }));
    return true;
  } catch (err) {
    if (force) $("synthMsg").textContent = errText(err);
    return false;
  } finally {
    synthRunning = false; renderSynthState();
    if (currentTab === "map") renderMap();
  }
}
// Re-read the whole journal after the 3rd dream, then after every 5 new ones.
function maybeSynthesize() {
  const n = analysedReal().length;
  const last = profile && !profile.example ? profile.n || 0 : 0;
  if ((n >= 3 && last === 0) || n - last >= 5) synthesize(false);
}
function renderSynthState() {
  const b = $("synthBtn"); if (!b) return;
  b.disabled = synthRunning;
  b.textContent = synthRunning ? "Reading your whole journal…" : "Refresh insights";
  if (!synthRunning) $("synthMsg").textContent = profile && profile.at && !profile.example ? "Last read " + new Date(profile.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) + ", " + (profile.n || 0) + " dreams." : "";
}

// Write
$("wDate").value = today();
$("wDate").max = today();
const wDraft = store.get("doh_wdraft"); if (wDraft) $("wText").value = wDraft;
$("wText").addEventListener("input", () => { store.set("doh_wdraft", $("wText").value); writeCastHint(); });
function writeCastHint() {
  const box = $("wCastHint");
  if (!cast.length) { box.hidden = true; return; }
  const text = $("wText").value;
  box.replaceChildren(document.createTextNode("Your cast: "));
  cast.forEach((m, i) => { box.append(el("b", mentions(text, m) ? "hit" : "", m.name)); if (i < cast.length - 1) box.append(document.createTextNode(", ")); });
  box.hidden = false;
}
$("writeDay").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

$("wSave").onclick = async () => {
  const text = $("wText").value.trim();
  if (text.length < 8) { $("wMsg").textContent = "Even a fragment helps, write a few more words."; return; }
  const e = { id: uid("d"), at: Date.now(), date: $("wDate").value || today(), dream: text, title: text.split(/\s+/).slice(0, 5).join(" ") + "…", analysis: null, status: "pending" };
  await idb.put("dreams", e);
  $("wText").value = ""; store.del("doh_wdraft"); $("wMsg").textContent = ""; writeCastHint();
  await loadEntries();
  openEntry(e);
  analyse(e);
};

function renderWriteStats() {
  const box = $("wStats"); box.replaceChildren();
  const real = entries.filter(e => !e.example);
  if (!real.length) { box.hidden = true; return; }
  const { stats } = DMap.build(entries, cast);
  const top = [...stats.values()].filter(s => s.type !== "emotion" && s.count >= 2).sort((a, b) => b.count - a.count).slice(0, 3);
  const nights = new Set(real.map(e => e.date)).size;
  box.append(el("div", "label", ""), el("p", "muted", nights + (nights === 1 ? " night" : " nights") + " in your journal." + (top.length ? " Keeps returning: " + top.map(t => t.label + " (" + t.count + ")").join(", ") + "." : "")));
  box.firstChild.append(el("span", null, "So far"));
  const go = el("button", "link", "Open your map →"); go.onclick = () => tab("map"); box.append(go);
  box.hidden = false;
}

// Analyse
async function analyse(e) {
  let analysedOk = false;
  e.status = "pending"; await idb.put("dreams", e);
  if (openId === e.id) renderEntry(e);
  try {
    const { result } = await api("/api/analyze", { body: { text: e.dream, date: e.date, cast: cast.map(m => ({ id: m.id, name: m.name, aliases: m.aliases || [], kind: m.kind, relation: m.relation || "" })), known: knownLabels(),
      profile: profile && !profile.example ? { aliases: profile.aliases || [], threads: (profile.threads || []).map(t => ({ name: t.name, description: t.description, keys: t.keys })), notes: profile.notes || "" } : undefined } });
    e.analysis = result; e.status = "done";
    if (result.title) e.title = result.title;
    analysedOk = true;
  } catch (err) {
    e.status = "error"; e.error = err.code === "no_key" ? "Automatic filing is not switched on yet. Connect OpenRouter (Make it a film → Connect) or ask the admin to enable it." : errText(err);
  }
  await idb.put("dreams", e);
  await loadEntries();
  if (openId === e.id) renderEntry(e);
  if (analysedOk && !e.example) maybeSynthesize();
}

// Entry view
function openEntry(e) { openId = e.id; tab("entry"); renderEntry(e); }
$("eBack").onclick = () => tab("journal");

function facet(label, items, type) {
  if (!items.length) return null;
  const row = el("div", "facet"); row.append(el("span", "fl", label));
  const box = el("div", "chips");
  items.forEach(t => box.append(el("span", "chip " + type, t)));
  row.append(box); return row;
}

function renderEntry(e) {
  const a = e.analysis;
  $("eDate").textContent = new Date(e.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const flags = [];
  if (a && a.nightmare) flags.push("nightmare"); if (a && a.lucid) flags.push("lucid"); if (e.example) flags.push("example");
  $("eFlags").textContent = flags.join(" · ");
  $("eTitle").textContent = e.title || "Untitled dream";
  $("eSummary").textContent = (a && a.summary) || "";
  $("eText").textContent = e.dream;
  $("eBusy").hidden = e.status !== "pending";
  $("eErr").textContent = e.status === "error" ? e.error || "Couldn't file this dream." : "";
  $("eCare").hidden = !(a && a.care);
  const f = $("eFacets"); f.replaceChildren();
  if (a) {
    const ci = DMap.castIndex(cast);
    const name = (p, kind) => { const m = (p.cast_id && ci.byId.get(p.cast_id)) || ci.byTerm.get(String(p.label || "").toLowerCase().trim()); return m ? "◐ " + m.name : p.label; };
    [facet("People", (a.people || []).map(p => name(p)), "person"), facet("Places", (a.places || []).map(p => name(p)), "place"),
     facet("Symbols", a.symbols || [], "symbol"), facet("What happens", a.events || [], "event"),
     facet("Motifs", a.motifs || [], "motif"), facet("Feelings", (a.emotions || []).map(x => x.name + " " + "•".repeat(Math.max(1, Math.min(5, x.intensity || 3)))), "emotion"),
     facet("Time", a.time_refs || [], "time"), facet("Objects", a.objects || [], "object")].filter(Boolean).forEach(r => f.append(r));
    // shared with humanity: dream themes and figures people everywhere report
    const arch = [...new Set([...(a.archetypes || []), ...(a.people || []).map(p => p.archetype).filter(Boolean)])];
    if (arch.length) {
      const row = el("div", "facet shared"); row.append(el("span", "fl", "Shared with humanity"));
      const box = el("div", "chips");
      arch.forEach(id => { const c = el("span", "chip archetype", DMap.archName(id)); const d = DMap.ARCHETYPES[id]; if (d) c.title = d[2]; box.append(c); });
      row.append(box); f.append(row);
    }
    // threads this dream belongs to
    const th = [...new Set([...((profile && profile.threads) || []).filter(t => (t.entry_ids || []).includes(e.id)).map(t => t.name), ...(a.threads || [])])];
    if (th.length) {
      const row = el("div", "facet"); row.append(el("span", "fl", "Part of"));
      const box = el("div", "chips");
      th.forEach(n => box.append(el("span", "chip story", n)));
      row.append(box); f.append(row);
    }
  }
  // echoes
  const ec = a ? DMap.echoes(e, entries, cast) : [];
  $("eEchoWrap").hidden = !ec.length; const eb = $("eEchoes"); eb.replaceChildren();
  ec.forEach(x => {
    const b = el("button", "echo"); b.type = "button";
    b.append(el("span", "ed", DMap.fmtDay(x.o.date)), el("span", "et", x.o.title), el("span", "es", "shared: " + x.shared.join(", ")));
    b.onclick = () => openEntry(x.o); eb.append(b);
  });
  // cast suggestions
  const cs = a ? DMap.castCandidates(e, entries, cast) : [];
  $("eSuggestWrap").hidden = !cs.length; const sb = $("eSuggest"); sb.replaceChildren();
  cs.forEach(c => {
    const row = el("div", "sugg"); const t = el("span"); t.append(el("b", null, c.name), document.createTextNode(c.count > 1 ? " · in " + c.count + " dreams" : (c.relation ? " · " + c.relation : "")));
    const add = el("button", "btn ghost small", "Add to cast"); add.type = "button";
    add.onclick = () => { tab("cast"); openEditor(null, { kind: c.kind, name: c.name, relation: c.relation || "", aliases: c.aliases || [] }); };
    row.append(t, add); sb.append(row);
  });
  $("eFilm").textContent = e.result ? "Open the film" : "Make it a film";
  $("eDelete").textContent = "Delete";
}

$("eFilm").onclick = () => {
  const e = entries.find(x => x.id === openId); if (!e) return;
  filmEntry = e;
  if (e.result) { openResult(e); return; }
  $("dream").value = e.dream; castHint();
  tab("dream"); show("inputCard");
};
$("eReanalyse").onclick = () => { const e = entries.find(x => x.id === openId); if (e) analyse(e); };
$("eDelete").onclick = async () => {
  if ($("eDelete").textContent === "Delete") { $("eDelete").textContent = "Tap again to delete"; return; }
  await idb.del("dreams", openId); await idb.del("videos", openId); openId = null;
  await loadEntries(); tab("journal");
};

// Journal list
$("jSearch").addEventListener("input", () => renderJournal());
function setFilter(items) { jFilter = items; tab("journal"); }
function entryMatches(e, q, feats) {
  if (jFilter && !jFilter.every(f => f.ids ? f.ids.includes(e.id) : feats.has(f.key))) return false;
  if (!q) return true;
  const hay = [e.title, e.dream, ...[...feats.values()].map(v => v.label)].join(" ").toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}
function renderJournal() {
  const list = $("journal"); list.replaceChildren();
  const fb = $("jFilter"); fb.replaceChildren();
  if (jFilter) {
    fb.append(document.createTextNode("Dreams with "));
    jFilter.forEach((f, i) => { fb.append(el("span", "chip " + f.type, f.label)); if (i < jFilter.length - 1) fb.append(document.createTextNode(" + ")); });
    const x = el("button", "link", "Clear"); x.onclick = () => { jFilter = null; renderJournal(); }; fb.append(x);
  }
  fb.hidden = !jFilter;
  if (!entries.length) {
    const e = el("div", "empty"); e.append(el("div", "moon", "☾"), el("p", null, "Your journal is empty."));
    const row = el("div", "row center"); const w = el("button", "btn small", "Write tonight's dream"); w.onclick = () => tab("write");
    const x = el("button", "btn ghost small", "Load 14 example dreams"); x.onclick = loadExamples; row.append(w, x); e.append(row); list.append(e); return;
  }
  const ci = DMap.castIndex(cast), q = $("jSearch").value.trim().toLowerCase();
  let month = "", shown = 0;
  entries.forEach(d => {
    const feats = DMap.features(d, ci);
    if (!entryMatches(d, q, feats)) return;
    const m = new Date(d.date + "T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (m !== month) { month = m; list.append(el("h2", "month", m)); }
    const b = el("button", "entry"); b.type = "button";
    const left = el("span", "el"); left.append(el("span", "t", d.title || "Untitled dream"));
    const tags = el("span", "tags");
    [...feats.values()].filter(v => v.type !== "emotion").slice(0, 4).forEach(v => tags.append(el("span", "chip sm " + v.type, (v.cast ? "◐ " : "") + v.label)));
    if (d.status === "pending") tags.append(el("span", "chip sm", "filing…"));
    left.append(tags);
    const right = el("span", "d", DMap.fmtDay(d.date));
    if (d.video && d.video.status === "completed") right.prepend(el("span", "film", "▶ "));
    if (d.analysis && d.analysis.nightmare) right.prepend(el("span", "nm", "● "));
    b.append(left, right);
    b.onclick = () => openEntry(d);
    list.append(b); shown++;
  });
  if (!shown) list.append(el("p", "hint", "No dreams match."));
}

// Map
function renderMap() {
  const has = entries.some(e => e.analysis);
  $("mapEmpty").hidden = has; $("mapBody").hidden = !has;
  $("exampleNote").hidden = !entries.some(e => e.example);
  if (!has) return;
  DMap.render(entries, cast, {
    stats: $("mStats"), heat: $("mHeat"), range: $("mRange"), constellation: $("mConst"), threads: $("mThreads"),
    people: $("mPeople"), places: $("mPlaces"), motifs: $("mMotifs"), weather: $("mWeather"), onPick: setFilter,
    symbols: $("mSymbols"), archetypes: $("mArch"), observations: $("mObs"), profile,
  });
  renderSynthState();
}
async function loadExamples() {
  for (const e of DMap.EXAMPLES) await idb.put("dreams", JSON.parse(JSON.stringify(e)));
  if (!profile) saveProfile(JSON.parse(JSON.stringify(DMap.EXAMPLE_PROFILE)));
  await loadEntries(); tab("map");
}
$("loadExamples").onclick = loadExamples;
$("mapWrite").onclick = () => tab("write");
$("synthBtn").onclick = () => { $("synthMsg").textContent = ""; synthesize(true); };
$("removeExamples").onclick = async () => {
  for (const e of entries.filter(x => x.example)) { await idb.del("dreams", e.id); await idb.del("videos", e.id); }
  if (profile && profile.example) clearProfile();
  await loadEntries(); renderMap();
};

// ── Boot ────────────────────────────────────────────────
(async () => {
  await finishConnect();
  refreshAccount();
  await loadCast();
  loadProfile();
  await loadEntries();
  // retry dreams whose filing was interrupted
  entries.filter(e => e.status === "pending" && Date.now() - e.at > 60000).forEach(e => analyse(e));
  if (apiKey) loadModels(); else { const sel = $("modelSel"); sel.replaceChildren(...FALLBACK_MODELS.map(id => { const o = el("option", null, id); o.value = id; return o; })); updateRenderBox(); }
  const h = location.hash.slice(1);
  tab(["journal", "map", "cast"].includes(h) ? h : "write");
  writeCastHint();
})();
})();
