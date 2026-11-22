// Hero: a crumpled notebook page in WebGL. Drag across it to smooth it out; once it is mostly smooth it lets go and
// lies flat so the note can be read. Double-click (double-tap) or press C to crumple it again.
// Adapted from a WebGL "receipt study": the paper mesh, folds and lighting follow it; the receipt is now a notebook.

// ---------- what the notebook says (edit freely) ----------
const NOTE = {
  heading: "Hi! I'm Hyunji.",
  body: "I'm a brand designer based in NYC, and I'm focused on brand identity and packaging design.",
};

// ---------- settings ----------
const IMAGE = "images/notebook.png"; // 1200 px wide cutout with transparent background
const LINES = { first: 154.2, gap: 58.6, left: 205, right: 1105 }; // ruled lines, in image px
const INK = "#1f1d21";
const PAPER_W = 460; // notebook width in world units (CSS px at zoom 1)
const NX = 36;
const RESID = 0.055; // creases that stay visible once smoothed
const K = 0.5; // how much a fully crumpled patch shrinks
const RUB_RADIUS = 90;
const RUB_STRENGTH = 0.0125;
const FLAT_AT = 0.36; // mean crumple at which it lets go
const CRUMPLE_TIME = 1.05;
const DOUBLE_TAP = 300;

const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const hero = document.querySelector(".hero");
if (hero) start(hero);

async function start(hero) {
  const canvas = hero.querySelector(".hero-canvas");
  // Safety net: pin the canvas inside the hero even if the stylesheet hasn't loaded (or an old one is cached),
  // so resizing the canvas can never make the page grow.
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
  if (getComputedStyle(hero).overflow !== "hidden") {
    // the hero styles are missing: give it a size of its own and hide the screen-reader heading
    Object.assign(hero.style, { position: "relative", overflow: "hidden", height: "calc(100svh - 90px)", minHeight: "520px" });
    const h1 = hero.querySelector(".sr-only");
    if (h1) Object.assign(h1.style, { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0,0,0,0)" });
  }
  const cursor = hero.querySelector(".hero-cursor");
  const hint = hero.querySelector(".hero-hint");

  // wait for the font (max 2.5 s) and the image, then print the note onto the page texture
  const fonts = [`500 1em "IBM Plex Mono"`, `600 1em "IBM Plex Mono"`].map((f) =>
    document.fonts.load(f, NOTE.heading + NOTE.body).catch(() => {}),
  );
  await Promise.race([Promise.all(fonts), new Promise((r) => setTimeout(r, 2500))]);
  const img = await loadImage(IMAGE);
  const tex = printNote(img);

  const study = createStudy(canvas, tex, { cursor, hint, hero });
  if (!study) paintStill(canvas, tex, hero);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}

/** The notebook image with the note written on its ruled lines. */
function printNote(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  const lineY = (n) => LINES.first + LINES.gap * n - 10;
  const maxW = LINES.right - LINES.left;

  ctx.font = `600 44px ${MONO}`;
  ctx.fillText(NOTE.heading, LINES.left, lineY(1));

  ctx.font = `500 33px ${MONO}`;
  let line = "";
  let n = 3;
  for (const word of NOTE.body.split(" ")) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, LINES.left, lineY(n++));
      line = word;
    } else line = test;
  }
  if (line) ctx.fillText(line, LINES.left, lineY(n));
  return c;
}

// ---------- the paper mesh ----------
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function createPaper(texW, texH) {
  const W = PAPER_W;
  const H = (W * texH) / texW;
  const NY = Math.round((NX * H) / W);
  const CX = NX + 1;
  const N = CX * (NY + 1);
  const dx0 = W / NX, dy0 = H / NY;
  const X0 = new Float32Array(N), Y0 = new Float32Array(N), UV = new Float32Array(N * 2);
  for (let j = 0; j <= NY; j++)
    for (let i = 0; i <= NX; i++) {
      const v = j * CX + i;
      X0[v] = i * dx0 - W / 2;
      Y0[v] = j * dy0 - H / 2;
      UV[v * 2] = i / NX;
      UV[v * 2 + 1] = j / NY;
    }
  const IDX = new Uint16Array(NX * NY * 6);
  for (let j = 0, k = 0; j < NY; j++)
    for (let i = 0; i < NX; i++, k += 6) {
      const a = j * CX + i, b = a + 1, c = a + CX, d = c + 1;
      IDX.set([a, c, b, b, c, d], k);
    }
  const P = new Float32Array(N * 3), NOR = new Float32Array(N * 3);
  const C = new Float32Array(N).fill(1);
  const Zcur = new Float32Array(N), Zold = new Float32Array(N);
  const JX = new Float32Array(N), JY = new Float32Array(N), EDGE = new Float32Array(N);
  for (let v = 0; v < N; v++) EDGE[v] = Math.min(1, Math.hypot(X0[v] / (W / 2), Y0[v] / (H / 2)) / 1.2);

  function genFolds() {
    Zcur.fill(0);
    const R = Math.random;
    for (let f = 0; f < 95; f++) {
      const a = R() * Math.PI, nx = Math.cos(a), ny = Math.sin(a);
      const px = (R() - 0.5) * W * 1.1, py = (R() - 0.5) * H * 1.02;
      const w = 14 + Math.pow(R(), 1.6) * 92, amp = (0.3 + R() * 0.45) * w * (R() < 0.5 ? -1 : 1), L = 60 + R() * 280;
      for (let v = 0; v < N; v++) {
        const x = X0[v] - px, y = Y0[v] - py, d = Math.abs(nx * x + ny * y);
        if (d > w) continue;
        const t = (-ny * x + nx * y) / L, e = 1 - t * t;
        if (e <= 0) continue;
        Zcur[v] += amp * (1 - d / w) * e;
      }
    }
    for (let b = 0; b < 8; b++) {
      const bx = (R() - 0.5) * W, by = (R() - 0.5) * H, s = 110 + R() * 170, A = (R() < 0.5 ? -1 : 1) * (16 + R() * 24);
      for (let v = 0; v < N; v++) {
        const x = X0[v] - bx, y = Y0[v] - by;
        Zcur[v] += A * Math.exp(-(x * x + y * y) / (s * s));
      }
    }
    const p1 = R() * 6.28, p2 = R() * 6.28, p3 = R() * 6.28, p4 = R() * 6.28;
    for (let v = 0; v < N; v++) {
      const x = X0[v], y = Y0[v];
      JX[v] = 7 * Math.sin(y * 0.019 + p1) + 4 * Math.sin(x * 0.05 + y * 0.012 + p2);
      JY[v] = 6 * Math.sin(x * 0.023 + p3) + 4 * Math.sin(y * 0.031 + x * 0.01 + p4);
    }
  }
  genFolds();

  const xs = new Float32Array(CX), ys = new Float32Array(NY + 1);
  function build(gMean) {
    for (let j = 0; j <= NY; j++) {
      let acc = 0;
      xs[0] = 0;
      for (let i = 1; i <= NX; i++) {
        const v = j * CX + i;
        acc += dx0 * (1 - K * (C[v - 1] + C[v]) * 0.5);
        xs[i] = acc;
      }
      const mid = xs[NX] / 2;
      for (let i = 0; i <= NX; i++) P[(j * CX + i) * 3] = xs[i] - mid;
    }
    for (let i = 0; i <= NX; i++) {
      let acc = 0;
      ys[0] = 0;
      for (let j = 1; j <= NY; j++) {
        const v = j * CX + i;
        acc += dy0 * (1 - K * (C[v - CX] + C[v]) * 0.5);
        ys[j] = acc;
      }
      const mid = ys[NY] / 2;
      for (let j = 0; j <= NY; j++) P[(j * CX + i) * 3 + 1] = ys[j] - mid;
    }
    const th = -0.17 * gMean, cs = Math.cos(th), sn = Math.sin(th);
    for (let v = 0; v < N; v++) {
      const c = C[v];
      const x = P[v * 3] + JX[v] * c, y = P[v * 3 + 1] + JY[v] * c;
      P[v * 3] = x * cs - y * sn;
      P[v * 3 + 1] = x * sn + y * cs;
      P[v * 3 + 2] = Zcur[v] * (RESID + (1 - RESID) * c) + Zold[v];
    }
    for (let j = 0; j <= NY; j++)
      for (let i = 0; i <= NX; i++) {
        const v = j * CX + i, l = j * CX + Math.max(i - 1, 0), r = j * CX + Math.min(i + 1, NX);
        const u = Math.max(j - 1, 0) * CX + i, d = Math.min(j + 1, NY) * CX + i;
        const ax = P[r * 3] - P[l * 3], ay = P[r * 3 + 1] - P[l * 3 + 1], az = P[r * 3 + 2] - P[l * 3 + 2];
        const bx = P[d * 3] - P[u * 3], by = P[d * 3 + 1] - P[u * 3 + 1], bz = P[d * 3 + 2] - P[u * 3 + 2];
        const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const m = Math.hypot(nx, ny, nz) || 1;
        NOR[v * 3] = nx / m;
        NOR[v * 3 + 1] = ny / m;
        NOR[v * 3 + 2] = nz / m;
      }
  }
  function rub(wx, wy, m) {
    if (m <= 0) return;
    const R2 = RUB_RADIUS * RUB_RADIUS;
    for (let v = 0; v < N; v++) {
      const dx = P[v * 3] - wx, dy = P[v * 3 + 1] - wy, d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      let f = 1 - Math.sqrt(d2) / RUB_RADIUS;
      f = f * f * (3 - 2 * f);
      C[v] = Math.max(0, C[v] - RUB_STRENGTH * m * f);
    }
  }
  const Ctmp = new Float32Array(N);
  function diffuse() {
    for (let j = 0; j <= NY; j++)
      for (let i = 0; i <= NX; i++) {
        const v = j * CX + i;
        const s = C[j * CX + Math.max(i - 1, 0)] + C[j * CX + Math.min(i + 1, NX)] +
          C[Math.max(j - 1, 0) * CX + i] + C[Math.min(j + 1, NY) * CX + i];
        Ctmp[v] = C[v] * 0.92 + s * 0.02;
      }
    C.set(Ctmp);
  }
  const mean = () => { let s = 0; for (let v = 0; v < N; v++) s += C[v]; return s / N; };
  function settle(dt) {
    let mx = 0;
    for (let v = 0; v < N; v++) { C[v] += -C[v] * Math.min(1, dt * 6); if (C[v] > mx) mx = C[v]; }
    return mx;
  }
  function recrumple() {
    for (let v = 0; v < N; v++) Zold[v] = Zold[v] * 0.6 + Zcur[v] * RESID;
    genFolds();
  }
  function crumpleTo(t) {
    for (let v = 0; v < N; v++) C[v] = ease(Math.max(0, Math.min(1, t * 1.4 - (1 - EDGE[v]) * 0.4)));
  }
  return { W, H, P, NOR, UV, IDX, C, build, rub, diffuse, mean, settle, recrumple, crumpleTo };
}

// ---------- WebGL ----------
const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv;
uniform vec2 uView, uOff; uniform float uD, uShadow, uZoom;
varying vec2 vUv; varying vec3 vNor;
void main(){
  vec3 p=aPos;
  if(uShadow>.5){ p.xy += uOff * (1.0 + max(p.z,0.0)*0.012); p.z=0.0; }
  float k=uD/(uD-p.z);
  vec2 s=p.xy*k*uZoom;
  gl_Position=vec4(s.x/(uView.x*.5), -s.y/(uView.y*.5), -p.z/3000.0, 1.0);
  vUv=aUv; vNor=aNor;
}`;
const FS = `
precision highp float;
uniform sampler2D uTex; uniform float uShadow, uAlpha; uniform vec3 uLight;
varying vec2 vUv; varying vec3 vNor;
void main(){
  vec4 t=texture2D(uTex,vUv);
  float a=smoothstep(.25,.75,t.a);
  if(a<.02) discard;
  if(uShadow>.5){ gl_FragColor=vec4(0.,0.,0.,uAlpha*a); return; }
  vec3 N=normalize(vNor);
  float d=max(dot(N,uLight),0.);
  vec3 H=normalize(uLight+vec3(0.,0.,1.));
  float sp=pow(max(dot(N,H),0.),48.)*.07;
  // lit so that a flat page shows the photo's own colours
  vec3 col=t.rgb*(.70+.38*d)/(.70+.38*uLight.z) + sp;
  gl_FragColor=vec4(col*a,a);
}`;
const LIGHT = [-0.42, -0.58, 0.7];
// soft shadow: many faint offset passes (more passes = smoother on a light background)
const SHADOW = Array.from({ length: 12 }, (_, i) => {
  const t = (i + 1) / 12;
  return [2 + 22 * t * t, 4 + 34 * t * t, 0.045 * (1 - t) + 0.008];
});

function createRenderer(gl, isGL2, paper, tex) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uView = U("uView"), uOff = U("uOff"), uShadow = U("uShadow"), uAlpha = U("uAlpha"), uZoom = U("uZoom");
  const m = Math.hypot(...LIGHT);
  gl.uniform3f(U("uLight"), LIGHT[0] / m, LIGHT[1] / m, LIGHT[2] / m);
  gl.uniform1f(U("uD"), 1600);
  gl.uniform1i(U("uTex"), 0);

  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (isGL2) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const buf = (data, attr, size, dyn) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, dyn ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, attr);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return b;
  };
  const bP = buf(paper.P, "aPos", 3, true);
  const bN = buf(paper.NOR, "aNor", 3, true);
  buf(paper.UV, "aUv", 2, false);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, paper.IDX, gl.STATIC_DRAW);
  const count = paper.IDX.length;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  function draw(vw, vh, zoom, lift) {
    gl.bindBuffer(gl.ARRAY_BUFFER, bP);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, paper.P);
    gl.bindBuffer(gl.ARRAY_BUFFER, bN);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, paper.NOR);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform2f(uView, vw, vh);
    gl.uniform1f(uZoom, zoom);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(uShadow, 1);
    for (const [ox, oy, a] of SHADOW) {
      gl.uniform2f(uOff, ox * lift, oy * lift);
      gl.uniform1f(uAlpha, a);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.uniform1f(uShadow, 0);
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
  }
  return { draw };
}

function getGL(canvas) {
  const opts = { antialias: true, premultipliedAlpha: true, alpha: true };
  const gl2 = canvas.getContext("webgl2", opts);
  if (gl2) return { gl: gl2, isGL2: true };
  const gl1 = canvas.getContext("webgl", opts);
  return gl1 ? { gl: gl1, isGL2: false } : null;
}

// ---------- the loop, phases and input ----------
function createStudy(canvas, tex, { cursor, hint, hero }) {
  const ctx = getGL(canvas);
  if (!ctx) return null;
  let renderer;
  const paper = createPaper(tex.width, tex.height);
  try {
    renderer = createRenderer(ctx.gl, ctx.isGL2, paper, tex);
  } catch (e) {
    console.warn(e);
    return null;
  }
  const gl = ctx.gl;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touchScreen = matchMedia("(hover: none)").matches;
  const HINTS = {
    crumpled: touchScreen ? "Swipe across the page to smooth it out" : "Drag across the page to smooth it out",
    flat: touchScreen ? "Double-tap to crumple it again" : "Double-click to crumple it again",
  };

  let vw = 0, vh = 0, zoom = 1;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    vw = hero.clientWidth;
    vh = hero.clientHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // fit the flat page inside the hero, with room for the hint below
    zoom = Math.min(1.25, (vh * 0.84) / paper.H, (vw * 0.9) / paper.W);
    cursor.style.setProperty("--ring", `${RUB_RADIUS * 1.8 * zoom}px`);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(hero);
  resize();

  let phase = "crumpled", animT = 0, gMean = 1, ticks = 0;
  const mouse = { x: -999, y: -999, down: false };
  let lastTap = 0;
  const setLook = (look) => {
    hero.dataset.look = look;
    hint.textContent = HINTS[look];
  };
  setLook("crumpled");

  const toWorld = (mx, my) => [(mx - vw / 2) / zoom, (my - vh / 2) / zoom];

  function crumple() {
    if (phase !== "flat") return;
    paper.recrumple();
    phase = "crumpling";
    animT = 0;
    setLook("crumpled");
  }

  let last = performance.now(), raf = 0, visible = true;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (phase === "crumpled") {
      ticks += dt * 60;
      const n = Math.floor(ticks + 1e-6);
      ticks -= n;
      if (!reduced || mouse.down) for (let i = 0; i < n; i++) paper.diffuse();
      if (paper.mean() < FLAT_AT) {
        phase = "settling";
        if (reduced) { paper.C.fill(0); gMean = 0; }
      }
    } else if (phase === "settling") {
      if (paper.settle(dt) < 0.003) {
        paper.C.fill(0);
        phase = "flat";
        setLook("flat");
      }
    } else if (phase === "crumpling") {
      animT = reduced ? 1 : Math.min(1, animT + dt / CRUMPLE_TIME);
      if (reduced) gMean = 1;
      paper.crumpleTo(animT);
      if (animT >= 1) { paper.C.fill(1); phase = "crumpled"; }
    }
    gMean += (paper.mean() - gMean) * (1 - Math.pow(0.75, dt * 60));
    paper.build(gMean);
    renderer.draw(vw, vh, zoom, 0.35 + gMean * 0.9);
    raf = visible ? requestAnimationFrame(frame) : 0;
  }
  raf = requestAnimationFrame(frame);

  // pause drawing while the hero is scrolled out of view
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }).observe(hero);

  const place = (e) => {
    const r = hero.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    cursor.style.transform = `translate(${x}px,${y}px)`;
    return [x, y];
  };
  hero.addEventListener("pointermove", (e) => {
    if (!e.isPrimary) return;
    const [x, y] = place(e);
    const mdx = x - mouse.x, mdy = y - mouse.y;
    mouse.x = x; mouse.y = y;
    if (mouse.down && phase === "crumpled") paper.rub(...toWorld(x, y), Math.hypot(mdx, mdy) / zoom);
  });
  hero.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return;
    const [x, y] = place(e);
    mouse.down = true; mouse.x = x; mouse.y = y;
    hero.dataset.down = "";
    if (e.pointerType === "touch") {
      if (e.timeStamp - lastTap < DOUBLE_TAP) { crumple(); lastTap = 0; } else lastTap = e.timeStamp;
    }
  });
  const up = () => { mouse.down = false; delete hero.dataset.down; };
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
  hero.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") cursor.style.transform = "translate(-200px,-200px)"; });
  hero.addEventListener("dblclick", crumple);
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const r = hero.getBoundingClientRect();
    if ((e.key === "c" || e.key === "C") && r.bottom > 0 && r.top < innerHeight) crumple();
  });
  return {};
}

// ---------- without WebGL: the page lying flat ----------
function paintStill(canvas, tex, hero) {
  hero.dataset.still = "";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const draw = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const vw = hero.clientWidth, vh = hero.clientHeight;
    canvas.width = vw * dpr;
    canvas.height = vh * dpr;
    const s = Math.min((vh * 0.84) / tex.height, (vw * 0.9) / tex.width) * dpr;
    const w = tex.width * s, h = tex.height * s;
    ctx.shadowColor = "rgba(0,0,0,.18)";
    ctx.shadowBlur = 30 * dpr;
    ctx.shadowOffsetY = 12 * dpr;
    ctx.drawImage(tex, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  };
  new ResizeObserver(draw).observe(hero);
}
