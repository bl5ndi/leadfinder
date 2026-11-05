// Business processing: normalization, duplicate keys, merge into the local store.
import { domainOf, socialKind, slug, PLATFORM_RE } from './util.js';

export function normalize(raw) {
  const b = { phone: '', email: '', website: '', facebook: '', instagram: '', otherSocial: [], listing: '',
    rating: null, reviews: null, ...raw, src: { ...raw.src } };
  if (b.website && !/^https?:/i.test(b.website)) b.website = 'http://' + b.website;
  if (b.website) {
    // A social profile or a directory page is not an own website.
    const kind = socialKind(b.website);
    if (kind === 'facebook' || kind === 'instagram') {
      if (!b[kind]) { b[kind] = b.website; b.src[kind] = b.src.website; }
    } else if (kind) b.otherSocial = [...b.otherSocial, b.website];
    else if (PLATFORM_RE.test(domainOf(b.website))) { b.listing = b.website; b.src.listing = b.src.website; }
    if (kind || b.listing) { b.website = ''; delete b.src.website; }
  }
  return b;
}

/** Identity keys used for duplicate detection. Website domain is deliberately not one (chains share domains). */
export function keysOf(b) {
  const k = [];
  if (b.osmId) k.push('o:' + b.osmId);
  const ph = String(b.phone || '').replace(/\D/g, '').slice(-9);
  if (ph.length === 9) k.push('t:' + ph);
  const n = slug(b.name);
  if (n && (b.postcode || b.city)) k.push(`n:${n}|${b.postcode || slug(b.city)}`);
  return k;
}

const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length);

/** Fill only empty fields of t from b (never overwrites existing or user data). */
function fillEmpty(t, b) {
  for (const [k, v] of Object.entries(b)) {
    if (k === 'src' || k === 'id' || isEmpty(v) || !isEmpty(t[k])) continue;
    t[k] = v;
    if (b.src?.[k]) t.src[k] = b.src[k];
  }
}

/** Merge raw search results into store (id → business). Returns ids in result order. */
export function mergeAll(store, list) {
  const index = new Map();
  for (const b of Object.values(store)) for (const k of keysOf(b)) index.set(k, b.id);
  const ids = [];
  for (const raw of list) {
    if (!raw.name) continue;
    const b = normalize(raw);
    const hit = keysOf(b).map(k => index.get(k)).find(Boolean);
    let target;
    if (hit) { target = store[hit]; fillEmpty(target, b); }
    else {
      target = { ...b, id: crypto.randomUUID(), saved: false, status: 'new', interesting: false,
        notes: '', history: [], lastContact: '', audit: null, foundAt: Date.now() };
      store[target.id] = target;
    }
    for (const k of keysOf(target)) index.set(k, target.id);
    if (!ids.includes(target.id)) ids.push(target.id);
  }
  return ids;
}

/** Remove duplicates already in the store, keeping saved / older entries. Returns removed count. */
export function dedupeStore(store) {
  const list = Object.values(store).sort((a, b) => (b.saved - a.saved) || (a.foundAt - b.foundAt));
  const index = new Map();
  let removed = 0;
  for (const b of list) {
    const hit = keysOf(b).map(k => index.get(k)).find(id => id && id !== b.id);
    if (!hit) { for (const k of keysOf(b)) index.set(k, b.id); continue; }
    const t = store[hit];
    fillEmpty(t, b);
    t.history = [...(t.history || []), ...(b.history || [])];
    if (b.notes && !t.notes.includes(b.notes)) t.notes = [t.notes, b.notes].filter(Boolean).join('\n');
    delete store[b.id];
    removed++;
    for (const k of keysOf(t)) index.set(k, t.id);
  }
  return removed;
}
