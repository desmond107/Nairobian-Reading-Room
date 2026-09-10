/**
 * Rows of book spines, drawn rather than photographed.
 *
 * Three reasons, the same three as any generated art here: it stays sharp at
 * any viewport, it costs a few kilobytes instead of a few megabytes, and it can
 * be tuned by editing a number rather than reshooting a picture.
 *
 * The spine heights follow a slow wave. It is not meant to be noticed, but it
 * is the one place where the two halves of this app — a library, and a voice
 * reading aloud — are the same shape.
 */

/** Mulberry32: small, fast, identical across browsers for a given seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VIEW_W = 1600;
const VIEW_H = 420;
const BOARD_Y = 372;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Cloth and leather bindings, muted the way a shelf of old books actually is. */
const BINDINGS = [
  '#4e1f26', '#5a2a24', '#233c2c', '#1d2b44', '#6b4c2a',
  '#2a2622', '#6a5320', '#382132', '#1b3436', '#43301f',
  '#2f3a25', '#513122', '#24303f', '#5c3a2c', '#332c24',
];

const GILT = '#c8a44c';

/** Shade a hex colour towards black or white. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const to = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const mix = (c: number) => Math.round(c + (to - c) * k);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${fill}"/>`;
}

/**
 * One shelf: a run of spines standing on a board.
 *
 * `lit` fades the whole row towards the room's darkness, which is how the
 * shelves further back read as further back rather than merely smaller.
 */
export function shelfSvg(seed: number, lit = 1): string {
  const rand = rng(seed);
  let out = '';
  let x = -14;

  while (x < VIEW_W + 14) {
    const w = 15 + rand() * 32;

    // A gap where a book has been taken off the shelf.
    if (rand() > 0.955) {
      x += w * 0.7;
      continue;
    }

    // Height follows a slow wave, with enough jitter to stay a bookshelf.
    const wave =
      0.5 +
      0.24 * Math.sin((x / VIEW_W) * Math.PI * 3.1 + seed) +
      0.12 * Math.sin((x / VIEW_W) * Math.PI * 7.7 + seed * 1.9);
    const h = 118 + wave * 96 + rand() * 46;
    const y = BOARD_Y - h;

    // Some books lean, the way the last few on a shelf always do.
    const tilt = rand() > 0.94 ? (rand() - 0.5) * 9 : 0;
    const base = BINDINGS[Math.floor(rand() * BINDINGS.length)];
    const body = shade(base, -0.55 + lit * 0.55);

    let spine = rect(0, y, w, h, body);
    // Cylindrical shading: a catch of light on the left, shadow on the right.
    spine += rect(0, y, Math.max(1.4, w * 0.16), h, shade(body, 0.16));
    spine += rect(w - Math.max(1.6, w * 0.2), y, Math.max(1.6, w * 0.2), h, shade(body, -0.34));
    // Rounded head and tail, so the row does not read as a bar chart.
    spine += `<rect x="0" y="${r1(y)}" width="${r1(w)}" height="${r1(Math.min(7, w * 0.4))}" rx="${r1(Math.min(3.4, w * 0.2))}" fill="${shade(body, 0.08)}"/>`;

    if (w > 19) {
      // Gilt bands at head and tail, and a label block between them.
      const g = shade(GILT, -0.62 + lit * 0.62);
      spine += rect(w * 0.14, y + h * 0.13, w * 0.72, 1.8, g);
      spine += rect(w * 0.14, y + h * 0.19, w * 0.72, 1.2, g);
      if (rand() > 0.42) {
        spine += rect(w * 0.18, y + h * 0.3, w * 0.64, h * 0.15, shade(body, -0.3));
        spine += rect(w * 0.26, y + h * 0.35, w * 0.48, 1.6, g);
        spine += rect(w * 0.26, y + h * 0.4, w * 0.34, 1.4, g);
      }
      spine += rect(w * 0.14, y + h * 0.86, w * 0.72, 1.8, g);
      // Raised hubs, as a bound leather spine has.
      if (rand() > 0.7) {
        for (let b = 0; b < 3; b++) {
          spine += rect(0, y + h * (0.5 + b * 0.12), w, 2.4, shade(body, -0.28));
        }
      }
    }

    out += tilt
      ? `<g transform="translate(${r1(x)},0) rotate(${r1(tilt)},${r1(w / 2)},${BOARD_Y})">${spine}</g>`
      : `<g transform="translate(${r1(x)},0)">${spine}</g>`;
    x += w + 0.6 + rand() * 1.6;
  }

  // The board the books stand on, with a lit front edge.
  const board = shade('#3a2a1c', -0.55 + lit * 0.55);
  out += rect(0, BOARD_Y, VIEW_W, VIEW_H - BOARD_Y, board);
  out += rect(0, BOARD_Y, VIEW_W, 2.6, shade(board, 0.22));
  out += rect(0, BOARD_Y + 15, VIEW_W, VIEW_H - BOARD_Y - 15, shade(board, -0.35));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none">` +
    out +
    `</svg>`
  );
}

/** Ready-to-use CSS url() for a shelf at a given depth into the room. */
export function shelfUrl(seed: number, lit: number): string {
  return `url("data:image/svg+xml,${encodeURIComponent(shelfSvg(seed, lit))}")`;
}

/** The three rows, front to back, dimming as they recede. */
export const SHELVES = [
  { url: shelfUrl(21, 1), depth: 0, lit: 1 },
  { url: shelfUrl(137, 0.66), depth: -190, lit: 0.66 },
  { url: shelfUrl(409, 0.4), depth: -360, lit: 0.4 },
];
