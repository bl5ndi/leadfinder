// OpenStreetMap — free, no key. Nominatim (geocoding) + Overpass (business search).
// Data © OpenStreetMap contributors, ODbL. Usage policies: max ~1 req/s on Nominatim, be gentle with Overpass.
import { SECTORS } from '../sectors.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const SRC = 'OpenStreetMap';

export async function searchOsm({ sector, name, city, postcode, country, lang = 'fr', limit = 300 }) {
  const place = [postcode, city, country].filter(Boolean).join(', ');
  if (!place) throw new Error('OpenStreetMap: ville, code postal ou pays requis');
  if (!sector && !name) throw new Error('OpenStreetMap: secteur ou nom requis');

  const geo = await (await fetch(`${NOMINATIM}?${new URLSearchParams({ format: 'json', limit: 1, q: place, 'accept-language': lang })}`)).json();
  if (!geo[0]) throw new Error(`OpenStreetMap: zone introuvable « ${place} »`);
  const g = geo[0];
  const areaId = g.osm_type === 'relation' ? 3600000000 + Number(g.osm_id) : null;
  const [s, n, w, e] = g.boundingbox;
  const scope = areaId ? '(area.a)' : `(${s},${w},${n},${e})`;

  const nameF = name ? `["name"~"${reEsc(name)}",i]` : '["name"]';
  const filters = sector ? SECTORS[sector].osm : [''];
  const ql = `[out:json][timeout:60];${areaId ? `area(id:${areaId})->.a;` : ''}(${filters
    .map(f => `nwr${f ? `[${f}]` : ''}${nameF}${scope};`).join('')});out tags center ${limit};`;

  let res;
  for (const endpoint of OVERPASS) { // public instances are often busy: try the next mirror
    res = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ data: ql }), signal: AbortSignal.timeout(70000) }).catch(() => null);
    if (res?.ok) break;
  }
  if (!res?.ok) throw new Error(`Overpass: HTTP ${res?.status ?? 'réseau'} (serveurs surchargés, réessayez dans 1 min)`);
  const j = await res.json();
  const label = sector ? SECTORS[sector][lang] || SECTORS[sector].fr : '';
  return (j.elements || []).map(el => fromOsm(el, label, areaId ? city : '', country));
}

// Escape for an Overpass regex inside double quotes.
const reEsc = s => s.replace(/["\\]/g, '').replace(/[.*+?^${}()|[\]]/g, '\\$&');

function fromOsm(el, sectorLabel, areaCity, country) {
  const t = el.tags || {};
  const first = v => (v || '').split(';')[0].trim();
  const social = (v, host) => !v ? '' : /^https?:/i.test(v) ? v : `https://${host}/${v.replace(/^@/, '')}`;
  const city = t['addr:city'] || areaCity;
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const b = {
    osmId: `${el.type}/${el.id}`,
    name: t.name || '',
    sector: sectorLabel || t.amenity || t.shop || t.craft || t.office || t.tourism || t.healthcare || '',
    address: [street, t['addr:postcode'], city].filter(Boolean).join(', '),
    city,
    postcode: t['addr:postcode'] || '',
    country: t['addr:country'] || country || '',
    phone: first(t.phone || t['contact:phone'] || t['contact:mobile']),
    email: first(t.email || t['contact:email']),
    website: first(t.website || t['contact:website'] || t.url),
    facebook: social(first(t['contact:facebook'] || t.facebook), 'facebook.com'),
    instagram: social(first(t['contact:instagram'] || t.instagram), 'instagram.com'),
    // Not a place URL: a Google Maps search link generated from name + city.
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([t.name, street, city].filter(Boolean).join(' '))}`,
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    src: { mapsUrl: 'gen' },
  };
  for (const k of ['name', 'sector', 'address', 'city', 'postcode', 'country', 'phone', 'email', 'website', 'facebook', 'instagram'])
    if (b[k]) b.src[k] = SRC;
  return b;
}
