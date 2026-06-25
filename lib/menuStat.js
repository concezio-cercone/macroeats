/* ===========================================================================
 * menuStat.js — VERIFIED macros for ~60 chains, imported from MenuStat 2022.
 *
 * This is the bulk verified-macro source. Where lib/chains.js is a small,
 * hand-curated set with rich modifiers ("no rice, double chicken") and real
 * prices, this covers the long tail of national chains (Pizza Hut, Golden
 * Corral, Applebee's, Arby's, KFC, Burger King, Domino's, Dairy Queen …) with
 * their official published per-item nutrition.
 *
 * Resolution order in the app: learned store → curated chains.js → THIS →
 * cuisine estimate. When a place matches BOTH chains.js and this, the curated
 * store wins and these items are MERGED in for extra breadth (see mergeInto).
 *
 * Macros are real (verified:true → green check). Prices are estimates (MenuStat
 * has no prices); each item's source string says so. Most items have no
 * modifiers; pizza-slice items get "+1 / +2 slices" so a slice isn't a "meal".
 *
 * Regenerate the data file:  python build_menustat.py
 * ======================================================================== */

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "menustat-chains.json");

let DB = { chains: {}, chainCount: 0, itemCount: 0 };
try {
  DB = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
} catch (e) {
  // Data file missing/unbuilt — the app still runs, just without this source.
  console.warn("menuStat: could not load " + DATA_PATH + " (" + e.message +
    "). Run `python build_menustat.py`. Continuing without MenuStat chains.");
}

// Match-normalize a name: lowercase, drop apostrophes, collapse to spaces.
// Mirrors norm() in build_menustat.py so stored fragments line up.
function norm(s) {
  return String(s || "").toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Fast lookup: name fragment -> chain key, longest fragment first so a specific
// match ("california pizza") beats a generic one.
const MATCH_INDEX = [];
for (const [key, def] of Object.entries(DB.chains || {})) {
  for (const frag of def.match || []) MATCH_INDEX.push({ frag, key });
}
MATCH_INDEX.sort((a, b) => b.frag.length - a.frag.length);

function chainKeyFor(placeName) {
  const n = norm(placeName);
  if (!n) return null;
  const hit = MATCH_INDEX.find(m => n.includes(m.frag));
  return hit ? hit.key : null;
}

// Turn a stored item into the runtime item shape the engine expects.
function hydrate(i) {
  return {
    name: i.name,
    course: i.course,
    carbType: i.carbType,
    cheese: !!i.cheese,
    price: i.price,
    base: i.base,
    verified: true,      // real published macros → green check
    source: i.source,
    modifiers: i.modifiers || [],   // usually none; pizza slices get slice-count mods
  };
}

// Given a discovered place name, return a verified MenuStat store or null.
// Mirrors chainStoreFor() in lib/chains.js.
function menuStatStoreFor(placeName, place) {
  const key = chainKeyFor(placeName);
  if (!key) return null;
  const def = DB.chains[key];
  place = place || {};
  return {
    restaurant: place.name || placeName,
    platform: null,
    region: def.region,
    cuisines: def.cuisines,
    diets: def.diets || [],
    lat: place.lat, lng: place.lng,
    hours: place.hours || null,
    locationCount: place.locationCount || 1,
    discovered: true,
    chain: true,
    menustat: true,      // flag: came from the MenuStat source
    items: def.items.map(hydrate),
  };
}

// Merge a MenuStat store's items into an existing (e.g. curated) store for the
// same place: appends items not already present by normalized name, and unions
// diet tags. Curated items (with their modifiers) are kept; this only adds the
// extra breadth MenuStat provides. Returns the same store, mutated.
function mergeInto(store, msStore) {
  if (!store || !msStore) return store;
  const have = new Set((store.items || []).map(i => norm(i.name)));
  for (const it of msStore.items) {
    const k = norm(it.name);
    if (have.has(k)) continue;
    have.add(k);
    store.items.push(it);
  }
  const diets = new Set(store.diets || []);
  for (const d of (msStore.diets || [])) diets.add(d);
  store.diets = [...diets];
  return store;
}

function stats() {
  return { chains: DB.chainCount || Object.keys(DB.chains || {}).length,
           items: DB.itemCount || 0 };
}

module.exports = { menuStatStoreFor, mergeInto, stats, CHAINS: DB.chains };
