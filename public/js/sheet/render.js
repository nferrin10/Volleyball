// Renders the layout ops to a PDF (pdf-lib) or to SVG (on-screen preview).
// Both outputs come from the same ops, so the preview is what prints.
import { PAGE_W, PAGE_H } from './layout.js';

export async function makeMeasurer(PDFLib) {
  const doc = await PDFLib.PDFDocument.create();
  const fonts = await embedFonts(PDFLib, doc);
  return (text, size, font = 'r') => fonts[font].widthOfTextAtSize(text, size);
}

async function embedFonts(PDFLib, doc) {
  const F = PDFLib.StandardFonts;
  return {
    r: await doc.embedFont(F.Helvetica),
    b: await doc.embedFont(F.HelveticaBold),
    i: await doc.embedFont(F.HelveticaOblique),
  };
}

function hex(PDFLib, c) {
  const n = parseInt(c.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function renderPDF(PDFLib, sheet, meta = {}) {
  const doc = await PDFLib.PDFDocument.create();
  doc.setTitle(meta.title || 'Volleyball scoresheet');
  doc.setCreator('Volleyball Game Day');
  doc.setProducer('Volleyball Game Day');
  const fonts = await embedFonts(PDFLib, doc);
  const H = PAGE_H;
  for (const pg of sheet.pages) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    for (const op of pg.ops) {
      const color = hex(PDFLib, op.color || '#000000');
      switch (op.t) {
        case 'l':
          page.drawLine({ start: { x: op.x1, y: H - op.y1 }, end: { x: op.x2, y: H - op.y2 }, thickness: op.lw, color, dashArray: op.dash });
          break;
        case 'r':
          page.drawRectangle({ x: op.x, y: H - op.y - op.h, width: op.w, height: op.h, borderWidth: op.lw, borderColor: color, borderDashArray: op.dash, color: op.fill ? hex(PDFLib, op.fill) : undefined });
          break;
        case 'p': {
          const d = 'M' + op.pts.map((p) => `${p[0]} ${p[1]}`).join(' L') + ' Z';
          page.drawSvgPath(d, { x: 0, y: H, borderWidth: op.lw, borderColor: color, color: op.fill ? hex(PDFLib, op.fill) : undefined });
          break;
        }
        case 'c':
          page.drawEllipse({ x: op.cx, y: H - op.cy, xScale: op.r, yScale: op.r, borderWidth: op.lw, borderColor: color });
          break;
        case 't': {
          const f = fonts[op.font || 'r'];
          const w = f.widthOfTextAtSize(op.s, op.size);
          let dx = 0;
          if (op.align === 'c') dx = -w / 2; else if (op.align === 'r') dx = -w;
          const rad = ((op.rot || 0) * Math.PI) / 180;
          const x = op.x + dx * Math.cos(rad);
          const y = H - op.y + dx * Math.sin(rad);
          page.drawText(op.s, { x, y, size: op.size, font: f, color, opacity: op.opacity, rotate: op.rot ? PDFLib.degrees(op.rot) : undefined });
          break;
        }
        default: break;
      }
    }
  }
  return doc.save();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function pageToSVG(page, opts = {}) {
  const out = [];
  const vb = opts.viewBox || `0 0 ${PAGE_W} ${PAGE_H}`;
  const dims = opts.viewBox ? '' : ` width="${opts.width || PAGE_W}" height="${opts.height || PAGE_H}"`;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${dims} font-family="Helvetica, Arial, sans-serif" role="img" aria-label="${esc(opts.label || 'Scoresheet page')}">`);
  out.push(`<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>`);
  for (const op of page.ops) {
    const dash = op.dash ? ` stroke-dasharray="${op.dash.join(' ')}"` : '';
    switch (op.t) {
      case 'l': out.push(`<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${op.color}" stroke-width="${op.lw}"${dash}/>`); break;
      case 'r': out.push(`<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" fill="${op.fill || 'none'}" stroke="${op.color}" stroke-width="${op.lw}"${dash}/>`); break;
      case 'p': out.push(`<polygon points="${op.pts.map((p) => p.join(',')).join(' ')}" fill="${op.fill || 'none'}" stroke="${op.color}" stroke-width="${op.lw}" stroke-linejoin="miter"/>`); break;
      case 'c': out.push(`<circle cx="${op.cx}" cy="${op.cy}" r="${op.r}" fill="none" stroke="${op.color}" stroke-width="${op.lw}"/>`); break;
      case 't': {
        const anchor = op.align === 'c' ? 'middle' : op.align === 'r' ? 'end' : 'start';
        const tr = op.rot ? ` transform="rotate(${-op.rot} ${op.x} ${op.y})"` : '';
        const op2 = op.opacity != null ? ` fill-opacity="${op.opacity}"` : '';
        out.push(`<text x="${op.x}" y="${op.y}" font-size="${op.size}" text-anchor="${anchor}" fill="${op.color}"${op2}${op.font === 'b' ? ' font-weight="bold"' : ''}${op.font === 'i' ? ' font-style="italic"' : ''}${tr}>${esc(op.s)}</text>`);
        break;
      }
      default: break;
    }
  }
  out.push('</svg>');
  return out.join('');
}
