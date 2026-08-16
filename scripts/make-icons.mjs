/**
 * The Rally mark, and every size the platforms ask for.
 *
 *   npm run icons
 *
 * The icon has a source, not just a binary. Three R's climbing a stack, cut
 * from Bricolage Grotesque ExtraBold — the same face the app sets its headlines
 * in, so the mark and the product are drawn with one pen. The glyph is
 * converted to outlines here rather than referenced as text: a logo that
 * depends on a font being installed is a logo that renders differently on every
 * machine that opens it.
 *
 * Every number a designer would want to push lives in SPEC. Changing the stack
 * offset is one edit and one command, which is the point — an icon that can only
 * be revised in a drawing program stops being revised.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = join(
  ROOT,
  'node_modules/@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf',
);
const OUT = join(ROOT, 'assets');

/** Straight from `src/theme/tokens.ts`. The mark is not allowed its own palette. */
export const COLOR = {
  lime: '#C3F53C',
  ink: '#191E16',
  paper: '#F1F2EC',
  planBg: '#12170F',
};

export const SPEC = {
  /** The art is drawn on this square and scaled to whatever a platform wants. */
  canvas: 1024,

  /** Cap height of one R as a fraction of the canvas. */
  letter: 0.36,

  /**
   * How far each R sits above and to the right of the one before it, as a
   * fraction of cap height.
   *
   * These two numbers are the whole design, and they were found by rendering
   * rather than by reasoning. Stacked nearly vertically — the first thing
   * "three R's stacked" suggests — the letters bury each other's legs and the
   * mark reads as one damaged R with debris behind it. The horizontal drift is
   * what buys each letter its own air; the rise is what keeps it a climb rather
   * than a word. At 0.70/0.68 the three stay individually legible down to about
   * 40px, which is the size an icon is actually judged at.
   */
  riseY: 0.7,
  driftX: 0.68,

  /**
   * The lime cut around each letter, in canvas units. Three black shapes this
   * close would merge into one silhouette at any size a person actually sees an
   * icon at. This gap is the only reason the stack reads as three.
   */
  gap: 20,

  /** Optical centring nudge, canvas units. Positive moves the art down/right. */
  nudgeX: 0,
  nudgeY: 0,
};

// `parse`, not `loadSync` — the latter is deprecated in opentype.js 1.3+ and
// returns undefined rather than throwing, which fails a good way downstream.
const font = opentype.parse(readFileSync(FONT).buffer);

/**
 * One R as outlines, normalised so its ink box is exactly `size` tall and its
 * top-left corner is the origin. opentype gives glyph metrics, not ink extents,
 * and the difference is the sidebearing — leave it in and the letter sits
 * visibly off-centre in a square.
 */
function letterR(size) {
  const probe = font.getPath('R', 0, 0, 1000);
  const b = probe.getBoundingBox();
  const scale = size / (b.y2 - b.y1);
  const path = font.getPath('R', 0, 0, 1000 * scale);
  const bb = path.getBoundingBox();
  return {
    d: path.toPathData(3),
    dx: -bb.x1,
    dy: -bb.y1,
    width: bb.x2 - bb.x1,
    height: bb.y2 - bb.y1,
  };
}

/** Where each letter sits, bottom of the stack first. */
export function letterPositions(spec = SPEC) {
  const s = spec.canvas;
  const cap = s * spec.letter;
  const R = letterR(cap);
  const stepY = cap * spec.riseY;
  const stepX = cap * spec.driftX;

  // The whole stack's ink box, so it can be centred as one object rather than
  // three. Centring each letter individually is what makes stacked marks list.
  const stackW = R.width + stepX * 2;
  const stackH = R.height + stepY * 2;
  const originX = (s - stackW) / 2 + spec.nudgeX;
  const originY = (s - stackH) / 2 + spec.nudgeY;

  return {
    R,
    letters: [0, 1, 2].map((i) => ({
      x: +(originX + R.dx + stepX * i).toFixed(2),
      y: +(originY + R.dy + stepY * (2 - i)).toFixed(2),
    })),
  };
}

/**
 * The three-R stack, as SVG.
 *
 * The channel between overlapping letters is cut out of the letter underneath
 * rather than painted over it. That distinction is the whole reason this
 * function looks the way it does.
 *
 * Painting a fat background-coloured copy of each letter before its ink is the
 * obvious way to get a separation channel, and it is what this did first. It
 * works on the lime plate and produces nothing at all on the Android
 * foreground, the themed icon and the splash art, because those are drawn on
 * transparency and `fill="none"` paints nothing. All three shipped as one fused
 * blob, and it was invisible in review: at a glance the shapes still read as
 * letters. A connected-component count is what caught it, and is what should be
 * used to check it — three ink components on every asset, or it is broken
 * again.
 *
 * Cut as a mask, the channel is a hole in the alpha, which is a hole on any
 * ground: the lime plate shows through on the icon, the background layer shows
 * through on Android, and the launcher's flat recolour of the themed icon keeps
 * all three letters because Android tints by alpha.
 */
export function markSvg({
  size = SPEC.canvas,
  bg = COLOR.lime,
  fg = COLOR.ink,
  spec = SPEC,
  bleed = 1,
  radius = 0,
  idPrefix = 'cut',
} = {}) {
  const s = spec.canvas;
  const { R, letters } = letterPositions(spec);

  // Letter i is notched by every letter drawn after it, which is every letter
  // sitting higher up the stack.
  const masks = letters.map((_, i) => {
    const above = letters
      .map((p, j) =>
        j > i
          ? `<g transform="translate(${p.x} ${p.y})"><path d="${R.d}" fill="#000" stroke="#000" stroke-width="${spec.gap * 2}" stroke-linejoin="round"/></g>`
          : '',
      )
      .join('');
    return `<mask id="${idPrefix}-${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${s}" height="${s}">
      <rect width="${s}" height="${s}" fill="#fff"/>${above}
    </mask>`;
  });

  // The mask goes on an outer group that carries no transform, and the
  // translate goes on an inner one. A `mask` resolves in its element's own user
  // space, so putting both on the same group applies the translate to the mask
  // content too — the cut-outs land at double the offset and swallow the mark.
  const painted = letters.map(
    (p, i) =>
      `<g mask="url(#${idPrefix}-${i})"><g transform="translate(${p.x} ${p.y})"><path d="${R.d}" fill="${fg}"/></g></g>`,
  );

  const bgShape =
    bg === 'none'
      ? ''
      : radius
        ? `<rect width="${s}" height="${s}" rx="${radius}" fill="${bg}"/>`
        : `<rect x="${-bleed}" y="${-bleed}" width="${s + bleed * 2}" height="${s + bleed * 2}" fill="${bg}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
  <defs>${masks.join('')}</defs>
  ${bgShape}
  ${painted.join('\n  ')}
</svg>`;
}

/**
 * The same stack with no plate behind it, drawn to fit Android's safe circle.
 * An adaptive icon's foreground gets masked to roughly the middle 66%, so art
 * that fills the square loses its corners on every launcher that crops a circle.
 */
/**
 * `scale` shrinks the letters, not the channel. Android masks the foreground to
 * a circle and the mark has to fit inside it: at 0.66 the ink reached radius
 * 400 against a 341 limit and the launcher shaved the top R's shoulder and the
 * bottom R's foot flat. 0.56 fits by a single pixel, which is not a margin;
 * 0.51 leaves about 9% and clears Google's stricter 66dp circle too.
 *
 * `gap` deliberately does not scale with it. The channel's job is optical at
 * whatever size the icon is finally drawn, so it is an absolute width — scaled
 * down alongside the letters it would land near half a device pixel on a themed
 * icon and close up entirely, which is the bug this whole function just had.
 */
export function foregroundSvg({ size = SPEC.canvas, fg = COLOR.ink, scale = 0.51 } = {}) {
  const s = SPEC.canvas;
  return markSvg({
    size,
    spec: { ...SPEC, letter: SPEC.letter * scale },
    fg,
    bg: 'none',
    idPrefix: `fg${Math.round(scale * 100)}`,
  });
}

/**
 * The same three letters, as data the app can draw.
 *
 * The launch screen shows this mark and then hands over to the real UI, so it
 * has to be the *same* mark — not a picture of it that drifts the first time
 * SPEC changes. The generator emits the geometry; `BootScreen` renders it with
 * react-native-svg. One shape, one source, two places it appears.
 */
function markModule() {
  const { R, letters } = letterPositions();

  return `/**
 * The Rally mark, as geometry.
 *
 * GENERATED by scripts/make-icons.mjs — run \`npm run icons\` after changing
 * SPEC there. Editing this file by hand puts the launch screen and the app icon
 * out of step, which is the one thing having a generator was meant to prevent.
 *
 * The R is Bricolage Grotesque ExtraBold converted to outlines, so nothing here
 * depends on a font being loaded — which matters, because the launch screen is
 * on screen precisely while the fonts are still loading.
 */

/** Both the viewBox width and height. The mark is drawn on a square. */
export const MARK_CANVAS = ${SPEC.canvas};

/** One R, as a path. Draw it three times at the offsets below. */
export const MARK_PATH = '${R.d}';

/** Bottom letter first, so a stagger animates as a climb. */
export const MARK_LETTERS: { x: number; y: number }[] = ${JSON.stringify(letters)};

/** The channel that keeps overlapping letters apart, in canvas units. */
export const MARK_GAP = ${SPEC.gap};
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
 * The mark is three letters and must therefore be three shapes. When the
 * channel between them fails they fuse into one, and the failure is close to
 * invisible by eye — the outline still looks like letters at a glance. This
 * counts them instead, which is how the fused assets were caught in the first
 * place. Run on every output, every time.
 */
async function inkIslands(file, opaqueOnly) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const isInk = opaqueOnly
      ? data[o + 3] > 128
      : data[o + 3] > 128 && data[o] < 120 && data[o + 1] < 120;
    if (isInk) ink[i] = 1;
  }
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
    // Anti-aliasing leaves specks; only real letters are this big.
    if (n > 500) islands++;
  }
  return islands;
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

async function main() {
  console.log('Rally mark — three R’s, Bricolage Grotesque ExtraBold, outlined.\n');

  // iOS has no adaptive layer and masks its own corners, so this one is drawn
  // edge to edge and lets the platform round it.
  await write('icon.png', await png(markSvg(), 1024));

  // The launch screen is paper, the same colour the app opens on, so the mark
  // is ink and carries no plate. A lime plate here would flash green and then
  // drop to paper the moment React took over.
  await write('splash-icon.png', await png(foregroundSvg({ fg: COLOR.ink, scale: 0.92 }), 1024));

  await write('android-icon-foreground.png', await png(foregroundSvg(), 1024));
  await write(
    'android-icon-background.png',
    await png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="${COLOR.lime}"/></svg>`, 1024),
  );
  // Themed icons are a silhouette: the launcher recolours it, so anything but a
  // single flat shape comes back as mud.
  await write('android-icon-monochrome.png', await png(foregroundSvg({ fg: '#000000' }), 1024));

  await write('favicon.png', await png(markSvg({ radius: 180 }), 96));

  const mod = join(ROOT, 'src/theme/mark.ts');
  writeFileSync(mod, markModule());
  console.log(`  ${'src/theme/mark.ts'.padEnd(32)} geometry for the launch screen`);

  console.log('\nChecking the letters are still three separate shapes:');
  let bad = 0;
  for (const [name, opaqueOnly] of [
    ['icon.png', false],
    ['splash-icon.png', true],
    ['android-icon-foreground.png', true],
    ['android-icon-monochrome.png', true],
    ['favicon.png', false],
  ]) {
    const n = await inkIslands(join(OUT, name), opaqueOnly);
    // The favicon is only 96px, where anti-aliasing legitimately bridges the
    // channel; it is the same artwork and is verified at full size above.
    const ok = n === 3 || name === 'favicon.png';
    if (!ok) bad++;
    console.log(`  ${name.padEnd(32)} ${n} ${n === 1 ? 'island ' : 'islands'} ${ok ? '' : '← FUSED'}`);
  }

  const fit = await safeCircle(join(OUT, 'android-icon-foreground.png'));
  const fits = fit.max <= fit.mask66;
  if (!fits) bad++;
  console.log(
    `  android safe circle              ink reaches ${fit.max.toFixed(0)} of ${fit.mask66.toFixed(0)} ${fits ? '' : '← CLIPPED'}`,
  );

  if (bad) {
    console.error(`\n${bad} problem(s). The mark is broken — do not ship these.`);
    process.exitCode = 1;
  }

  console.log('\nSource: scripts/make-icons.mjs — edit SPEC and re-run.');
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
