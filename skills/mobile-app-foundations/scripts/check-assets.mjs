#!/usr/bin/env node
// check-assets.mjs — checks app icons and splash images against the sizing and masks that
// Expo prebuild, Android and iOS actually apply, so "fine in Expo Go, cropped/oversized on the
// phone" is caught before a build. Zero dependencies (Node >= 18).
//
//   node check-assets.mjs [projectDir] [--preview <dir>]
//       Expo project: reads the resolved config (app.json / app.config.js) and checks every
//       icon, adaptive-icon layer, splash image (light + dark) and notification icon it names.
//
//   node check-assets.mjs --file <png> --role <role> [--image-width <dp>] [--bg <#hex>] [--preview <dir>]
//       One file (bare React Native, or a file you are about to use).
//       roles: ios-icon | ios-icon-dark | adaptive-foreground | adaptive-monochrome |
//              adaptive-background | legacy-android-icon | splash | notification-icon
//       For react-native-bootsplash pass --image-width = your --logo-width.
//
//   node check-assets.mjs --make <logo.png> --out <dir> [--bg <#hex>] [--dark-bg <#hex>] [--preview <dir>]
//       Generates a correct set from ONE transparent logo: icon.png (iOS, opaque), icon-dark.png,
//       adaptive-icon.png (logo inside the safe circle), monochrome-icon.png, splash-icon.png
//       (cropped to the logo's circle), notification-icon.png — then checks them and prints the
//       app.json snippet with a safe imageWidth.
//
//   --preview <dir> writes PNGs that simulate what the launcher / splash will really show
//   (circle, squircle and rounded-square masks; the 192 dp splash circle). Open them to look.
//
// Exit code 1 when any check FAILS, so it can gate a build or CI step.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

// ── Geometry the platforms really apply ────────────────────────────────────────────────────────
// Android adaptive icon: 108 dp layers; launchers show at most the centre 72 dp (circle mask on
// Pixel); only the centre 66 dp circle is guaranteed never to be clipped by any mask or motion.
const ADAPTIVE_SAFE = 66 / 108; // 0.611 of the half-canvas radius
const ADAPTIVE_VISIBLE = 72 / 108; // 0.667
// Android 12+ SplashScreen API (also used below 12 through androidx core-splashscreen, which Expo
// uses): icon area 288 dp, visible only inside a 192 dp circle. Expo draws the logo `contain`-ed
// into an imageWidth x imageWidth dp square centred on that 288 dp canvas. iOS draws the same
// square at imageWidth pt with no mask.
const SPLASH_CANVAS_DP = 288;
const SPLASH_CIRCLE_R_DP = 96;
// Defaults when imageWidth is not set (read from @expo/prebuild-config 54.x/55.x; re-detected
// from the installed package below when possible). The legacy top-level "splash" key is different:
// Android 200 dp, and iOS shows the image full-screen.
const DEFAULT_IMAGE_WIDTH = { android: 100, ios: 100, legacyAndroid: 200 };

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = { dir: process.cwd(), file: null, role: null, imageWidth: null, bg: null, darkBg: null, preview: null, make: null, out: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--file') opt.file = argv[++i];
  else if (a === '--role') opt.role = argv[++i];
  else if (a === '--image-width') opt.imageWidth = Number(argv[++i]);
  else if (a === '--bg') opt.bg = argv[++i];
  else if (a === '--preview') opt.preview = argv[++i];
  else if (a === '--make') opt.make = argv[++i];
  else if (a === '--out') opt.out = argv[++i];
  else if (a === '--dark-bg') opt.darkBg = argv[++i];
  else if (a === '-h' || a === '--help') {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 25).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  } else opt.dir = path.resolve(a);
}

const ICON = { pass: '✅', warn: '⚠️ ', fail: '❌', info: 'ℹ️ ' };
let fails = 0;
let warns = 0;

// ── PNG decode / encode ────────────────────────────────────────────────────────────────────────
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.length < 8 || sig.some((b, i) => buf[i] !== b)) throw new Error('not a PNG file (convert it to PNG)');
  let off = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') ihdr = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], ctype: body[9], interlace: body[12] };
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG has no IHDR chunk');
  const { width, height, depth, ctype, interlace } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`unsupported PNG colour type ${ctype}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const data = Buffer.alloc(width * height * 4);
  const bitsPP = channels * depth;
  const bpp = Math.max(1, bitsPP >> 3);
  const maxV = (1 << depth) - 1;
  const to8 = (v) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / maxV));
  const sample = (line, idx) => {
    if (depth === 8) return line[idx];
    if (depth === 16) return line.readUInt16BE(idx * 2);
    const perByte = 8 / depth;
    const shift = 8 - depth * ((idx % perByte) + 1);
    return (line[Math.floor(idx / perByte)] >> shift) & maxV;
  };
  let pos = 0;
  for (const [x0, y0, dx, dy] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitsPP) / 8);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < ph; y++) {
      const ft = raw[pos++];
      const line = Buffer.from(raw.subarray(pos, pos + stride));
      pos += stride;
      unfilter(ft, line, prev, bpp);
      for (let x = 0; x < pw; x++) {
        const o = ((y0 + y * dy) * width + (x0 + x * dx)) * 4;
        let r, g, b, a = 255;
        if (ctype === 0) {
          const v = sample(line, x);
          r = g = b = to8(v);
          if (trns && trns.length >= 2 && v === trns.readUInt16BE(0)) a = 0;
        } else if (ctype === 2) {
          const s = [sample(line, x * 3), sample(line, x * 3 + 1), sample(line, x * 3 + 2)];
          [r, g, b] = s.map(to8);
          if (trns && trns.length >= 6 && s[0] === trns.readUInt16BE(0) && s[1] === trns.readUInt16BE(2) && s[2] === trns.readUInt16BE(4)) a = 0;
        } else if (ctype === 3) {
          const i = sample(line, x);
          r = palette[i * 3];
          g = palette[i * 3 + 1];
          b = palette[i * 3 + 2];
          if (trns && i < trns.length) a = trns[i];
        } else if (ctype === 4) {
          r = g = b = to8(sample(line, x * 2));
          a = to8(sample(line, x * 2 + 1));
        } else {
          [r, g, b, a] = [0, 1, 2, 3].map((c) => to8(sample(line, x * 4 + c)));
        }
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = a;
      }
      prev = line;
    }
  }
  return { width, height, data, hasAlphaChannel: ctype === 4 || ctype === 6 || !!trns };
}

function unfilter(ft, line, prev, bpp) {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let v = line[i];
    if (ft === 1) v += a;
    else if (ft === 2) v += b;
    else if (ft === 3) v += (a + b) >> 1;
    else if (ft === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    } else if (ft !== 0) throw new Error(`corrupt PNG (filter ${ft})`);
    line[i] = v & 255;
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function encodePNG({ width, height, data }) {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * row + 1, y * width * 4, (y + 1) * width * 4);
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── Pixel analysis ─────────────────────────────────────────────────────────────────────────────
// "Content" = pixels that are not background. Background is transparency when the corners are
// transparent, otherwise the corners' shared colour; busy full-bleed art counts as all content.
function analyze(img, centre = null) {
  const { width: W, height: H, data } = img;
  const at = (x, y) => (y * W + x) * 4;
  let transparentPx = 0;
  let translucentNonWhite = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 250) transparentPx++;
    if (data[i + 3] > 24 && Math.min(data[i], data[i + 1], data[i + 2]) < 200) translucentNonWhite++;
  }
  const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(([x, y]) => Array.from(data.subarray(at(x, y), at(x, y) + 4)));
  const cornersTransparent = corners.every((c) => c[3] < 24);
  const near = (c, d, t) => Math.max(Math.abs(c[0] - d[0]), Math.abs(c[1] - d[1]), Math.abs(c[2] - d[2])) <= t;
  let mode = 'full';
  let bg = null;
  if (cornersTransparent) mode = 'alpha';
  else if (corners.every((c) => c[3] > 230 && near(c, corners[0], 12))) {
    mode = 'color';
    bg = [0, 1, 2].map((k) => Math.round(corners.reduce((s, c) => s + c[k], 0) / 4));
  }
  const cx = centre ? centre[0] : W / 2, cy = centre ? centre[1] : H / 2;
  const maxPossible = Math.ceil(Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))) + 1;
  const hist = new Uint32Array(maxPossible + 1);
  let minX = W, minY = H, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = at(x, y);
      const a = data[o + 3];
      let isContent;
      if (mode === 'alpha') isContent = a > 24;
      else if (mode === 'color') isContent = a > 24 && !near([data[o], data[o + 1], data[o + 2]], bg, 28);
      else isContent = true;
      if (!isContent) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      hist[Math.floor(Math.hypot(x + 0.5 - cx, y + 0.5 - cy))]++;
    }
  }
  // Robust max radius: ignore a handful of stray pixels (export artefacts) at the very edge.
  const ignore = Math.max(4, Math.round(W * H * 0.00002));
  let beyond = 0;
  let maxR = 0;
  for (let r = maxPossible; r >= 0; r--) {
    beyond += hist[r];
    if (beyond > ignore) {
      maxR = r + 1;
      break;
    }
  }
  return {
    W, H, mode, bg, count,
    hasAlphaChannel: img.hasAlphaChannel,
    transparentPx,
    cornersTransparent,
    isSilhouette: translucentNonWhite === 0,
    bbox: count ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
    maxR, // px from canvas centre
    radiusFrac: maxR / (Math.min(W, H) / 2),
  };
}

// ── Checks per role ────────────────────────────────────────────────────────────────────────────
const pct = (f) => `${Math.round(f * 100)}%`;

function checkSquare(st, out, { want = 1024, min = 512 } = {}) {
  if (st.W !== st.H) out.push(['fail', `${st.W}×${st.H} is not square — icons and splash logos must be square canvases`]);
  else if (st.W < min) out.push(['fail', `${st.W}×${st.H} is too small (use ${want}×${want})`]);
  else if (st.W !== want) out.push(['warn', `${st.W}×${st.H} — works, but export ${want}×${want} so every generated size is sharp and predictable`]);
  else out.push(['pass', `${st.W}×${st.H} square`]);
}

function checkAdaptiveGeometry(st, out, what) {
  if (!st.count) return out.push(['fail', `${what} is completely empty`]);
  const f = st.radiusFrac;
  const scaleTo = Math.min(1, 0.58 / f);
  if (st.mode === 'full') {
    out.push(['fail', `${what} has no empty margin — the artwork runs to the edges, so every launcher mask crops it. Put the logo on a transparent canvas inside the centre 61% circle and move the colour to backgroundColor/backgroundImage`]);
  } else if (f > ADAPTIVE_VISIBLE) {
    out.push(['fail', `${what}: logo reaches ${pct(f)} of the canvas radius; circular launchers show only ${pct(ADAPTIVE_VISIBLE)} and guarantee ${pct(ADAPTIVE_SAFE)} → it WILL be cropped. Scale the logo to ~${pct(scaleTo)} of its current size (keep the 1024 canvas)`]);
  } else if (f > ADAPTIVE_SAFE) {
    out.push(['warn', `${what}: logo reaches ${pct(f)} of the canvas radius, outside the ${pct(ADAPTIVE_SAFE)} safe circle — edges can clip on some masks/animations. Scale to ~${pct(scaleTo)} of current size`]);
  } else if (f < 0.33) {
    out.push(['warn', `${what}: logo only reaches ${pct(f)} of the canvas radius — it will look tiny next to other apps (aim for 45–60%)`]);
  } else {
    out.push(['pass', `${what}: logo stays inside the safe zone (reaches ${pct(f)}, limit ${pct(ADAPTIVE_SAFE)})`]);
  }
}

function checkRole(role, st, ctx = {}) {
  const out = [];
  switch (role) {
    case 'ios-icon':
    case 'legacy-android-icon': {
      checkSquare(st, out);
      if (st.transparentPx > 0) {
        if (role === 'ios-icon')
          out.push(['warn', st.cornersTransparent
            ? 'transparent corners/padding — iOS needs a full-bleed opaque square (Expo flattens transparency onto WHITE, and iOS applies its own rounded mask). Do not pre-round corners or pad the icon'
            : `${st.transparentPx} transparent pixels — Expo flattens them onto white; App Store icons must be opaque`]);
        else out.push(['warn', 'transparent pixels — this square icon is used where no adaptive icon exists; prefer an opaque full-bleed square']);
      } else out.push(['pass', 'opaque, full-bleed']);
      if (role === 'legacy-android-icon') out.push(['warn', 'no android.adaptiveIcon configured — Android 8+ launchers shrink this square icon onto a white plate. Add adaptiveIcon.foregroundImage + backgroundColor (+ monochromeImage)']);
      break;
    }
    case 'ios-icon-dark':
      checkSquare(st, out);
      out.push(['info', 'dark iOS icon: transparent background is expected (iOS draws the dark backdrop)']);
      break;
    case 'adaptive-foreground':
      checkSquare(st, out, { want: 1024, min: 432 });
      if (st.mode === 'color') out.push(['warn', 'foreground is opaque (background baked in) — adaptiveIcon.backgroundColor will never show and parallax looks flat. Prefer a transparent foreground']);
      checkAdaptiveGeometry(st, out, 'foreground');
      break;
    case 'adaptive-monochrome':
      checkSquare(st, out, { want: 1024, min: 432 });
      if (!st.cornersTransparent) out.push(['fail', 'monochrome layer must be a silhouette on transparency — Android uses only its alpha, so an opaque image becomes a solid tinted square']);
      checkAdaptiveGeometry(st, out, 'monochrome');
      break;
    case 'adaptive-background':
      checkSquare(st, out, { want: 1024, min: 432 });
      out.push(st.transparentPx > 0 ? ['warn', 'background layer has transparency — it should be an opaque full-bleed square (or use backgroundColor instead)'] : ['pass', 'opaque background layer']);
      break;
    case 'notification-icon':
      if (!st.cornersTransparent || st.mode !== 'alpha') out.push(['fail', 'Android notification icons must be a white silhouette on transparency — an opaque image shows as a solid white/grey square']);
      else out.push(['pass', 'transparent silhouette']);
      if (!st.isSilhouette) out.push(['info', 'has coloured pixels — Android uses only the alpha channel; tint comes from the notification colour']);
      if (st.W !== 96 || st.H !== 96) out.push(['info', `${st.W}×${st.H} — 96×96 is the conventional size`]);
      break;
    case 'splash':
      checkSplash(st, out, ctx);
      break;
    default:
      throw new Error(`unknown role "${role}"`);
  }
  return out;
}

function checkSplash(st, out, { imageWidth, platform = 'both', explicitWidth = true, defaults = DEFAULT_IMAGE_WIDTH }) {
  const aspect = Math.max(st.W, st.H) / Math.min(st.W, st.H);
  if (st.H > st.W && aspect >= 1.6)
    out.push(['fail', `${st.W}×${st.H} looks like an old full-screen splash design. Android 12+ shows only a small icon inside a circle, so this gets shrunk and cropped. Use a logo-only square PNG + backgroundColor`]);
  else if (aspect > 1.01) out.push(['info', `${st.W}×${st.H} is not square — it is fitted (contain) into an imageWidth square, so its long side sets the size. A square canvas is easier to reason about`]);
  else out.push(['pass', `${st.W}×${st.H}`]);
  if (!st.count) return out.push(['fail', 'image is empty']);
  if (st.mode === 'full' || (st.mode === 'color' && st.bbox && st.bbox.w >= st.W - 2 && st.bbox.h >= st.H - 2))
    out.push(['warn', 'image has an opaque background — on Android the splash square is cropped to a circle, so a background baked into the image shows as a coloured disc. Use a transparent PNG and set backgroundColor']);
  const M = Math.max(st.W, st.H);
  const fill = st.bbox ? Math.max(st.bbox.w, st.bbox.h) / M : 0;
  if (fill < 0.6) out.push(['info', `logo fills only ${pct(fill)} of its canvas — the empty padding shrinks it on BOTH platforms; crop to the logo (~5% margin) and set the size with imageWidth instead`]);

  const widths = platform === 'both' ? { android: imageWidth?.android, ios: imageWidth?.ios } : { [platform]: imageWidth?.[platform] };
  if (!explicitWidth) out.push(['info', `imageWidth is not set — Expo uses ${defaults.android} dp (Android) / ${defaults.ios} pt (iOS). Set it explicitly so the size is a decision, not a default`]);
  if (widths.android != null) {
    const w = widths.android;
    const s = w / M; // dp per source px
    const rDp = st.maxR * s;
    const maxSafe = Math.min(SPLASH_CANVAS_DP, Math.floor((SPLASH_CIRCLE_R_DP * 0.95 * M) / Math.max(1, st.maxR)));
    if (w > SPLASH_CANVAS_DP) out.push(['fail', `Android imageWidth ${w} dp is bigger than the ${SPLASH_CANVAS_DP} dp splash icon canvas`]);
    if (rDp > SPLASH_CIRCLE_R_DP)
      out.push(['fail', `Android: at imageWidth ${w} dp the logo reaches ${Math.round(rDp)} dp from centre, but the splash icon is cropped to a ${SPLASH_CIRCLE_R_DP * 2} dp circle (radius ${SPLASH_CIRCLE_R_DP}) → oversized & cut off. Use imageWidth ≤ ${maxSafe} for this image`]);
    else if (rDp > SPLASH_CIRCLE_R_DP * 0.92)
      out.push(['warn', `Android: logo reaches ${Math.round(rDp)} dp of the ${SPLASH_CIRCLE_R_DP} dp circle radius — touching the edge. imageWidth ≤ ${maxSafe} leaves a margin`]);
    else out.push(['pass', `Android: logo stays inside the 192 dp circle at imageWidth ${w} dp (reaches ${Math.round(rDp)} dp of ${SPLASH_CIRCLE_R_DP}; max safe imageWidth ≈ ${maxSafe})`]);
  }
  if (widths.ios != null) {
    const w = widths.ios;
    const s = w / M;
    const vis = st.bbox ? [Math.round(st.bbox.w * s), Math.round(st.bbox.h * s)] : [0, 0];
    const big = Math.max(...vis);
    if (big < 60) out.push(['warn', `iOS: visible logo is only ~${vis[0]}×${vis[1]} pt at imageWidth ${w} — will look tiny`]);
    else if (big > 320) out.push(['warn', `iOS: visible logo is ~${vis[0]}×${vis[1]} pt — wider than many phones' safe width`]);
    else out.push(['pass', `iOS: visible logo ≈ ${vis[0]}×${vis[1]} pt at imageWidth ${w} (no mask on iOS)`]);
  }
  if (widths.android != null && widths.ios != null && widths.android !== widths.ios)
    out.push(['info', `imageWidth differs per platform (Android ${widths.android} dp, iOS ${widths.ios} pt) — the logo will not look the same size on both`]);
}

// ── Preview rendering ──────────────────────────────────────────────────────────────────────────
function blank(w, h, [r, g, b, a = 255]) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { width: w, height: h, data };
}
// Draw src scaled into the rect (dx, dy, dw, dh) of dst with alpha "over" compositing.
function nearest(src, fx, fy) {
  const o = (Math.floor(fy) * src.width + Math.floor(fx)) * 4;
  const sa = src.data[o + 3] / 255;
  return [src.data[o] * sa, src.data[o + 1] * sa, src.data[o + 2] * sa, sa];
}
// Premultiplied bilinear sample (smooth edges when a small logo is scaled up).
function bilinear(src, fx, fy) {
  const x = Math.min(src.width - 1, Math.max(0, fx - 0.5));
  const y = Math.min(src.height - 1, Math.max(0, fy - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(src.width - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const out = [0, 0, 0, 0];
  for (const [px, py, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]]) {
    const o = (py * src.width + px) * 4;
    const sa = (src.data[o + 3] / 255) * w;
    out[0] += src.data[o] * sa;
    out[1] += src.data[o + 1] * sa;
    out[2] += src.data[o + 2] * sa;
    out[3] += sa;
  }
  return out;
}
function drawImage(dst, src, dx, dy, dw, dh) {
  const k = Math.min(4, Math.max(1, Math.ceil(src.width / dw)));
  const upscale = dw > src.width * 1.01;
  for (let y = Math.max(0, Math.floor(dy)); y < Math.min(dst.height, Math.ceil(dy + dh)); y++) {
    for (let x = Math.max(0, Math.floor(dx)); x < Math.min(dst.width, Math.ceil(dx + dw)); x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          const fx = ((x + (i + 0.5) / k - dx) / dw) * src.width;
          const fy = ((y + (j + 0.5) / k - dy) / dh) * src.height;
          if (fx < 0 || fy < 0 || fx >= src.width || fy >= src.height) continue;
          const p = upscale ? bilinear(src, fx, fy) : nearest(src, fx, fy);
          r += p[0];
          g += p[1];
          b += p[2];
          a += p[3];
        }
      }
      const n = k * k;
      const sa = a / n;
      if (sa <= 0) continue;
      const o = (y * dst.width + x) * 4;
      const da = dst.data[o + 3] / 255;
      const outA = sa + da * (1 - sa);
      for (const [c, v] of [[0, r], [1, g], [2, b]]) dst.data[o + c] = Math.round((v / n + dst.data[o + c] * da * (1 - sa)) / outA);
      dst.data[o + 3] = Math.round(outA * 255);
    }
  }
}
// Keep pixels where inside(nx, ny) (coords normalised to -1..1), replace the rest with fill.
function mask(img, inside, fill) {
  const { width: W, height: H, data } = img;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let cov = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) if (inside(((x + ox) / W) * 2 - 1, ((y + oy) / H) * 2 - 1)) cov += 0.25;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) data[o + c] = Math.round(data[o + c] * cov + fill[c] * (1 - cov));
    }
  }
  return img;
}
function ring(img, r, color, widthPx = 2) {
  const { width: W, height: H, data } = img;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2);
      if (Math.abs(d - r) <= widthPx / 2) data.set(color, (y * W + x) * 4);
    }
  }
}
function hstack(tiles, gap = 24, bgc = [235, 235, 235, 255]) {
  const w = tiles.reduce((s, t) => s + t.width, 0) + gap * (tiles.length + 1);
  const h = Math.max(...tiles.map((t) => t.height)) + gap * 2;
  const out = blank(w, h, bgc);
  let x = gap;
  for (const t of tiles) {
    drawImage(out, t, x, gap, t.width, t.height);
    x += t.width + gap;
  }
  return out;
}
const MASKS = {
  circle: (x, y) => x * x + y * y <= 1,
  squircle: (x, y) => x ** 4 + y ** 4 <= 1,
  'rounded-square': (x, y) => {
    const r = 0.36;
    const ax = Math.max(0, Math.abs(x) - (1 - r));
    const ay = Math.max(0, Math.abs(y) - (1 - r));
    return ax * ax + ay * ay <= r * r;
  },
};

function previewAdaptive(fg, bgImg, bgColor, size = 216) {
  // Full 108-dp canvas rendered at `layer` px, then the centre 72 dp cropped and masked.
  const layer = Math.round((size * 108) / 72);
  const full = blank(layer, layer, bgColor ?? [255, 255, 255, 255]);
  if (bgImg) drawImage(full, bgImg, 0, 0, layer, layer);
  if (fg) drawImage(full, fg, 0, 0, layer, layer);
  const tiles = Object.values(MASKS).map((inside) => {
    const t = blank(size, size, [0, 0, 0, 0]);
    drawImage(t, full, -(layer - size) / 2, -(layer - size) / 2, layer, layer);
    return mask(t, inside, [0, 0, 0, 0]);
  });
  const guide = blank(layer, layer, [0, 0, 0, 0]);
  drawImage(guide, full, 0, 0, layer, layer);
  ring(guide, (layer * ADAPTIVE_VISIBLE) / 2, [255, 140, 0, 255]);
  ring(guide, (layer * ADAPTIVE_SAFE) / 2, [0, 170, 0, 255]);
  return hstack([...tiles, guide]);
}
function previewSplashAndroid(img, imageWidth, bgColor, scale = 2) {
  const c = SPLASH_CANVAS_DP * scale;
  const M = Math.max(img.width, img.height);
  const w = (img.width / M) * imageWidth * scale;
  const h = (img.height / M) * imageWidth * scale;
  const raw = blank(c, c, bgColor);
  drawImage(raw, img, (c - w) / 2, (c - h) / 2, w, h);
  const cut = blank(c, c, bgColor);
  drawImage(cut, raw, 0, 0, c, c);
  mask(cut, (x, y) => x * x + y * y <= (SPLASH_CIRCLE_R_DP / (SPLASH_CANVAS_DP / 2)) ** 2, bgColor);
  ring(raw, SPLASH_CIRCLE_R_DP * scale, [230, 30, 30, 255]);
  return hstack([cut, raw]);
}
function previewSplashIos(img, imageWidth, bgColor, scale = 2) {
  const c = 393 * scale; // iPhone 15/16 width in pt
  const M = Math.max(img.width, img.height);
  const w = (img.width / M) * imageWidth * scale;
  const h = (img.height / M) * imageWidth * scale;
  const t = blank(c, Math.round(c * 1.2), bgColor);
  drawImage(t, img, (c - w) / 2, (t.height - h) / 2, w, h);
  return hstack([t]);
}
function previewIosIcon(img, size = 256) {
  const t = blank(size, size, [255, 255, 255, 255]); // Expo flattens transparency onto white
  drawImage(t, img, 0, 0, size, size);
  return hstack([mask(t, (x, y) => {
    const r = 0.45;
    const ax = Math.max(0, Math.abs(x) - (1 - r));
    const ay = Math.max(0, Math.abs(y) - (1 - r));
    return ax * ax + ay * ay <= r * r;
  }, [0, 0, 0, 0])]);
}

// ── Colour helpers ─────────────────────────────────────────────────────────────────────────────
function parseColor(s, fallback = [255, 255, 255, 255]) {
  if (!s || typeof s !== 'string') return fallback;
  const named = { white: [255, 255, 255, 255], black: [0, 0, 0, 255], transparent: [0, 0, 0, 0] };
  if (named[s.toLowerCase()]) return named[s.toLowerCase()];
  let h = s.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return fallback;
  return [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255));
}

// ── Expo config ────────────────────────────────────────────────────────────────────────────────
async function loadExpoConfig(dir) {
  const notes = [];
  const req = createRequire(path.join(dir, 'package.json'));
  try {
    const { getConfig } = req('@expo/config');
    const { exp } = getConfig(dir, { skipSDKVersionRequirement: true });
    return { exp, source: 'resolved by @expo/config (app.json + app.config.*)', notes };
  } catch (e) {
    notes.push(`@expo/config could not resolve the full config (${String(e.message).split('\n')[0]}) — falling back`);
  }
  let exp = {};
  let source = 'none';
  const appJson = path.join(dir, 'app.json');
  if (fs.existsSync(appJson)) {
    const j = JSON.parse(fs.readFileSync(appJson, 'utf8'));
    exp = j.expo ?? j;
    source = 'app.json';
  }
  for (const name of ['app.config.js', 'app.config.cjs']) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    try {
      const mod = req(p);
      const fn = mod?.default ?? mod;
      let res = typeof fn === 'function' ? fn({ config: structuredClone(exp), projectRoot: dir }) : fn;
      if (res && typeof res.then === 'function') res = await res;
      exp = res?.expo ?? res ?? exp;
      source = `${name} (evaluated) on top of app.json`;
    } catch (e) {
      notes.push(`could not evaluate ${name}: ${String(e.message).split('\n')[0]} — using app.json values`);
    }
    break;
  }
  for (const name of ['app.config.ts', 'app.config.mjs']) if (fs.existsSync(path.join(dir, name)) && !source.includes('evaluated')) notes.push(`${name} exists but was not evaluated; values come from app.json only`);
  return { exp, source, notes };
}

// Read Expo's splash defaults from the installed package, so a future SDK change is noticed.
function detectExpoSplashGeometry(dir) {
  const base = path.join(dir, 'node_modules/@expo/prebuild-config/build/plugins/unversioned/expo-splash-screen');
  try {
    const a = fs.readFileSync(path.join(base, 'withAndroidSplashImages.js'), 'utf8');
    const g = fs.readFileSync(path.join(base, 'getAndroidSplashConfig.js'), 'utf8');
    const i = fs.readFileSync(path.join(base, 'withIosSplashAssets.js'), 'utf8');
    const canvas = Number(/canvasSize\s*=\s*(\d+)\s*\*/.exec(a)?.[1]);
    // first match = the plugin-props branch; the later literal = the legacy "splash" key branch
    const and = Number(/imageWidth:\s*splash\.imageWidth\s*\?\?\s*(\d+)/.exec(g)?.[1]);
    const legacyAndroid = Number(/imageWidth:\s*(\d+)/.exec(g)?.[1]) || DEFAULT_IMAGE_WIDTH.legacyAndroid;
    const ios = Number(/imageWidth:\s*splash\.imageWidth\s*\?\?\s*(\d+)/.exec(i)?.[1]);
    const version = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules/@expo/prebuild-config/package.json'), 'utf8')).version;
    if (canvas && and && ios) return { verified: canvas === SPLASH_CANVAS_DP, defaults: { android: and, ios, legacyAndroid }, version, canvas };
    return { verified: false, version, defaults: DEFAULT_IMAGE_WIDTH };
  } catch {
    return { verified: false, version: null, defaults: DEFAULT_IMAGE_WIDTH };
  }
}

function splashConfig(exp, defaults) {
  const entry = (exp.plugins ?? []).find((p) => (Array.isArray(p) ? p[0] : p) === 'expo-splash-screen');
  const props = Array.isArray(entry) ? entry[1] : null;
  if (props && Object.keys(props).length) {
    const { ios, android, ...common } = props;
    const merge = (o) => ({ ...common, ...(o ?? {}), dark: { ...(common.dark ?? {}), ...(o?.dark ?? {}) } });
    const iosLegacy = !!android && !ios && Object.keys(common).length === 0;
    const androidLegacy = !!ios && !android && Object.keys(common).length === 0;
    const a = merge(android);
    const i = merge(ios);
    return {
      mode: 'plugin',
      iosLegacy,
      androidLegacy,
      android: androidLegacy ? null : { ...a, width: a.imageWidth ?? defaults.android, explicit: a.imageWidth != null },
      ios: iosLegacy ? null : { ...i, width: i.imageWidth ?? defaults.ios, explicit: i.imageWidth != null },
    };
  }
  const legacy = { ...(exp.splash ?? {}), ...(exp.android?.splash ?? {}) };
  if (legacy.image) return { mode: 'legacy', android: { ...legacy, width: defaults.legacyAndroid, explicit: true }, ios: null };
  return { mode: 'none' };
}

// ── --make: generate a correct asset set from one logo ─────────────────────────────────────────
// Placement is driven by the logo's CONTENT (its bounding-box centre and farthest pixel), so a logo
// exported with uneven padding still ends up centred and inside every safe zone.
function placeLogo(canvas, logo, centre, rLogo, rTarget) {
  const s = rTarget / rLogo;
  drawImage(canvas, logo, canvas.width / 2 - centre[0] * s, canvas.height / 2 - centre[1] * s, logo.width * s, logo.height * s);
  return canvas;
}
function silhouette(img) {
  for (let i = 0; i < img.data.length; i += 4) img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
  return img;
}
function makeAssets() {
  const logoPath = path.resolve(opt.make);
  const out = path.resolve(opt.out ?? 'assets/generated');
  const logo = load(logoPath);
  const st0 = analyze(logo);
  if (!st0.count) throw new Error('logo is empty');
  if (st0.mode !== 'alpha') console.log(`${ICON.warn} the logo is not on a transparent background — export just the mark on transparency for clean results (its background is treated as part of the logo)`);
  const b = st0.bbox;
  const centre = [b.x + b.w / 2, b.y + b.h / 2];
  const rLogo = analyze(logo, centre).maxR; // farthest content pixel from the logo's own centre
  const bg = parseColor(opt.bg ?? '#ffffff');
  const C = 1024;
  fs.mkdirSync(out, { recursive: true });
  const files = {};
  const write = (name, img) => {
    files[name] = path.join(out, name);
    fs.writeFileSync(files[name], encodePNG(img));
  };
  // iOS: opaque full-bleed square, logo diameter ≈ 62% of the icon. Dark variant keeps transparency.
  write('icon.png', placeLogo(blank(C, C, [...bg.slice(0, 3), 255]), logo, centre, rLogo, 0.62 * (C / 2)));
  write('icon-dark.png', placeLogo(blank(C, C, [0, 0, 0, 0]), logo, centre, rLogo, 0.62 * (C / 2)));
  // Android adaptive: logo radius 56% of the half-canvas, inside the 61% safe circle.
  write('adaptive-icon.png', placeLogo(blank(C, C, [0, 0, 0, 0]), logo, centre, rLogo, 0.56 * (C / 2)));
  write('monochrome-icon.png', silhouette(placeLogo(blank(C, C, [0, 0, 0, 0]), logo, centre, rLogo, 0.56 * (C / 2))));
  // Splash: square canvas just around the logo's circle (4% margin), never upscaled past the source.
  const S = Math.min(C, Math.ceil(2 * rLogo * 1.04));
  const splash = placeLogo(blank(S, S, [0, 0, 0, 0]), logo, centre, rLogo, (S / 2) / 1.04);
  write('splash-icon.png', splash);
  // Notification (Android status bar): white silhouette, 96 px.
  write('notification-icon.png', silhouette(placeLogo(blank(96, 96, [0, 0, 0, 0]), logo, centre, rLogo, 0.8 * 48)));

  console.log(`Generated from ${path.relative(process.cwd(), logoPath)} → ${path.relative(process.cwd(), out) || out}`);
  const sst = analyze(splash);
  const maxSafe = Math.min(SPLASH_CANVAS_DP, Math.floor((SPLASH_CIRCLE_R_DP * 0.95 * S) / Math.max(1, sst.maxR)));
  const imageWidth = Math.min(180, maxSafe);
  safeCheck('[ios-icon]', files['icon.png'], (st) => checkRole('ios-icon', st));
  safeCheck('[adaptive-foreground]', files['adaptive-icon.png'], (st) => checkRole('adaptive-foreground', st));
  safeCheck('[adaptive-monochrome]', files['monochrome-icon.png'], (st) => checkRole('adaptive-monochrome', st));
  safeCheck('[splash]', files['splash-icon.png'], (st) => checkRole('splash', st, { imageWidth: { android: imageWidth, ios: imageWidth } }));
  safeCheck('[notification-icon]', files['notification-icon.png'], (st) => checkRole('notification-icon', st));
  if (opt.preview) {
    writePreview('ios-icon', previewIosIcon(load(files['icon.png'])));
    writePreview('android-adaptive-icon', previewAdaptive(load(files['adaptive-icon.png']), null, bg));
    writePreview('android-monochrome', previewAdaptive(load(files['monochrome-icon.png']), null, [40, 40, 40, 255]));
    writePreview('splash-android', previewSplashAndroid(splash, imageWidth, bg));
    writePreview('splash-ios', previewSplashIos(splash, imageWidth, bg));
  }
  const rel = (f) => './' + path.relative(opt.dir, f).split(path.sep).join('/');
  const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const darkBg = opt.darkBg ? hex(parseColor(opt.darkBg)) : null;
  const snippet = {
    backgroundColor: hex(bg),
    icon: rel(files['icon.png']),
    ios: { icon: { light: rel(files['icon.png']), dark: rel(files['icon-dark.png']) } },
    android: { adaptiveIcon: { foregroundImage: rel(files['adaptive-icon.png']), monochromeImage: rel(files['monochrome-icon.png']), backgroundColor: hex(bg) } },
    plugins: [
      ['expo-splash-screen', { image: rel(files['splash-icon.png']), imageWidth, resizeMode: 'contain', backgroundColor: hex(bg), ...(darkBg ? { dark: { backgroundColor: darkBg } } : {}) }],
      ['expo-notifications', { icon: rel(files['notification-icon.png']) }],
    ],
  };
  console.log(`\napp.json "expo" keys (paths relative to ${opt.dir}; merge, don't paste over existing plugins; drop expo-notifications if unused; give it your brand "color"):`);
  console.log(JSON.stringify(snippet, null, 2));
  console.log(`\nimageWidth ${imageWidth}: the logo stays inside Android's 192 dp splash circle up to ${maxSafe}. If the logo is dark, also add dark.image (a light version) for dark mode.`);
}

// ── Main ───────────────────────────────────────────────────────────────────────────────────────
function load(file) {
  return decodePNG(fs.readFileSync(file));
}
function report(title, file, results) {
  console.log(`\n${title}  ${file}`);
  for (const [lvl, msg] of results) {
    if (lvl === 'fail') fails++;
    if (lvl === 'warn') warns++;
    console.log(`  ${ICON[lvl]} ${msg}`);
  }
}
function safeCheck(title, file, fn) {
  if (!file) return null;
  if (!fs.existsSync(file)) {
    report(title, file, [['fail', 'file not found']]);
    return null;
  }
  try {
    const img = load(file);
    const st = analyze(img);
    report(title, `${path.relative(opt.file ? process.cwd() : opt.dir, file) || file}  (${st.W}×${st.H})`, fn(st));
    return img;
  } catch (e) {
    report(title, file, [['fail', e.message]]);
    return null;
  }
}
function writePreview(name, img) {
  if (!opt.preview || !img) return;
  fs.mkdirSync(opt.preview, { recursive: true });
  const p = path.join(opt.preview, `${name}.png`);
  fs.writeFileSync(p, encodePNG(img));
  console.log(`     preview → ${p}`);
}

async function main() {
  if (opt.make) {
    makeAssets();
  } else if (opt.file) {
    if (!opt.role) throw new Error('--file needs --role');
    const file = path.resolve(opt.file);
    const w = opt.imageWidth ?? DEFAULT_IMAGE_WIDTH.android;
    const img = safeCheck(`[${opt.role}]`, file, (st) => checkRole(opt.role, st, { imageWidth: { android: w, ios: w }, explicitWidth: opt.imageWidth != null }));
    const bgc = parseColor(opt.bg);
    if (img && opt.role === 'splash') {
      writePreview('splash-android', previewSplashAndroid(img, w, bgc));
      writePreview('splash-ios', previewSplashIos(img, w, bgc));
    } else if (img && opt.role === 'adaptive-foreground') writePreview('adaptive-icon', previewAdaptive(img, null, bgc));
    else if (img && opt.role === 'adaptive-monochrome') writePreview('adaptive-monochrome', previewAdaptive(img, null, [40, 40, 40, 255]));
    else if (img && opt.role === 'ios-icon') writePreview('ios-icon', previewIosIcon(img));
  } else {
    const dir = opt.dir;
    if (!fs.existsSync(path.join(dir, 'package.json'))) throw new Error(`${dir} has no package.json — pass an Expo project dir, or use --file/--role`);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (!deps.expo) {
      console.log('Not an Expo project (no "expo" dependency). For bare React Native, check each source PNG with --file/--role (see --help).');
      return;
    }
    const { exp, source, notes } = await loadExpoConfig(dir);
    const geo = detectExpoSplashGeometry(dir);
    const r = (p) => (typeof p === 'string' ? path.resolve(dir, p) : null);
    console.log(`Asset check — ${dir}\nConfig: ${source}`);
    for (const n of notes) console.log(`  ${ICON.info} ${n}`);
    console.log(geo.version
      ? `Expo splash geometry (@expo/prebuild-config ${geo.version}): ${geo.verified ? `Android logo = imageWidth dp centred in a ${SPLASH_CANVAS_DP} dp canvas, cropped to a 192 dp circle; iOS = imageWidth pt, no crop. Defaults if unset: Android ${geo.defaults.android}, iOS ${geo.defaults.ios}` : '⚠️ could not confirm the 288 dp canvas in this version — re-verify the splash maths against the installed plugin'}`
      : `${ICON.info} node_modules not installed — using SDK 54/55 splash geometry`);

    // iOS icon
    const iosIcon = exp.ios?.icon ?? exp.icon;
    if (typeof iosIcon === 'string' && iosIcon.endsWith('.icon')) report('iOS app icon', iosIcon, [['info', 'Icon Composer (.icon) file — layered Liquid Glass icon; check it in Icon Composer / Xcode 26 preview (not analysed here)']]);
    else if (iosIcon && typeof iosIcon === 'object') {
      const light = safeCheck('iOS app icon (light)', r(iosIcon.light ?? exp.icon), (st) => checkRole('ios-icon', st));
      if (light) writePreview('ios-icon', previewIosIcon(light));
      safeCheck('iOS app icon (dark)', r(iosIcon.dark), (st) => checkRole('ios-icon-dark', st));
      safeCheck('iOS app icon (tinted)', r(iosIcon.tinted), (st) => checkRole('ios-icon-dark', st));
    } else if (iosIcon) {
      const img = safeCheck('iOS app icon', r(iosIcon), (st) => checkRole('ios-icon', st));
      if (img) writePreview('ios-icon', previewIosIcon(img));
    } else report('iOS app icon', '(none)', [['fail', 'no "icon" / "ios.icon" configured']]);

    // Android icon
    const ai = exp.android?.adaptiveIcon;
    if (ai) {
      const fgPath = r(ai.foregroundImage ?? exp.icon);
      const fg = safeCheck('Android adaptive icon — foreground', fgPath, (st) => checkRole('adaptive-foreground', st));
      const bgImg = ai.backgroundImage ? safeCheck('Android adaptive icon — background image', r(ai.backgroundImage), (st) => checkRole('adaptive-background', st)) : null;
      if (!ai.backgroundImage && !ai.backgroundColor) report('Android adaptive icon — background', '(unset)', [['warn', 'no backgroundColor/backgroundImage — Expo defaults to white. Set it explicitly to your brand colour']]);
      const mono = ai.monochromeImage ? safeCheck('Android adaptive icon — monochrome', r(ai.monochromeImage), (st) => checkRole('adaptive-monochrome', st)) : null;
      if (!ai.monochromeImage) report('Android adaptive icon — monochrome', '(unset)', [['warn', 'no monochromeImage — Android 13+ "Themed icons" will show your normal coloured icon among tinted ones. Add a single-colour silhouette with the same safe-zone rules']]);
      if (fg) writePreview('android-adaptive-icon', previewAdaptive(fg, bgImg, parseColor(ai.backgroundColor)));
      if (mono) writePreview('android-monochrome', previewAdaptive(mono, null, [40, 40, 40, 255]));
    } else {
      safeCheck('Android icon (legacy, no adaptiveIcon)', r(exp.android?.icon ?? exp.icon), (st) => checkRole('legacy-android-icon', st));
    }

    // Splash
    const sp = splashConfig(exp, geo.defaults);
    if (sp.mode === 'none') report('Splash screen', '(none)', [['warn', 'no splash configured — add the expo-splash-screen plugin with image, imageWidth, backgroundColor (+ dark)']]);
    if (sp.mode === 'legacy') report('Splash screen config', 'top-level "splash"', [['warn', `uses the legacy top-level "splash" key (or a bare "expo-splash-screen" plugin string), not plugin options. iOS then shows the image FULL-SCREEN while Android shows a ${geo.defaults.legacyAndroid} dp logo cropped to a 192 dp circle — the two platforms look different. Move it into plugins: ["expo-splash-screen", { image, imageWidth, backgroundColor, dark }]`]]);
    if (sp.iosLegacy) report('Splash screen config', 'plugin', [['warn', 'plugin has only "android" options, so iOS falls back to the legacy full-screen splash. Put shared options at the top level of the plugin config']]);
    if (sp.androidLegacy) report('Splash screen config', 'plugin', [['warn', 'plugin has only "ios" options, so Android falls back to the legacy splash. Put shared options at the top level of the plugin config']]);
    for (const [plat, cfg] of [['android', sp.android], ['ios', sp.ios]]) {
      if (!cfg) continue;
      for (const theme of ['light', 'dark']) {
        const image = theme === 'light' ? cfg.image : cfg.dark?.image;
        const bgc = theme === 'light' ? cfg.backgroundColor : cfg.dark?.backgroundColor ?? cfg.backgroundColor;
        if (!image) {
          if (theme === 'light') report(`Splash (${plat})`, '(no image)', [['warn', 'no splash image — only the background colour will show']]);
          else if (exp.userInterfaceStyle === 'automatic' && !cfg.dark?.backgroundColor) report(`Splash (${plat}, dark)`, '(unset)', [['info', 'userInterfaceStyle is "automatic" but no dark splash — dark-mode users get the light splash. Add dark.backgroundColor (+ dark.image if the logo needs it)']]);
          continue;
        }
        const img = safeCheck(`Splash (${plat}, ${theme})`, r(image), (st) => checkRole('splash', st, { imageWidth: { [plat]: cfg.width }, platform: plat, explicitWidth: cfg.explicit, defaults: geo.defaults }));
        if (!bgc) report(`Splash (${plat}, ${theme})`, 'backgroundColor', [['warn', 'no backgroundColor — set it so the splash, root view and first screen share one colour (no white flash)']]);
        if (img) writePreview(`splash-${plat}-${theme}`, plat === 'android' ? previewSplashAndroid(img, cfg.width, parseColor(bgc)) : previewSplashIos(img, cfg.width, parseColor(bgc)));
      }
    }

    // Notification icon
    const notif = (exp.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-notifications')?.[1]?.icon ?? exp.notification?.icon;
    if (notif) safeCheck('Android notification icon', r(notif), (st) => checkRole('notification-icon', st));
  }
  console.log(`\n${fails} fail, ${warns} warn${fails ? ' — fix the ❌ items before building' : ''}`);
  console.log('Reminder: icon/splash changes need a native rebuild (npx expo prebuild --clean, then uninstall the old app first). Expo Go never shows them.');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(`check-assets: ${e.message}`);
  process.exit(2);
});
