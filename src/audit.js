// Automatic website mini-audit.
// Each check = { cat, id, w (weight), v (0..1, or null = not verified), p (params for display) }.
// Only what is really fetched/measured gets a value; everything else stays null and is shown as "not verified".
// Runs in an extension page (needs DOMParser + host permissions to fetch any site).
import { socialKind, domainOf } from './util.js';
import { categoryScores } from './scoring.js';

const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|@(example|domain|email|sentry|wixpress|sentry-next)\.|^(votre|your|nom|name)[@.]/i;

async function load(url, timeout = 20000) {
  const t0 = performance.now();
  const res = await fetch(url, { redirect: 'follow', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(timeout) });
  const html = await res.text();
  return { res, html, ms: Math.round(performance.now() - t0), url: res.url || url };
}

async function exists(url, test) {
  try {
    const r = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(10000) });
    return r.ok && (!test || test(await r.text()));
  } catch { return false; }
}

export async function runPsi(url, key) {
  const q = new URLSearchParams({ url, strategy: 'mobile' });
  for (const c of ['performance', 'accessibility', 'seo', 'best-practices']) q.append('category', c);
  if (key) q.set('key', key);
  const res = await fetch(`${PSI}?${q}`, { signal: AbortSignal.timeout(120000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
  return j;
}

export async function auditSite(url, { psiKey = '', usePsi = true } = {}) {
  const at = Date.now();
  const checks = [];
  const add = (cat, id, w, v, p) => checks.push({ cat, id, w, v: v == null ? null : Math.max(0, Math.min(1, v)), p });

  // 1. Fetch the homepage (https first; fall back to http to tell "no SSL" from "site down").
  const https = url.replace(/^http:/i, 'https:');
  let page, sslBroken = false;
  try { page = await load(https); } catch {
    try { page = await load(url.replace(/^https:/i, 'http:')); sslBroken = true; } catch (e) {
      return { ok: false, at, url, error: e.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
    }
  }
  // Anti-bot / access protection: we never try to bypass it, the site must be checked by hand.
  if ([401, 403, 429, 503].includes(page.res.status)) return { ok: false, at, url, error: 'blocked', status: page.res.status };
  const psiP = usePsi ? runPsi(page.url, psiKey).catch(e => ({ error: e.message })) : Promise.resolve(null);

  const { res, html, ms } = page;
  const finalUrl = page.url;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const origin = new URL(finalUrl).origin;
  const $$ = s => [...doc.querySelectorAll(s)];
  const isHttps = finalUrl.startsWith('https:');

  // --- Security & technique
  add('security', 'https', 4, isHttps ? 1 : 0, { ssl: sslBroken });
  add('security', 'status', 3, res.ok ? 1 : 0, { s: res.status });
  if (isHttps) {
    add('security', 'hsts', 1, res.headers.get('strict-transport-security') ? 1 : 0);
    const mixed = $$('img[src^="http:"],script[src^="http:"],iframe[src^="http:"],link[rel=stylesheet][href^="http:"]').length;
    add('security', 'mixedContent', 2, mixed ? 0 : 1, { n: mixed });
  }
  const gen = doc.querySelector('meta[name=generator]')?.content || '';
  const wp = gen.match(/WordPress\s+(\d+)\.(\d+)/i);
  if (wp) add('security', 'oldCms', 1, Number(wp[1]) >= 6 ? 1 : 0, { v: `${wp[1]}.${wp[2]}` });
  const jq = $$('script[src]').map(s => s.getAttribute('src').match(/jquery[.-]?(\d)\.(\d+)/i)).find(Boolean);
  if (jq) add('security', 'oldJquery', 1, Number(jq[1]) >= 3 ? 1 : 0, { v: `${jq[1]}.${jq[2]}` });

  // --- Design & UX (objective proxies only; visual taste is not measured)
  const deprecated = $$('font,center,marquee,blink,frameset,frame').length;
  add('design', 'deprecatedTags', 3, deprecated ? 0 : 1, { n: deprecated });
  const flash = $$('object,embed').filter(e => /\.swf/i.test(e.outerHTML)).length;
  add('design', 'flash', 3, flash ? 0 : 1);
  const layoutTables = $$('table table, table[width], body > table').length;
  add('design', 'tableLayout', 2, layoutTables ? 0 : 1, { n: layoutTables });
  const hrefs = $$('a[href]').map(a => a.getAttribute('href'));
  const hasCta = hrefs.some(h => /^(tel|mailto):/i.test(h)) || $$('form').length > 0;
  add('design', 'contactCta', 2, hasCta ? 1 : 0);
  add('design', 'navigation', 1, $$('nav, header a, [role=navigation]').length ? 1 : 0);
  // Copyright year is only a weak hint and can never by itself make a site "outdated".
  const year = (doc.body?.textContent.match(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/i) || [])[1];
  if (year) add('design', 'copyright', 0.5, new Date().getFullYear() - Number(year) <= 3 ? 1 : 0.5, { y: year });

  // --- Mobile
  const vp = doc.querySelector('meta[name=viewport]')?.content || '';
  add('mobile', 'viewport', 4, /width\s*=\s*device-width/i.test(vp) ? 1 : 0);
  const fixedW = $$('[width],[style]').filter(e => {
    const w = Number(e.getAttribute('width')) || Number((e.getAttribute('style') || '').match(/(?:^|;)\s*width\s*:\s*(\d+)px/i)?.[1]);
    return w >= 800;
  }).length;
  add('mobile', 'fixedWidth', 2, fixedW ? 0 : 1, { n: fixedW });

  // --- Performance (basic, always measured from this browser)
  add('performance', 'responseTime', 2, ms <= 1000 ? 1 : ms <= 2500 ? 0.5 : 0, { ms });
  const kb = Math.round(html.length / 1024);
  add('performance', 'htmlSize', 1, kb <= 300 ? 1 : kb <= 800 ? 0.5 : 0, { kb });
  const imgs = $$('img');
  if (imgs.length > 8) {
    const lazy = imgs.filter(i => i.getAttribute('loading') === 'lazy').length;
    add('performance', 'lazyImages', 1, lazy / imgs.length >= 0.5 ? 1 : 0, { n: imgs.length - lazy });
  }

  // --- SEO
  const title = doc.title.trim();
  add('seo', 'title', 3, !title ? 0 : title.length >= 10 && title.length <= 70 ? 1 : 0.5, { n: title.length });
  const desc = doc.querySelector('meta[name=description]')?.content?.trim() || '';
  add('seo', 'metaDesc', 3, !desc ? 0 : desc.length >= 50 && desc.length <= 170 ? 1 : 0.5, { n: desc.length });
  const h1 = $$('h1').length;
  add('seo', 'h1', 2, h1 === 1 ? 1 : h1 > 1 ? 0.5 : 0, { n: h1 });
  add('seo', 'h2', 1, $$('h2').length ? 1 : 0);
  add('seo', 'lang', 1, doc.documentElement.getAttribute('lang') ? 1 : 0);
  const noindex = /noindex/i.test(doc.querySelector('meta[name=robots]')?.content || '') || /noindex/i.test(res.headers.get('x-robots-tag') || '');
  add('seo', 'indexable', 3, noindex ? 0 : 1);
  add('seo', 'canonical', 1, doc.querySelector('link[rel=canonical]') ? 1 : 0);
  add('seo', 'structuredData', 1, doc.querySelector('script[type="application/ld+json"],[itemtype]') ? 1 : 0);
  add('seo', 'openGraph', 1, doc.querySelector('meta[property^="og:"]') ? 1 : 0);
  if (imgs.length) {
    const alt = imgs.filter(i => (i.getAttribute('alt') || '').trim()).length;
    add('seo', 'imgAlt', 1, alt / imgs.length, { n: imgs.length - alt });
  }
  const internal = hrefs.filter(h => h && !/^(#|mailto:|tel:|javascript:)/i.test(h) && (!/^https?:/i.test(h) || h.startsWith(origin)));
  if (internal.length >= 3) {
    const ugly = internal.filter(h => /\?(page_id|p|id|option|cat)=|\.(php|aspx?|cfm)(\?|$)/i.test(h)).length;
    add('seo', 'cleanUrls', 1, 1 - ugly / internal.length, { n: ugly });
  }
  const robots = await fetch(origin + '/robots.txt', { credentials: 'omit', signal: AbortSignal.timeout(10000) })
    .then(r => r.ok ? r.text() : '').catch(() => '');
  const sitemapUrl = robots.match(/^\s*sitemap:\s*(\S+)/im)?.[1] || origin + '/sitemap.xml';
  add('seo', 'sitemap', 2, await exists(sitemapUrl, t => /<(urlset|sitemapindex)/i.test(t)) ? 1 : 0);

  // --- Public contacts published on the site (homepage + contact page)
  const contacts = { emails: [], social: {}, phones: [] };
  extractContacts(doc, finalUrl, contacts);
  const contactHref = $$('a[href]').find(a => /contact/i.test(a.getAttribute('href') + ' ' + a.textContent))?.getAttribute('href');
  if (contactHref) {
    try {
      const cu = new URL(contactHref, finalUrl);
      if (cu.origin === origin) {
        const cp = await load(cu.href, 12000);
        extractContacts(new DOMParser().parseFromString(cp.html, 'text/html'), cp.url, contacts);
      }
    } catch { /* contact page optional */ }
  }
  const site = domainOf(finalUrl);
  contacts.emails.sort((a, b) => (b.endsWith(site) - a.endsWith(site)));

  // --- PageSpeed Insights (Lighthouse, mobile) when available
  const j = await psiP;
  let psi = null, psiError = j?.error || (usePsi ? null : 'disabled');
  if (j && !j.error) {
    const cat = j.lighthouseResult?.categories || {};
    const a = j.lighthouseResult?.audits || {};
    const num = id => a[id]?.numericValue;
    psi = {
      perf: pct(cat.performance?.score), acc: pct(cat.accessibility?.score),
      seo: pct(cat.seo?.score), bp: pct(cat['best-practices']?.score),
      lcp: num('largest-contentful-paint'), cls: num('cumulative-layout-shift'),
      tbt: num('total-blocking-time'), fcp: num('first-contentful-paint'), weight: num('total-byte-weight'),
      field: j.loadingExperience?.overall_category || null, // real-user Core Web Vitals (CrUX), if Google has data
    };
    if (psi.perf != null) add('performance', 'psiPerf', 5, psi.perf / 100, { s: psi.perf });
    if (psi.lcp != null) add('performance', 'lcp', 2, psi.lcp <= 2500 ? 1 : psi.lcp <= 4000 ? 0.5 : 0, { s: (psi.lcp / 1000).toFixed(1) });
    if (psi.cls != null) add('performance', 'cls', 1, psi.cls <= 0.1 ? 1 : psi.cls <= 0.25 ? 0.5 : 0, { s: psi.cls.toFixed(2) });
    if (psi.tbt != null) add('performance', 'tbt', 1, psi.tbt <= 200 ? 1 : psi.tbt <= 600 ? 0.5 : 0, { s: Math.round(psi.tbt) });
    if (psi.weight != null) add('performance', 'weight', 1, psi.weight <= 2e6 ? 1 : psi.weight <= 4e6 ? 0.5 : 0, { s: (psi.weight / 1e6).toFixed(1) });
    const img = ['uses-optimized-images', 'modern-image-formats', 'uses-responsive-images'].map(id => a[id]?.score).filter(s => s != null);
    if (img.length) add('performance', 'images', 1, Math.min(...img));
    if (psi.acc != null) add('mobile', 'psiAccessibility', 3, psi.acc / 100, { s: psi.acc });
    if (psi.seo != null) add('seo', 'psiSeo', 2, psi.seo / 100, { s: psi.seo });
    if (psi.bp != null) add('security', 'psiBestPractices', 2, psi.bp / 100, { s: psi.bp });
  }

  return { ok: true, at, url: finalUrl, ms, checks, scores: categoryScores(checks), psi, psiError, contacts };
}

const pct = s => s == null ? null : Math.round(s * 100);

function extractContacts(doc, base, acc) {
  const addEmail = e => {
    e = decodeURIComponent(e).trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !BAD_EMAIL.test(e) && !acc.emails.includes(e)) acc.emails.push(e);
  };
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href').trim();
    if (/^mailto:/i.test(href)) { addEmail(href.slice(7).split('?')[0]); continue; }
    if (/^tel:/i.test(href)) { const p = href.slice(4).trim(); if (!acc.phones.includes(p)) acc.phones.push(p); continue; }
    let abs; try { abs = new URL(href, base).href; } catch { continue; }
    const k = socialKind(abs);
    if (k && !acc.social[k] && !/sharer|share\?|intent\/|plugins|\/dialog\//i.test(abs)) acc.social[k] = abs;
  }
  // Join text nodes with spaces: textContent glues "a@b.fr</p><a>Facebook" into "a@b.frFacebook".
  const texts = [];
  if (doc.body) for (const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT); w.nextNode();) texts.push(w.currentNode.nodeValue);
  for (const m of texts.join(' ').matchAll(EMAIL_RE)) addEmail(m[0]);
}
