/* ===========================================================================
 * chainSource.js — shared loader for a generated verified-chain database.
 *
 * Both the MenuStat and OpenNutrition imports produce the same JSON shape:
 *   { source, chainCount, itemCount, chains: { key: {
 *       name, match:[fragments], region, cuisines:[], diets:[],
 *       items:[ { name, course, carbType, cheese, price, base, modifiers, source } ]
 *   } } }
 * This factory turns one such file into a lookup that mirrors chainStoreFor()
 * from chains.js, so server.js can layer several verified sources uniformly.
 * ======================================================================== */

const fs = require("fs");

// Match-normalize a name: lowercase, drop apostrophes, collapse to spaces.
// Stored match fragments are written the same way so substring tests line up.
function norm(s) {
  return String(s || "").toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Build a source from a generated JSON file. `opts.flag` (e.g. "menustat") is
// stamped on each returned store so callers can tell where it came from.
function makeChainSource(dataPath, opts = {}) {
  const flag = opts.flag;
  let DB = { chains: {}, chainCount: 0, itemCount: 0 };
  try {
    DB = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  } catch (e) {
    console.warn("chainSource: could not load " + dataPath + " (" + e.message +
      "). Continuing without it — re-run its build script to populate.");
  }

  // fragment -> chain key, longest fragment first (specific beats generic)
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

  function hydrate(i) {
    return {
      name: i.name, course: i.course, carbType: i.carbType, cheese: !!i.cheese,
      price: i.price, base: i.base, verified: true, source: i.source,
      modifiers: i.modifiers || [],
      micros: i.micros || null,                                  // {sodium,fiber,sugar,addedSugar,satFat} | null
      allergens: i.allergens !== undefined ? i.allergens : null, // [..] | [] (clean) | null (unknown)
    };
  }

  // Given a discovered place name, return a verified store or null.
  function storeFor(placeName, place) {
    const key = chainKeyFor(placeName);
    if (!key) return null;
    const def = DB.chains[key];
    place = place || {};
    const store = {
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
      items: def.items.map(hydrate),
    };
    if (flag) store[flag] = true;
    return store;
  }

  function stats() {
    return { chains: DB.chainCount || Object.keys(DB.chains || {}).length,
             items: DB.itemCount || 0 };
  }

  return { storeFor, stats, chainKeyFor, CHAINS: DB.chains };
}

// Merge another store's items into `store`: append items not already present by
// normalized name, and union diet tags. Used to fold extra verified sources
// into a higher-priority store (e.g. curated + MenuStat + OpenNutrition for the
// same place). Curated/earlier items (with their modifiers) are kept.
function mergeInto(store, other) {
  if (!store || !other) return store;
  const have = new Set((store.items || []).map(i => norm(i.name)));
  for (const it of other.items) {
    const k = norm(it.name);
    if (have.has(k)) continue;
    have.add(k);
    store.items.push(it);
  }
  const diets = new Set(store.diets || []);
  for (const d of (other.diets || [])) diets.add(d);
  store.diets = [...diets];
  return store;
}

module.exports = { makeChainSource, mergeInto, norm };
