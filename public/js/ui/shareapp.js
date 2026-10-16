// "Share the app": a QR code that opens the app in any phone camera. No account or login is
// needed, because everything is saved on the device. Can also be printed as a sign.
import { h, modal, toast } from '../util.js';

export async function openShareApp() {
  const url = new URL('./', location.href).href;
  const { default: qrcode } = await import('../../vendor/qrcode.mjs');
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Could not copy. Press and hold the link.'); }
  };
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Volleyball Game Day', text: 'Free volleyball scorekeeper. No login needed:', url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copy();
  };
  const print = () => {
    document.body.classList.add('printing-qr');
    const done = () => { document.body.classList.remove('printing-qr'); globalThis.removeEventListener('afterprint', done); };
    globalThis.addEventListener('afterprint', done);
    globalThis.print();
  };

  const body = h('div', { class: 'qr-modal' },
    h('div', { class: 'qr-print' },
      h('h2', { class: 'qr-sign' }, 'Volleyball Game Day'),
      h('div', { class: 'qr-box', html: svg, role: 'img', 'aria-label': 'QR code that opens the Volleyball Game Day app' }),
      h('p', { class: 'qr-big' }, 'Scan with your phone camera'),
      h('p', { class: 'qr-sub' }, 'Free. No account. No login. Start scoring right away.'),
      h('p', { class: 'qr-url' }, url)),
    h('div', { class: 'no-print' },
      h('p', { class: 'muted' }, 'To keep it on the home screen: on iPhone tap Share, then Add to Home Screen. On Android tap the menu, then Install app.'),
      h('button', { class: 'btn primary big block', onclick: share }, 'Share link'),
      h('div', { class: 'lv-row' }, h('button', { class: 'btn', onclick: copy }, 'Copy link'), h('button', { class: 'btn', onclick: print }, 'Print sign')),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Close'))));
  const m = modal(body, { title: 'Share the app' });
}
