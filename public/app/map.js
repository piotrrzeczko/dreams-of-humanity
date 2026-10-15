// Dream map: turns journal entries into recurring people, places, motifs, threads and a constellation.
// Pure functions + SVG rendering, no dependencies. Exposed as window.DMap.
(() => {
"use strict";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const norm = s => String(s || "").trim().toLowerCase();
const fmtMonth = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" });
const fmtDay = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

// ── features ────────────────────────────────────────────
function castIndex(cast) {
  const byTerm = new Map(), byId = new Map();
  for (const m of cast) {
    byId.set(m.id, m);
    for (const t of [m.name, ...(m.aliases || [])]) if (t) byTerm.set(norm(t), m);
  }
  return { byTerm, byId };
}

const PFX = { person: "h", place: "l", motif: "m", emotion: "e", symbol: "s", event: "v", archetype: "a" };

// Shared human dream archetypes. We name the pattern and how common it is; we never say what it means.
const ARCHETYPES = {
  chased: ["Being chased", "theme", "One of the most often reported dreams in every culture studied."],
  falling: ["Falling", "theme", "Reported by most people at least once; often wakes the dreamer."],
  flying: ["Flying", "theme", "A classic of lucid and joyful dreams worldwide."],
  exam: ["The exam", "theme", "Unprepared at school or an exam, often decades after the last one."],
  late: ["Running late", "theme", "Missing the train, the flight, the moment."],
  teeth: ["Teeth falling out", "theme", "Recorded across cultures and centuries."],
  deceased_alive: ["The dead return", "theme", "Someone who has died appears alive, often simply present."],
  naked: ["Naked in public", "theme", "Exposed or wrongly dressed among others."],
  lost: ["Lost", "theme", "Unable to find the way, the room, the exit."],
  paralysis: ["Cannot move", "theme", "Legs that will not run, a voice that will not come."],
  flood: ["The flood", "theme", "Water rising, waves, a world going under."],
  hidden_rooms: ["Hidden rooms", "theme", "Finding new rooms in a familiar house."],
  vehicle_control: ["Losing control", "theme", "A car or vehicle that will not obey."],
  disaster: ["The end of the world", "theme", "Fire, earthquake, catastrophe."],
  cant_call: ["The call that fails", "theme", "A phone, a number or a voice that will not work."],
  childhood_home: ["The childhood home", "theme", "Returning to the places one grew up in."],
  searching: ["The search", "theme", "Looking for someone or something that cannot be found."],
  shadow: ["The Shadow", "figure", "Jung's name for the threatening or rejected figure that pursues."],
  wise_elder: ["The Wise Elder", "figure", "An old guide who knows, warns or gives."],
  great_mother: ["The Great Mother", "figure", "The nurturing, feeding or engulfing mother figure."],
  beloved_stranger: ["The Beloved Stranger", "figure", "An unknown, magnetic figure of longing (Jung's anima/animus)."],
  child: ["The Child", "figure", "A child, often the dreamer as a child."],
  trickster: ["The Trickster", "figure", "A figure who deceives, mocks or changes shape."],
};
const archName = id => (ARCHETYPES[id] || [String(id).replace(/_/g, " ")])[0];

// Aliases learned from the whole journal: variant → canonical (person, place, symbol labels).
let ALIAS = new Map();
function setProfile(p) {
  ALIAS = new Map();
  for (const a of (p && p.aliases) || []) for (const v of a.variants || []) if (norm(v) && norm(a.canonical)) ALIAS.set(norm(v), String(a.canonical).trim());
}
const canon = raw => ALIAS.get(norm(raw)) || String(raw || "").trim();

// Returns Map key → {key, type: person|place|motif|emotion|symbol|event|archetype, label, cast?}
function features(entry, ci) {
  const out = new Map();
  const a = entry.analysis;
  if (!a) return out;
  const add = (type, raw, castId) => {
    if (type === "person" || type === "place" || type === "symbol") raw = canon(raw);
    let m = castId && ci.byId.get(castId);
    if (!m && (type === "person" || type === "place")) m = ci.byTerm.get(norm(raw));
    const key = m ? "c:" + m.id : PFX[type] + ":" + norm(raw);
    if (!norm(raw) && !m) return;
    const label = m ? m.name : type === "archetype" ? archName(raw) : String(raw).trim();
    out.set(key, { key, type: m ? (m.kind === "place" ? "place" : "person") : type, label, cast: !!m });
  };
  (a.people || []).forEach(p => { add("person", p.label, p.cast_id); if (p.archetype) add("archetype", p.archetype); });
  (a.places || []).forEach(p => add("place", p.label, p.cast_id));
  (a.motifs || []).forEach(m => add("motif", m));
  (a.symbols || []).forEach(m => add("symbol", m));
  (a.events || []).forEach(m => add("event", m));
  (a.archetypes || []).forEach(m => add("archetype", m));
  (a.emotions || []).forEach(e => add("emotion", e.name));
  return out;
}
// Keys that make a dream "the same story" (not feelings, not universal archetypes).
const storyKey = k => !k.startsWith("e:") && !k.startsWith("a:");

function dateOf(e) { return e.date || new Date(e.at).toISOString().slice(0, 10); }

// ── aggregate ───────────────────────────────────────────
function build(entries, cast) {
  const ci = castIndex(cast);
  const list = entries.filter(e => e.analysis).map(e => ({ e, d: dateOf(e), f: features(e, ci) })).sort((x, y) => x.d.localeCompare(y.d));
  const stats = new Map(); // key → {key,type,label,cast,count,first,last,ids}
  for (const { e, d, f } of list) for (const v of f.values()) {
    const s = stats.get(v.key) || Object.assign({ count: 0, first: d, last: d, ids: [] }, v);
    s.count++; s.last = d; s.ids.push(e.id); stats.set(v.key, s);
  }
  const co = new Map(); // "a|b" → count
  for (const { f } of list) {
    const ks = [...f.keys()].filter(storyKey).sort();
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const k = ks[i] + "|" + ks[j]; co.set(k, (co.get(k) || 0) + 1); }
  }
  return { ci, list, stats, co };
}

function echoes(entry, entries, cast, max = 3) {
  const ci = castIndex(cast);
  const strip = f => new Set([...f.keys()].filter(storyKey));
  const mine = strip(features(entry, ci));
  if (!mine.size) return [];
  const mineF = features(entry, ci);
  return entries.filter(o => o.id !== entry.id && o.analysis).map(o => {
    const of = features(o, ci), ok = strip(of);
    const shared = [...mine].filter(k => ok.has(k));
    const union = new Set([...mine, ...ok]).size;
    return { o, score: shared.length / union, shared: shared.map(k => (mineF.get(k) || of.get(k)).label) };
  }).filter(x => x.shared.length && x.score >= 0.12).sort((a, b) => b.score - a.score).slice(0, max);
}

// People/places that recur but are not in the cast yet.
function castCandidates(entry, entries, cast) {
  const { stats } = build(entries, cast);
  const ci = castIndex(cast);
  const f = features(entry, ci);
  const out = [];
  for (const v of f.values()) {
    if (v.cast || (v.type !== "person" && v.type !== "place")) continue;
    const s = stats.get(v.key);
    if (s && s.count >= 2) out.push({ name: v.label, kind: v.type, count: s.count });
  }
  const sugg = (entry.analysis && entry.analysis.cast_suggestions) || [];
  for (const s of sugg) if (s && s.name && !ci.byTerm.has(norm(s.name)) && !out.some(o => norm(o.name) === norm(s.name))) out.push({ name: s.name, kind: s.kind === "place" ? "place" : "person", relation: s.relation, aliases: s.aliases, count: (stats.get((s.kind === "place" ? "l" : "h") + ":" + norm(s.name)) || {}).count || 1 });
  return out.slice(0, 4);
}

// ── rendering ───────────────────────────────────────────
const COLORS = { person: "#9A7FCB", place: "#D4924A", motif: "#C4687A", emotion: "#8B8BAD", symbol: "#3D8B8F", event: "#B7A98A", archetype: "#E8C27A" };
const EMO = {
  fear: "#C4687A", anxiety: "#C4687A", anger: "#C4687A", shame: "#C4687A", guilt: "#C4687A",
  sadness: "#7B5EA7", longing: "#7B5EA7",
  joy: "#D4924A", love: "#D4924A", relief: "#D4924A",
  calm: "#3D8B8F", awe: "#3D8B8F",
  confusion: "#8B8BAD",
};
const EMO_GROUPS = [["Fear & unease", "#C4687A"], ["Longing & sadness", "#7B5EA7"], ["Joy & warmth", "#D4924A"], ["Calm & awe", "#3D8B8F"], ["Confusion & other", "#8B8BAD"]];

function streak(dates) {
  if (!dates.length) return 0;
  const set = new Set(dates);
  let d = new Date(dates[dates.length - 1] + "T12:00:00"), n = 0;
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function render(entries, cast, ui) {
  const B = build(entries, cast);
  const { list, stats, co } = B;
  const dates = list.map(x => x.d);
  const recurring = [...stats.values()].filter(s => storyKey(s.key) && s.count >= 2);

  // stats row
  const st = ui.stats; st.replaceChildren();
  const nights = new Set(entries.map(dateOf)).size;
  const nm = entries.filter(e => e.analysis && e.analysis.nightmare).length;
  [[nights, nights === 1 ? "night recorded" : "nights recorded"], [streak([...new Set(entries.map(dateOf))].sort()), "night streak"],
   [recurring.filter(s => s.type === "person").length, "recurring people"], [recurring.filter(s => s.type === "symbol" || s.type === "motif").length, "recurring symbols & motifs"],
   [list.length ? Math.round(nm / list.length * 100) + "%" : "–", "nightmares"]]
    .forEach(([n, l]) => { const d = el("div", "stat"); d.append(el("b", null, String(n)), el("span", null, l)); st.append(d); });

  renderHeat(entries, ui.heat, ui.range);
  renderConstellation(B, ui.constellation, ui.onPick);

  // threads: named by the journal analyst when available, otherwise simple co-occurrence
  const th = ui.threads; th.replaceChildren();
  const prof = ui.profile;
  const known = new Map(list.map(x => [x.e.id, x]));
  const named = ((prof && prof.threads) || []).map(t => ({ t, xs: (t.entry_ids || []).map(id => known.get(id)).filter(Boolean) })).filter(n => n.xs.length >= 2);
  named.forEach(({ t, xs }) => {
    const row = el("button", "thread named"); row.type = "button";
    const head = el("span", "tn"); head.append(el("b", "tname", t.name));
    const ds = xs.map(x => x.d).sort();
    row.append(head, el("span", "tm", xs.length + " dreams · " + fmtMonth(ds[0]) + (fmtMonth(ds[0]) !== fmtMonth(ds[ds.length - 1]) ? " → " + fmtMonth(ds[ds.length - 1]) : "")));
    if (t.description) row.append(el("span", "td", t.description));
    row.onclick = () => ui.onPick([{ key: "t:" + t.name, type: "thread", label: t.name, ids: xs.map(x => x.e.id) }]);
    th.append(row);
  });
  if (named.length) return renderRest();
  const pairs = [...co.entries()].filter(([, n]) => n >= 2).map(([k, n]) => { const [a, b] = k.split("|"); return { a: stats.get(a), b: stats.get(b), n }; })
    .filter(p => p.a && p.b).sort((x, y) => y.n - x.n || (y.a.last > y.b.last ? y.a.last : y.b.last).localeCompare(x.a.last > x.b.last ? x.a.last : x.b.last)).slice(0, 8);
  if (!pairs.length) th.append(el("p", "hint", "Threads appear when two things show up together in at least two dreams."));
  pairs.forEach(p => {
    const ids = p.a.ids.filter(id => p.b.ids.includes(id));
    const ds = list.filter(x => ids.includes(x.e.id)).map(x => x.d);
    const row = el("button", "thread"); row.type = "button";
    const names = el("span", "tn");
    names.append(chip(p.a), el("span", "plus", "+"), chip(p.b));
    row.append(names, el("span", "tm", p.n + " dreams · " + fmtMonth(ds[0]) + (ds.length > 1 && fmtMonth(ds[0]) !== fmtMonth(ds[ds.length - 1]) ? " → " + fmtMonth(ds[ds.length - 1]) : "")));
    row.onclick = () => ui.onPick([p.a, p.b]);
    th.append(row);
  });
  renderRest();

  function renderRest() {
  bars(ui.people, [...stats.values()].filter(s => s.type === "person"), ui.onPick);
  bars(ui.places, [...stats.values()].filter(s => s.type === "place"), ui.onPick);

  // motifs cloud
  const cl = ui.motifs; cl.replaceChildren();
  const motifs = [...stats.values()].filter(s => s.type === "motif").sort((a, b) => b.count - a.count).slice(0, 24);
  const maxM = Math.max(1, ...motifs.map(m => m.count));
  motifs.forEach(m => { const b = el("button", "word", m.label); b.type = "button"; b.style.fontSize = (0.85 + 1.1 * (m.count / maxM)).toFixed(2) + "rem"; b.style.opacity = (0.55 + 0.45 * m.count / maxM).toFixed(2); b.title = m.count + " dreams"; b.onclick = () => ui.onPick([m]); cl.append(b); });
  if (!motifs.length) cl.append(el("p", "hint", "No motifs yet."));

  // symbols cloud
  if (ui.symbols) {
    const sy = ui.symbols; sy.replaceChildren();
    const syms = [...stats.values()].filter(s => s.type === "symbol").sort((a, b) => b.count - a.count).slice(0, 24);
    const maxS = Math.max(1, ...syms.map(m => m.count));
    syms.forEach(m => { const b = el("button", "word sym", m.label); b.type = "button"; b.style.fontSize = (0.85 + 1.1 * (m.count / maxS)).toFixed(2) + "rem"; b.style.opacity = (0.55 + 0.45 * m.count / maxS).toFixed(2); b.title = m.count + (m.count > 1 ? " dreams" : " dream"); b.onclick = () => ui.onPick([m]); sy.append(b); });
    if (!syms.length) sy.append(el("p", "hint", "Symbols appear as you write: objects and images that seem to carry weight."));
  }

  if (ui.archetypes) renderArchetypes(stats, list.length, ui.archetypes, ui.onPick);
  if (ui.observations) {
    const ob = ui.observations; ob.replaceChildren();
    const obs = (prof && prof.observations) || [];
    obs.forEach(o => ob.append(el("li", null, o)));
    ob.hidden = !obs.length;
  }

  renderWeather(list, ui.weather);
  }
}

function renderArchetypes(stats, n, box, onPick) {
  box.replaceChildren();
  const items = [...stats.values()].filter(s => s.type === "archetype").sort((a, b) => b.count - a.count);
  if (!items.length) { box.append(el("p", "hint", "When a dream follows one of the patterns shared by people everywhere (falling, being chased, the dead returning), it shows up here.")); return; }
  items.forEach(s => {
    const id = s.key.slice(2), def = ARCHETYPES[id];
    const b = el("button", "arch" + (def && def[1] === "figure" ? " fig" : "")); b.type = "button";
    const top = el("span", "ah"); top.append(el("b", null, s.label), el("span", "ac", s.count + (s.count > 1 ? " dreams" : " dream")));
    b.append(top);
    if (def) b.append(el("span", "ad", def[2]));
    b.onclick = () => onPick([s]);
    box.append(b);
  });
}

function chip(s) { const c = el("span", "chip " + s.type + (s.cast ? " cast" : ""), (s.cast ? "◐ " : "") + s.label); return c; }

function bars(box, items, onPick) {
  box.replaceChildren();
  items.sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
  const top = items.slice(0, 8), max = Math.max(1, ...top.map(i => i.count));
  if (!top.length) { box.append(el("p", "hint", "Nobody yet.")); return; }
  top.forEach(i => {
    const r = el("button", "bar"); r.type = "button";
    const name = el("span", "bn", (i.cast ? "◐ " : "") + i.label);
    const track = el("span", "bt"); const fill = el("i"); fill.style.width = (i.count / max * 100) + "%"; fill.style.background = COLORS[i.type]; track.append(fill);
    r.append(name, track, el("span", "bc", String(i.count)), el("span", "bd", i.first === i.last ? fmtDay(i.first) : fmtDay(i.first) + " – " + fmtDay(i.last)));
    r.onclick = () => onPick([i]);
    box.append(r);
  });
}

function renderHeat(entries, svg, rangeEl) {
  svg.replaceChildren();
  const byDay = new Map();
  for (const e of entries) { const d = dateOf(e); const v = byDay.get(d) || { n: 0, nm: false }; v.n++; v.nm = v.nm || !!(e.analysis && e.analysis.nightmare); byDay.set(d, v); }
  const WEEKS = 26, C = 14, G = 3, top = 18, left = 22;
  const end = new Date(); end.setHours(12, 0, 0, 0);
  const last = [...byDay.keys()].sort().pop();
  if (last && new Date(last + "T12:00:00") > end) end.setTime(new Date(last + "T12:00:00").getTime());
  const start = new Date(end); start.setDate(start.getDate() - (WEEKS * 7 - 1) - ((end.getDay() + 6) % 7 - 6 + 7) % 7);
  // align start to Monday
  while ((start.getDay() + 6) % 7 !== 0) start.setDate(start.getDate() - 1);
  svg.setAttribute("viewBox", `0 0 ${left + WEEKS * (C + G)} ${top + 7 * (C + G)}`);
  ["M", "W", "F"].forEach((t, i) => svg.append(svgEl("text", { x: 0, y: top + (i * 2) * (C + G) + 11, class: "hl" }, t)));
  let lastMonth = -1;
  const d = new Date(start);
  for (let w = 0; w < WEEKS; w++) {
    for (let r = 0; r < 7; r++) {
      const key = d.toISOString().slice(0, 10);
      if (r === 0 && d.getMonth() !== lastMonth) { lastMonth = d.getMonth(); svg.append(svgEl("text", { x: left + w * (C + G), y: 11, class: "hl" }, d.toLocaleDateString(undefined, { month: "short" }))); }
      const v = byDay.get(key);
      const fill = !v ? "#1E1B3A" : v.nm ? "#C4687A" : v.n > 1 ? "#C9B6F0" : "#7B5EA7";
      const rect = svgEl("rect", { x: left + w * (C + G), y: top + r * (C + G), width: C, height: C, rx: 3, fill, opacity: d > end ? 0.25 : 1 });
      rect.append(svgEl("title", {}, fmtDay(key) + (v ? " · " + v.n + (v.n > 1 ? " dreams" : " dream") + (v.nm ? " · nightmare" : "") : "")));
      svg.append(rect);
      d.setDate(d.getDate() + 1);
    }
  }
  rangeEl.textContent = "last 26 weeks";
}

function renderConstellation(B, svg, onPick) {
  svg.replaceChildren();
  const { stats, co } = B;
  const nodes = [...stats.values()].filter(s => storyKey(s.key) && s.count >= 2).sort((a, b) => b.count - a.count).slice(0, 16);
  if (nodes.length < 2) { svg.append(svgEl("text", { x: 300, y: 230, "text-anchor": "middle", class: "hl" }, "The constellation forms once things start to recur.")); return; }
  const idx = new Map(nodes.map((n, i) => [n.key, i]));
  const edges = [];
  for (const [k, n] of co) { const [a, b] = k.split("|"); if (idx.has(a) && idx.has(b)) edges.push({ s: idx.get(a), t: idx.get(b), w: n }); }
  const W = 600, H = 460, cx = W / 2, cy = H / 2;
  const P = nodes.map((n, i) => { const ang = i / nodes.length * Math.PI * 2; return { x: cx + Math.cos(ang) * 150, y: cy + Math.sin(ang) * 130, vx: 0, vy: 0 }; });
  for (let it = 0; it < 400; it++) {
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d2 = Math.max(dx * dx + dy * dy, 100), f = 2600 / d2;
      const fx = dx / Math.sqrt(d2) * f, fy = dy / Math.sqrt(d2) * f;
      P[i].vx -= fx; P[i].vy -= fy; P[j].vx += fx; P[j].vy += fy;
    }
    for (const e of edges) {
      const a = P[e.s], b = P[e.t], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 110) * 0.004 * Math.min(e.w, 4);
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    }
    for (const p of P) { p.vx += (cx - p.x) * 0.006; p.vy += (cy - p.y) * 0.008; p.x += p.vx * 0.5; p.y += p.vy * 0.5; p.vx *= 0.6; p.vy *= 0.6; p.x = Math.max(110, Math.min(W - 110, p.x)); p.y = Math.max(40, Math.min(H - 40, p.y)); }
  }
  const maxW = Math.max(1, ...edges.map(e => e.w));
  const gE = svgEl("g", {});
  edges.forEach(e => gE.append(svgEl("line", { x1: P[e.s].x, y1: P[e.s].y, x2: P[e.t].x, y2: P[e.t].y, stroke: "#9A7FCB", "stroke-opacity": (0.12 + 0.45 * e.w / maxW).toFixed(2), "stroke-width": (0.6 + 2.4 * e.w / maxW).toFixed(1) })));
  svg.append(gE);
  const maxC = Math.max(...nodes.map(n => n.count));
  nodes.forEach((n, i) => {
    const r = 5 + 13 * Math.sqrt(n.count / maxC);
    const g = svgEl("g", { class: "node", tabindex: 0, role: "button", "aria-label": n.label + ", " + n.count + " dreams" });
    g.append(svgEl("circle", { cx: P[i].x, cy: P[i].y, r: r + 8, fill: COLORS[n.type], opacity: 0.12 }));
    g.append(svgEl("circle", { cx: P[i].x, cy: P[i].y, r, fill: COLORS[n.type], stroke: n.cast ? "#F9F8FF" : "none", "stroke-width": 1.5 }));
    const below = P[i].y < cy;
    g.append(svgEl("text", { x: P[i].x, y: below ? P[i].y - r - 8 : P[i].y + r + 16, "text-anchor": "middle", class: "nl" }, (n.cast ? "◐ " : "") + n.label));
    g.onclick = () => onPick([n]);
    g.onkeydown = ev => { if (ev.key === "Enter") onPick([n]); };
    svg.append(g);
  });
}

function emoGroup(name) { const c = EMO[norm(name)] || "#8B8BAD"; return EMO_GROUPS.findIndex(g => g[1] === c); }

function renderWeather(list, box) {
  box.replaceChildren();
  const months = new Map();
  for (const { e, d } of list) {
    const m = d.slice(0, 7); const arr = months.get(m) || [0, 0, 0, 0, 0];
    for (const em of (e.analysis.emotions || [])) arr[emoGroup(em.name)] += Math.max(1, Math.min(5, Number(em.intensity) || 3));
    months.set(m, arr);
  }
  const keys = [...months.keys()].sort().slice(-6);
  if (!keys.length) { box.append(el("p", "hint", "Emotions appear here month by month.")); return; }
  keys.forEach(k => {
    const arr = months.get(k), sum = arr.reduce((a, b) => a + b, 0) || 1;
    const row = el("div", "wrow"); row.append(el("span", "wm", fmtMonth(k + "-15")));
    const bar = el("span", "wbar");
    arr.forEach((v, i) => { if (!v) return; const s = el("i"); s.style.width = (v / sum * 100) + "%"; s.style.background = EMO_GROUPS[i][1]; s.title = EMO_GROUPS[i][0] + " " + Math.round(v / sum * 100) + "%"; bar.append(s); });
    row.append(bar); box.append(row);
  });
  const lg = el("div", "legend"); EMO_GROUPS.forEach(([n, c]) => { const s = el("span"); const i = el("i"); i.style.background = c; s.append(i, document.createTextNode(n)); lg.append(s); }); box.append(lg);
}

// ── example journal (public/app/examples.js), so the map is visible on day one ──
const EXAMPLES = (window.DMAP_EXAMPLES && window.DMAP_EXAMPLES.entries) || [];
const EXAMPLE_PROFILE = (window.DMAP_EXAMPLES && window.DMAP_EXAMPLES.profile) || null;

window.DMap = { features, build, echoes, castCandidates, render, castIndex, dateOf, EXAMPLES, EXAMPLE_PROFILE, fmtDay, setProfile, ARCHETYPES, archName };
})();
