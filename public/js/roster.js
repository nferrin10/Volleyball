// Turns pasted or typed roster text into players. Understands a plain list of numbers
// ("1 4 7 9 10 12"), one player per line ("12 Mia Lopez", "Mia Lopez 12", "#12 - Mia"),
// spreadsheet rows (tab separated) and a libero mark ("7L", "L7", "7 libero").
// Pure (no DOM) so it can be tested.

const LIB = /^(?:l|lib|libero)$/i;

function parseEntry(raw) {
  let s = raw.replace(/\t+/g, ' ').replace(/[#]/g, ' ').replace(/^[\s.\-–—:)]+|[\s\-–—:]+$/g, '').trim();
  if (!s) return null;
  let libero = false;
  // "7L" / "L7" stuck together
  let m = /^(\d{1,3})\s*[lL]$/.exec(s) || /^[lL]\s*(\d{1,3})$/.exec(s);
  if (m) return { number: String(+m[1]), name: '', libero: true };
  const words = s.split(/\s+/);
  const clean = (w) => w.replace(/^[.\-–—:)(]+|[.\-–—:)(,]+$/g, '');
  const kept = [];
  for (const w of words) { if (LIB.test(clean(w))) libero = true; else kept.push(w); }
  s = kept.join(' ').replace(/\(\s*\)/g, '').trim();
  m = /^(\d{1,3})(?:\s*[lL])?\b[\s.\-–—:)]*(.*)$/.exec(s);
  if (m) return { number: String(+m[1]), name: clean(m[2]).trim(), libero: libero || /^\d{1,3}\s*[lL]\b/.test(s) };
  m = /^(.*?)[\s.\-–—:(]*(\d{1,3})\)?$/.exec(s);
  if (m && /[^\W\d_]/u.test(m[1])) return { number: String(+m[2]), name: m[1].trim(), libero };
  return null;
}

export function parseRoster(text, existingNumbers = []) {
  const seen = new Set(existingNumbers.map(String));
  const players = [], skipped = [];
  const entries = String(text || '').split(/[\n\r;,]+/).map((x) => x.trim()).filter(Boolean);
  const add = (p, raw) => {
    if (!p) { skipped.push(raw); return; }
    if (seen.has(p.number)) { skipped.push('#' + p.number + ' (already added)'); return; }
    seen.add(p.number); players.push(p);
  };
  for (const e of entries) {
    // several bare numbers on one line: "1 4 7 9 10 12" or "1 4 7L 9"
    if (/^(?:#?\d{1,3}\s*[lL]?\s+)+#?\d{1,3}\s*[lL]?$/.test(e) || /^(?:[lL]\s*\d{1,3}\s+)+[lL]?\s*\d{1,3}$/.test(e)) {
      for (const tok of e.match(/[lL]\s*\d{1,3}|#?\d{1,3}\s*[lL]?/g)) add(parseEntry(tok), tok);
    } else add(parseEntry(e), e);
  }
  return { players, skipped };
}
