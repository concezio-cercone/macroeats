/* ===========================================================================
 * comboEngine.js — MacroEats core logic (v2: modifier-aware)
 *
 * Items now have a `base` (macros as ordered with defaults) plus `modifiers`
 * (toggleable options with macro/price deltas). The engine builds the best
 * VARIANT of each item — the modifier combination that, combined with optional
 * sides/dessert, lands closest to the macro target. This is how it matches the
 * way you'd actually order ("Chicken Bowl, no rice, double chicken").
 * ======================================================================== */

const CARB_TYPES = ["whole grain", "refined", "legume", "none"];

function distMiles(a, b) {
  const R = 3958.8, toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// --- Open/closed from a store's weekly `hours` array (0=Sun..6=Sat), each
//     entry [openHHMM, closeHHMM] or null=closed. Handles overnight windows
//     (e.g. noon->3am). `now` is a Date in the diner's local time.
//     NOTE: this is REGULAR HOURS only. A one-off "kitchen closed early on
//     DoorDash today" lives in the platform feed and isn't knowable here —
//     wire the Places "open_now" flag (see usdaLookup-style scaffold) for that. ---
function isOpenAt(hours, now) {
  // Our seed format: an array of 7 [open,close] HHMM slots (index = day).
  if (Array.isArray(hours)) {
    const day = now.getDay();
    const mins = now.getHours() * 100 + now.getMinutes();
    const within = (slot, t) => {
      if (!slot) return false;
      const [o, c] = slot;
      if (c > o) return t >= o && t < c;
      return t >= o || t < c;
    };
    const today = hours[day];
    const yest = hours[(day + 6) % 7];
    const open = within(today, mins) || (yest && yest[1] <= yest[0] && mins < yest[1]);
    return { known: true, open: !!open };
  }
  // OSM format: an opening_hours string. We handle the common cases that cover
  // the large majority of real tags; anything exotic returns known:false so the
  // caller falls back gracefully (e.g. dedupe just uses distance).
  if (typeof hours === "string" && hours.trim()) {
    return osmOpenNow(hours.trim(), now);
  }
  return { known: false, open: null };
}

// Parse a subset of OSM opening_hours: "24/7", and rules like
// "Mo-Fr 09:00-22:00; Sa-Su 10:00-23:00" or "Mo,We 11:00-14:00,17:00-21:00".
// Returns {known, open}. Unsupported syntax -> {known:false}.
const OSM_DAYS = { su:0, mo:1, tu:2, we:3, th:4, fr:5, sa:6 };
function osmOpenNow(str, now) {
  const s = str.toLowerCase();
  if (s === "24/7") return { known: true, open: true };
  // Reject syntax we don't model (month/week/holiday rules) -> unknown.
  if (/ph|se|easter|week|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}/.test(s)) {
    return { known: false, open: null };
  }
  const day = now.getDay();
  const mins = now.getHours() * 100 + now.getMinutes();
  let sawValidRule = false;

  for (const rawRule of s.split(";")) {
    const rule = rawRule.trim();
    if (!rule) continue;
    // Split day-spec from time-spec: day tokens then time ranges.
    const m = rule.match(/^([a-z,\-\s]*?)\s*([0-9:,\-\s]+|off|closed)$/);
    if (!m) { continue; } // can't parse this rule; skip it
    let dayPart = m[1].trim();
    const timePart = m[2].trim();

    // Which days does this rule cover? Empty day-part = every day.
    const days = new Set();
    if (!dayPart) { for (let d = 0; d < 7; d++) days.add(d); }
    else {
      for (const tok of dayPart.split(",")) {
        const range = tok.trim().match(/^([a-z]{2})\s*-\s*([a-z]{2})$/);
        if (range) {
          let a = OSM_DAYS[range[1]], b = OSM_DAYS[range[2]];
          if (a == null || b == null) continue;
          for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; }
        } else {
          const d = OSM_DAYS[tok.trim()];
          if (d != null) days.add(d);
        }
      }
    }
    if (!days.has(day)) continue;        // rule doesn't apply today
    sawValidRule = true;
    if (timePart === "off" || timePart === "closed") return { known: true, open: false };

    // Check each time range "HH:MM-HH:MM"
    for (const rng of timePart.split(",")) {
      const tm = rng.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
      if (!tm) continue;
      const o = parseInt(tm[1], 10) * 100 + parseInt(tm[2], 10);
      let c = parseInt(tm[3], 10) * 100 + parseInt(tm[4], 10);
      const open = (c > o) ? (mins >= o && mins < c) : (mins >= o || mins < c);
      if (open) return { known: true, open: true };
    }
  }
  // We understood the syntax and found today's rule(s) but none matched -> closed.
  if (sawValidRule) return { known: true, open: false };
  return { known: false, open: null };
}

function fmtHHMM(n) {
  const h = Math.floor(n / 100), m = n % 100;
  const ap = h >= 12 ? "pm" : "am";
  const h12 = ((h + 11) % 12) + 1;
  return h12 + (m ? ":" + String(m).padStart(2, "0") : "") + ap;
}
function todayHoursLabel(hours, now) {
  if (!Array.isArray(hours)) return null;
  const slot = hours[now.getDay()];
  if (!slot) return "closed today";
  return fmtHHMM(slot[0]) + "–" + fmtHHMM(slot[1]);
}

function parseQuery(q) {
  const t = String(q || "").toLowerCase();
  const f = {
    calTarget: null, calMax: null, calMin: null,
    proteinMin: null, proteinMax: null,
    carbsMax: null, fatMax: null,
    courses: [], region: null, cheese: null,
    carbType: null, wantsCarbs: null, food: null,
  };
  const num = re => { const m = t.match(re); return m ? parseInt(m[1], 10) : null; };

  f.calMax = num(/(?:under|less than|below|<|max)\s*(\d+)\s*(?:cal|kcal|calorie)/);
  f.calMin = num(/(?:over|more than|above|>|at least)\s*(\d+)\s*(?:cal|kcal|calorie)/);
  const around = num(/(?:around|about|~|roughly)\s*(\d+)\s*(?:cal|kcal|calorie)/);
  if (around !== null) f.calTarget = around;
  if (f.calMax === null && f.calMin === null && f.calTarget === null) {
    const bare = num(/(\d+)\s*(?:cal|kcal|calorie)/);
    if (bare) f.calTarget = bare;
  }

  f.proteinMax = num(/(?:under|less than|below|<)\s*(\d+)\s*g?\s*(?:of\s+)?protein/);
  if (f.proteinMax === null) {
    f.proteinMin = num(/(?:over|more than|above|>|at least|high)\s*(\d+)\s*g?\s*(?:of\s+)?protein/)
      ?? num(/(\d+)\s*g\s*protein/);
    if (/high protein/.test(t) && f.proteinMin === null) f.proteinMin = 35;
  }

  f.carbsMax = num(/(?:under|less than|below|<|low)\s*(\d+)\s*g?\s*(?:of\s+)?carb/);
  f.fatMax = num(/(?:under|less than|below|<|low)\s*(\d+)\s*g?\s*(?:of\s+)?fat/);
  if (/low carb/.test(t) && f.carbsMax === null) f.wantsCarbs = false;

  if (/\bmeal\b|entree|main|lunch|dinner/.test(t)) f.courses.push("meal");
  if (/dessert|sweet|treat/.test(t)) f.courses.push("dessert");

  if (/no cheese|without cheese|cheese[- ]free|dairy[- ]free/.test(t)) f.cheese = false;
  else if (/cheese/.test(t)) f.cheese = true;
  if (/no carbs|without carbs|carb[- ]free|keto/.test(t)) f.wantsCarbs = false;

  const ct = CARB_TYPES.find(c => t.includes(c));
  if (ct) f.carbType = ct;
  else if (/brown rice|whole wheat/.test(t)) f.carbType = "whole grain";

  const quoted = String(q || "").match(/"([^"]+)"/);
  if (quoted) f.food = quoted[1].toLowerCase();

  // Free-text food/keyword filter: whatever's left after stripping the macro,
  // diet and course words is treated as a food type — so "800 cal sandwich"
  // returns sandwiches, "chicken bowl" returns chicken bowls, "big mac" finds
  // the item. Quoted text (above) wins. Falls back to nothing if only macros.
  if (!f.food) {
    const rest = t
      .replace(/"[^"]*"/g, " ")
      .replace(/[<>~]/g, " ")
      .replace(/\b\d+\s*(?:k?cal|kcal|calorie|calories)\b/g, " ")
      .replace(/\b\d+\s*g(?:rams?)?\b/g, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(/\b(?:under|over|below|above|less|more|than|at|least|around|about|roughly|max|min|maximum|minimum|high|low|of|the|a|an|and|or|with|without|no|for|me|my|i|id|im|want|wanna|would|like|please|get|just|show|gimme|something|some|that|hits?)\b/g, " ")
      .replace(/\b(?:cal|cals|kcal|calorie|calories|protein|carb|carbs|carbohydrate|carbohydrates|fat|fats|gram|grams)\b/g, " ")
      .replace(/\b(?:meal|meals|entree|entrees|main|mains|lunch|dinner|dessert|desserts|sweet|sweets|treat|treats)\b/g, " ")
      .replace(/\b(?:vegetarian|vegan|pescatarian|keto|gluten|dairy|nut|free|halal|kosher|sodium|cheese)\b/g, " ")
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ").trim();
    if (rest.replace(/\s/g, "").length >= 3) f.food = rest;
  }

  return f;
}

// Free-text food filter: every term must appear in the haystack (chosen item
// names + the store's category). `food` is already lowercased by parseQuery.
function matchesFood(hayLower, food) {
  if (!food) return true;
  return food.split(/\s+/).every(term => term.length < 2 || hayLower.includes(term));
}

function detectRegion(q, regions) {
  const t = String(q || "").toLowerCase();
  return regions.find(r => t.includes(r.toLowerCase())) || null;
}

// --- Variant generation: apply a chosen subset of an item's modifiers ---
// Returns { name, label, cal, protein, carbs, fat, price, carbType, cheese,
//           course, verified, source, chosen:[modifier labels] }
function applyModifiers(item, chosenIds) {
  const v = {
    cal: item.base.cal, protein: item.base.protein, carbs: item.base.carbs, fat: item.base.fat,
    price: item.price, carbType: item.carbType, cheese: item.cheese,
    course: item.course, verified: item.verified, templated: item.templated, source: item.source,
    name: item.name, chosen: [],
    // extra nutrients + allergens ride along at item-base level (modifiers don't
    // adjust them). allergens: array (incl. []=clean) or null when unknown.
    micros: item.micros || null,
    allergens: item.allergens !== undefined ? item.allergens : null,
  };
  for (const m of (item.modifiers || [])) {
    if (!chosenIds.includes(m.id)) continue;
    v.cal += m.d.cal; v.protein += m.d.protein; v.carbs += m.d.carbs; v.fat += m.d.fat;
    v.price += (m.dPrice || 0);
    if (m.sets) { if ("carbType" in m.sets) v.carbType = m.sets.carbType; if ("cheese" in m.sets) v.cheese = m.sets.cheese; }
    v.chosen.push(m.label);
  }
  // clamp to non-negative, round
  v.cal = Math.max(0, Math.round(v.cal));
  v.protein = Math.max(0, Math.round(v.protein));
  v.carbs = Math.max(0, Math.round(v.carbs));
  v.fat = Math.max(0, Math.round(v.fat));
  v.price = Math.max(0, Math.round(v.price * 100) / 100);
  v.label = v.chosen.length ? item.name + " — " + v.chosen.join(", ") : item.name;
  return v;
}

// Enumerate modifier subsets, but only those that satisfy the hard dietary
// rules (cheese / carbType), and keep the search bounded. Most items have a
// handful of modifiers, so all subsets is fine (2^n with small n). We cap n.
function itemVariants(item, f) {
  const mods = (item.modifiers || []);
  const n = Math.min(mods.length, 8);
  const ids = mods.slice(0, n).map(m => m.id);
  const variants = [];
  const total = 1 << n;
  for (let mask = 0; mask < total; mask++) {
    const chosen = [];
    for (let b = 0; b < n; b++) if (mask & (1 << b)) chosen.push(ids[b]);
    // Don't allow contradictory rice mods together (e.g. no-rice + brown-rice)
    if (chosen.includes("no-rice") && (chosen.includes("brown-rice") || chosen.includes("add-rice") || chosen.includes("add-sticky-rice"))) continue;
    const v = applyModifiers(item, chosen);
    // hard dietary filters at the variant level
    if (f.cheese === false && v.cheese) continue;
    if (f.cheese === true && !v.cheese) continue;
    if (f.carbType && v.carbType !== f.carbType) continue;
    variants.push(v);
  }
  return variants;
}

function macroSum(parts) {
  return parts.reduce((a, i) => ({
    cal: a.cal + i.cal, protein: a.protein + i.protein,
    carbs: a.carbs + i.carbs, fat: a.fat + i.fat, price: a.price + i.price,
  }), { cal: 0, protein: 0, carbs: 0, fat: 0, price: 0 });
}

function scoreCombo(sum, partCount, modCount, f, dist, goal) {
  let pen = 0;
  if (goal !== null) {
    pen += Math.abs(sum.cal - goal);
    if (f.calTarget !== null && sum.cal > f.calTarget) pen += (sum.cal - f.calTarget) * 0.5;
  } else if (f.proteinMin !== null) {
    pen += -sum.protein * 2 + sum.cal * 0.05;
  } else {
    pen += sum.cal * 0.1;
  }
  pen += partCount * 6;  // fewer separate items = simpler
  pen += modCount * 1.5; // mild preference for fewer customizations when it's a wash
  pen += dist * 3;       // closer wins ties
  return pen;
}

function fitFor(sum, goal) {
  if (goal === null) return { class: "range", label: "match" };
  const off = Math.abs(sum.cal - goal) / goal;
  if (off < 0.06) return { class: "spot", label: "spot on" };
  if (off < 0.13) return { class: "great", label: "great fit" };
  if (off < 0.22) return { class: "close", label: "close" };
  return { class: "range", label: "in range" };
}

// Diets we can verify from real item DATA (computed per-meal) rather than as a
// store "capability". The rest (vegetarian, vegan, high-protein, keto, …) stay
// store-level. "no cheese" is handled via the existing cheese-variant filter.
const DATA_DIETS = new Set(["low-sodium", "gluten-free", "dairy-free", "nut-free"]);
const LOW_SODIUM_MAX = 800; // mg — ceiling for a "low-sodium" MEAL

// Aggregate extra nutrients + allergens across a meal's parts. A nutrient total
// is null if NO part reports it; allergenKnown is true only when EVERY part has
// allergen data (so we never certify "allergen-free" on missing data).
function comboExtras(parts) {
  const add = (a, v) => (v == null ? a : (a == null ? v : a + v));
  let sodium = null, fiber = null, sugar = null, addedSugar = null, satFat = null, chol = null;
  const allergens = new Set();
  let allergenKnown = true;
  for (const p of parts) {
    const m = p.micros;
    if (m) {
      sodium = add(sodium, m.sodium); fiber = add(fiber, m.fiber);
      sugar = add(sugar, m.sugar); addedSugar = add(addedSugar, m.addedSugar);
      satFat = add(satFat, m.satFat); chol = add(chol, m.chol);
    }
    if (Array.isArray(p.allergens)) for (const a of p.allergens) allergens.add(a);
    else allergenKnown = false;
  }
  return { sodium, fiber, sugar, addedSugar, satFat, chol,
           allergens: [...allergens], allergenKnown };
}

// True if a meal satisfies the requested data-backed diets. Allergen diets fail
// closed: an unknown-status meal does NOT pass (can't certify what we can't see).
function passesDataDiets(extras, dataDiets) {
  if (!dataDiets || !dataDiets.length) return true;
  const has = a => extras.allergens.includes(a);
  for (const d of dataDiets) {
    if (d === "low-sodium") {
      if (extras.sodium == null || extras.sodium > LOW_SODIUM_MAX) return false;
    } else if (d === "gluten-free") {
      if (!extras.allergenKnown || has("gluten") || has("wheat")) return false;
    } else if (d === "dairy-free") {
      if (!extras.allergenKnown || has("milk")) return false;
    } else if (d === "nut-free") {
      if (!extras.allergenKnown || has("tree_nuts") || has("peanuts")) return false;
    }
  }
  return true;
}

// --- Build the best meal per store. opts: { now (Date), openOnly (bool),
//     cuisines ([]), diets ([]) } ---
function buildCombos(restaurants, center, radiusMi, f, opts = {}) {
  const out = [];
  const now = opts.now || new Date();

  // Split requested diets: data-backed ones are checked per-meal below; the rest
  // remain store-level capabilities. "no cheese" reuses the cheese-variant filter.
  const reqDiets = opts.diets || [];
  const dataDiets = reqDiets.filter(d => DATA_DIETS.has(d));
  const capDiets = reqDiets.filter(d => !DATA_DIETS.has(d) && d !== "no cheese");
  if (reqDiets.includes("no cheese") && f.cheese == null) f = { ...f, cheese: false };

  for (const store of restaurants) {
    const dist = distMiles(center, store);
    if (dist > radiusMi) continue;
    if (f.region && store.region !== f.region) continue;

    // cuisine preference: store must match at least one selected cuisine
    if (opts.cuisines && opts.cuisines.length) {
      const sc = (store.cuisines || [store.region]).map(x => x.toLowerCase());
      if (!opts.cuisines.some(c => sc.includes(c.toLowerCase()))) continue;
    }
    // dietary capability (store-level): store must support every selected tag
    if (capDiets.length) {
      const sd = (store.diets || []).map(x => x.toLowerCase());
      const ok = capDiets.every(req => {
        const r = req.toLowerCase();
        return sd.includes(r) || sd.includes(r + "-option");
      });
      if (!ok) continue;
    }

    if (f.food) {
      const hay = (store.restaurant + " " + store.region + " " +
        (store.cuisines || []).join(" ") + " " +
        store.items.map(i => i.name).join(" ")).toLowerCase();
      if (!matchesFood(hay, f.food)) continue;   // coarse: store has something matching
    }
    const foodCat = f.food ? (store.region + " " + (store.cuisines || []).join(" ")).toLowerCase() : "";

    const openInfo = isOpenAt(store.hours, now);
    if (opts.openOnly && openInfo.known && openInfo.open === false) continue;

    const mains = store.items.filter(i => i.course === "main");
    const sides = store.items.filter(i => i.course === "side");
    const desserts = store.items.filter(i => i.course === "dessert");

    const wantMeal = f.courses.length === 0 || f.courses.includes("meal");
    const wantDessert = f.courses.includes("dessert");
    const dessertOnly = wantDessert && !wantMeal;

    if (!dessertOnly && mains.length === 0) continue;
    if (wantDessert && desserts.length === 0) continue;

    // Precompute valid variants for each item once.
    const mainVariants = dessertOnly ? [null] : mains.flatMap(m => itemVariants(m, f));
    const sideVariants = dessertOnly ? [null] : [null, ...sides.flatMap(s => itemVariants(s, f))];
    const dessVariants = wantDessert ? desserts.flatMap(d => itemVariants(d, f))
                                     : [null, ...desserts.flatMap(d => itemVariants(d, f))];

    if (!dessertOnly && mainVariants.length === 0) continue; // dietary rules killed all mains
    if (wantDessert && dessVariants.length === 0) continue;

    const goal = f.calTarget !== null ? f.calTarget : (f.calMax !== null ? f.calMax : null);
    const hardHigh = f.calMax !== null ? f.calMax : (f.calTarget !== null ? f.calTarget * 1.25 : null);
    const hardLow = f.calTarget !== null ? f.calTarget * 0.70 : null;

    let best = null;
    for (const m of mainVariants) for (const s of sideVariants) for (const d of dessVariants) {
      const parts = [m, s, d].filter(Boolean);
      if (!parts.length) continue;
      if (!dessertOnly && !m) continue;
      if (wantDessert && !d) continue;

      const sum = macroSum(parts);
      if (hardHigh !== null && sum.cal > hardHigh) continue;
      if (hardLow !== null && sum.cal < hardLow) continue;
      if (f.proteinMin !== null && sum.protein < f.proteinMin) continue;
      if (f.proteinMax !== null && sum.protein > f.proteinMax) continue;
      if (f.fatMax !== null && sum.fat > f.fatMax) continue;
      if (f.carbsMax !== null && sum.carbs > f.carbsMax) continue;
      if (f.wantsCarbs === false && sum.carbs > 30) continue;
      if (dataDiets.length && !passesDataDiets(comboExtras(parts), dataDiets)) continue;
      // Food/craving filter: the MAIN dish (or the store's category) must match —
      // a steak with a side salad is NOT a "salad" result.
      const mainPart = parts.find(p => p.course === "main") || parts[0];
      const mainName = mainPart ? mainPart.name.toLowerCase() : "";
      if (f.food && !matchesFood(foodCat + " " + mainName, f.food)) continue;

      const modCount = parts.reduce((a, p) => a + p.chosen.length, 0);
      // Strongly prefer combos whose MAIN name actually contains the food term
      // over ones that only matched via store category, so "salad" at a place
      // that also sells burgers picks the salad, not the best-fitting burger.
      const foodBonus = (f.food && matchesFood(mainName, f.food)) ? 100000 : 0;
      const sc = scoreCombo(sum, parts.length, modCount, f, dist, goal) - foodBonus;
      if (!best || sc < best.score) best = { parts, sum, goal, score: sc };
    }

    if (best) {
      const estimatedMenu = best.parts.some(p => p.templated);
      const extras = comboExtras(best.parts);
      out.push({
        store: {
          restaurant: store.restaurant, platform: store.platform, region: store.region,
          lat: store.lat, lng: store.lng, distance: Math.round(dist * 10) / 10,
          cuisines: store.cuisines || [store.region],
          openKnown: openInfo.known, open: openInfo.open,
          hoursToday: todayHoursLabel(store.hours, now),
          discovered: !!store.discovered,
          locationCount: store.locationCount || 1,
        },
        items: best.parts.map(p => ({
          name: p.name, label: p.label, course: p.course,
          cal: p.cal, protein: p.protein, carbs: p.carbs, fat: p.fat, price: p.price,
          mods: p.chosen, verified: !!p.verified, templated: !!p.templated, source: p.source || null,
        })),
        totals: {
          cal: Math.round(best.sum.cal), protein: Math.round(best.sum.protein),
          carbs: Math.round(best.sum.carbs), fat: Math.round(best.sum.fat),
          price: Math.round(best.sum.price * 100) / 100,
          sodium: extras.sodium, fiber: extras.fiber, sugar: extras.sugar,
          addedSugar: extras.addedSugar, satFat: extras.satFat, chol: extras.chol,
        },
        allergens: extras.allergens,
        allergenKnown: extras.allergenKnown,
        verified: best.parts.every(p => p.verified),
        estimatedMenu,
        goal: best.goal,
        fit: fitFor(best.sum, best.goal),
        score: best.score,
      });
    }
  }

  // Open stores first; then verified-data meals nudged ahead of estimated-menu
  // (discovered) meals; then by fit score.
  return out.sort((a, b) => {
    const ao = a.store.open === false ? 1 : 0, bo = b.store.open === false ? 1 : 0;
    if (ao !== bo) return ao - bo;
    const ad = a.estimatedMenu ? 15 : 0, bd = b.estimatedMenu ? 15 : 0;
    return (a.score + ad) - (b.score + bd);
  });
}

module.exports = { distMiles, parseQuery, detectRegion, buildCombos, buildStoreVariants, fitFor, applyModifiers, itemVariants, isOpenAt, todayHoursLabel, CARB_TYPES };

// --- Build a RANKED LIST of meals for ONE store (for re-roll + sub-search).
//     Returns up to `limit` distinct meals, best-first. `subText` is optional
//     free text scoping the meal (e.g. "chicken and potatoes", "no fruit") —
//     it's parsed for macro filters AND used to prefer/avoid items by keyword. ---
function buildStoreVariants(store, center, f, opts = {}) {
  const now = opts.now || new Date();
  const limit = opts.limit || 8;
  const subText = (opts.subText || "").toLowerCase().trim();

  // Parse "no X" / "without X" avoid-terms and the remaining prefer-terms.
  const avoid = [];
  let pref = subText;
  const noRe = /\b(?:no|without|hold the|skip)\s+([a-z ]+?)(?:,|;|\band\b|$)/g;
  let m;
  while ((m = noRe.exec(subText)) !== null) { avoid.push(m[1].trim()); }
  pref = subText.replace(noRe, " ");
  const prefTerms = pref.split(/[\s,]+/).map(s => s.trim()).filter(t => t.length > 2 &&
    !["and","with","the","for","some","please","want","like"].includes(t));

  const dist = distMiles(center, store);
  const mains = store.items.filter(i => i.course === "main");
  const sides = store.items.filter(i => i.course === "side");
  const desserts = store.items.filter(i => i.course === "dessert");

  const wantMeal = f.courses.length === 0 || f.courses.includes("meal");
  const wantDessert = f.courses.includes("dessert");
  const dessertOnly = wantDessert && !wantMeal;

  const mainVariants = dessertOnly ? [null] : mains.flatMap(mm => itemVariants(mm, f));
  const sideVariants = dessertOnly ? [null] : [null, ...sides.flatMap(s => itemVariants(s, f))];
  const dessVariants = wantDessert ? desserts.flatMap(d => itemVariants(d, f))
                                   : [null, ...desserts.flatMap(d => itemVariants(d, f))];

  // The per-store view (re-roll + sub-search) is EXPLORATORY: the user wants to
  // see what else this place has, not just the 1-2 meals that exactly hit the
  // target. So we widen the calorie band and drop the protein/fat/carb limits.
  // Results still rank by fit (and by sub-search keywords), so the closest meals
  // lead — there's just real variety to cycle through. The macro target still
  // bounds calories loosely so meals stay meal-sized.
  const explore = true;
  const goal = f.calTarget !== null ? f.calTarget : (f.calMax !== null ? f.calMax : null);
  let hardHigh = f.calMax !== null ? f.calMax : (f.calTarget !== null ? f.calTarget * 1.25 : null);
  let hardLow = f.calTarget !== null ? f.calTarget * 0.70 : null;
  if (explore && goal !== null) { hardHigh = Math.round(goal * 1.45); hardLow = Math.round(goal * 0.5); }

  // keyword scoring against a meal's text (item names + chosen modifiers).
  // For avoid-terms ("no fruit"), reward meals whose modifiers REMOVE that
  // ingredient (a "no cheese" modifier), and penalize meals that still contain
  // it in a base item name without a removing modifier.
  function keywordScore(parts) {
    const names = parts.map(p => p.name.toLowerCase()).join(" ");           // base item names
    const mods = parts.flatMap(p => p.chosen.map(c => c.toLowerCase())).join(" "); // chosen modifier labels
    let s = 0;
    for (const a of avoid) {
      if (!a) continue;
      const removed = mods.includes("no " + a) || mods.includes("without " + a) || mods.includes("light " + a) || mods.includes(a + " only") || mods.includes("no-" + a);
      const presentInBase = names.includes(a);
      if (removed) s -= 200;            // good: this meal removes the avoided thing
      else if (presentInBase) s += 400; // bad: avoided thing is in the base, not removed
    }
    for (const t of prefTerms) {
      if (names.includes(t)) s -= 120;  // preferred term in an item name
      if (mods.includes(t)) s -= 140;   // even better: it's an added modifier ("double chicken")
    }
    return s;
  }

  const candidates = [];
  for (const mm of mainVariants) for (const s of sideVariants) for (const d of dessVariants) {
    const parts = [mm, s, d].filter(Boolean);
    if (!parts.length) continue;
    if (!dessertOnly && !mm) continue;
    if (wantDessert && !d) continue;

    const sum = macroSum(parts);
    if (hardHigh !== null && sum.cal > hardHigh) continue;
    if (hardLow !== null && sum.cal < hardLow) continue;
    if (!explore) {
      if (f.proteinMin !== null && sum.protein < f.proteinMin) continue;
      if (f.proteinMax !== null && sum.protein > f.proteinMax) continue;
      if (f.fatMax !== null && sum.fat > f.fatMax) continue;
      if (f.carbsMax !== null && sum.carbs > f.carbsMax) continue;
      if (f.wantsCarbs === false && sum.carbs > 30) continue;
    }
    const fMain = parts.find(p => p.course === "main") || parts[0];
    if (f.food && !matchesFood((store.region + " " + (store.cuisines || []).join(" ") + " " + (fMain ? fMain.name : "")).toLowerCase(), f.food)) continue;

    const modCount = parts.reduce((a, p) => a + p.chosen.length, 0);
    const sc = scoreCombo(sum, parts.length, modCount, f, dist, goal) + keywordScore(parts);
    const key = parts.map(p => p.label).join(" + ");
    candidates.push({ parts, sum, goal, score: sc, key });
  }

  // De-dup by MAIN dish (not the full combo), keeping the best-scoring variant
  // of each. This makes re-roll cycle through genuinely different mains instead
  // of the same main with a different side.
  const byKey = new Map();
  for (const c of candidates) {
    const main = c.parts.find(p => p.course === "main") || c.parts[0];
    const mkey = main ? main.name.toLowerCase() : c.key;
    const ex = byKey.get(mkey);
    if (!ex || c.score < ex.score) byKey.set(mkey, c);
  }
  const ranked = [...byKey.values()].sort((a, b) => a.score - b.score).slice(0, limit);
  const openInfo = isOpenAt(store.hours, now);

  return ranked.map(best => ({
    store: {
      restaurant: store.restaurant, platform: store.platform, region: store.region,
      lat: store.lat, lng: store.lng, distance: Math.round(dist * 10) / 10,
      cuisines: store.cuisines || [store.region],
      openKnown: openInfo.known, open: openInfo.open,
      hoursToday: todayHoursLabel(store.hours, now),
      discovered: !!store.discovered,
    },
    items: best.parts.map(p => ({
      name: p.name, label: p.label, course: p.course,
      cal: p.cal, protein: p.protein, carbs: p.carbs, fat: p.fat, price: p.price,
      mods: p.chosen, verified: !!p.verified, templated: !!p.templated, source: p.source || null,
    })),
    totals: (() => {
      const ex = comboExtras(best.parts);
      return {
        cal: Math.round(best.sum.cal), protein: Math.round(best.sum.protein),
        carbs: Math.round(best.sum.carbs), fat: Math.round(best.sum.fat),
        price: Math.round(best.sum.price * 100) / 100,
        sodium: ex.sodium, fiber: ex.fiber, sugar: ex.sugar,
        addedSugar: ex.addedSugar, satFat: ex.satFat, chol: ex.chol,
      };
    })(),
    allergens: comboExtras(best.parts).allergens,
    allergenKnown: comboExtras(best.parts).allergenKnown,
    verified: best.parts.every(p => p.verified),
    estimatedMenu: best.parts.some(p => p.templated),
    goal: best.goal,
    fit: fitFor(best.sum, best.goal),
  }));
}
