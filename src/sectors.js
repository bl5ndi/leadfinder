// Business sectors: display labels + OpenStreetMap tag filters (Overpass QL).
export const SECTORS = {
  restaurant:  { fr: 'Restaurants', en: 'Restaurants', osm: ['amenity~"^(restaurant|fast_food)$"'] },
  cafe:        { fr: 'Cafés & bars', en: 'Cafés & bars', osm: ['amenity~"^(cafe|bar|pub)$"'] },
  bakery:      { fr: 'Boulangeries & pâtisseries', en: 'Bakeries', osm: ['shop~"^(bakery|pastry|confectionery)$"'] },
  beauty:      { fr: 'Coiffure & beauté', en: 'Hair & beauty', osm: ['shop~"^(hairdresser|beauty|cosmetics)$"'] },
  car:         { fr: 'Garages automobiles', en: 'Car repair', osm: ['shop~"^(car_repair|car|tyres)$"', 'amenity="car_wash"'] },
  dentist:     { fr: 'Cabinets dentaires', en: 'Dentists', osm: ['amenity="dentist"', 'healthcare="dentist"'] },
  health:      { fr: 'Médecins & santé', en: 'Doctors & health', osm: ['amenity~"^(doctors|clinic)$"', 'healthcare~"^(physiotherapist|psychotherapist|optometrist|podiatrist)$"'] },
  pharmacy:    { fr: 'Pharmacies', en: 'Pharmacies', osm: ['amenity="pharmacy"'] },
  craft:       { fr: 'Artisans du bâtiment', en: 'Trades & builders', osm: ['craft~"^(plumber|electrician|carpenter|painter|roofer|builder|hvac|tiler|stonemason|glaziery|locksmith|joiner)$"'] },
  legal:       { fr: 'Avocats & notaires', en: 'Lawyers & notaries', osm: ['office~"^(lawyer|notary)$"'] },
  accountant:  { fr: 'Comptables', en: 'Accountants', osm: ['office~"^(accountant|tax_advisor)$"'] },
  realestate:  { fr: 'Agences immobilières', en: 'Real estate agencies', osm: ['office="estate_agent"', 'shop="estate_agent"'] },
  hotel:       { fr: 'Hôtels & hébergements', en: 'Hotels & lodging', osm: ['tourism~"^(hotel|guest_house|motel|hostel)$"'] },
  fitness:     { fr: 'Salles de sport', en: 'Gyms & fitness', osm: ['leisure~"^(fitness_centre|sports_centre)$"'] },
  florist:     { fr: 'Fleuristes', en: 'Florists', osm: ['shop="florist"'] },
  retail:      { fr: 'Commerces de détail', en: 'Retail shops', osm: ['shop~"^(clothes|shoes|jewelry|gift|furniture|butcher|cheese|wine|deli|optician)$"'] },
};
