// The "write on the sheet" dialog: type a correction, optionally white out what is underneath.
import { h, modal, toast } from '../util.js';
import { uid } from '../engine/engine.js';
import { DEFAULT_COVER, TEXT_SIZES, normalizeEdit } from '../sheet/edits.js';

export function editDialog(session, { page, x, y, existing }) {
  const draft = existing ? { ...existing, cover: existing.cover ? { ...existing.cover } : null } : { id: 'e-' + uid(), page, x, y, text: '', size: 9, cover: null };
  const edits = () => (session.rec.setup.sheetEdits || []).slice();
  const save = async (next) => { await session.updateSetup({ sheetEdits: next }); };

  const text = h('input', { class: 'inp', type: 'text', maxlength: 60, value: draft.text, placeholder: 'What should be written here?', 'aria-label': 'Text to write on the sheet', autocomplete: 'off',
    oninput: (e) => { draft.text = e.target.value; } });
  const sizes = h('div', { class: 'seg' });
  const drawSizes = () => sizes.replaceChildren(...TEXT_SIZES.map(([l, v]) => h('button', { class: draft.size === v ? 'on' : '', onclick: () => { draft.size = v; drawSizes(); } }, l)));
  drawSizes();
  const coverBox = h('div');
  const cover = h('input', { type: 'checkbox', id: 'cov', checked: !!draft.cover, onchange: (e) => { draft.cover = e.target.checked ? (draft.cover || { ...DEFAULT_COVER }) : null; drawCover(); } });
  function step(label, key, d) {
    return h('div', { class: 'lv-row', style: { alignItems: 'center' } },
      h('span', { style: { flex: 1, fontWeight: 700 } }, label),
      h('button', { class: 'btn small', 'aria-label': label + ' smaller', onclick: () => { draft.cover[key] = Math.max(6, draft.cover[key] - d); drawCover(); } }, '−'),
      h('span', { style: { minWidth: '44px', textAlign: 'center' } }, Math.round(draft.cover[key])),
      h('button', { class: 'btn small', 'aria-label': label + ' bigger', onclick: () => { draft.cover[key] += d; drawCover(); } }, '+'));
  }
  function drawCover() { coverBox.replaceChildren(...(draft.cover ? [step('White patch width', 'w', 8), step('White patch height', 'h', 3)] : [])); }
  drawCover();

  const m = modal(h('div', null,
    h('div', { class: 'field' }, h('span', null, 'Text'), text),
    h('div', { class: 'field' }, h('span', null, 'Size'), sizes),
    h('label', { class: 'check', style: { margin: '6px 0' } }, cover, 'White out what is underneath (to cover a wrong mark)'),
    coverBox,
    h('p', { class: 'muted' }, 'Leave the text empty to only white out. This changes the printed sheet only. The score and stats stay as they are.'),
    h('div', { class: 'modal-actions' },
      existing ? h('button', { class: 'btn danger', onclick: async () => { await save(edits().filter((e) => e.id !== draft.id)); m.close(); toast('Removed'); } }, 'Remove') : null,
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!draft.text.trim() && !draft.cover) { toast('Type something or turn on White out'); return; }
        const next = normalizeEdit(draft);
        const all = edits();
        const i = all.findIndex((e) => e.id === next.id);
        if (i >= 0) all[i] = next; else all.push(next);
        await save(all);
        m.close();
      } }, 'Save'))), { title: existing ? 'Change this edit' : 'Write on the sheet' });
  setTimeout(() => text.focus(), 50);
}
