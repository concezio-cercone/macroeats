/* ===========================================================================
 * learnedStore.js — a PERSISTENT local cache of restaurant macro data.
 *
 * This is the "remember it so we never look it up again" layer. Anything saved
 * here is written to data/learned-chains.json on disk and survives restarts.
 * Discovery checks here FIRST (before the built-in chain map or the cuisine
 * estimate), so once a restaurant's menu is known, every future match — every
 * McDonald's, every Chipotle — pulls from local data instantly.
 *
 * Entries are keyed by a normalized name fragment, exactly like the built-in
 * chain map, so "McDonald's", "McDonalds", "McDonald's #4821" all resolve to
 * the same stored menu.
 * ======================================================================== */

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "learned-chains.json");

function normName(s) {
  return String(s || "").toLowerCase()
    .replace(/['’`]/g, "")               // drop apostrophes so "Joe's" == "Joes"
    .replace(/mexican grill|restaurant|grill|kitchen|cafe|café|co\.|llc|inc\.?|#\d+/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

// Load the on-disk store (or empty). Shape: { entries: [ {match:[...], def} ] }
function load() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const data = JSON.parse(raw);
    return data && Array.isArray(data.entries) ? data : { entries: [] };
  } catch { return { entries: [] }; }
}

let CACHE = load();

// Rebuild the fast match index (longest fragment first).
function buildIndex() {
  const idx = [];
  CACHE.entries.forEach((e, i) => {
    (e.match || []).forEach(frag => idx.push({ frag: frag.toLowerCase(), i }));
  });
  idx.sort((a, b) => b.frag.length - a.frag.length);
  return idx;
}
let INDEX = buildIndex();

function persist() {
  fs.writeFileSync(FILE, JSON.stringify(CACHE, null, 2));
  INDEX = buildIndex();
}

// Look up a discovered place. Returns a store object (verified) or null.
function learnedStoreFor(placeName, place) {
  // Match on the NORMALIZED name so punctuation differences (apostrophes,
  // "#123", "Grill") don't cause misses. Fragments in the index are already
  // normalized; normalize the incoming name the same way before comparing.
  const n = normName(placeName);
  if (!n) return null;
  const hit = INDEX.find(m => {
    const frag = normName(m.frag);
    return frag && (n.includes(frag) || frag.includes(n));
  });
  if (!hit) return null;
  const e = CACHE.entries[hit.i];
  return {
    restaurant: place.name || placeName,
    platform: null,
    region: e.region || "Restaurant",
    cuisines: e.cuisines || [e.region || "Restaurant"],
    diets: e.diets || [],
    lat: place.lat, lng: place.lng,
    discovered: true,
    chain: true,
    learned: true,                 // came from the persistent learned store
    items: (e.items || []).map(i => ({ ...i, verified: true })),
  };
}

// Save / upsert a restaurant's menu into the persistent store.
// entry = { name, match?[], region, cuisines?[], diets?[], items:[...] }
// Items should already be in the data-model shape (base + modifiers). They're
// stored verified.
function saveLearned(entry) {
  if (!entry || !entry.name || !Array.isArray(entry.items)) {
    throw new Error("saveLearned needs { name, items[] }");
  }
  const match = (entry.match && entry.match.length) ? entry.match.map(s => s.toLowerCase())
    : [normName(entry.name)].filter(Boolean);
  const def = {
    name: entry.name,
    match,
    region: entry.region || "Restaurant",
    cuisines: entry.cuisines || [entry.region || "Restaurant"],
    diets: entry.diets || [],
    items: entry.items.map(i => ({ ...i, verified: true })),
    savedAt: new Date().toISOString(),
  };
  // upsert by overlapping match fragment
  const existingIdx = CACHE.entries.findIndex(e =>
    (e.match || []).some(f => match.includes(f.toLowerCase())));
  if (existingIdx >= 0) CACHE.entries[existingIdx] = def;
  else CACHE.entries.push(def);
  persist();
  return def;
}

function listLearned() {
  return CACHE.entries.map(e => ({ name: e.name, match: e.match, items: e.items.length, savedAt: e.savedAt }));
}

function removeLearned(name) {
  const before = CACHE.entries.length;
  const nn = normName(name);
  CACHE.entries = CACHE.entries.filter(e => !(e.match || []).some(f => f.toLowerCase() === nn) && normName(e.name) !== nn);
  persist();
  return before - CACHE.entries.length;
}

module.exports = { learnedStoreFor, saveLearned, listLearned, removeLearned, normName };
