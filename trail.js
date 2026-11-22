// Cursor trail: outline star glyphs (from glyphy.io/cool-symbols/stars) pop up along the mouse path, glide toward
// the cursor, then shrink and fade. Each one gets a random pastel colour. Off on touch screens, with reduced motion, and over the
// notebook hero (which has its own cursor).

(() => {
  // ---------- settings (edit freely) ----------
  // pastel yellows, blues and greens
  const COLORS = ["#fff4a8", "#ffe680", "#fdf7cf", "#dff2ff", "#c4e6ff", "#eaf7ff", "#d6f7cf", "#b8ecb4", "#e6fbe0"];
  // outline (unfilled) stars from glyphy.io/cool-symbols/stars
  const GLYPHS = ["☆", "✩", "✰", "✧", "⭒", "✫", "✬", "✲", "✼", "⍟", "✪", "❂"];
  const SPACING = 100;   // px the mouse travels between symbols
  const SIZE = 39;       // px
  const GROW = 1000;     // ms to grow in and glide to the cursor
  const SHRINK = 800;    // ms to shrink and fade out
  const MAX_TILT = 20;   // degrees, random either way
  const LAG = 0.3;       // how quickly the spawn point catches up with the mouse (0-1 per frame)
  const SKIP = ".hero";  // areas with no trail

  if (matchMedia("(hover: none)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed", inset: "0", pointerEvents: "none", zIndex: "50", overflow: "hidden",
  });
  document.body.appendChild(layer);

  const mouse = { x: 0, y: 0, active: false };
  const spawn = { x: 0, y: 0 };   // lags behind the mouse: new symbols start here and glide to the cursor
  const last = { x: 0, y: 0 };    // where the previous symbol appeared
  let z = 1, lastShape = "";

  addEventListener("mousemove", (e) => {
    const skip = e.target instanceof Element && e.target.closest(SKIP);
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (skip) { mouse.active = false; return; }
    if (!mouse.active) {          // (re)entering: start fresh, no symbol for the jump
      mouse.active = true;
      spawn.x = last.x = mouse.x;
      spawn.y = last.y = mouse.y;
    }
  }, { passive: true });
  document.addEventListener("mouseleave", () => { mouse.active = false; });

  function tick() {
    spawn.x += (mouse.x - spawn.x) * LAG;
    spawn.y += (mouse.y - spawn.y) * LAG;
    if (mouse.active && Math.hypot(mouse.x - last.x, mouse.y - last.y) > SPACING) {
      show();
      last.x = mouse.x;
      last.y = mouse.y;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function show() {
    let glyph;
    do glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; while (glyph === lastShape);
    lastShape = glyph;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const tilt = (Math.random() * 2 - 1) * MAX_TILT;

    const el = document.createElement("div");
    el.textContent = glyph + "\uFE0E"; // \uFE0E: show as a text symbol, never as an emoji
    Object.assign(el.style, {
      position: "absolute", left: "0", top: "0", width: SIZE + "px", height: SIZE + "px",
      marginLeft: -SIZE / 2 + "px", marginTop: -SIZE / 2 + "px", zIndex: String(z++), willChange: "transform, opacity",
      color, fontSize: SIZE + "px", lineHeight: SIZE + "px", textAlign: "center",
      fontFamily: '"Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", "Noto Sans Symbols", "DejaVu Sans", sans-serif',
    });
    layer.appendChild(el);

    const from = `translate(${spawn.x}px, ${spawn.y}px)`, to = `translate(${mouse.x}px, ${mouse.y}px)`;
    // glide from the lagging point to the cursor while growing in
    const grow = el.animate(
      [
        { transform: `${from} rotate(${tilt}deg) scale(0)`, opacity: 0 },
        { transform: `${to} rotate(${tilt}deg) scale(1)`, opacity: 1, offset: 1 },
      ],
      { duration: GROW, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
    );
    grow.onfinish = () => {
      const shrink = el.animate(
        [
          { transform: `${to} rotate(${tilt}deg) scale(1)`, opacity: 1 },
          { transform: `${to} rotate(${tilt}deg) scale(0)`, opacity: 0 },
        ],
        { duration: SHRINK, easing: "cubic-bezier(0.25, 1, 0.5, 1)", fill: "forwards" },
      );
      shrink.onfinish = () => el.remove();
    };
    // never keep too many around
    while (layer.childElementCount > 40) layer.firstElementChild.remove();
  }
})();
