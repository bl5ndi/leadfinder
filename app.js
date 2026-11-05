// LeadFinder dashboard: UI layer only. Data, audit, scoring, storage and export live in src/.
import { t, setLang, getLang, applyI18n } from './src/i18n.js';
import { get, set, DEFAULT_SETTINGS } from './src/storage.js';
import { SECTORS } from './src/sectors.js';
import { searchOsm } from './src/sources/osm.js';
import { mergeAll, dedupeStore } from './src/process.js';
import { auditSite } from './src/audit.js';
import { scoreBusiness, priorityOf, issuesOf, CAT_WEIGHTS } from './src/scoring.js';
import { toRows, toCsv, toXlsx } from './src/export.js';
import { esc, pool, sleep, domainOf } from './src/util.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const S = { settings: null, biz: {}, lastIds: [], view: 'dashboard', sel: { results: new Set(), prospects: new Set() }, auditing: new Set(), openId: null };
const STATUSES = ['new', 'todo', 'contacted', 'discussion', 'client', 'lost'];
const CATS = ['none', 'outdated', 'improve', 'good', 'pending'];
const today = () => new Date().toISOString().slice(0, 10);
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '#';
const split = (s, re) => String(s || '').split(re).map(x => x.trim()).filter(Boolean);
const rescore = b => Object.assign(b, scoreBusiness(b));
const ICON = {
  open: '<svg viewBox="0 0 24 24"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14zM5 5h6v2H5v12h12v-6h2v8H3V5z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
};

// ---------- persistence ----------
let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { set('biz', S.biz); set('lastIds', S.lastIds); }, 300);
}
const saveSettings = () => set('settings', S.settings);

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2800);
}

function log(msg, cls = '') {
  $('#log').insertAdjacentHTML('beforeend', `<div class="${cls}">${esc(new Date().toLocaleTimeString())} · ${esc(msg)}</div>`);
  $('#log').scrollTop = 1e9;
  const chip = $('#statusChip');
  chip.hidden = false; chip.textContent = msg;
}

// ---------- navigation / theme / language ----------
function show(view) {
  if (!$('#v-' + view)) view = 'dashboard';
  S.view = view;
  $$('.view').forEach(v => { v.hidden = v.id !== 'v-' + view; });
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  history.replaceState(null, '', '#' + view);
  render();
}

let raf;
function refresh() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
  render();
  // Don't wipe what the user is typing in the sheet while background audits update it.
  if (S.openId && !$('#sheet').contains(document.activeElement)) renderSheet();
}); }

function render() {
  if (S.view === 'dashboard') renderDashboard();
  else if (S.view === 'results' || S.view === 'prospects') renderTable(S.view);
  else if (S.view === 'settings') fillSettings();
}

function applyTheme() { document.documentElement.dataset.theme = S.settings.theme; }

function applyLanguage() {
  setLang(S.settings.lang);
  applyI18n();
  $('#langBtn').textContent = t('lang.toggle');
  fillSelects();
  render();
  if (S.openId) renderSheet();
}

function fillSelects() {
  const opts = (sel, first, items) => {
    const v = sel.value;
    sel.innerHTML = `<option value="">${esc(first)}</option>` + items.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
    sel.value = v;
  };
  opts($('#sectorSel'), t('search.sector.any'), Object.entries(SECTORS).map(([k, s]) => [k, s[getLang()]]));
  $$('.f-cat').forEach(s => opts(s, t('filter.allCat'), CATS.map(c => [c, t('cat.' + c)])));
  $$('.f-prio').forEach(s => opts(s, t('filter.allPrio'), ['high', 'mid', 'low', 'pending'].map(p => [p, t('prio.' + p)])));
  $$('.f-status').forEach(s => opts(s, t('filter.allStatus'), STATUSES.map(st => [st, t('st.' + st)])));
}

// ---------- dashboard ----------
function renderDashboard() {
  const all = Object.values(S.biz);
  const k = {
    total: all.length,
    noSite: all.filter(b => b.category === 'none').length,
    outdated: all.filter(b => b.category === 'outdated').length,
    improve: all.filter(b => b.category === 'improve').length,
    priority: all.filter(b => b.score >= 80).length,
    contacted: all.filter(b => ['contacted', 'discussion', 'client'].includes(b.status)).length,
    clients: all.filter(b => b.status === 'client').length,
  };
  $('#kpis').innerHTML = Object.entries(k).map(([key, n]) =>
    `<div class="kpi k-${key}"><span>${t('kpi.' + key)}</span><b>${n}</b></div>`).join('');

  const group = fn => Object.entries(all.reduce((m, b) => { const x = fn(b) || t('na'); m[x] = (m[x] || 0) + 1; return m; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 8);
  bars('#chartSector', group(b => b.sector));
  bars('#chartCity', group(b => b.city));
  bars('#chartCat', CATS.map(c => [t('cat.' + c), all.filter(b => (b.category || 'pending') === c).length, c]));

  const top = all.filter(b => b.score != null && !['client', 'lost'].includes(b.status)).sort((a, b) => b.score - a.score).slice(0, 8);
  $('#topList').innerHTML = top.length ? top.map(b => `<button class="toprow" data-id="${b.id}">
      <span class="score p-${priorityOf(b.score)}">${b.score}</span>
      <span class="grow"><b>${esc(b.name)}</b><small>${esc([b.sector, b.city].filter(Boolean).join(' · '))}</small></span>
      <span class="badge cat-${b.category}">${t('cat.' + b.category)}</span></button>`).join('')
    : `<p class="muted">${t('dash.empty')}</p>`;
}

function bars(sel, entries) {
  const max = Math.max(1, ...entries.map(e => e[1]));
  $(sel).innerHTML = entries.length && entries.some(e => e[1]) ? entries.map(([label, n, c]) => `<div class="bar">
      <span class="bl" title="${esc(label)}">${esc(label)}</span>
      <div class="bt"><i class="${c ? 'cat-' + c : ''}" style="width:${(n / max) * 100}%"></i></div><b>${n}</b></div>`).join('')
    : `<p class="muted">${t('dash.empty')}</p>`;
}

// ---------- results / prospects tables ----------
function listFor(view) {
  const base = view === 'results' ? S.lastIds.map(id => S.biz[id]).filter(Boolean) : Object.values(S.biz).filter(b => b.saved);
  const bar = $(`#v-${view} .toolbar`);
  const q = bar.querySelector('.f-text').value.trim().toLowerCase();
  const cat = bar.querySelector('.f-cat').value, prio = bar.querySelector('.f-prio').value;
  const st = bar.querySelector('.f-status')?.value, star = bar.querySelector('.f-star')?.checked;
  return base.filter(b =>
    (!q || [b.name, b.city, b.sector, b.postcode, b.email, b.phone].join(' ').toLowerCase().includes(q)) &&
    (!cat || (b.category || 'pending') === cat) && (!prio || priorityOf(b.score) === prio) &&
    (!st || b.status === st) && (!star || b.interesting)
  ).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

function renderTable(view) {
  const sec = $('#v-' + view), list = listFor(view), sel = S.sel[view];
  const cols = ['name', 'city', 'contact', 'site', 'category', 'score', ...(view === 'prospects' ? ['status'] : []), 'actions'];
  const allSel = list.length && list.every(b => sel.has(b.id));
  sec.querySelector('thead').innerHTML = `<tr><th><input type="checkbox" class="sel-all" ${allSel ? 'checked' : ''}></th>${cols.map(c => `<th>${t('col.' + c)}</th>`).join('')}</tr>`;
  sec.querySelector('tbody').innerHTML = list.map(b => row(b, view)).join('') ||
    `<tr><td colspan="${cols.length + 1}" class="empty">${t('dash.empty')}</td></tr>`;
  sec.querySelector('.count').textContent = t('filter.count', { n: list.length, s: list.filter(b => sel.has(b.id)).length });
}

function siteCell(b) {
  if (S.auditing.has(b.id)) return `<span class="muted pulse">${t('site.auditing')}</span>`;
  if (b.website) {
    const g = b.audit?.ok ? `<small class="sub">${t('col.auditGlobal')} ${b.audit.scores.global}/100</small>` : '';
    return `<a href="${esc(safeUrl(b.website))}" target="_blank" rel="noopener">${esc(domainOf(b.website))}</a>${g}`;
  }
  return `<span class="muted">${t(b.listing ? 'site.listing' : 'site.none')}</span>`;
}

function row(b, view) {
  const prio = priorityOf(b.score), cat = b.category || 'pending';
  const na = `<span class="muted">${t('na')}</span>`;
  return `<tr data-id="${b.id}" class="${S.sel[view].has(b.id) ? 'selected' : ''}">
    <td><input type="checkbox" class="sel" ${S.sel[view].has(b.id) ? 'checked' : ''}></td>
    <td><button class="linkbtn open">${esc(b.name)}</button>${b.interesting ? ' <span class="star">★</span>' : ''}<small class="sub">${esc(b.sector || '')}</small></td>
    <td>${b.city ? esc(b.city) : na}<small class="sub">${esc(b.postcode || '')}</small></td>
    <td>${b.phone ? esc(b.phone) : na}<small class="sub">${esc(b.email || '')}</small></td>
    <td>${siteCell(b)}</td>
    <td><span class="badge cat-${cat}">${t('cat.' + cat)}</span></td>
    <td><span class="score p-${prio}" title="${t('prio.' + prio)}">${b.score ?? '-'}</span></td>
    ${view === 'prospects' ? `<td><span class="badge st-${b.status}">${t('st.' + b.status)}</span></td>` : ''}
    <td class="acts">
      <button class="ib open" title="${t('btn.sheet')}">${ICON.open}</button>
      ${b.website ? `<a class="ib" href="${esc(safeUrl(b.website))}" target="_blank" rel="noopener" title="${t('btn.site')}">${ICON.ext}</a>` : ''}
      ${b.mapsUrl ? `<a class="ib" href="${esc(safeUrl(b.mapsUrl))}" target="_blank" rel="noopener" title="${t('btn.maps')}">${ICON.pin}</a>` : ''}
      <button class="ib save ${b.saved ? 'on' : ''}" title="${t(b.saved ? 'btn.unsave' : 'btn.save')}">${ICON.save}</button>
    </td></tr>`;
}

function targetIds(view) {
  const list = listFor(view), sel = S.sel[view];
  const picked = list.filter(b => sel.has(b.id));
  return (picked.length ? picked : list).map(b => b.id);
}

function exportList(view, kind) {
  const list = targetIds(view).map(id => S.biz[id]);
  const rows = toRows(list, t);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (kind === 'csv') download(`leadfinder-${view}-${stamp}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  else download(`leadfinder-${view}-${stamp}.xlsx`, toXlsx(rows), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  toast(t('toast.exported', { n: list.length }));
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function bindList(view) {
  const sec = $('#v-' + view), sel = S.sel[view];
  sec.querySelector('.toolbar').addEventListener('input', () => renderTable(view));
  sec.querySelector('thead').addEventListener('change', e => {
    if (!e.target.matches('.sel-all')) return;
    for (const b of listFor(view)) e.target.checked ? sel.add(b.id) : sel.delete(b.id);
    renderTable(view);
  });
  sec.querySelector('tbody').addEventListener('click', e => {
    const id = e.target.closest('tr')?.dataset.id;
    if (!id) return;
    if (e.target.matches('.sel')) { e.target.checked ? sel.add(id) : sel.delete(id); renderTable(view); }
    else if (e.target.closest('.open')) openSheet(id);
    else if (e.target.closest('.save')) { const b = S.biz[id]; b.saved = !b.saved; persist(); renderTable(view); }
  });
  sec.querySelector('.b-audit').addEventListener('click', () => auditMany(targetIds(view)));
  sec.querySelector('.b-csv').addEventListener('click', () => exportList(view, 'csv'));
  sec.querySelector('.b-xlsx').addEventListener('click', () => exportList(view, 'xlsx'));
  sec.querySelector('.b-save')?.addEventListener('click', () => {
    const ids = targetIds(view);
    ids.forEach(id => { S.biz[id].saved = true; });
    persist(); renderTable(view); toast(t('toast.savedN', { n: ids.length }));
  });
  sec.querySelector('.b-dedupe')?.addEventListener('click', dedupe);
}

function dedupe() {
  const n = dedupeStore(S.biz);
  S.lastIds = S.lastIds.filter(id => S.biz[id]);
  for (const s of Object.values(S.sel)) for (const id of s) if (!S.biz[id]) s.delete(id);
  persist(); render(); toast(t('toast.dedupe', { n }));
}

// ---------- search ----------
async function runSearch(e) {
  e.preventDefault();
  const form = e.target, f = Object.fromEntries(new FormData(form));
  f.autoAudit = form.autoAudit.checked;
  S.settings.autoAudit = f.autoAudit; saveSettings();
  const cities = split(f.cities, /[,;\n]/), names = split(f.names, /\n/);
  const hasWhere = cities.length || f.postcode.trim() || f.country.trim();
  if (!hasWhere && !f.keyword.trim() && !names.length) return toast(t(f.sector ? 'search.needWhere' : 'search.needAny'));

  const btn = $('#searchBtn');
  btn.disabled = true; btn.textContent = t('search.running');
  $('#log').innerHTML = '';
  const sectorLabel = f.sector ? SECTORS[f.sector][getLang()] : '';
  const found = [];
  for (const city of cities.length ? cities : ['']) {
    for (const name of names.length ? names : ['']) {
      const q = [f.keyword.trim() || sectorLabel, name, f.postcode.trim(), city, f.country.trim()].filter(Boolean).join(' ');
      log(t('log.query', { q }));
      try {
        const list = await searchOsm({ sector: f.sector, name: name || f.keyword.trim(), city, postcode: f.postcode.trim(), country: f.country.trim(), lang: getLang() });
        if (sectorLabel) list.forEach(b => { b.sector ||= sectorLabel; });
        found.push(...list);
        log(t('log.found', { n: list.length }));
      } catch (err) { log(t('log.error', { e: err.message }), 'err'); }
      await sleep(1100); // Nominatim usage policy: max 1 request / second
    }
  }
  const ids = mergeAll(S.biz, found);
  ids.forEach(id => rescore(S.biz[id]));
  S.lastIds = ids; S.sel.results.clear();
  persist();
  log(t('log.merged', { n: ids.length }));
  btn.disabled = false; btn.textContent = t('search.go');
  show('results');
  if (f.autoAudit) await auditMany(ids.filter(id => S.biz[id].website && !S.biz[id].audit), true);
  log(t('log.done'));
}

// ---------- audit ----------
async function auditMany(ids, quiet = false) {
  ids = ids.filter(id => S.biz[id]?.website && !S.auditing.has(id));
  if (!ids.length) { if (!quiet) toast(t('toast.noSite')); return; }
  ids.forEach(id => S.auditing.add(id));
  refresh();
  log(t('log.auditing', { n: ids.length }));
  let i = 0;
  await pool(ids, 3, async id => {
    const b = S.biz[id];
    try {
      b.audit = await auditSite(b.website, { psiKey: S.settings.psiKey, usePsi: S.settings.usePsi });
      if (b.audit.ok) enrich(b, b.audit.contacts);
    } catch (e) { b.audit = { ok: false, at: Date.now(), error: 'unreachable', msg: e.message }; }
    rescore(b);
    S.auditing.delete(id);
    persist(); refresh();
    log(t('log.audited', { i: ++i, n: ids.length, d: domainOf(b.website) }));
  });
}

/** Add public contacts found on the company's own website, without overwriting existing data. */
function enrich(b, c) {
  if (!b.email && c.emails[0]) { b.email = c.emails[0]; b.src.email = 'site'; }
  if (!b.phone && c.phones[0]) { b.phone = c.phones[0]; b.src.phone = 'site'; }
  for (const k of ['facebook', 'instagram']) if (!b[k] && c.social[k]) { b[k] = c.social[k]; b.src[k] = 'site'; }
  for (const [k, url] of Object.entries(c.social)) {
    if (k !== 'facebook' && k !== 'instagram' && !b.otherSocial.includes(url)) { b.otherSocial = [...b.otherSocial, url]; b.src.otherSocial = 'site'; }
  }
}

// ---------- prospect sheet ----------
function openSheet(id) {
  S.openId = id;
  renderSheet();
  $('#sheet').hidden = $('#sheetBackdrop').hidden = false;
  requestAnimationFrame(() => $('#sheet').classList.add('open'));
}
function closeSheet() {
  S.openId = null;
  $('#sheet').classList.remove('open');
  $('#sheetBackdrop').hidden = true;
  setTimeout(() => { if (!S.openId) $('#sheet').hidden = true; }, 200);
}

const srcLabel = s => s === 'gen' ? t('sheet.genLink') : s === 'site' ? t('sheet.fromSite') : s;

function renderSheet() {
  const b = S.biz[S.openId];
  if (!b) return closeSheet();
  const prio = priorityOf(b.score);
  const field = (k, v, link) => {
    const val = v == null || v === '' || (Array.isArray(v) && !v.length) ? `<span class="muted">${t('na')}</span>`
      : link ? [].concat(v).map(u => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(k === 'mapsUrl' ? 'Google Maps ↗' : u.replace(/^https?:\/\/(www\.)?/, ''))}</a>`).join('<br>')
      : esc(v);
    const s = b.src?.[k];
    return `<div class="field"><label>${t('col.' + k)}</label><div>${val}${s ? `<small class="src">${t('sheet.source', { s: srcLabel(s) })}</small>` : ''}</div></div>`;
  };
  const reasons = (b.reasons || []).map(r => `<li><span>${esc(t(r.k, r.p))}</span>${r.pts != null ? `<b class="${r.pts < 0 ? 'neg' : ''}">${r.pts > 0 ? '+' : ''}${r.pts}</b>` : ''}</li>`).join('');

  $('#sheet').innerHTML = `
  <header class="sh-head">
    <div><h2>${esc(b.name)}</h2><p class="muted">${esc([b.sector, b.city].filter(Boolean).join(' · '))}</p></div>
    <button class="ib" data-act="close" title="${t('btn.close')}">✕</button>
  </header>
  <div class="sh-body">
    <section class="sh-score">
      <div class="ring p-${prio}"><b>${b.score ?? '-'}</b><small>/100</small></div>
      <div><div class="badges"><span class="badge pr-${prio}">${t('prio.' + prio)}</span><span class="badge cat-${b.category || 'pending'}">${t('cat.' + (b.category || 'pending'))}</span></div>
      <h4>${t('sheet.reasons')}</h4><ul class="reasons">${reasons}</ul></div>
    </section>

    <section><h3>${t('sheet.contact')}</h3><div class="fields">
      ${field('address', b.address)}${field('phone', b.phone)}${field('email', b.email)}
      ${field('website', b.website, true)}${field('mapsUrl', b.mapsUrl, true)}${field('facebook', b.facebook, true)}
      ${field('instagram', b.instagram, true)}${field('otherSocial', b.otherSocial, true)}${b.listing ? field('listing', b.listing, true) : ''}
      ${field('rating', b.rating != null ? `${b.rating} / 5` : '')}${field('reviews', b.reviews)}
    </div>${b.osmUrl ? `<p><a href="${esc(b.osmUrl)}" target="_blank" rel="noopener">${t('sheet.osm')}</a></p>` : ''}</section>

    ${b.website ? `<section><h3>${t('sheet.audit')} <button class="btn sm" data-act="reaudit" ${S.auditing.has(b.id) ? 'disabled' : ''}>${t('btn.reaudit')}</button></h3>${auditHtml(b)}</section>` : ''}

    <section><h3>${t('sheet.crm')}</h3>
      <div class="crm">
        <label>${t('col.status')}<select data-f="status">${STATUSES.map(s => `<option value="${s}" ${b.status === s ? 'selected' : ''}>${t('st.' + s)}</option>`).join('')}</select></label>
        <label>${t('col.lastContact')}<input type="date" data-f="lastContact" value="${esc(b.lastContact)}"></label>
      </div>
      <div class="row-btns">
        <button class="btn sm ${b.saved ? 'on' : ''}" data-act="save">${ICON.save} ${t(b.saved ? 'sheet.saved' : 'btn.save')}</button>
        <button class="btn sm ${b.interesting ? 'on' : ''}" data-act="star">★ ${t('btn.interesting')}</button>
        <button class="btn sm" data-act="contacted">${t('btn.contacted')}</button>
        <button class="btn sm" data-act="client">${t('btn.client')}</button>
      </div>
      <label class="block">${t('sheet.notes')}<textarea data-f="notes" rows="4">${esc(b.notes)}</textarea></label>
      <h4>${t('sheet.history')}</h4>
      <div class="comment"><input id="commentIn" placeholder="${t('sheet.comment')}"><button class="btn sm" data-act="comment">${t('btn.addComment')}</button></div>
      <ul class="history">${(b.history || []).slice().reverse().map(h => `<li><time>${esc(h.date)}</time>${esc(h.text)}</li>`).join('')}</ul>
      <p class="muted small">${t('sheet.found', { d: new Date(b.foundAt).toLocaleDateString() })}</p>
      <button class="btn sm danger" data-act="delete">${t('btn.delete')}</button>
    </section>
  </div>`;
}

function auditHtml(b) {
  if (S.auditing.has(b.id)) return `<p class="muted pulse">${t('site.auditing')}</p>`;
  const a = b.audit;
  if (!a) return `<p class="muted">${t('sheet.noAudit')}</p>`;
  if (!a.ok) return `<p class="warn">${t('sheet.auditFail', { e: t('err.' + a.error) + (a.status ? ` (HTTP ${a.status})` : '') })}</p>`;
  const cats = [...Object.keys(CAT_WEIGHTS), 'global'];
  const meters = cats.map(c => {
    const v = a.scores[c];
    const label = c === 'global' ? t('col.auditGlobal') : t('col.' + c);
    return `<div class="meter ${c === 'global' ? 'global' : ''}"><span>${label}</span>${v == null
      ? `<em class="muted">${t('sheet.notVerified')}</em>`
      : `<div class="bt"><i class="${v >= 75 ? 'good' : v >= 50 ? 'mid' : 'bad'}" style="width:${v}%"></i></div><b>${v}</b>`}</div>`;
  }).join('');
  const psi = a.psi
    ? `<p class="small">${t('sheet.psi')} : Perf ${a.psi.perf ?? '-'} · A11y ${a.psi.acc ?? '-'} · SEO ${a.psi.seo ?? '-'} · BP ${a.psi.bp ?? '-'}${a.psi.field ? ` · ${t('sheet.field', { c: a.psi.field })}` : ''}</p>`
    : `<p class="small muted">${t('sheet.psiMissing', { e: a.psiError || '-' })}</p>`;
  const issues = issuesOf(a);
  return `<div class="meters">${meters}</div>${psi}
    <p class="small muted">${t('sheet.auditedAt', { d: new Date(a.at).toLocaleString() })} · ${t('sheet.checked', { n: a.checks.filter(c => c.v != null).length })}</p>
    <h4>${t('sheet.issues')}</h4>
    ${issues.length ? `<ul class="issues">${issues.map(c => `<li class="${c.v === 0 && c.w >= 3 ? 'sev' : ''}"><b>${esc(t('chk.' + c.id, c.p))}</b><span>${esc(t('rec.' + c.id))}</span></li>`).join('')}</ul>`
      : `<p class="muted">${t('sheet.noIssues')}</p>`}`;
}

function sheetAction(act) {
  const b = S.biz[S.openId];
  if (!b) return;
  const note = text => { b.history = [...(b.history || []), { date: today(), text }]; };
  switch (act) {
    case 'close': return closeSheet();
    case 'save': b.saved = !b.saved; break;
    case 'star': b.interesting = !b.interesting; b.saved ||= b.interesting; break;
    case 'contacted': b.status = 'contacted'; b.lastContact = today(); b.saved = true; note(t('st.contacted')); break;
    case 'client': b.status = 'client'; b.saved = true; note(t('st.client')); break;
    case 'reaudit': b.audit = null; auditMany([b.id]); break;
    case 'comment': {
      const v = $('#commentIn').value.trim();
      if (!v) return;
      note(v); b.saved = true; break;
    }
    case 'delete':
      if (!confirm(t('sheet.confirmDelete'))) return;
      delete S.biz[b.id];
      S.lastIds = S.lastIds.filter(id => id !== b.id);
      Object.values(S.sel).forEach(s => s.delete(b.id));
      persist(); closeSheet(); render(); return;
  }
  rescore(b); persist(); renderSheet(); render();
}

function sheetField(el) {
  const b = S.biz[S.openId];
  if (!b) return;
  const f = el.dataset.f;
  b[f] = el.value;
  if (f === 'status') { b.saved = true; b.history = [...(b.history || []), { date: today(), text: `${t('col.status')} : ${t('st.' + el.value)}` }]; }
  persist(); render();
  if (f === 'status') renderSheet();
}

// ---------- settings ----------
function fillSettings() {
  const f = $('#settingsForm');
  f.psiKey.value = S.settings.psiKey;
  f.usePsi.checked = S.settings.usePsi;
}

// ---------- wiring ----------
function bindStatic() {
  $('#nav').addEventListener('click', e => { const v = e.target.closest('button')?.dataset.view; if (v) show(v); });
  $('#langBtn').addEventListener('click', () => { S.settings.lang = S.settings.lang === 'fr' ? 'en' : 'fr'; saveSettings(); applyLanguage(); });
  $('#themeBtn').addEventListener('click', () => { S.settings.theme = S.settings.theme === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); });
  $('#searchForm').addEventListener('submit', runSearch);
  $('#settingsForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    Object.assign(S.settings, { psiKey: f.psiKey.value.trim(), usePsi: f.usePsi.checked });
    saveSettings(); toast(t('toast.saved'));
  });
  $('#dedupeBtn').addEventListener('click', dedupe);
  $('#clearBtn').addEventListener('click', () => {
    if (!confirm(t('set.confirmClear'))) return;
    S.biz = {}; S.lastIds = []; Object.values(S.sel).forEach(s => s.clear());
    persist(); toast(t('toast.cleared')); render();
  });
  $('#topList').addEventListener('click', e => { const id = e.target.closest('[data-id]')?.dataset.id; if (id) openSheet(id); });
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.openId) closeSheet(); });
  $('#sheet').addEventListener('click', e => { const a = e.target.closest('[data-act]')?.dataset.act; if (a) sheetAction(a); });
  $('#sheet').addEventListener('change', e => { if (e.target.dataset.f) sheetField(e.target); });
  $('#sheet').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'commentIn') sheetAction('comment'); });
  bindList('results');
  bindList('prospects');
}

async function init() {
  S.settings = { ...DEFAULT_SETTINGS, ...(await get('settings', {})) };
  S.biz = await get('biz', {});
  S.lastIds = (await get('lastIds', [])).filter(id => S.biz[id]);
  const f = $('#searchForm');
  f.autoAudit.checked = S.settings.autoAudit;
  applyTheme();
  bindStatic();
  applyLanguage();
  show(location.hash.slice(1));
}

init();
