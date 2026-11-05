// OpenStreetMap: free, no key. Nominatim (geocoding) + Overpass (business search).
// Data © OpenStreetMap contributors, ODbL. Usage policies: max ~1 req/s on Nominatim, be gentle with Overpass.
import { SECTORS } from '../sectors.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const SRC = 'OpenStreetMap';

// "All businesses" when no sector is chosen: named shops, trades, offices and commercial places.
const ALL = ['shop', 'craft', 'office', 'healthcare', 'tourism~"^(hotel|guest_house|motel|hostel)$"', 'leisure~"^(fitness_centre|sports_centre)$"',
  'amenity~"^(restaurant|fast_food|cafe|bar|pub|dentist|doctors|clinic|pharmacy|car_wash|car_rental|veterinary|driving_school)$"'];
const BUSINESS_CLASSES = ['shop', 'craft', 'office', 'healthcare', 'tourism', 'leisure', 'amenity'];

export async function searchOsm({ sector, name, city, postcode, country, lang = 'fr', limit = 300 }) {
  const place = [postcode, city, country].filter(Boolean).join(', ');
  if (!place) {
    if (!name) throw new Error('OpenStreetMap : indiquez une ville, un code postal ou un pays pour chercher un secteur');
    return searchByName(name, lang);
  }

  const geo = await (await fetch(`${NOMINATIM}?${new URLSearchParams({ format: 'json', limit: 1, q: place, 'accept-language': lang })}`)).json();
  if (!geo[0]) throw new Error(`OpenStreetMap: zone introuvable « ${place} »`);
  const g = geo[0];
  const areaId = g.osm_type === 'relation' ? 3600000000 + Number(g.osm_id) : null;
  const [s, n, w, e] = g.boundingbox;
  const scope = areaId ? '(area.a)' : `(${s},${w},${n},${e})`;

  const nameF = name ? `["name"~"${reEsc(name)}",i]` : '["name"]';
  const filters = sector ? SECTORS[sector].osm : ALL;
  const ql = `[out:json][timeout:60];${areaId ? `area(id:${areaId})->.a;` : ''}(${filters
    .map(f => `nwr[${f}]${nameF}${scope};`).join('')});out tags center ${limit};`;

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

/** No location given: worldwide search of a business by name (Nominatim, with phone/website tags). */
async function searchByName(name, lang) {
  const q = new URLSearchParams({ format: 'jsonv2', limit: 40, q: name, extratags: 1, addressdetails: 1, 'accept-language': lang });
  const res = await fetch(`${NOMINATIM}?${q}`);
  if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
  return (await res.json()).filter(r => BUSINESS_CLASSES.includes(r.category)).map(r => {
    const a = r.address || {};
    const city = a.city || a.town || a.village || a.municipality || '';
    return fromOsm({ type: r.osm_type, id: r.osm_id, tags: {
      ...r.extratags, name: r.name, [r.category]: r.type,
      'addr:street': a.road, 'addr:housenumber': a.house_number, 'addr:postcode': a.postcode, 'addr:city': city,
    } }, '', '', a.country || '');
  });
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
