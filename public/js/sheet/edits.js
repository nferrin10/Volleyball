// Manual edits written on top of the scoresheet: a bit of text, optionally on a white patch that
// covers whatever is underneath. They never change the score or stats, only what the sheet shows.
// Coordinates are sheet points (792 x 612), the same space the layout uses.

export const DEFAULT_COVER = { w: 40, h: 14 };
export const TEXT_SIZES = [['Small', 7], ['Normal', 9], ['Large', 12]];

// The rectangle an edit occupies, used for tapping it again and for the edit-mode outline.
export function editBox(e) {
  const size = e.size || 9;
  const tw = Math.max(8, String(e.text || '').length * size * 0.58);
  const w = Math.max(e.cover ? e.cover.w : 0, tw), h = Math.max(e.cover ? e.cover.h : 0, size + 4);
  return { x: e.x - w / 2, y: e.y - h / 2, w, h };
}

// Which edit (if any) sits under a tap. The most recent one wins when they overlap.
export function hitTest(edits, page, x, y, slop = 4) {
  for (let i = (edits || []).length - 1; i >= 0; i--) {
    const e = edits[i];
    if (e.page !== page) continue;
    const b = editBox(e);
    if (x >= b.x - slop && x <= b.x + b.w + slop && y >= b.y - slop && y <= b.y + b.h + slop) return e;
  }
  return null;
}

export function normalizeEdit(e) {
  const size = [7, 9, 12].includes(+e.size) ? +e.size : 9;
  const cover = e.cover ? { w: Math.max(8, Math.min(400, +e.cover.w || DEFAULT_COVER.w)), h: Math.max(6, Math.min(120, +e.cover.h || DEFAULT_COVER.h)) } : null;
  return { id: e.id, page: e.page | 0, x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10, text: String(e.text || '').slice(0, 60), size, cover };
}
