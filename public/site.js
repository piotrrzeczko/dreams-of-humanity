(() => {
"use strict";
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── Living fog (WebGL) ──────────────────────────────────
const canvas = document.getElementById("fog");
const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
if (gl) {
  const vs = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const fs = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec2 m;uniform float s;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 R=mat2(.8,.6,-.6,.8);for(int i=0;i<5;i++){v+=a*n(p);p=R*p*2.03;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/r;vec2 p=(gl_FragCoord.xy-.5*r)/min(r.x,r.y);
  p.y+=s*.35;
  float T=t*.03;
  vec2 q=vec2(fbm(p*1.5+vec2(0.,T)),fbm(p*1.5+vec2(5.2,1.3)-T));
  vec2 w=vec2(fbm(p*1.3+2.*q+vec2(1.7,9.2)+.7*T),fbm(p*1.3+2.*q+vec2(8.3,2.8)-.5*T));
  float f=fbm(p*1.1+2.3*w);
  vec3 vd=vec3(.024,.02,.059),vi=vec3(.48,.37,.65),ro=vec3(.77,.41,.48),am=vec3(.83,.57,.29);
  vec3 c=mix(vd,vi*.6,smoothstep(.32,.9,f));
  c=mix(c,ro*.55,smoothstep(.5,1.,w.x)*.5);
  c=mix(c,am*.6,smoothstep(.72,1.05,q.y)*.28);
  vec2 mp=(m-.5)*vec2(r.x/min(r.x,r.y),r.y/min(r.x,r.y));
  float d=length(p-mp);c+=vi*.28*exp(-d*d*2.5);
  c*=1.-.55*length(uv-.5);
  c=mix(vd,c,.92);
  gl_FragColor=vec4(c,1.);
}`;
  const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return x; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
  if (gl.getProgramParameter(pr, gl.LINK_STATUS)) {
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = { r: gl.getUniformLocation(pr, "r"), t: gl.getUniformLocation(pr, "t"), m: gl.getUniformLocation(pr, "m"), s: gl.getUniformLocation(pr, "s") };
    const scale = Math.min(window.devicePixelRatio || 1, 2) * (innerWidth > 1400 ? .4 : .55);
    const size = () => { canvas.width = Math.round(innerWidth * scale); canvas.height = Math.round(innerHeight * scale); gl.viewport(0, 0, canvas.width, canvas.height); };
    size(); addEventListener("resize", size);
    let mx = .5, my = .6, tx = .5, ty = .6;
    addEventListener("pointermove", e => { tx = e.clientX / innerWidth; ty = 1 - e.clientY / innerHeight; }, { passive: true });
    const t0 = performance.now(); let visible = true;
    document.addEventListener("visibilitychange", () => { visible = !document.hidden; if (visible && !reduce) requestAnimationFrame(frame); });
    function frame(now) {
      mx += (tx - mx) * .04; my += (ty - my) * .04;
      gl.uniform2f(U.r, canvas.width, canvas.height);
      gl.uniform1f(U.t, reduce ? 20 : (now - t0) / 1000);
      gl.uniform2f(U.m, mx, my);
      gl.uniform1f(U.s, scrollY / innerHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduce && visible) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    if (reduce) addEventListener("scroll", () => requestAnimationFrame(frame), { passive: true });
  }
} else {
  canvas.style.background = "radial-gradient(ellipse 80% 60% at 50% 35%, rgba(123,94,167,.45), transparent 70%), radial-gradient(ellipse 60% 50% at 80% 80%, rgba(196,104,122,.25), transparent 70%), #06050F";
}

// ── Nav ─────────────────────────────────────────────────
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("solid", scrollY > 40);
onScroll(); addEventListener("scroll", onScroll, { passive: true });

// ── Reveal on scroll ────────────────────────────────────
// Content is visible by default; it only fades in when this script runs (html.js).
if (!("IntersectionObserver" in window)) document.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
const io = !("IntersectionObserver" in window) ? { observe() {}, unobserve() {} } : new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .06, rootMargin: "0px 0px -4% 0px" });
document.querySelectorAll(".reveal").forEach((el, i) => { el.style.transitionDelay = (el.closest(".hero") ? i * 120 : 0) + "ms"; io.observe(el); });

// ── Live example map (same code as the journal app) ────
if (window.DMap && document.getElementById("lConst")) {
  const ex = DMap.EXAMPLES, prof = DMap.EXAMPLE_PROFILE;
  DMap.setProfile(prof);
  const div = () => document.createElement("div");
  const go = () => { location.href = "/app/#examples"; };
  DMap.render(ex, [], {
    stats: div(), heat: document.getElementById("lHeat"), range: div(), constellation: document.getElementById("lConst"),
    threads: document.getElementById("lThreads"), people: div(), places: div(), motifs: div(), weather: div(),
    symbols: div(), archetypes: div(), observations: document.getElementById("lObs"), profile: prof, onPick: go,
  });
  document.getElementById("lObs").hidden = false;
}

// ── Waitlist ────────────────────────────────────────────
const form = document.getElementById("wlForm");
form.addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("wlEmail").value.trim();
  const note = document.getElementById("wlNote");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { note.textContent = "That email doesn't look right."; return; }
  const btn = form.querySelector("button"); btn.disabled = true;
  try {
    const r = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, lang: navigator.language }) });
    if (!r.ok) throw new Error();
    note.textContent = "You're on the list. Sweet dreams."; form.reset();
  } catch { note.textContent = "Something went wrong. Please try again."; btn.disabled = false; }
});
})();
