// lessloc install counter for the README: a pixel-art lime slime, as an animated SVG.
//
//   slime({ total, recent }) -> SVG string, 360x240, transparent, no script, deterministic.
//
// The slime always dances: it hops left and right, wobbles and blinks, carrying the total on its
// belly in pixel digits (the word "installs" sits below). When recent > 0, every loop it also
// inflates (the total grows with it), splats into min(recent, 8) little slimes that bounce where
// they land, hops them back to sink into a small blob, and reforms with an overshoot while the
// total, back on the body, pulses.
//
// Every distinct frame is drawn once down a tall film strip, 64 cells apart, and a discrete
// translate picks the frame for each tick; the hop and the tremble glide on a spline wrapper.
// All tracks share one clock (100 ticks of 70 ms = 7 s, begin 0, repeating), so nothing drifts,
// and all are SMIL animateTransform, which plays inside <img> on GitHub and npm in every browser.

const N = 100, DUR = '7s', STEP = 64, HIDE = STEP; // HIDE: a shift that leaves every frame off screen
const LOOP = `dur="${DUR}" repeatCount="indefinite"`;
const COLORS = { o: '#3b7a2a', d: '#8bcf4c', l: '#cdf98a', b: '#b3ec64', h: '#f7ffe9', e: '#243040', w: '#ffffff', k: '#ff93a6' };
const PAINT = 'odlbODLBHWEK'; // paint order: fills (outline to body), then 1-cell strokes
const EASE = { lin: '0 0 1 1', io: '.4 0 .6 1', up: '.2 .5 .5 1', down: '.45 0 .8 .6' };

// ---- animation tracks ------------------------------------------------------------------------

// Discrete track from one value per tick; only the changes are written.
function track(perTick, type = 'translate') {
  const values = [], times = [];
  perTick.forEach((v, i) => { if (!i || v !== perTick[i - 1]) { values.push(v); times.push(i / N); } });
  return `<animateTransform attributeName="transform" type="${type}" calcMode="discrete" ${LOOP} values="${values.join(';')}" keyTimes="${times.join(';')}"/>`;
}

// Smooth track from [tick, value, ease of the next segment] keys, looping back to the first value.
function glide(keys) {
  const ks = [...keys, [N, keys[0][1]]];
  return `<animateTransform attributeName="transform" type="translate" calcMode="spline" ${LOOP} values="${ks.map((k) => k[1]).join(';')}" keyTimes="${ks.map((k) => k[0] / N).join(';')}" keySplines="${keys.map((k) => EASE[k[2]]).join(';')}"/>`;
}
const key = (keys, t, v, ease = 'lin') => { if (keys.at(-1)?.[0] === t) keys.pop(); keys.push([t, v, ease]); };

// ---- pixel drawing ---------------------------------------------------------------------------

// Frames never overlap on a strip, so each color is one <path> holding every frame's shapes.
function ink() {
  const m = {};
  return {
    add(c, d) { if (d) (m[c] ||= []).push(d); },
    colors: () => Object.keys(m),
    svg: (attr) => [...PAINT].filter((c) => m[c]).map((c) => `<path ${attr(c)} d="${m[c].join('').replace(/ -/g, '-')}"/>`).join(''),
  };
}

// Rows {y, L, R} (R exclusive, contiguous y) -> one staircase polygon.
function poly(rows, dy) {
  rows = rows.filter((r) => r.R > r.L);
  if (!rows.length) return '';
  const n = rows.length, last = rows[n - 1];
  let d = `M${rows[0].L} ${rows[0].y + dy}h${rows[0].R - rows[0].L}`;
  for (let i = 0; i < n;) {
    let j = i; while (j + 1 < n && rows[j + 1].R === rows[i].R) j++;
    d += `v${j - i + 1}` + (j + 1 < n ? `h${rows[j + 1].R - rows[i].R}` : '');
    i = j + 1;
  }
  d += `h${last.L - last.R}`;
  for (let i = n - 1; i >= 0;) {
    let j = i; while (j - 1 >= 0 && rows[j - 1].L === rows[i].L) j--;
    if (j === 0) break; // z closes the last edge
    d += `v${j - i - 1}h${rows[j - 1].L - rows[i].L}`;
    i = j - 1;
  }
  return d + 'z';
}

// Single cells ("x,y" -> color) -> a 1-cell stroked line per horizontal run, per color.
function runs(cells, dy, out) {
  const byColor = {};
  for (const [k, c] of cells) { const [x, y] = k.split(',').map(Number); (byColor[c] ||= []).push([y + dy, x]); }
  for (const c of Object.keys(byColor)) {
    const rs = [];
    for (const [y, x] of byColor[c].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
      const r = rs.at(-1);
      if (r && r.y === y && r.x + r.n === x) r.n++; else rs.push({ y, x, n: 1 });
    }
    let d = '', px = 0, py = 0;
    rs.forEach((r, i) => {
      d += (i ? `m${r.x - px} ${r.y - py}` : `M${r.x} ${r.y + 0.5}`) + `h${r.n}`;
      px = r.x + r.n; py = r.y;
    });
    out.add(c.toUpperCase(), d);
  }
}

// Half-width of the slime dome at height fraction v (0 = ground, 1 = top).
const dome = (W, v) => (W / 2) * Math.sqrt(Math.max(0, 1 - v ** 2.3));

// Slime silhouette standing on y = 0: a dome, leaning by `lean` cells at the top, rippled by `rip`.
function silhouette(W, H, lean = 0, rip = 0, ph = 0) {
  const rows = [];
  for (let y = -H; y < 0; y++) {
    const v = (-y - 0.5) / H;
    const hw = dome(W, v) + rip * Math.sin(v * 8 + ph) - (y === -1 ? 0.6 : 0);
    const c = lean * v ** 1.4;
    const L = Math.ceil(c - hw - 0.5), R = Math.floor(c + hw - 0.5) + 1;
    if (R > L) rows.push({ y, L, R, c });
  }
  return rows;
}

// Outline, shaded lower right, light rim upper left, body: four stacked polygons.
function body(rows, H, dy, out) {
  const at = (y) => rows.find((r) => r.y === y);
  const top = rows[0].y, bot = rows.at(-1);
  const o = [{ y: top - 1, L: rows[0].L, R: rows[0].R }];
  for (const r of rows) {
    const a = at(r.y - 1) || r, b = at(r.y + 1) || r;
    o.push({ y: r.y, L: Math.min(r.L - 1, a.L, b.L), R: Math.max(r.R + 1, a.R, b.R) });
  }
  o.push({ y: bot.y + 1, L: bot.L, R: bot.R });
  const lit = [], mid = [];
  for (const r of rows) {
    const b = at(r.y + 1);
    if (!b) continue;
    const L = Math.max(r.L, b.L), R = Math.min(r.R - 1, b.R - 1, r.y > top + H * 0.35 ? r.R - 2 : Infinity);
    lit.push({ y: r.y, L, R });
    const a = at(r.y - 1);
    if (a) mid.push({ y: r.y, L: Math.max(L, r.L + 1, a.L), R: Math.min(R, a.R) });
  }
  out.add('o', poly(o, dy)); out.add('d', poly(rows, dy)); out.add('l', poly(lit, dy)); out.add('b', poly(mid, dy));
}

const EYES = { // [dx, dy, color] from the eye's top-left cell
  open: [[0, 0, 'w'], [1, 0, 'e'], [0, 1, 'e'], [1, 1, 'e'], [0, 2, 'e'], [1, 2, 'e']],
  blink: [[0, 2, 'e'], [1, 2, 'e']],
  squint: [[0, 0, 'e'], [1, 1, 'e'], [0, 2, 'e']],
  happy: [[-1, 2, 'e'], [0, 1, 'e'], [1, 1, 'e'], [2, 2, 'e']],
};
const MOUTHS = {
  smile: [[-1, 0], [0, 0]],
  grin: [[-2, 0], [1, 0], [-1, 1], [0, 1]],
  open: [[-2, 0], [-1, 0], [0, 0], [1, 0], [-2, 1], [-1, 1, 'k'], [0, 1, 'k'], [1, 1], [-1, 2], [0, 2]],
  wavy: [[-2, 1], [-1, 0], [0, 1], [1, 0]],
};

// A slime frame for pose p = { W, H, lean, rip, ph, eyes, mouth }, drawn at strip offset dy.
function slimeFrame(p, dy, out) {
  const rows = silhouette(p.W, p.H, p.lean, p.rip, p.ph);
  const at = (y) => rows.find((r) => r.y === y);
  const cells = new Map(), set = (x, y, c) => cells.set(x + ',' + y, c);
  // Gloss: an arc two cells inside the upper-left edge, and a dot below it.
  const top = rows[0].y, len = Math.max(2, Math.round(p.H * 0.2));
  for (let i = 0; i < len; i++) { const r = at(top + 2 + i); if (r) set(r.L + 2, r.y, 'h'); }
  const r2 = at(top + 2); if (r2) { set(r2.L + 3, r2.y, 'h'); if (p.W > 20) set(r2.L + 4, r2.y, 'h'); }
  const rd = at(top + 3 + len); if (rd && p.H > 10) set(rd.L + 2, rd.y, 'h');
  // Face: eyes a third of the way up, or higher when the total on the belly needs the room
  // (p.face: the lowest the eye row may sit), mouth just below, blush on the larger poses.
  const eyeBottom = Math.min(-Math.round(p.H * 0.36) - 1, p.face ?? 0), c = Math.round((at(eyeBottom) || rows[0]).c);
  const gap = Math.max(2, Math.round(p.W * 0.16)), lx = c - gap - 2, rx = c + gap, ey = eyeBottom - 2;
  for (const [dx, y, col] of EYES[p.eyes]) {
    set(lx + dx, ey + y, col);
    set(rx + (p.eyes === 'squint' ? 1 - dx : dx), ey + y, col);
  }
  for (const [dx, y, col = 'e'] of MOUTHS[p.mouth]) set(c + dx, eyeBottom + 1 + y, col);
  if (p.W >= 20) for (const x of [lx - 1, lx, rx + 1, rx + 2]) set(x, eyeBottom + 1, 'k');
  body(rows, p.H, dy, out);
  runs(cells, dy, out);
}

// Little slime with two dot eyes, normal and squashed. Drawn through <use>, so it takes
// presentation attributes; its outline is currentColor, so the page's dark mode can lift it.
function bitFrames(W, H) {
  const out = ink();
  for (const [w, h, dy] of [[W, H, 0], [W + 2, H - 1, STEP]]) {
    const rows = silhouette(w, h), eye = -Math.round(h * 0.5) - 1;
    body(rows, h, dy, out);
    runs(new Map([[`-2,${eye}`, 'e'], [`1,${eye}`, 'e'], [`${rows[1].L + 1},${rows[1].y}`, 'h']]), dy, out);
  }
  return out.svg((c) => c === 'o' ? 'fill="currentColor"' : c > 'Z' ? `fill="${COLORS[c]}"` : `stroke="${COLORS[c.toLowerCase()]}"`);
}

// Deterministic jitter in [0, 1) from an integer.
const jit = (i) => (Math.imul(i + 1, 2654435761) >>> 0) / 2 ** 32;

// The pop, centred where the inflated body (W x H) stood: a ring of irregular lime blobs along its
// outline, puddles on the ground and drops flung outward (`far`: the follow-up frame, drops only).
function splatFrame(W, H, dy, out, far = false) {
  const along = (a, push) => { // a point pushed out from the outline at angle a, and its normal
    const v = Math.sin(a), x = Math.sign(Math.cos(a)) * dome(W, v), y = -H * v;
    const n = Math.hypot(x, y + H * 0.45) || 1, nx = x / n, ny = (y + H * 0.45) / n;
    return { x: x + nx * push, y: y + ny * push, nx, ny };
  };
  const blobs = [], drops = [], NB = 9;
  for (let j = 0; j < NB; j++) {
    const a = (Math.PI * (j + 0.5)) / NB, b = (Math.PI * (j + 1)) / NB;
    if (!far) blobs.push({ ...along(a, 0.5 + 1.5 * jit(j)), r: 2.6 + 1.5 * jit(j + 20) });
    if (far || j < NB - 1) drops.push({ ...along(b, (far ? 9 : 5) + 3 * jit(j + 40)), r: far ? 1.2 : 1.5 });
  }
  if (!far) [-0.27, 0.02, 0.29].forEach((x, i) => blobs.push({ x: x * W, y: -1.2, r: 2.2 + jit(i + 60), flat: true }));
  const fill = (list) => {
    const set = new Set();
    for (let y = -H - 20; y < 1; y++) for (let x = -W; x <= W; x++) {
      if (list.some((o) => {
        const ex = x + 0.5 - o.x, ey = y + 0.5 - o.y;
        if (o.flat) return (ex / (o.r * 1.9)) ** 2 + (ey / 2.2) ** 2 <= 1; // a puddle
        return ((ex * o.nx + ey * o.ny) / (o.r * 1.3)) ** 2 + ((ex * o.ny - ey * o.nx) / o.r) ** 2 <= 1;
      })) set.add(x + ',' + y);
    }
    return set;
  };
  const cells = new Map();
  const B = fill(blobs), has = (x, y) => B.has(x + ',' + y);
  const core = (x, y) => has(x, y) && has(x - 1, y) && has(x + 1, y) && has(x, y - 1) && has(x, y + 1);
  for (const k of B) { // blobs shaded like the slime: outline, dark lower right, light upper left
    const [x, y] = k.split(',').map(Number);
    cells.set(k, !core(x, y) ? 'o' : !core(x + 1, y + 1) ? 'd' : !core(x - 1, y - 1) ? 'l' : 'b');
  }
  const D = fill(drops); // drops: plain lime, darker on the lower right
  for (const k of D) {
    const [x, y] = k.split(',').map(Number);
    cells.set(k, D.has(x + 1 + ',' + y) && D.has(x + ',' + (y + 1)) ? 'b' : 'd');
  }
  runs(cells, dy, out);
}

// ---- poses and timeline ----------------------------------------------------------------------

const pose = (o) => ({ W: 26, H: 18, lean: 0, rip: 0, ph: 0, eyes: 'open', mouth: 'grin', ...o });
const POSES = {
  sq: pose({ W: 30, H: 15 }),
  wa: pose({ W: 28, H: 16, rip: 0.7 }),
  wb: pose({ W: 25, H: 19, rip: 0.7, ph: 3 }),
  wa_: pose({ W: 28, H: 16, rip: 0.7, eyes: 'blink' }),
  wb_: pose({ W: 25, H: 19, rip: 0.7, ph: 3, eyes: 'blink' }),
  sq2: pose({ W: 29, H: 16, mouth: 'open' }),
  st: pose({ W: 23, H: 21, mouth: 'open' }),
  st1: pose({ W: 23, H: 21, lean: 2, mouth: 'open' }),
  'st-1': pose({ W: 23, H: 21, lean: -2, mouth: 'open' }),
  n1: pose({ lean: 3, rip: 0.4, ph: 3 }),
  'n-1': pose({ lean: -3, rip: 0.4 }),
};
// One hop of 3 cells, 10 ticks: land, wobble, crouch, fly. [pose, height for the shadow]
const BEAT = [['sq', 0], ['wa', 0], ['wb', 0], ['sq2', 0], ['st', -2], ['n', -5], ['n', -6], ['n', -5], ['st', -3], ['st', -1]];
const HOP = 6, TREMBLE = 1;

// The pop, in ticks: inflate, splat, bits fly out and land, bounce, hop back (the central bits
// first, up to 3 ticks apart), sink into the reform blob, which grows, overshoots and settles.
const INFLATE = 50, POP = 62, LAND = 69, RETURN = 78, RIM = 82;
const GROW = [1.12, 1.24, 1.36, 1.48]; // the inflate, 3 ticks each; the total grows with it
const SWELL = GROW.map((s) => pose({ W: Math.round(13 * s) * 2, H: Math.round(18 * s ** 1.4), eyes: 'squint', mouth: 'wavy' }));
const BIG = SWELL.at(-1);
const REFORM = [ // from RIM to the end of the loop
  pose({ W: 12, H: 8, eyes: 'blink', mouth: 'smile' }),
  pose({ W: 14, H: 9, eyes: 'blink', mouth: 'smile' }),
  pose({ W: 16, H: 11, eyes: 'blink', mouth: 'smile' }),
  pose({ W: 18, H: 13, eyes: 'blink', mouth: 'smile' }),
  pose({ W: 21, H: 16, mouth: 'smile' }),
  pose({ W: 24, H: 20, eyes: 'happy', mouth: 'open' }),
  pose({ W: 26, H: 23, eyes: 'happy', mouth: 'open' }), // overshoot: tall...
  pose({ W: 33, H: 15, eyes: 'happy', mouth: 'open' }), // ...then wide
  'st', 'wa', 'wb', 'wa', 'wb', 'wa_', 'wb_', 'wa', 'sq2', 'sq2',
];
const SHOWN = RIM + 4; // the total is back on the reform blob from here
const PULSE = [[0, 1], [88, 1.12], [90, 1.06], [92, 1]]; // the total's scale, with the overshoot

// ---- the total on the belly ------------------------------------------------------------------

// 3x5 pixel digits, a 3-bit mask per row (4 = left column); the comma, one column, hangs a row lower.
const DIGITS = ['75557', '26227', '71747', '71317', '55711', '74717', '34757', '71122', '75757', '75716'];
const COMMA = '000011';
const GAP = 0.75, ROOM = 2, SIDE = 1; // cells above the number to the mouth (at least, wanted); beside it

// The formatted total as pixel cells in font pixels: { cells, w, h, desc: rows below the baseline }.
function digits(text) {
  const cells = new Map();
  let x = 0;
  for (const ch of text) {
    const g = ch === ',' ? COMMA : DIGITS[ch], gw = ch === ',' ? 1 : 3;
    [...g].forEach((m, y) => { for (let i = 0; i < gw; i++) if ((m >> (gw - 1 - i)) & 1) cells.set(`${x + i},${y}`, 'e'); });
    x += gw + 1;
  }
  return { cells, w: x - 1, h: 5, desc: text.includes(',') ? 1 : 0 };
}

const mouthRows = (p) => 1 + Math.max(...MOUTHS[p.mouth].map((c) => c[1]));
const eyeRise = (p) => 2 - Math.min(...EYES[p.eyes].map((c) => c[1])); // eye rows above its bottom row

// Where the number (k cells per font pixel, scaled by s) sits on pose p: its baseline a cell above
// the ground (a comma's tail may take half of that), centred on the belly. { cx, base, top } if it
// clears the sides by SIDE and the highest face the pose allows (eyes 3 rows under the top) by GAP.
function belly(p, art, k, s) {
  const rows = silhouette(p.W, p.H, p.lean, p.rip, p.ph), w = art.w * k * s;
  const base = -1 - Math.max(0, art.desc * k * s - 0.5), top = base - art.h * k * s;
  const low = rows.filter((r) => r.y >= -6 && r.y < -1), cx = low.reduce((a, r) => a + r.L + r.R, 0) / low.length / 2;
  if (top < -p.H + 4 + eyeRise(p) + mouthRows(p) + GAP) return null;
  const clear = rows.every((r) => r.y < Math.floor(top) || r.y >= base || (r.L + SIDE <= cx - w / 2 && cx + w / 2 <= r.R - SIDE));
  return clear ? { cx, base, top } : null;
}

export function slime({ total = 0, recent = 0 } = {}) {
  total = Math.max(0, Math.floor(Number.isFinite(+total) ? +total : 0));
  recent = Math.max(0, Math.floor(Number(recent) || 0));
  const bits = Math.min(recent, 8);
  const poses = { ...POSES };
  SWELL.forEach((p, i) => { poses['swell' + i] = p; });
  REFORM.forEach((p, i) => { if (typeof p !== 'string') poses['reform' + i] = p; });

  // Per tick: what the strip shows ({ pose, y } | { frame } | {}), and the glide's spline keys.
  const ticks = [], X = [], Y = [];
  for (let t = 0; t < N; t++) {
    if (!bits || t < INFLATE) { // hop left from x 0, then back right from x -3
      const k = t % 10, s = Math.floor(t / 10) % 2 ? 1 : -1, x0 = s < 0 ? 0 : -3;
      let [name, y] = BEAT[k];
      if (name === 'n' || (name === 'st' && k < 9)) name += s;
      if ((k === 1 || k === 2) && ((t >= 10 && t < 20) || (t >= 60 && t < 70))) name += '_'; // blink
      ticks.push({ pose: name, y });
      if (k === 0) { key(X, t, x0); key(Y, t, '0 0'); }
      if (k === 3) key(Y, t, '0 0', 'up');
      if (k === 4) key(X, t, x0, 'io');
      if (k === 6) key(Y, t, `0 ${-HOP}`, 'down');
      if (k === 8) key(X, t, x0 + 3 * s);
    } else if (t < POP) {
      ticks.push({ pose: 'swell' + Math.floor((t - INFLATE) / 3), y: 0 });
      key(X, t, -3 + (t % 2 ? TREMBLE : -TREMBLE), 'io');
      if (t === INFLATE) key(Y, t, '0 0');
    } else if (t < RIM) {
      ticks.push(t === POP ? { frame: 'splat' } : t === POP + 1 ? { frame: 'drops' } : {});
      if (t === POP || t === RIM - 1) key(X, t, -3);
    } else {
      const p = REFORM[t - RIM];
      ticks.push({ pose: typeof p === 'string' ? p : 'reform' + (t - RIM), y: 0 });
      if (t === RIM) key(X, t, 0);
    }
  }

  // The total on the belly, inside the body's glide: the largest whole-pixel size, up to one
  // sprite cell, that fits every dance pose (finer only past that), at the inflate's scale and
  // the reform's pulse, smaller only where a pose has no room; hidden while the body is apart.
  // Each pose lifts its face clear of the number it carries.
  const art = digits(BigInt(total).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  const fitsAll = (k) => Object.values(POSES).every((p) => belly(p, art, k, 1) !== null);
  let px = [1, 0.75, 0.5, 0.25].find(fitsAll);
  if (!px) { let lo = 0, hi = 0.25; for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (fitsAll(m)) lo = m; else hi = m; } px = Math.floor(lo * 1e4) / 1e4; }
  const spot = [], size = [], face = {};
  ticks.forEach(({ pose: name }, t) => {
    const p = poses[name];
    let s = !p || (bits && t >= RIM && t < SHOWN) ? 0 // the body is apart
      : bits && t >= INFLATE && t < POP ? GROW[Math.floor((t - INFLATE) / 3)]
      : bits ? PULSE.findLast((q) => q[0] <= t)[1] : 1, b = null;
    while (s > 0.2 && !(b = belly(p, art, px, s))) s = Math.round(s * 100 - 2) / 100;
    if (!b) { spot.push(`0 ${HIDE}`); size.push(size.at(-1)); return; }
    const half = (art.w * px * s) / 2, x = Math.round((b.cx - half) * 4) / 4 + half; // left edge on a whole pixel
    spot.push(`${+x.toFixed(4)} ${+b.base.toFixed(4)}`);
    size.push(s);
    const high = -p.H + 3 + eyeRise(p); // the highest eye row: three rows under the top
    face[name] = Math.min(face[name] ?? 0, Math.max(high, Math.floor(b.top - ROOM) - 1 - mouthRows(p)));
  });
  for (const name in face) poses[name] = { ...poses[name], face: face[name] };
  const num = ink();
  runs(art.cells, 0, num);
  const numPath = num.svg(() => `id="total" stroke="#243040" transform="scale(${px})translate(${-art.w / 2} ${-art.h})"`);
  const onBelly = `<g>${track(spot)}${size.some((s) => s !== 1) ? `<g>${track(size, 'scale')}${numPath}</g>` : numPath}</g>`;

  // Main strip: each distinct frame once, in order of first use; the track selects it per tick.
  const paint = ink(), index = new Map();
  const frameOf = (name, draw) => {
    if (!index.has(name)) { index.set(name, index.size); draw(index.get(name) * STEP, paint); }
    return index.get(name);
  };
  const FRAMES = {
    splat: (dy, out) => splatFrame(BIG.W, BIG.H, dy, out),
    drops: (dy, out) => splatFrame(BIG.W, BIG.H, dy, out, true),
  };
  const main = ticks.map((k) => {
    const draw = k.pose ? (dy, out) => slimeFrame(poses[k.pose], dy, out) : FRAMES[k.frame];
    return draw ? `0 ${-STEP * frameOf(k.pose || k.frame, draw)}` : `0 ${HIDE}`;
  });

  // Shadow strip: a two-line smudge, narrower while the slime is in the air.
  const widths = new Map();
  let shadows = '';
  const shadow = ticks.map((k) => {
    if (!k.pose) return `0 ${HIDE}`;
    const w = Math.max(8, Math.round(((poses[k.pose].W + 2) * (1 + k.y / 12)) / 4) * 4);
    if (!widths.has(w)) { shadows += `M${-w / 2} ${widths.size * STEP + 0.5}h${w}m-${w - 3} 1h${w - 6}`; widths.set(w, widths.size); }
    return `0 ${-STEP * widths.get(w)}`;
  });

  // Bits leave from the body's outline, land spread out and bounce, then hop onto the reform
  // blob's rim and sink in: drawn behind the main strip, they are swallowed by the blob.
  let defs = '', flock = '';
  if (bits) {
    defs = `<defs><g id="bit">${bitFrames(...(bits <= 4 ? [10, 7] : bits <= 6 ? [8, 6] : [7, 5]))}</g></defs>`;
    const span = Math.min(70, 24 + bits * 8); // 70: 16 px or more from the edges
    for (let i = 0; i < bits; i++) {
      const f = bits === 1 ? 0.8 : i / (bits - 1); // 0 leftmost .. 1 rightmost; a lone bit goes right
      const a = Math.PI * (0.9 - 0.8 * f), v = Math.sin(a), side = Math.sign(Math.cos(a));
      const sx = -3 + side * dome(BIG.W, v), sy = -BIG.H * v + 3; // start centred on the body outline
      const tx = bits === 1 ? 26 : Math.round(-span / 2 + span * f); // landing spot
      const d = Math.floor((bits - 1) / 2) - Math.min(i, bits - 1 - i); // 0 for the central bits
      const land = LAND + Math.round(d / 2), back = RETURN + d, rimAt = back + 4;
      const rim = (p, inset) => [side * dome(p.W - 2 * inset, v), Math.min(0, -(p.H - inset) * v + 3)];
      const [rx, ry] = rim(REFORM[rimAt - RIM], 0), [kx, ky] = rim(REFORM[rimAt + 1 - RIM], 3);
      const peak = 6 + 5 * (1 - Math.abs(2 * f - 1)) + (i % 2) * 2;
      const xy = [];
      for (let t = 0; t < N; t++) {
        let x, y, squash = false;
        if (t > POP && t <= land) {
          const u = (t - POP - 1) / (land - POP - 1);
          x = sx + (tx - sx) * (1 - (1 - u) ** 1.6); y = sy * (1 - u) - 4 * peak * u * (1 - u);
          squash = t === land;
        } else if (t > land && t < back) {
          const ph = (t - land - 1 + i * 2) % 5;
          x = tx; y = -[0, 2, 3, 2, 0][ph]; squash = ph === 0;
        } else if (t >= back && t <= rimAt) {
          const u = (t - back) / (rimAt - back);
          x = tx + (rx - tx) * u; y = ry * u - 4 * (7 + 3 * d) * u * (1 - u); squash = t === back; // outer bits leap higher
        } else if (t === rimAt + 1) {
          x = kx; y = ky; // sunk halfway into the next, bigger blob
        } else { xy.push('0 200'); continue; }
        xy.push(`${Math.round(x)} ${Math.round(y) - (squash ? STEP : 0)}`);
      }
      flock += `<g>${track(xy)}<use href="#bit"/></g>`;
    }
    flock = `<g class="f">${flock}</g>`;
  }

  let today = '';
  if (bits) {
    const rise = Array.from({ length: N }, (_, t) => t >= 66 && t < 92 ? `0 ${-4 * Math.min(3, Math.floor((t - 66) / 2))}` : '0 300');
    today = `<g>${track(rise)}<text class="g" x="180" y="30">+${recent} today</text></g>`;
  }

  const used = paint.colors();
  const css = [...PAINT].filter((c) => used.includes(c)).map((c) => `.${c}{${c > 'Z' ? 'fill' : 'stroke'}:${COLORS[c.toLowerCase()]}}`).join('') +
    '.S{stroke:#243040;stroke-opacity:.13}.f{color:#3b7a2a}' +
    // A halo in the page colour: invisible when the OS theme matches GitHub's, readable when not.
    'text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;text-anchor:middle;stroke:#fff;stroke-width:3px;stroke-linejoin:round;paint-order:stroke}' +
    '.t{font-size:16px;font-weight:600;fill:#243040}.g{font-size:15px;font-weight:700;fill:#3b7a2a}' +
    '@media (prefers-color-scheme:dark){text{stroke:#0d1117}.t{fill:#e4f1f4}.g{fill:#bdf86c}.S{stroke:#bdf86c;stroke-opacity:.18}.o{fill:#4f9a35}.O{stroke:#4f9a35}.f{color:#4f9a35}}';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240">` +
    `<title>${total} lessloc installs</title><style>${css}</style>${defs}` +
    `<g transform="scale(4)" fill="none" stroke-width="1" shape-rendering="crispEdges"><g transform="translate(45 44)">${flock}` +
    `<g>${glide(X)}<g>${track(shadow)}<path class="S" d="${shadows}"/></g>` +
    `<g>${glide(Y)}<g>${track(main)}${paint.svg((c) => `class="${c}"`)}</g>${onBelly}</g></g></g></g>` +
    `${today}<text class="t" x="180" y="216">install${total === 1 ? '' : 's'}</text></svg>`;
}
