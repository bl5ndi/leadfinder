// Run: node tests/test.mjs  — checks pure modules (processing, scoring, export).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mergeAll, dedupeStore, normalize } from '../src/process.js';
import { scoreBusiness, categoryScores, priorityOf } from '../src/scoring.js';
import { toRows, toCsv, toXlsx } from '../src/export.js';

// normalize: social / directory URLs are not own websites
let b = normalize({ name: 'A', website: 'https://www.facebook.com/resto', src: { website: 'OSM' } });
assert.equal(b.website, ''); assert.equal(b.facebook, 'https://www.facebook.com/resto');
b = normalize({ name: 'B', website: 'https://www.pagesjaunes.fr/pros/123', src: {} });
assert.equal(b.website, ''); assert.ok(b.listing);
b = normalize({ name: 'C', website: 'resto.fr', src: {} });
assert.equal(b.website, 'http://resto.fr');

// merge + dedupe
const store = {};
const ids1 = mergeAll(store, [
  { name: 'Le Gourmet', city: 'Lyon', postcode: '69001', phone: '04 78 00 00 00', src: {} },
  { name: 'Le Gourmet', city: 'Lyon', postcode: '69001', phone: '+33 4 78 00 00 00', email: 'a@legourmet.fr', src: { email: 'OSM' } },
  { name: 'Chez Paul', city: 'Lyon', src: {} },
]);
assert.equal(ids1.length, 2, 'same phone → same business');
assert.equal(store[ids1[0]].email, 'a@legourmet.fr', 'empty field filled from duplicate');
store[ids1[0]].notes = 'rappeler';
mergeAll(store, [{ name: 'Le Gourmet', postcode: '69001', email: 'other@x.fr', src: {} }]);
assert.equal(store[ids1[0]].email, 'a@legourmet.fr', 'never overwrite existing data');
assert.equal(store[ids1[0]].notes, 'rappeler');
// force a duplicate into the store, then dedupe
store.dup = { ...store[ids1[1]], id: 'dup', saved: true, foundAt: Date.now() + 1, notes: 'n2', history: [] };
assert.equal(dedupeStore(store), 1);
assert.equal(Object.keys(store).length, 2);
assert.ok(store.dup?.saved, 'saved entry kept as master');

// scoring: no website
let s = scoreBusiness({ name: 'X', website: '', phone: '01', instagram: 'https://instagram.com/x', reviews: 40, rating: 4.6 });
assert.equal(s.category, 'none'); assert.ok(s.score >= 80, 'no site + active → priority: ' + s.score);
s = scoreBusiness({ name: 'Y', website: '' });
assert.equal(s.score, 45, 'no site, no contact, no activity → low');
// website not audited: no fake score
s = scoreBusiness({ name: 'Z', website: 'http://z.fr', audit: null });
assert.equal(s.score, null); assert.equal(priorityOf(s.score), 'pending');
// blocked by anti-bot: no score
s = scoreBusiness({ name: 'Z', website: 'http://z.fr', audit: { ok: false, error: 'blocked', status: 403 } });
assert.equal(s.score, null);
// category scores ignore unverified checks
const checks = [
  { cat: 'mobile', id: 'viewport', w: 4, v: 0 }, { cat: 'mobile', id: 'fixedWidth', w: 2, v: 1 },
  { cat: 'seo', id: 'title', w: 3, v: 1 }, { cat: 'design', id: 'x', w: 1, v: null },
];
const sc = categoryScores(checks);
assert.equal(sc.mobile, 33); assert.equal(sc.seo, 100); assert.equal(sc.design, null);
s = scoreBusiness({ name: 'W', website: 'http://w.fr', phone: '1', audit: { ok: true, checks, scores: sc, psi: null } });
assert.equal(s.category, 'outdated', 'non-responsive → outdated');
assert.ok(s.reasons.some(r => r.k === 'chk.viewport'));
assert.ok(s.reasons.some(r => r.k === 'r.partialAudit'));

// good average but one very weak area → to improve, not "good"
const perfChecks = [{ cat: 'performance', id: 'psiPerf', w: 5, v: 0.3 }, { cat: 'seo', id: 'title', w: 3, v: 1 },
  { cat: 'mobile', id: 'viewport', w: 4, v: 1 }, { cat: 'design', id: 'flash', w: 3, v: 1 }, { cat: 'security', id: 'https', w: 4, v: 1 }];
const ps = categoryScores(perfChecks);
assert.ok(ps.global >= 75, 'global hides the weak area: ' + ps.global);
assert.equal(scoreBusiness({ name: 'P', website: 'x', audit: { ok: true, checks: perfChecks, scores: ps, psi: {} } }).category, 'improve');

// export
const t = (k, p) => p ? `${k}(${JSON.stringify(p)})` : k;
const list = Object.values(store).map(x => Object.assign(x, scoreBusiness(x)));
list[0].notes = '=HYPERLINK("evil")'; list[0].phone = '+33 4 78';
const rows = toRows(list, t);
assert.equal(rows.length, list.length + 1);
const csv = toCsv(rows);
assert.ok(csv.startsWith('﻿'));
assert.ok(csv.includes(`"'=HYPERLINK(""evil"")"`), 'formula injection neutralized');
assert.ok(csv.includes(';+33 4 78;'), 'phone numbers kept as is');
const xlsx = toXlsx(rows);
writeFileSync(process.argv[2] || 'test.xlsx', xlsx);
console.log('All tests passed. xlsx bytes:', xlsx.length);
