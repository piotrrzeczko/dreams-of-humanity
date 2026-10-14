// Dreams of Humanity — edge API.
// Static pages are served from ./public; everything under /api/* lands here.
// The dreamer's own OpenRouter key arrives per request (Authorization: Bearer ...) and is
// forwarded to OpenRouter only. It is never stored or logged on our side.

import PROCESSOR from "./prompts/dream-processor.md";
import DESCRIBER from "./prompts/persona-describer.md";

const OR = "https://openrouter.ai/api/v1";
const MAX_BODY = 8 * 1024 * 1024; // photos for the describer arrive as data URLs

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/api/waitlist" && request.method === "POST") return waitlist(request, env);
      if (path === "/api/auth/exchange" && request.method === "POST") return authExchange(request);
      if (path === "/api/account" && request.method === "GET") return account(request);
      if (path === "/api/process" && request.method === "POST") return processDream(request, env);
      if (path === "/api/describe" && request.method === "POST") return describe(request, env);
      if (path === "/api/video-models" && request.method === "GET") return videoModels(request);
      if (path === "/api/render" && request.method === "POST") return renderStart(request);
      let m = path.match(/^\/api\/render\/([\w.-]+)$/);
      if (m && request.method === "GET") return renderStatus(request, m[1]);
      m = path.match(/^\/api\/render\/([\w.-]+)\/content$/);
      if (m && request.method === "GET") return renderContent(request, m[1]);
      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: "server_error", message: String(e && e.message || e) }, 500);
    }
  },
};

// ── helpers ──────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function body(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY) throw new Error("Request too large");
  return request.json();
}

function userKey(request) {
  const h = request.headers.get("authorization") || "";
  const k = h.replace(/^Bearer\s+/i, "").trim();
  return k.length > 10 ? k : null;
}

function needKey() {
  return json({ error: "no_key", message: "Connect your OpenRouter account first." }, 401);
}

async function or(key, path, init = {}) {
  return fetch(OR + path, {
    ...init,
    headers: {
      authorization: "Bearer " + key,
      "content-type": "application/json",
      "HTTP-Referer": "https://dreamsofhumanity.app",
      "X-Title": "Dreams of Humanity",
      ...(init.headers || {}),
    },
  });
}

async function passError(r) {
  let detail = null;
  try { detail = await r.json(); } catch { /* not json */ }
  const message = detail?.error?.message || detail?.message || r.statusText || "Upstream error";
  const code = r.status === 401 ? "bad_key" : r.status === 402 ? "no_credits" : r.status === 429 ? "rate_limited" : "upstream_error";
  return json({ error: code, message, status: r.status }, r.status >= 400 && r.status < 600 ? r.status : 502);
}

function parseJsonLoose(text) {
  if (!text) throw new Error("Empty answer");
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(src);
}

// Calls Claude through the dreamer's OpenRouter account, trying models in order.
async function claude(env, key, system, userContent, maxTokens) {
  const models = (env.PROCESSOR_MODELS || "anthropic/claude-sonnet-4.5").split(",").map(s => s.trim()).filter(Boolean);
  let last = null;
  for (const model of models) {
    const r = await or(key, "/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.7,
        usage: { include: true },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (r.ok) {
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content;
      return { ok: true, model, text: Array.isArray(text) ? text.map(t => t.text || "").join("") : text, cost: data?.usage?.cost ?? null };
    }
    last = r;
    // Only fall through to the next model when this one is unknown/unavailable.
    if (![400, 404].includes(r.status)) break;
    const peek = await r.clone().text();
    if (!/model/i.test(peek)) break;
  }
  return { ok: false, response: last };
}

// ── endpoints ────────────────────────────────────────────

async function waitlist(request, env) {
  const { email, lang } = await body(request);
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 200) return json({ error: "bad_email" }, 400);
  await env.DB.prepare("INSERT OR IGNORE INTO waitlist (email, lang, source) VALUES (?1, ?2, ?3)")
    .bind(e, String(lang || "").slice(0, 10) || null, "landing").run();
  return json({ ok: true });
}

async function authExchange(request) {
  const { code, code_verifier } = await body(request);
  if (!code || !code_verifier) return json({ error: "bad_request" }, 400);
  const r = await fetch(OR + "/auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier, code_challenge_method: "S256" }),
  });
  if (!r.ok) return passError(r);
  const data = await r.json();
  return json({ key: data.key });
}

async function account(request) {
  const key = userKey(request);
  if (!key) return needKey();
  const r = await or(key, "/key");
  if (!r.ok) return passError(r);
  const d = (await r.json()).data || {};
  return json({ label: d.label || null, usage: d.usage ?? null, limit: d.limit ?? null, limit_remaining: d.limit_remaining ?? null, is_free_tier: d.is_free_tier ?? null });
}

async function processDream(request, env) {
  const key = userKey(request);
  if (!key) return needKey();
  const b = await body(request);
  const dream = String(b.dream || "").trim();
  if (dream.length < 8) return json({ error: "too_short" }, 400);
  const input = {
    dream: dream.slice(0, 6000),
    perspective: ["1PP", "3PP", "mixed"].includes(b.perspective) ? b.perspective : "mixed",
    aspect_ratio: b.aspect_ratio === "16:9" ? "16:9" : "9:16",
    personas: Array.isArray(b.personas) ? b.personas.slice(0, 30) : [],
  };
  if (typeof b.clarification_answer === "string") input.clarification_answer = b.clarification_answer.slice(0, 1000);
  const user = "INPUT (JSON):\n" + JSON.stringify(input) +
    `\n\nUse render.aspect_ratio = "${input.aspect_ratio}". Respond with the single JSON object only.`;
  const res = await claude(env, key, PROCESSOR, user, 6000);
  if (!res.ok) return passError(res.response);
  let out;
  try { out = parseJsonLoose(res.text); } catch { return json({ error: "invalid_json", message: "The processor answer was malformed." }, 502); }
  return json({ result: out, model: res.model, cost: res.cost });
}

async function describe(request, env) {
  const key = userKey(request);
  if (!key) return needKey();
  const b = await body(request);
  const meta = {
    name: String(b.name || "").slice(0, 80),
    kind: b.kind === "place" ? "place" : "person",
    relation: String(b.relation || "").slice(0, 120),
    notes: String(b.notes || "").slice(0, 2000),
  };
  const content = [{ type: "text", text: "INPUT (JSON):\n" + JSON.stringify(meta) + "\n\nRespond with the single JSON object only." }];
  if (typeof b.image === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(b.image)) {
    content.push({ type: "image_url", image_url: { url: b.image } });
  }
  const res = await claude(env, key, DESCRIBER, content, 800);
  if (!res.ok) return passError(res.response);
  let out;
  try { out = parseJsonLoose(res.text); } catch { return json({ error: "invalid_json" }, 502); }
  return json({ result: out, cost: res.cost });
}

async function videoModels(request) {
  const key = userKey(request);
  if (!key) return needKey();
  const r = await or(key, "/videos/models");
  if (!r.ok) return passError(r);
  const d = await r.json();
  const list = (d.data || d.models || d || []);
  return json({ models: Array.isArray(list) ? list : [] });
}

async function renderStart(request) {
  const key = userKey(request);
  if (!key) return needKey();
  const b = await body(request);
  const prompt = String(b.prompt || "");
  if (prompt.length < 40) return json({ error: "bad_prompt" }, 400);
  const payload = {
    model: String(b.model || "bytedance/seedance-2.5"),
    prompt: prompt.slice(0, 8000),
    duration: Math.max(4, Math.min(30, Number(b.duration) || 30)),
    resolution: ["480p", "720p", "1080p"].includes(b.resolution) ? b.resolution : "720p",
    aspect_ratio: b.aspect_ratio === "16:9" ? "16:9" : "9:16",
    generate_audio: b.generate_audio !== false,
  };
  const r = await or(key, "/videos", { method: "POST", body: JSON.stringify(payload) });
  if (!r.ok) return passError(r);
  const d = await r.json();
  return json({ id: d.id, status: d.status || "queued" }, 202);
}

async function renderStatus(request, id) {
  const key = userKey(request);
  if (!key) return needKey();
  const r = await or(key, "/videos/" + encodeURIComponent(id));
  if (!r.ok) return passError(r);
  const d = await r.json();
  return json({
    id: d.id,
    status: d.status,
    error: d.error || null,
    cost: d.usage?.cost ?? null,
    count: Array.isArray(d.unsigned_urls) ? d.unsigned_urls.length : 0,
  });
}

async function renderContent(request, id) {
  const key = userKey(request);
  if (!key) return needKey();
  const r = await fetch(OR + "/videos/" + encodeURIComponent(id) + "/content?index=0", {
    headers: { authorization: "Bearer " + key },
  });
  if (!r.ok) return passError(r);
  return new Response(r.body, {
    headers: {
      "content-type": r.headers.get("content-type") || "video/mp4",
      "cache-control": "no-store",
    },
  });
}
