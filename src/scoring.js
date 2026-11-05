// Commercial scoring /100 for Neti Labs. Every point comes with a reason (k = i18n key, pts, p = params).
// Missing information is never treated as bad quality: unverified checks (v = null) are excluded.
import { domainOf } from './util.js';

export const CAT_WEIGHTS = { design: 0.2, mobile: 0.25, performance: 0.2, seo: 0.2, security: 0.15 };

/** Per-category scores (0..100 or null if nothing verified) + weighted global. */
export function categoryScores(checks) {
  const out = {};
  for (const cat of Object.keys(CAT_WEIGHTS)) {
    const cs = checks.filter(c => c.cat === cat && c.v != null);
    const w = cs.reduce((s, c) => s + c.w, 0);
    out[cat] = w ? Math.round(100 * cs.reduce((s, c) => s + c.w * c.v, 0) / w) : null;
  }
  const known = Object.keys(CAT_WEIGHTS).filter(c => out[c] != null);
  const tw = known.reduce((s, c) => s + CAT_WEIGHTS[c], 0);
  out.global = tw ? Math.round(known.reduce((s, c) => s + out[c] * CAT_WEIGHTS[c], 0) / tw) : null;
  return out;
}

/** Most important failed checks first. */
export const issuesOf = audit => (audit?.checks || [])
  .filter(c => c.v != null && c.v < 1).sort((a, b) => b.w * (1 - b.v) - a.w * (1 - a.v));

export function scoreBusiness(b) {
  const reasons = [];
  const add = (k, pts, p) => { reasons.push({ k, pts, p }); return pts; };
  const contactable = b.phone || b.email;
  let s, category;

  if (!b.website) {
    category = 'none';
    s = add('r.noWebsite', 60);
    if (b.facebook || b.instagram || b.otherSocial?.length) s += add('r.socialOnly', 10);
    if (b.listing) s += add('r.listingOnly', 5, { d: domainOf(b.listing) });
    if (contactable) s += add('r.contactable', 10);
    else if (!b.facebook && !b.instagram) s += add('r.noContact', -15);
    if (b.reviews >= 20) s += add('r.activeReviews', 10, { n: b.reviews });
    else if (b.reviews >= 5) s += add('r.someReviews', 5, { n: b.reviews });
    if (b.rating >= 4) s += add('r.goodRating', 5, { r: b.rating });
    // OSM often lacks the website tag: absence of data is not proof of absence of a site.
    reasons.push({ k: 'r.unconfirmedNoSite', pts: null });
  } else if (!b.audit) {
    return { score: null, category: 'pending', reasons: [{ k: 'r.notAudited', pts: null }] };
  } else if (b.audit.error === 'blocked') {
    return { score: null, category: 'pending', reasons: [{ k: 'r.blocked', pts: null, p: { s: b.audit.status } }] };
  } else if (!b.audit.ok) {
    category = 'improve';
    s = add('r.unreachable', 55, { e: b.audit.error });
    if (contactable) s += add('r.contactable', 5);
  } else {
    const sc = b.audit.scores;
    s = add('r.auditGap', 100 - sc.global, { g: sc.global });
    const outdated = (sc.mobile != null && sc.mobile < 50) || (sc.design != null && sc.design < 50);
    // An average can hide one very weak area (e.g. 6 s load time): any category < 50 means "to improve".
    const weak = ['performance', 'seo', 'security'].some(c => sc[c] != null && sc[c] < 50);
    category = outdated ? 'outdated' : sc.global < 75 || weak ? 'improve' : 'good';
    if (outdated) s += add('r.outdated', 15);
    if (contactable) s += add('r.contactable', 5);
    if (b.reviews >= 20) s += add('r.activeReviews', 5, { n: b.reviews });
    for (const c of issuesOf(b.audit).slice(0, 5)) reasons.push({ k: 'chk.' + c.id, pts: null, p: c.p });
    if (!b.audit.psi) reasons.push({ k: 'r.partialAudit', pts: null });
  }
  return { score: Math.max(0, Math.min(100, Math.round(s))), category, reasons };
}

export const priorityOf = s => s == null ? 'pending' : s >= 80 ? 'high' : s >= 50 ? 'mid' : 'low';
