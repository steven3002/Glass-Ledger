/**
 * Where a location label sits on the globe.
 *
 * The chain holds the *label* — "Lagos - Ikoyi", posted with the tranche and readable forever. The
 * coordinates are this page's own atlas: a display convenience for drawing the pin, never a fact the
 * ledger asserts. The map says so out loud, and a label the atlas does not know is listed beside the
 * map rather than silently dropped — an unplottable location is still a location.
 */

export type Place = { name: string; lat: number; lon: number };

/** The atlas: places a consignment might name, most specific spellings first. */
const ATLAS: [string, Place][] = [
  // Lagos districts — the shop's home turf gets street-level pins.
  ["ikoyi", { name: "Lagos — Ikoyi", lat: 6.4541, lon: 3.4316 }],
  ["lekki", { name: "Lagos — Lekki", lat: 6.4478, lon: 3.4723 }],
  ["victoria island", { name: "Lagos — Victoria Island", lat: 6.4281, lon: 3.4219 }],
  ["yaba", { name: "Lagos — Yaba", lat: 6.5095, lon: 3.3711 }],
  ["surulere", { name: "Lagos — Surulere", lat: 6.5059, lon: 3.3509 }],
  ["ikeja", { name: "Lagos — Ikeja", lat: 6.6018, lon: 3.3515 }],
  // Nigerian cities.
  ["lagos", { name: "Lagos", lat: 6.5244, lon: 3.3792 }],
  ["abuja", { name: "Abuja", lat: 9.0765, lon: 7.3986 }],
  ["port harcourt", { name: "Port Harcourt", lat: 4.8156, lon: 7.0498 }],
  ["ibadan", { name: "Ibadan", lat: 7.3775, lon: 3.947 }],
  ["kano", { name: "Kano", lat: 12.0022, lon: 8.592 }],
  ["enugu", { name: "Enugu", lat: 6.4584, lon: 7.5464 }],
  ["benin city", { name: "Benin City", lat: 6.335, lon: 5.6037 }],
  // Where the diaspora shops.
  ["accra", { name: "Accra", lat: 5.6037, lon: -0.187 }],
  ["nairobi", { name: "Nairobi", lat: -1.2921, lon: 36.8219 }],
  ["johannesburg", { name: "Johannesburg", lat: -26.2041, lon: 28.0473 }],
  ["london", { name: "London", lat: 51.5074, lon: -0.1278 }],
  ["paris", { name: "Paris", lat: 48.8566, lon: 2.3522 }],
  ["new york", { name: "New York", lat: 40.7128, lon: -74.006 }],
  ["atlanta", { name: "Atlanta", lat: 33.749, lon: -84.388 }],
  ["houston", { name: "Houston", lat: 29.7604, lon: -95.3698 }],
  ["toronto", { name: "Toronto", lat: 43.6532, lon: -79.3832 }],
  ["dubai", { name: "Dubai", lat: 25.2048, lon: 55.2708 }],
];

/** The most specific place a label names, or nothing — never a guess. */
export function placeOf(label: string): Place | undefined {
  const said = label.toLowerCase();
  return ATLAS.find(([key]) => said.includes(key))?.[1];
}
