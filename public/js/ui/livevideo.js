// "Live video for family": one saved YouTube channel, one tap to share the watch link.
// The video itself comes from a second phone running the YouTube app; this phone keeps scoring.
import { h, modal, toast } from '../util.js';
import { store } from '../store.js';
import { parseYouTube, shareText } from '../video.js';

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export async function openLiveVideo(session) {
  const saved = (await store.getKV('youtube')) || {};
  const setup = session ? session.rec.setup : null;
  const gameLink = setup && setup.watchInput ? parseYouTube(setup.watchInput) : { ok: false };
  let channelInput = saved.input || '';
  let current = () => (gameLink.ok ? gameLink : parseYouTube(channelInput));

  const status = h('p', { class: 'lv-status' });
  const share = h('button', { class: 'btn primary big block', onclick: doShare }, 'Share link with family');
  const copyBtn = h('button', { class: 'btn', onclick: doCopy }, 'Copy link');
  const test = h('a', { class: 'btn', target: '_blank', rel: 'noopener' }, 'Test the link');

  function refresh() {
    const r = current();
    share.disabled = copyBtn.disabled = !r.ok;
    if (r.ok) { test.href = r.url; test.removeAttribute('aria-disabled'); test.classList.remove('lock'); }
    else { test.removeAttribute('href'); test.classList.add('lock'); }
    status.className = 'lv-status ' + (r.ok ? 'ok' : (channelInput.trim() ? 'bad' : ''));
    status.textContent = r.ok ? 'Family link: ' + r.url
      : channelInput.trim() ? 'That doesn’t look like a YouTube link. Try @yourchannel or paste the channel’s address.'
      : 'Add your YouTube channel once and it’s saved for every game.';
  }
  async function doShare() {
    const r = current(); if (!r.ok) return;
    const text = shareText(setup);
    if (navigator.share) {
      try { await navigator.share({ title: 'Watch live', text, url: r.url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    toast((await copy(`${text} ${r.url}`)) ? 'Link copied. Paste it into a text or post.' : 'Could not copy. Press and hold the link above.');
  }
  async function doCopy() {
    const r = current(); if (!r.ok) return;
    toast((await copy(r.url)) ? 'Link copied' : 'Could not copy. Press and hold the link above.');
  }

  const chan = h('input', { class: 'inp', type: 'text', inputmode: 'url', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false',
    placeholder: '@yourchannel or channel link', value: channelInput, 'aria-label': 'Your YouTube channel',
    oninput: (e) => {
      channelInput = e.target.value;
      if (parseYouTube(channelInput).ok && parseYouTube(channelInput).kind === 'channel') store.setKV('youtube', { input: channelInput.trim() });
      refresh();
    } });

  const body = h('div', { class: 'lv' },
    h('div', { class: 'lv-step' }, h('b', null, '1'), h('div', null,
      h('strong', null, 'Start the video on a second phone'),
      h('p', null, 'The second phone is the camera. Open YouTube on it, tap + then Live, and start streaming. This phone keeps scoring.'),
      h('a', { class: 'btn small', href: 'https://www.youtube.com/', target: '_blank', rel: 'noopener' }, 'Open YouTube'))),
    h('div', { class: 'lv-step' }, h('b', null, '2'), h('div', { style: { flex: 1 } },
      h('strong', null, 'Your YouTube channel (saved once)'),
      h('p', null, 'A team channel or your own, whichever the family will watch.'),
      chan, status)),
    h('div', { class: 'lv-step' }, h('b', null, '3'), h('div', { style: { flex: 1 } },
      h('strong', null, 'Send it to family'),
      h('p', null, 'This link always opens the live video your channel is streaming, so you never send a new one.'),
      share, h('div', { class: 'lv-row' }, copyBtn, test))),
    setup ? advanced() : null,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Close')));

  function advanced() {
    const inp = h('input', { class: 'inp', type: 'text', inputmode: 'url', autocapitalize: 'off', placeholder: 'Link to one specific video', value: setup.watchInput || '', 'aria-label': 'Link for this game only',
      onchange: async (e) => {
        const v = e.target.value.trim();
        const r = parseYouTube(v);
        if (v && !r.ok) { toast('That doesn’t look like a YouTube link'); return; }
        await session.updateSetup({ watchInput: v });
        Object.assign(gameLink, r.ok ? r : { ok: false });
        refresh();
      } });
    return h('details', { class: 'adv' }, h('summary', null, 'A different link for just this game'), h('p', { class: 'muted' }, 'Only if this game streams somewhere other than your channel. Leave empty otherwise.'), inp);
  }

  const m = modal(body, { title: 'Live video for family' });
  refresh();
}
