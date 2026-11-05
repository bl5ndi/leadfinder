// Export to CSV and real .xlsx (Office Open XML written by hand: stored ZIP, no dependency).
import { priorityOf, issuesOf } from './scoring.js';

const COLS = ['name', 'sector', 'address', 'city', 'postcode', 'country', 'phone', 'email', 'website', 'mapsUrl',
  'facebook', 'instagram', 'otherSocial', 'listing', 'rating', 'reviews', 'score', 'priority', 'category', 'reasons',
  'auditGlobal', 'design', 'mobile', 'performance', 'seo', 'security', 'issues',
  'status', 'interesting', 'lastContact', 'notes', 'history', 'sources'];

/** Build a 2D array (header + rows). t = translate function. */
export function toRows(list, t) {
  const na = t('na');
  const val = v => (v == null || v === '' || (Array.isArray(v) && !v.length)) ? na : Array.isArray(v) ? v.join(' | ') : v;
  const rows = list.map(b => {
    const sc = b.audit?.ok ? b.audit.scores : {};
    const cell = {
      ...b,
      priority: t('prio.' + priorityOf(b.score)),
      category: t('cat.' + (b.category || 'pending')),
      reasons: (b.reasons || []).map(r => t(r.k, r.p)).join(' | '),
      auditGlobal: sc.global, design: sc.design, mobile: sc.mobile, performance: sc.performance, seo: sc.seo, security: sc.security,
      issues: issuesOf(b.audit).slice(0, 8).map(c => t('chk.' + c.id, c.p)).join(' | '),
      status: t('st.' + (b.status || 'new')),
      interesting: b.interesting ? '✓' : '',
      history: (b.history || []).map(h => `${h.date} : ${h.text}`).join(' | '),
      sources: Object.entries(b.src || {}).map(([k, s]) => `${k}: ${s === 'gen' ? t('sheet.genLink') : s === 'site' ? t('sheet.fromSite') : s}`).join(' | '),
    };
    return COLS.map(c => (c === 'interesting' || c === 'notes' || c === 'lastContact') ? (cell[c] ?? '') : val(cell[c]));
  });
  return [COLS.map(c => t('col.' + c)), ...rows];
}

// Block spreadsheet formula injection from scraped text (keeps phone numbers like +33…).
const safe = v => typeof v === 'string' && /^[=@]|^[+-][^\d\s(]/.test(v) ? "'" + v : v;

export function toCsv(rows) {
  return '﻿' + rows.map(r => r.map(v => {
    const s = String(safe(v) ?? '');
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
}

const xml = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colName = i => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

/** @returns {Uint8Array} bytes of a valid .xlsx file */
export function toXlsx(rows, sheetName = 'Prospects') {
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
    return typeof v === 'number' && Number.isFinite(v)
      ? `<c r="${ref}"${st}><v>${v}</v></c>`
      : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xml(v ?? '')}</t></is></c>`;
  }).join('')}</row>`).join('');
  const NS = 'http://schemas.openxmlformats.org';
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  const enc = new TextEncoder();
  return zipStore(Object.entries(files).map(([name, s]) => ({ name, data: enc.encode(s) })));
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = d => { let c = ~0; for (const b of d) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return ~c >>> 0; };

/** Minimal ZIP writer, "stored" (no compression), enough for xlsx. */
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(12, 0x21, true); // date 1980-01-01
    h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
