import { loadImage } from "canvas";
import { BACKGROUND } from "./theme.js";

// Draws each line's owner as a circular avatar just past that line's last
// point, so a busy chart can be read without cross-referencing the legend.
//
// Chart.js plugins are synchronous, so the images cannot be fetched during the
// draw. `loadAvatars()` resolves them first and hangs the result off each
// dataset; the plugin then only draws what is already there. A dataset with no
// avatar — a Wordle player the upstream bot never resolved to a Discord
// account, a failed fetch — simply doesn't get one. A chart is never allowed to
// fail because a picture didn't load.

export const AVATAR_SIZE = 32;
const GAP = 10; // between the last point and the avatar
const RING = 2; // border thickness, drawn in the series colour

/** Right-hand padding a chart needs so avatars aren't clipped by the edge. */
export const AVATAR_PADDING = AVATAR_SIZE + GAP + RING * 2;

const FETCH_TIMEOUT_MS = 3000;

// Keyed by URL. Discord embeds the avatar hash in the URL, so an entry becomes
// unreachable the moment someone changes their picture — no TTL needed.
const cache = new Map();

/**
 * Fetches and decodes one avatar.
 * @returns {Promise<import('canvas').Image | null>} null on any failure
 */
function fetchAvatar(url) {
  const hit = cache.get(url);
  if (hit) return hit;

  const pending = (async () => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`avatar fetch failed: ${res.status}`);
    return loadImage(Buffer.from(await res.arrayBuffer()));
  })().catch(() => {
    // Don't cache the failure — a timeout now shouldn't blind the next chart.
    cache.delete(url);
    return null;
  });

  cache.set(url, pending);
  return pending;
}

/**
 * Resolves every dataset's avatar in parallel and attaches it as
 * `dataset.avatar`. Datasets with no `avatarUrl` are left untouched.
 *
 * @param {object[]} datasets  mutated in place
 */
export async function loadAvatars(datasets) {
  await Promise.all(
    datasets.map(async (dataset) => {
      if (!dataset.avatarUrl) return;
      const image = await fetchAvatar(dataset.avatarUrl);
      if (image) dataset.avatar = image;
    }),
  );
}

/** Index of the last point that actually has a value. -1 when the line is empty. */
function lastDrawnIndex(data) {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i] !== null && data[i] !== undefined) return i;
  }
  return -1;
}

export const avatarPlugin = {
  id: "avatars",

  afterDatasetsDraw(chart) {
    const { ctx } = chart;

    chart.data.datasets.forEach((dataset, i) => {
      if (!dataset.avatar) return;

      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;

      const index = lastDrawnIndex(dataset.data);
      if (index < 0) return;

      const point = meta.data?.[index];
      if (!point) return;

      const r = AVATAR_SIZE / 2;
      const cx = point.x + GAP + r;
      const cy = point.y;

      ctx.save();

      // Punch the background out first, so a line passing underneath doesn't
      // show through the transparent corners of a non-square avatar.
      ctx.beginPath();
      ctx.arc(cx, cy, r + RING, 0, Math.PI * 2);
      ctx.fillStyle = BACKGROUND;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(dataset.avatar, cx - r, cy - r, AVATAR_SIZE, AVATAR_SIZE);
      ctx.restore();

      // Ring in the series colour, tying the face back to its line.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r + RING / 2, 0, Math.PI * 2);
      ctx.lineWidth = RING;
      ctx.strokeStyle = dataset.borderColor ?? dataset.backgroundColor;
      ctx.stroke();
      ctx.restore();
    });
  },
};
