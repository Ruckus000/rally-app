/**
 * The Rally mark, and every size the platforms ask for.
 *
 *   npm run icons
 *
 * The icon has a source, not just a binary. The mark is **Gather**: five wedges
 * on a 72° rotation closing on one core — separate people arriving at the same
 * point. It is pure geometry, so unlike the three-R stack it replaced it needs
 * no font and no outlining step; `SPEC` below is the whole drawing.
 *
 * Every number a designer would want to push lives in SPEC. Changing the wedge
 * or the core is one edit and one command, which is the point — an icon that
 * can only be revised in a drawing program stops being revised.
 *
 * Source: `Rally - Logo Spec.dc.html`, Claude Design project
 * 5c5ab54c-3afe-4abc-bcd1-8d26813e4697.
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');

/** Straight from `src/theme/tokens.ts`. The mark is not allowed its own palette. */
export const COLOR = {
  lime: '#C3F53C',
  ink: '#191E16',
  paper: '#F1F2EC',
  /** `lightColors.moss`. The core on a light ground. */
  olive: '#4B6A0B',
  /** `darkColors.textPrimary`. The dark launch screen's ink. */
  onDarkInk: '#EEF0E8',
};

export const SPEC = {
  /** The art is drawn on this square and scaled to whatever a platform wants. */
  canvas: 100,

  /** Everything rotates about the middle of that square. */
  center: 50,

  /**
   * One wedge. Base across the top, tip pointing at the core — and the tip is
   * skewed 7 units off the axis (57, not 50), which is the whole reason the
   * group reads as *arriving* rather than as a finished pinwheel. Straighten it
   * and the mark goes static.
   */
  wedge: 'M38 6 L62 6 L57 44 Z',

  /**
   * The same wedge, thickened, for sizes where the standard cut turns to lace.
   * Paired with `coreSmallR` and drawn in one colour.
   */
  wedgeSmall: 'M36 4 L64 4 L58 44 Z',

  /** Five of them. 72° apart is not a style choice, it is the mark. */
  angles: [0, 72, 144, 216, 288],

  /** Two-tone core: the one element that changes between colorways. */
  coreR: 13,

  /**
   * One-colour core. It grows, because with the wedges in the same ink as the
   * core the huddle has to *fuse* — at r13 in a single colour the join looks
   * like a printing error rather than a decision.
   */
  coreSolidR: 15,

  /** Below 22px, with `wedgeSmall`. */
  coreSmallR: 17,

  /**
   * Optical centring nudge, canvas units. Positive moves the art down/right.
   *
   * The mark is five-fold symmetric about (50, 50) but its *ink box* is not
   * centred there — a 5-fold shape has no mirror symmetry across the horizontal,
   * so the box works out to 91.109 × 86.650 centred on (50, 49.325). Drawn on
   * the raw viewBox the mark therefore sits 0.675 units low in every square
   * asset. Small, and visible once you know.
   */
  nudgeX: 0,
  nudgeY: 0.675,
};

/**
 * Where the ink actually reaches, for a given cut.
 *
 * Measured from the path's own corner points rather than assumed: the scale
 * factors below are expressed as "this fraction of the tile", and that is only
 * meaningful against the real box. Returns canvas units.
 */
export function inkBox(spec = SPEC, small = false) {
  const d = small ? spec.wedgeSmall : spec.wedge;
  const pts = [...d.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  const c = spec.center;
  const all = [];
  for (const a of spec.angles) {
    const r = (a * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    for (const [x, y] of pts) {
      const dx = x - c;
      const dy = y - c;
      all.push([c + dx * cos - dy * sin, c + dx * sin + dy * cos]);
    }
  }
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    maxRadius: Math.max(...all.map((p) => Math.hypot(p[0] - c, p[1] - c))),
  };
}

/**
 * The one rule the spec puts above the others: *the wedges always touch the
 * core*. Everything Rally claims is carried by that contact point, and it is a
 * property of two numbers — where the tip lands, and how big the core is — so
 * it can be checked before a single pixel is rendered.
 */
export function contact(spec = SPEC) {
  const c = spec.center;
  const tip = (d) => {
    const pts = [...d.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    return pts[pts.length - 1];
  };
  const reach = (d) => {
    const [x, y] = tip(d);
    return Math.hypot(x - c, y - c);
  };
  return [
    { cut: 'two-tone', reach: reach(spec.wedge), core: spec.coreR },
    { cut: 'one-colour', reach: reach(spec.wedge), core: spec.coreSolidR },
    { cut: 'small', reach: reach(spec.wedgeSmall), core: spec.coreSmallR },
  ].map((r) => ({ ...r, ok: r.reach < r.core }));
}

/**
 * The mark, as SVG.
 *
 * Note what is *not* here: no masks, no separation channel, no per-shape
 * notching. The three-R mark this replaced needed all of that, because three
 * letters that close together weld into one silhouette. Gather has the opposite
 * requirement — the wedges are *supposed* to meet the core, and at 30.5° of
 * span on a 72° pitch they have 41.5° of clear air from each other. There is
 * nothing to keep apart, so there is nothing to go wrong.
 *
 * `inkWidthFraction` scales the art so its measured ink box is that fraction of
 * the tile; leave it undefined to draw on the raw canvas frame, which is what
 * the launch screen renders and therefore what the splash art must match.
 */
export function markSvg({
  size = 1024,
  spec = SPEC,
  plate = 'none',
  wedgeFill = COLOR.ink,
  coreFill = COLOR.olive,
  coreR = spec.coreR,
  small = false,
  radius = 0,
  inkWidthFraction,
  bleed = 1,
  /** The core with no wedges yet — the launch screen's first frame. */
  coreOnly = false,
} = {}) {
  const s = spec.canvas;
  const c = spec.center;
  const d = small ? spec.wedgeSmall : spec.wedge;

  const k = inkWidthFraction ? (inkWidthFraction * s) / inkBox(spec, small).width : 1;
  // Nudge first, then scale about the centre — SVG applies these right to
  // left, so the rightmost runs first. Order is not cosmetic: nudged after
  // scaling, the correction stays a fixed distance while the error it corrects
  // shrinks with the art, and a scaled-down icon lands 0.675(1-k) units low.
  // Nudged before, the ink centre sits on the rotation centre and *then*
  // scales about it, so it is exactly centred at every k.
  const frame = `translate(${c} ${c}) scale(${k}) translate(${-c} ${-c}) translate(${spec.nudgeX} ${spec.nudgeY})`;

  const wedges = spec.angles
    .map((a) => `<path d="${d}" fill="${wedgeFill}" transform="rotate(${a} ${c} ${c})"/>`)
    .join('\n      ');

  const plateShape =
    plate === 'none'
      ? ''
      : radius
        ? `<rect width="${s}" height="${s}" rx="${radius / (1024 / s)}" fill="${plate}"/>`
        : `<rect x="${-bleed}" y="${-bleed}" width="${s + bleed * 2}" height="${s + bleed * 2}" fill="${plate}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
  ${plateShape}
  <g transform="${frame}">
      ${coreOnly ? '' : wedges}
      <circle cx="${c}" cy="${c}" r="${coreR}" fill="${coreFill}"/>
  </g>
</svg>`;
}

/**
 * The same mark, as data the app can draw.
 *
 * The launch screen shows this mark and then hands over to the real UI, so it
 * has to be the *same* mark — not a picture of it that drifts the first time
 * SPEC changes. The generator emits the geometry; `BootScreen` and `Logo`
 * render it with react-native-svg. One shape, one source.
 *
 * Geometry only. How the brand is *applied* — minimum sizes, lockup ratios,
 * clear space — lives in `src/components/Logo.tsx`, with the code that enforces
 * it. A generated file should hold what the generator knows.
 */
function markModule() {
  return `/**
 * The Rally mark, as geometry.
 *
 * GENERATED by scripts/make-icons.mjs — run \`npm run icons\` after changing
 * SPEC there. Editing this file by hand puts the launch screen and the app icon
 * out of step, which is the one thing having a generator was meant to prevent.
 *
 * Five wedges on a 72° rotation closing on one core. Pure geometry: nothing
 * here depends on a font being loaded, which matters, because the launch screen
 * is on screen precisely while the fonts are still loading.
 */

/** Both the viewBox width and height. The mark is drawn on a square. */
export const MARK_CANVAS = ${SPEC.canvas};

/** Everything rotates about this point, on both axes. */
export const MARK_CENTER = ${SPEC.center};

/** One wedge. Draw it once per angle below. */
export const MARK_WEDGE = '${SPEC.wedge}';

/** The thickened cut, for sizes where the standard one turns to lace. */
export const MARK_WEDGE_SMALL = '${SPEC.wedgeSmall}';

/** Five of them, 72° apart. The spacing is the mark. */
export const MARK_ANGLES: number[] = ${JSON.stringify(SPEC.angles)};

/** Core radius, two-tone — the one element that changes between colorways. */
export const MARK_CORE_R = ${SPEC.coreR};

/** Core radius for the one-colour cut, grown so the huddle fuses. */
export const MARK_CORE_R_SOLID = ${SPEC.coreSolidR};

/** Core radius for the small cut, paired with \`MARK_WEDGE_SMALL\`. */
export const MARK_CORE_R_SMALL = ${SPEC.coreSmallR};

/**
 * Optical centring nudge, canvas units. The mark is five-fold symmetric about
 * the centre but its ink box is not — 5-fold has no mirror across the
 * horizontal — so drawn on the raw frame it sits this far high.
 */
export const MARK_NUDGE_Y = ${SPEC.nudgeY};
`;
}

const png = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size, { fit: 'fill' }).png({ compressionLevel: 9 }).toBuffer();

async function write(name, buf) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), buf);
  console.log(`  ${name.padEnd(32)} ${(buf.length / 1024).toFixed(1)} kB`);
}

/**
 * How many separate islands of ink an asset contains.
 *
 * For this mark the answer is always **one**. That is not a formality — it is
 * the contact rule, measured in pixels rather than in arithmetic: a wedge that
 * stops short of the core shows up here as a sixth island, on the asset, after
 * rasterising, which is the only place a rounding error would ever appear.
 *
 * Alpha only. Colour-filtering would be worse than useless here: the olive core
 * `#4B6A0B` is (75, 106, 11) and passes any reasonable "is this dark ink" test,
 * so a filter that tried to count wedges separately would fold the core in with
 * them and cheerfully report success on a broken mark.
 */
async function inkIslands(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] > 128) ink[i] = 1;
  const seen = new Uint8Array(w * h);
  let islands = 0;
  for (let i = 0; i < w * h; i++) {
    if (!ink[i] || seen[i]) continue;
    let n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && ink[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && ink[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && ink[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && ink[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    // Anti-aliasing leaves specks; only real shapes are this big.
    if (n > 500) islands++;
  }
  return islands;
}

/**
 * How far the art departs from its own five-fold symmetry, as a fraction of the
 * ink.
 *
 * This is the check that earns its keep. An island count sees contact and
 * nothing else — it is equally happy with four wedges, with six, with 70°
 * spacing, and with the stretched mark the spec explicitly forbids. Rotating
 * the mark by 72° and comparing it with itself sees all of them, because every
 * one of those breaks the symmetry that *is* the mark.
 *
 * Two things this has to get right, both learned by getting them wrong:
 *
 * On a plated asset the alpha channel is the *tile*, not the mark — opaque
 * everywhere — and rotating a square by 72° compares its corners with nothing.
 * So where there is a plate, the mask is "differs from the plate colour".
 *
 * And it samples bilinearly rather than by nearest neighbour. The mark is five
 * long thin wedges, so its perimeter is enormous next to its area; a half-pixel
 * of rounding along that boundary alone reported ~8% asymmetry on art that is
 * symmetric by construction. Sub-pixel sampling puts it back under 1%, which
 * leaves the tolerance tight enough to still mean something.
 */
export async function fivefoldError(file, { plate, spec = SPEC } = {}) {
  const N = 512;
  const { data } = await sharp(file)
    .resize(N, N, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pl = plate
    ? [1, 3, 5].map((i) => parseInt(plate.slice(i, i + 2), 16))
    : null;

  // Mask in [0,1]: the mark, however it is distinguished from its ground.
  const mask = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    if (pl) {
      const d = Math.abs(data[o] - pl[0]) + Math.abs(data[o + 1] - pl[1]) + Math.abs(data[o + 2] - pl[2]);
      mask[i] = Math.min(1, d / 60);
    } else {
      mask[i] = data[o + 3] / 255;
    }
  }

  const at = (x, y) => {
    if (x < 0 || y < 0 || x > N - 1 || y > N - 1) return 0;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, N - 1);
    const y1 = Math.min(y0 + 1, N - 1);
    const fx = x - x0;
    const fy = y - y0;
    return (
      mask[y0 * N + x0] * (1 - fx) * (1 - fy) +
      mask[y0 * N + x1] * fx * (1 - fy) +
      mask[y1 * N + x0] * (1 - fx) * fy +
      mask[y1 * N + x1] * fx * fy
    );
  };

  // The art is nudged off the raster centre by the same amount it is nudged on
  // the canvas, so rotate about where the mark actually turns.
  const cx = (spec.center / spec.canvas) * N;
  const cy = ((spec.center + spec.nudgeY) / spec.canvas) * N;
  const r = (72 * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  let ink = 0;
  let diff = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const a = mask[y * N + x];
      const dx = x - cx;
      const dy = y - cy;
      const b = at(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
      ink += a;
      diff += Math.abs(a - b);
    }
  }
  return ink ? diff / ink : 1;
}

/** The colour at the very centre — which is the core, on every asset. */
async function coreColor(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // The core is centred on the nudged centre, not the raster middle.
  const x = Math.round((SPEC.center / SPEC.canvas) * info.width);
  const y = Math.round(((SPEC.center + SPEC.nudgeY) / SPEC.canvas) * info.height);
  const o = (y * info.width + x) * 4;
  return '#' + [data[o], data[o + 1], data[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** The furthest any ink sits from the centre, against Android's safe circles. */
async function safeCircle(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const c = info.width / 2;
  let max = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 128) {
        const r = Math.hypot(x - c, y - c);
        if (r > max) max = r;
      }
    }
  }
  return { max, mask72: info.width * 0.333, mask66: info.width * 0.3056 };
}

/**
 * The app icon keeps the lime plate — a deliberate deviation from the identity
 * spec's app-icon row, which asks for an ink tile. See
 * `design-reference/DEVIATIONS.md`.
 */
const ICON_INK_WIDTH = 0.58;

/**
 * Everything on the lime plate is the one-colour cut, and that follows from
 * keeping the plate.
 *
 * The spec's two-tone core is olive `#4B6A0B`, which it only ever puts on bone
 * or white. On lime it is about 1.9:1 — at 120px it is a smudge and at 60px,
 * which is the size a home screen actually shows, it is gone: the mark
 * degrades into a one-colour huddle by accident. The spec already has a cut for
 * being one colour on purpose, with the core grown to r15 so the shape fuses
 * rather than looking like a printing fault, and it is unambiguously stronger
 * at every size an icon is judged at. Two-tone stays on the splash art, where
 * the ground is bone or ink and the colorway works as drawn.
 *
 * See `design-reference/DEVIATIONS.md`.
 */
const ON_LIME = { wedgeFill: COLOR.ink, coreFill: COLOR.ink, coreR: SPEC.coreSolidR };

/**
 * The Android foreground cannot use the icon's 0.58.
 *
 * An adaptive icon's foreground is masked to roughly the middle 66%, and at
 * 0.58 the ink reaches 0.2903 of the width against a 0.3056 limit — a 5%
 * margin, which is the same non-margin the previous mark was caught by when
 * 0.56 "fitted by a single pixel". At 0.52 the ink reaches 0.2603 and clears
 * Google's stricter 66dp circle by 15%.
 */
const ANDROID_INK_WIDTH = 0.52;

async function main() {
  console.log('Rally mark — Gather: five wedges, 72° apart, closing on one core.\n');

  // Contact first, because it is arithmetic and it gates everything: no point
  // rendering seven assets from a mark whose wedges do not reach.
  let bad = 0;
  console.log('The wedges reach the core:');
  for (const c of contact()) {
    if (!c.ok) bad++;
    console.log(
      `  ${c.cut.padEnd(32)} tip at ${c.reach.toFixed(2)} into r${c.core} ${c.ok ? '' : '← DETACHED'}`,
    );
  }
  if (bad) {
    console.error('\nThe mark is broken at the source. Nothing was written.');
    process.exitCode = 1;
    return;
  }
  console.log();

  // iOS has no adaptive layer and masks its own corners, so this one is drawn
  // edge to edge and lets the platform round it.
  await write(
    'icon.png',
    await png(markSvg({ plate: COLOR.lime, ...ON_LIME, inkWidthFraction: ICON_INK_WIDTH }), 1024),
  );

  // The splash is the core alone — and that is the load-bearing decision on
  // this screen, so it is worth the paragraph.
  //
  // The OS paints this before any JavaScript exists, and `BootScreen` then
  // draws the same thing so the handover is invisible. That is what the boot
  // screen is *for*. It also means an entrance animation cannot be seen: by
  // the time the splash lifts, a 500ms arrival is long over. Filmed, the mark
  // was already complete in the boot screen's first visible frame — and had
  // been for the three-R mark before it, which is why nobody noticed.
  //
  // Starting the arrival on reveal instead would make the mark visibly
  // disassemble and rebuild, which is precisely the flaw the boot screen was
  // written to fix. So the splash shows the core, `BootScreen` starts from
  // exactly that image, and the wedges arrive onto it once the splash has
  // lifted. The handover stays invisible and the choreography becomes
  // something you can actually watch.
  //
  // It does invert the spec's "then the core lands" — see
  // `design-reference/DEVIATIONS.md`.
  //
  // No `inkWidthFraction`: drawn on the raw canvas frame, which is exactly the
  // frame `BootScreen` renders (`viewBox="0 0 100 100"` at `MARK_WIDTH`).
  // Matching by construction beats a scale factor somebody has to keep in step.
  //
  // Two of them, since dark mode: `app.json` names one splash per scheme, and
  // they cannot share art. Olive on paper, lime on `#070A06` — olive there is
  // about 1.2:1, a hole where the core should be.
  await write('splash-icon.png', await png(markSvg({ coreOnly: true, coreFill: COLOR.olive }), 1024));
  await write(
    'splash-icon-dark.png',
    await png(markSvg({ coreOnly: true, coreFill: COLOR.lime }), 1024),
  );

  // Drawn over the lime background layer, so it takes the same cut as the iOS
  // tile for the same reason.
  await write(
    'android-icon-foreground.png',
    await png(markSvg({ ...ON_LIME, inkWidthFraction: ANDROID_INK_WIDTH }), 1024),
  );
  await write(
    'android-icon-background.png',
    await png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="${COLOR.lime}"/></svg>`, 1024),
  );
  // Themed icons are a silhouette: the launcher recolours by alpha, so a
  // two-tone core comes back invisible. This is the one-colour cut, which is
  // what that cut exists for.
  await write(
    'android-icon-monochrome.png',
    await png(
      markSvg({
        wedgeFill: '#000000',
        coreFill: '#000000',
        coreR: SPEC.coreSolidR,
        inkWidthFraction: ANDROID_INK_WIDTH,
      }),
      1024,
    ),
  );

  // The spec sends the favicon to the one-colour cut: at tab size the two-tone
  // core is three pixels of olive and reads as a smudge.
  await write(
    'favicon.png',
    await png(
      markSvg({ plate: COLOR.lime, ...ON_LIME, inkWidthFraction: ICON_INK_WIDTH, radius: 180 }),
      96,
    ),
  );

  const mod = join(ROOT, 'src/theme/mark.ts');
  writeFileSync(mod, markModule());
  console.log(`  ${'src/theme/mark.ts'.padEnd(32)} geometry for the launch screen`);

  // One island, on every asset: the pixel-level statement of the contact rule.
  // A wedge that pulls away from the core is a sixth island here.
  console.log('\nThe huddle is one connected shape:');
  for (const name of [
    'icon.png',
    'splash-icon.png',
    'splash-icon-dark.png',
    'android-icon-foreground.png',
    'android-icon-monochrome.png',
    'favicon.png',
  ]) {
    const n = await inkIslands(join(OUT, name));
    const ok = n === 1;
    if (!ok) bad++;
    console.log(`  ${name.padEnd(32)} ${n} ${n === 1 ? 'island ' : 'islands'} ${ok ? '' : '← BROKEN'}`);
  }

  // Symmetry is a property of the geometry, not of any one rasterisation, so it
  // is checked once on a canonical full-frame render rather than per asset.
  // Measured on the shipped assets instead, plate masking and the scaled-down
  // art push the floor from 2.05% to 3.6% and the 96px favicon to 18%, which
  // would crowd out the faults worth catching.
  //
  // Calibration, so the tolerance is a number with a reason rather than a
  // round one: correct art scores 2.05%; one wedge moved by a single degree
  // scores 4.43%; by five degrees 18.9%; a missing wedge 40%; a sixth wedge
  // 74%; the stretch the spec forbids 17% at 1.05x and 56% at 1.2x. 3.5% sits
  // in the gap with room on both sides.
  const sym = await (async () => {
    const probe = join(OUT, '.symmetry-probe.png');
    writeFileSync(probe, await png(markSvg({ wedgeFill: COLOR.ink, coreFill: COLOR.olive }), 1024));
    const e = await fivefoldError(probe);
    rmSync(probe);
    return e;
  })();
  const symOk = sym < 0.035;
  if (!symOk) bad++;
  console.log(
    `\n  five-fold symmetry               ${(sym * 100).toFixed(2)}% off ${symOk ? '' : '← ASYMMETRIC'}`,
  );

  // Lime is never the wedges. Sampling the core is how that stays true.
  console.log('\nThe core is the right colour:');
  for (const [name, want] of [
    ['icon.png', COLOR.ink],
    ['splash-icon.png', COLOR.olive],
    ['splash-icon-dark.png', COLOR.lime],
    ['favicon.png', COLOR.ink],
  ]) {
    const got = await coreColor(join(OUT, name));
    const ok = got === want.toUpperCase();
    if (!ok) bad++;
    console.log(`  ${name.padEnd(32)} ${got} ${ok ? '' : `← want ${want.toUpperCase()}`}`);
  }

  const fit = await safeCircle(join(OUT, 'android-icon-foreground.png'));
  const fits = fit.max <= fit.mask66;
  if (!fits) bad++;
  console.log(
    `\n  android safe circle              ink reaches ${fit.max.toFixed(0)} of ${fit.mask66.toFixed(0)} ${fits ? '' : '← CLIPPED'}`,
  );

  if (bad) {
    console.error(`\n${bad} problem(s). The mark is broken — do not ship these.`);
    process.exitCode = 1;
  }

  console.log('\nSource: scripts/make-icons.mjs — edit SPEC and re-run.');
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
