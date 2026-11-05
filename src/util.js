// Small shared helpers (no dependencies).

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Run fn over items with at most n in flight. */
export async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export function domainOf(url) {
  try {
    return new URL(/^https?:/i.test(url) ? url : 'http://' + url).hostname.replace(/^www\./, '').toLowerCase();
  } catch { return ''; }
}

export const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '');

const SOCIAL = {
  facebook: /(^|\.)(facebook|fb)\.com$/,
  instagram: /(^|\.)instagram\.com$/,
  linkedin: /(^|\.)linkedin\.com$/,
  tiktok: /(^|\.)tiktok\.com$/,
  youtube: /(^|\.)(youtube\.com|youtu\.be)$/,
  x: /(^|\.)(twitter|x)\.com$/,
};

export function socialKind(url) {
  const d = domainOf(url);
  for (const [k, re] of Object.entries(SOCIAL)) if (re.test(d)) return k;
  return null;
}

// Directory / marketplace pages: a listing there is not the company's own website.
export const PLATFORM_RE = /(^|\.)(pagesjaunes\.fr|tripadvisor\.[a-z.]+|thefork\.[a-z.]+|lafourchette\.com|ubereats\.com|deliveroo\.[a-z.]+|just-eat\.[a-z.]+|doctolib\.[a-z.]+|linktr\.ee|booking\.com|business\.site|google\.com|g\.page|yelp\.[a-z.]+|planity\.com|treatwell\.[a-z.]+)$/;
