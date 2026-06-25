/* ===========================================================================
 * server.js — MacroEats backend
 *
 * Endpoints:
 *   GET /api/combos?lat=&lng=&radius=&q=   -> assembled, ranked meals
 *   GET /api/geocode?q=                    -> {lat,lng,label} (Nominatim proxy)
 *   GET /api/health                        -> status + data coverage
 *   (static) /                             -> the frontend in /public
 *
 * Why a server at all: API keys and third-party calls (geocoding, and later a
 * licensed macro API) can't live safely in browser code, and the restaurant
 * data needs a home. The browser just renders what this returns.
 * ======================================================================== */

const express = require("express");
const fs = require("fs");
const path = require("path");
const { parseQuery, detectRegion, buildCombos, buildStoreVariants, isOpenAt } = require("./lib/comboEngine");
const { synthStore } = require("./lib/estimator");
const { chainStoreFor } = require("./lib/chains");
const { menuStatStoreFor, mergeInto, stats: menuStatStats } = require("./lib/menuStat");
const { learnedStoreFor, saveLearned, listLearned, removeLearned } = require("./lib/learnedStore");

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON request bodies (needed for POST /api/learned). Generous limit
// since a saved menu with many items/modifiers can be a few KB.
app.use(express.json({ limit: "1mb" }));

// --- Load restaurant data once at boot. Swap this for a real DB query later. ---
const DATA_PATH = path.join(__dirname, "data", "restaurants.json");
function loadRestaurants() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  return raw.restaurants || [];
}
let RESTAURANTS = loadRestaurants();
const REGIONS = [...new Set(RESTAURANTS.map(r => r.region))].sort();

// --- Health / coverage ---
app.get("/api/health", (req, res) => {
  const items = RESTAURANTS.flatMap(r => r.items);
  const verified = items.filter(i => i.verified).length;
  res.json({
    ok: true,
    restaurants: RESTAURANTS.length,
    items: items.length,
    verifiedItems: verified,
    verifiedPct: items.length ? Math.round((verified / items.length) * 100) : 0,
    regions: REGIONS,
    menuStat: menuStatStats(),   // verified-macro chains imported from MenuStat
  });
});

// --- Geocode proxy (Nominatim). Cleans the address first — secondary unit
//     designators like "Unit 7" / "Apt 5" / "#2" make Nominatim fail, so we
//     strip them and retry progressively. Sets a proper User-Agent per policy. ---
function cleanAddress(s) {
  return s
    // drop "unit 7", "apt 5", "suite 200", "ste 4", "# 2", "#12", "bldg 1", "fl 3"
    .replace(/#\s*[\w-]+/g, " ")
    .replace(/\b(unit|apt|apartment|suite|ste|bldg|building|fl|floor|rm|room)\s*\.?\s*[\w-]+/gi, " ")
    .replace(/,\s*,/g, ",")     // collapse empty comma segments
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

async function nominatim(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&countrycodes=us&q=" +
    encodeURIComponent(q);
  const r = await fetch(url, {
    headers: { "User-Agent": "MacroEats/0.1 (personal project)", "Accept": "application/json" },
  });
  if (!r.ok) throw new Error("nominatim " + r.status);
  const data = await r.json();
  return (data && data.length) ? data[0] : null;
}

app.get("/api/geocode", async (req, res) => {
  const raw = (req.query.q || "").toString().trim();
  if (!raw) return res.status(400).json({ error: "missing q" });

  // Try, in order: cleaned full address, then cleaned without the street-number-only
  // tail issues, then the raw string as a last resort.
  const cleaned = cleanAddress(raw);
  const attempts = [cleaned, raw].filter((v, i, a) => v && a.indexOf(v) === i);

  try {
    for (const attempt of attempts) {
      const hit = await nominatim(attempt);
      if (hit) {
        return res.json({
          found: true,
          lat: parseFloat(hit.lat),
          lng: parseFloat(hit.lon),
          label: hit.display_name,
          usedQuery: attempt,
          cleanedFrom: attempt === raw ? null : raw,
        });
      }
    }
    res.json({ found: false, tried: attempts });
  } catch (e) {
    res.status(502).json({ error: "geocode upstream failed", detail: e.message });
  }
});

// --- The main endpoint: assemble meals for a location + target ---
app.get("/api/combos", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = req.query.radius != null ? parseFloat(req.query.radius) : 6;
  const q = (req.query.q || "").toString();
  const openOnly = req.query.openOnly === "1" || req.query.openOnly === "true";
  const cuisines = (req.query.cuisines || "").toString().split(",").map(s => s.trim()).filter(Boolean);
  const diets = (req.query.diets || "").toString().split(",").map(s => s.trim()).filter(Boolean);
  const nowMs = parseInt(req.query.now, 10);
  const now = Number.isFinite(nowMs) ? new Date(nowMs) : new Date();

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: "lat and lng are required numbers" });
  }

  const filter = parseQuery(q);
  filter.region = detectRegion(q, REGIONS);

  // The seed list is empty by default — the app runs entirely on live
  // discovery. We pull real nearby places, synthesize an estimated menu for
  // each, and DISCARD any place we have no real macro signal for (generic
  // fallback with no cuisine tag = "no macro data yet"). We keep reaching down
  // the nearby list until we've collected enough usable restaurants, so the
  // discards don't leave you with a thin result set.
  const discover = req.query.discover !== "0" && req.query.discover !== "false";
  const TARGET_USABLE = 5000;   // effectively uncapped — collect everything usable nearby
  let restaurants = RESTAURANTS;
  let discovery = { attempted: false, found: 0, usable: 0, discarded: 0, error: null };
  if (discover) {
    discovery.attempted = true;
    try {
      const dbNames = new Set(RESTAURANTS.map(s => normName(s.restaurant)));
      const rawPlaces = await fetchNearbyRaw(lat, lng, radius); // already sorted nearest-first
      discovery.found = rawPlaces.length;

      // Collapse multiple locations of the same restaurant into ONE — the best
      // location to actually order from. "Best" = prefer places known to be open
      // now, and among those the closest; if none have known-open status, just
      // take the closest. This removes duplicate Starbucks/McDonald's clutter so
      // you only see the nearest reachable one.
      const places = dedupeNearest(rawPlaces, { lat, lng });
      discovery.collapsedFrom = rawPlaces.length;
      discovery.afterCollapse = places.length;

      const synth = [];
      let discarded = 0, chainMatched = 0, learnedMatched = 0, menuStatMatched = 0;
      // For each nearby place, resolve macros in priority order:
      //   1. learned store (persistent, grows over time) — pulled from disk
      //   2. curated verified chain map (lib/chains.js — rich modifiers + prices)
      //   3. MenuStat verified macros (~60 chains, official published nutrition)
      //   4. cuisine estimate (discard if no real signal)
      // So a restaurant we've already learned never gets looked up again. When a
      // place is in BOTH curated and MenuStat, curated wins and MenuStat's items
      // are merged in for extra breadth.
      for (const p of places) {
        if (dbNames.has(normName(p.name))) continue;     // verified DB handles these
        const learned = learnedStoreFor(p.name, p);      // 1. persistent local data
        if (learned) { synth.push(learned); learnedMatched++; }
        else {
          const chain = chainStoreFor(p.name, p);        // 2. curated chain map
          const ms = menuStatStoreFor(p.name, p);        // 3. MenuStat verified macros
          if (chain) {
            if (ms) mergeInto(chain, ms);                //    same place in both -> keep curated, add breadth
            synth.push(chain); chainMatched++;
          } else if (ms) {
            synth.push(ms); menuStatMatched++;
          } else {
            const s = synthStore(p);                     // 4. cuisine estimate
            if (s.lowConfidence) { discarded++; continue; }
            synth.push(s);
          }
        }
        if (synth.length >= TARGET_USABLE) break;
      }
      discovery.usable = synth.length;
      discovery.discarded = discarded;
      discovery.chainMatched = chainMatched;
      discovery.menuStatMatched = menuStatMatched;
      discovery.learnedMatched = learnedMatched;
      restaurants = RESTAURANTS.concat(synth);
    } catch (e) {
      discovery.error = e.message;  // surfaced to the UI
    }
  }

  const combos = buildCombos(restaurants, { lat, lng }, radius, filter,
    { now, openOnly, cuisines, diets });

  res.json({
    center: { lat, lng }, radius, query: filter,
    openOnly, cuisines, diets, discover, discovery,
    count: combos.length, combos,
  });
});

// --- Meta: full preference taxonomy + what the seed data actually supports,
//     so the UI can render the full lists and disable irrelevant ones. ---
const DIETARY_PREFS = [
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "pescatarian", label: "Pescatarian" },
  { id: "high-protein", label: "High protein" },
  { id: "keto", label: "Keto / low carb" },
  { id: "gluten-free", label: "Gluten-free" },
  { id: "dairy-free", label: "Dairy-free" },
  { id: "no cheese", label: "No cheese" },
  { id: "nut-free", label: "Nut-free" },
  { id: "halal", label: "Halal" },
  { id: "kosher", label: "Kosher" },
  { id: "low-sodium", label: "Low sodium" },
];
const CUISINES = [
  "American", "Mexican", "Mediterranean", "Greek", "Italian", "Japanese",
  "Sushi", "Poke", "Thai", "Asian", "Chinese", "Korean", "Indian",
  "Vietnamese", "Salads", "Bakery", "Dessert", "BBQ", "Seafood", "Breakfast",
];

app.get("/api/meta", (req, res) => {
  const supportedCuisines = [...new Set(RESTAURANTS.flatMap(r => r.cuisines || [r.region]))];
  const supportedDiets = [...new Set(RESTAURANTS.flatMap(r => (r.diets || []).map(d => d.replace(/-option$/, ""))))];
  res.json({
    dietaryPrefs: DIETARY_PREFS,
    cuisines: CUISINES,
    supportedCuisines, // which ones the current data can actually return
    supportedDiets,
  });
});

// --- OPTIONAL: live open/closed via Google Places (scaffold). Without a key
//     this returns notConfigured and the app falls back to the hours baked
//     into restaurants.json. With a free key, this gives a live "open_now"
//     flag and is the same integration that would make the restaurant list
//     genuinely location-aware. Get a key: https://developers.google.com/maps/documentation/places/web-service
//     Run with: GOOGLE_PLACES_KEY=your_key npm start ---
const PLACES_KEY = process.env.GOOGLE_PLACES_KEY || "";
app.get("/api/place-status", async (req, res) => {
  const name = (req.query.name || "").toString();
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!PLACES_KEY) return res.json({ configured: false, note: "Set GOOGLE_PLACES_KEY to enable live open/closed and real nearby branches." });
  if (!name || Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error: "name, lat, lng required" });
  try {
    // Find the nearest matching place, then read its opening_hours.open_now.
    const findUrl = "https://places.googleapis.com/v1/places:searchText";
    const r = await fetch(findUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_KEY,
        "X-Goog-FieldMask": "places.displayName,places.currentOpeningHours.openNow,places.location,places.googleMapsUri",
      },
      body: JSON.stringify({ textQuery: name, locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 8000 } } }),
    });
    const data = await r.json();
    const place = data.places && data.places[0];
    if (!place) return res.json({ configured: true, found: false });
    res.json({
      configured: true, found: true,
      openNow: place.currentOpeningHours ? place.currentOpeningHours.openNow : null,
      mapsUri: place.googleMapsUri || null,
      location: place.location || null,
    });
  } catch (e) {
    res.status(502).json({ configured: true, error: "places upstream failed", detail: e.message });
  }
});

// haversine miles (server copy, small)
function milesBetween(aLat, aLng, bLat, bLng) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// normalize names for matching ("Chipotle Mexican Grill" -> "chipotle")
function normName(s) {
  return String(s || "").toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/mexican grill|restaurant|grill|kitchen|cafe|café|co\.|llc|inc\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

// Collapse multiple locations of the same restaurant into ONE. Among locations
// sharing a normalized name, pick the best to order from:
//   1. prefer locations known to be OPEN now (OSM hours present and open),
//   2. then the closest,
//   3. if none have known hours, just the closest.
// `places` is assumed sorted nearest-first. Returns a filtered list preserving
// that order. Also annotates each kept place with locationCount (how many were
// collapsed) so the UI can show "3 locations · nearest open shown".
function dedupeNearest(places, center) {
  const now = new Date();
  const groups = new Map(); // normName -> { best, count }
  for (const p of places) {
    const key = normName(p.name);
    if (!key) continue;
    const openInfo = p.hours ? isOpenAt(p.hours, now) : { known: false, open: false };
    const cand = { place: p, known: openInfo.known, open: openInfo.open, dist: p.distance };
    const g = groups.get(key);
    if (!g) { groups.set(key, { best: cand, count: 1 }); continue; }
    g.count++;
    // Decide if cand beats the current best.
    const a = cand, b = g.best;
    const aOpen = a.known && a.open, bOpen = b.known && b.open;
    let better;
    if (aOpen !== bOpen) better = aOpen;          // an open one always beats a not-open one
    else better = a.dist < b.dist;                 // otherwise closer wins
    if (better) g.best = a;
  }
  // Rebuild in nearest-first order, annotating collapsed count.
  const kept = [];
  const emitted = new Set();
  for (const p of places) {
    const key = normName(p.name);
    if (!key || emitted.has(key)) continue;
    const g = groups.get(key);
    if (!g) continue;
    emitted.add(key);
    const chosen = { ...g.best.place, locationCount: g.count };
    kept.push(chosen);
  }
  // kept currently follows first-seen (nearest) order of the ORIGINAL list, but
  // the chosen location may differ from the first-seen one; re-sort by the
  // chosen location's distance to be safe.
  kept.sort((a, b) => a.distance - b.distance);
  return kept;
}

// --- Cached Overpass fetch. Returns normalized nearby places. Caches by
//     rounded lat/lng/radius for a few minutes. Hardened against hangs:
//     hard timeout per request, races multiple mirrors, dedupes in-flight. ---
const nearbyCache = new Map();   // key -> { t, places }
const nearbyInflight = new Map(); // key -> Promise (so concurrent identical calls share one fetch)
const NEARBY_TTL_MS = 30 * 60 * 1000;   // fresh cache: 30 min (was 5)
const STALE_OK_MS = 6 * 60 * 60 * 1000; // serve stale cache up to 6h if all mirrors are down
const OVERPASS_TIMEOUT_MS = 95 * 1000;  // must exceed the query's [timeout:90] so we don't abort a slow-but-valid sweep
const OVERPASS_ROUNDS = 3;              // retry rounds before giving up
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

// fetch one mirror with a hard abort timeout
async function overpassOnce(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "MacroEats/0.1 (personal project)" },
      body, signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error("overpass " + resp.status + " @ " + url);
    return await resp.json();
  } finally { clearTimeout(timer); }
}

// race all mirrors, resolve with the first that succeeds in this round
function overpassRaceRound(body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let pending = OVERPASS_MIRRORS.length, lastErr = null, done = false;
    for (const url of OVERPASS_MIRRORS) {
      overpassOnce(url, body, timeoutMs)
        .then(data => { if (!done) { done = true; resolve(data); } })
        .catch(e => { lastErr = e; if (--pending === 0 && !done) reject(lastErr || new Error("all mirrors failed")); });
    }
  });
}

// Try multiple rounds with a short backoff between them. Public Overpass
// servers are often briefly busy; a retry usually succeeds.
async function overpassWithRetry(body) {
  let lastErr = null;
  for (let round = 0; round < OVERPASS_ROUNDS; round++) {
    try { return await overpassRaceRound(body, OVERPASS_TIMEOUT_MS); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 600 * (round + 1))); }
  }
  throw lastErr || new Error("overpass failed after retries");
}

async function fetchNearbyRaw(lat, lng, radiusMi) {
  const effMi = Math.min(radiusMi, 8);
  const key = lat.toFixed(3) + "," + lng.toFixed(3) + "@" + effMi;

  const hit = nearbyCache.get(key);
  if (hit && (Date.now() - hit.t) < NEARBY_TTL_MS) return hit.places;
  if (nearbyInflight.has(key)) return nearbyInflight.get(key); // share concurrent calls

  const r = Math.round(effMi * 1609.34);
  // Query restaurants + fast food in the radius. Notes on why it's shaped this
  // way (this directly affects how many places come back):
  //  - Higher [timeout] so a dense urban radius finishes sweeping instead of
  //    getting truncated at a visible circle.
  //  - We do NOT require a "name" tag. Many fast-food spots store their name in
  //    "brand" or omit it; requiring "name" silently dropped them. We accept the
  //    node if it has amenity=restaurant|fast_food and recover the label from
  //    name OR brand OR operator below.
  //  - Two explicit amenity values (one block each) rather than one regex —
  //    Overpass resolves exact-value matches faster than a regex over a big area.
  const query = `[out:json][timeout:90];
(
  node["amenity"="restaurant"](around:${r},${lat},${lng});
  way["amenity"="restaurant"](around:${r},${lat},${lng});
  node["amenity"="fast_food"](around:${r},${lat},${lng});
  way["amenity"="fast_food"](around:${r},${lat},${lng});
);
out tags center 200000;`;
  const body = "data=" + encodeURIComponent(query);

  const promise = (async () => {
    let data;
    try {
      data = await overpassWithRetry(body);
    } catch (e) {
      // All mirrors failed across all rounds. If we have a stale-but-recent
      // cached result for this spot, serve it rather than erroring out.
      if (hit && (Date.now() - hit.t) < STALE_OK_MS) return hit.places;
      const err = new Error(e.message || "overpass failed"); err.upstream = true; throw err;
    }

    const elements = data.elements || [];
    const seen = new Set();
    const places = [];
    for (const el of elements) {
      const t = el.tags || {};
      // Recover a usable label: name, else brand, else operator. Only skip a
      // place if it has NONE of these (a genuinely unlabeled point we can't act
      // on). This recovers the many fast-food spots tagged by brand, not name.
      const name = t.name || t.brand || t.operator;
      if (!name) continue;
      const loc = el.type === "node" ? { lat: el.lat, lng: el.lon } : (el.center ? { lat: el.center.lat, lng: el.center.lon } : null);
      if (!loc) continue;
      const k = name.toLowerCase() + "@" + loc.lat.toFixed(4) + "," + loc.lng.toFixed(4);
      if (seen.has(k)) continue;
      seen.add(k);
      places.push({
        name, lat: loc.lat, lng: loc.lng,
        distance: Math.round(milesBetween(lat, lng, loc.lat, loc.lng) * 10) / 10,
        cuisine: t.cuisine || null,
        amenity: t.amenity || t.shop || null,
        hours: t.opening_hours || null,   // OSM hours when present (used to prefer open locations)
      });
    }
    places.sort((a, b) => a.distance - b.distance);
    nearbyCache.set(key, { t: Date.now(), places });
    return places;
  })();

  nearbyInflight.set(key, promise);
  try { return await promise; }
  finally { nearbyInflight.delete(key); }
}

// --- /api/store-meals: ranked meals for ONE restaurant (re-roll + sub-search).
//     The client posts the restaurant identity (name + location + cuisine, so we
//     can re-synthesize a discovered store's template) plus the base macro query
//     and an optional `sub` text ("chicken and potatoes", "no fruit"). Returns
//     a ranked list of meals to cycle through or refine. ---
app.get("/api/store-meals", (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  const name = (req.query.name || "").toString();
  const cuisine = (req.query.cuisine || "").toString() || null;
  const amenity = (req.query.amenity || "").toString() || null;
  const slat = parseFloat(req.query.slat), slng = parseFloat(req.query.slng); // store location
  const q = (req.query.q || "").toString();
  const sub = (req.query.sub || "").toString();
  const nowMs = parseInt(req.query.now, 10);
  const now = Number.isFinite(nowMs) ? new Date(nowMs) : new Date();

  if (!name || Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error: "name, lat, lng required" });

  // Resolve the store: verified DB → learned → curated chains (+MenuStat breadth)
  //  → MenuStat → estimate. Mirrors the priority in /api/combos.
  let store = RESTAURANTS.find(s => normName(s.restaurant) === normName(name));
  if (!store) {
    const loc = { name, lat: Number.isNaN(slat) ? lat : slat, lng: Number.isNaN(slng) ? lng : slng, cuisine, amenity };
    store = learnedStoreFor(name, loc);
    if (!store) {
      const chain = chainStoreFor(name, loc);
      const ms = menuStatStoreFor(name, loc);
      if (chain) store = ms ? mergeInto(chain, ms) : chain;
      else store = ms || synthStore(loc);
    }
  }

  const filter = parseQuery(q);
  filter.region = detectRegion(q, REGIONS);

  const meals = buildStoreVariants(store, { lat, lng }, filter, { now, subText: sub, limit: 10 });
  res.json({ restaurant: name, sub, count: meals.length, meals });
});

// --- Persistent learned-menu store endpoints ---
// Save a restaurant's menu so it's reused for every future match. Body is the
// entry { name, match?, region?, cuisines?, diets?, items[] } where items are
// in the data-model shape (base + modifiers). Items are stored verified.
app.post("/api/learned", (req, res) => {
  try {
    const saved = saveLearned(req.body || {});
    res.json({ ok: true, saved: { name: saved.name, items: saved.items.length, match: saved.match } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/learned", (req, res) => {
  res.json({ count: listLearned().length, entries: listLearned() });
});

app.delete("/api/learned", (req, res) => {
  const name = (req.query.name || "").toString();
  if (!name) return res.status(400).json({ error: "name required" });
  const removed = removeLearned(name);
  res.json({ ok: true, removed });
});

// --- Serve the frontend ---
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  const items = RESTAURANTS.flatMap(r => r.items);
  const verified = items.filter(i => i.verified).length;
  const ms = menuStatStats();
  console.log("MacroEats backend running:  http://localhost:" + PORT);
  console.log("  restaurants: " + RESTAURANTS.length + " | items: " + items.length +
    " | verified macros: " + verified + "/" + items.length);
  console.log("  MenuStat verified chains: " + ms.chains + " | items: " + ms.items);
  console.log("  endpoints: /api/combos  /api/geocode  /api/health");
});
