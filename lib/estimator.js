/* ===========================================================================
 * estimator.js — synthesize an ESTIMATED menu for a discovered restaurant.
 *
 * OpenStreetMap tells us a place exists and (often) its cuisine, but never its
 * macros. This maps a cuisine/amenity to a small template menu with ballpark
 * macros + modifiers, so discovered restaurants become buildable meals — every
 * item clearly flagged `templated:true` so the UI marks it as a rough estimate.
 *
 * This is deterministic and needs no API key. To upgrade to LLM-estimated
 * macros, replace templateFor() with a call to your model (see the note at the
 * bottom) — the rest of the pipeline is unchanged.
 * ======================================================================== */

function mod(id, label, d, dPrice, sets) {
  return { id, label, default: false, d, dPrice: dPrice || 0, ...(sets ? { sets } : {}) };
}
function it(name, course, carbType, cheese, base, price, modifiers) {
  return { name, course, carbType, cheese, price, base, modifiers: modifiers || [] };
}

// --- Archetype templates. Each returns { label, region, cuisines, items }. ---
const ARCHETYPES = {
  mexican: { label: "Mexican", cuisines: ["Mexican"], items: () => [
    it("Burrito Bowl (chicken, rice, beans)", "main", "refined", true, { cal:720, protein:45, carbs:78, fat:22 }, 12.50, [
      mod("no-rice","no rice",{cal:-200,protein:-4,carbs:-42,fat:-1},0,{carbType:"legume"}),
      mod("double-protein","double chicken",{cal:170,protein:30,carbs:0,fat:6},4.0),
      mod("no-cheese","no cheese",{cal:-100,protein:-6,carbs:-1,fat:-8},0,{cheese:false}),
      mod("add-guac","add guac",{cal:230,protein:2,carbs:8,fat:22},2.5),
    ]),
    it("3 Tacos (chicken)", "main", "refined", true, { cal:580, protein:34, carbs:52, fat:24 }, 11.0, [
      mod("no-cheese","no cheese",{cal:-90,protein:-5,carbs:-1,fat:-7},0,{cheese:false}),
    ]),
  ]},
  pizza: { label: "Pizza / Italian", cuisines: ["Italian"], items: () => [
    it("Cheese Pizza (2 slices)", "main", "refined", true, { cal:560, protein:24, carbs:64, fat:22 }, 9.0, [
      mod("add-pepperoni","add pepperoni",{cal:120,protein:8,carbs:2,fat:9},2.0),
      mod("extra-slice","extra slice",{cal:280,protein:12,carbs:32,fat:11},3.0),
    ]),
    it("Chicken Parm", "main", "refined", true, { cal:780, protein:48, carbs:62, fat:34 }, 14.0, []),
  ]},
  sushi: { label: "Sushi / Poke", cuisines: ["Japanese","Sushi","Poke"], items: () => [
    it("Poke Bowl (salmon, rice)", "main", "whole grain", false, { cal:600, protein:38, carbs:64, fat:18 }, 14.5, [
      mod("no-rice","no rice (greens)",{cal:-210,protein:-4,carbs:-44,fat:-2},0,{carbType:"none"}),
      mod("double-fish","double protein",{cal:150,protein:24,carbs:0,fat:6},4.5),
      mod("add-avocado","add avocado",{cal:120,protein:1,carbs:6,fat:11},2.0),
    ]),
    it("Sushi Combo (8pc + roll)", "main", "refined", false, { cal:560, protein:30, carbs:72, fat:12 }, 16.0, []),
  ]},
  thai: { label: "Thai / Asian", cuisines: ["Thai","Asian"], items: () => [
    it("Pad Thai (chicken)", "main", "refined", false, { cal:700, protein:30, carbs:86, fat:24 }, 13.0, [
      mod("extra-chicken","extra chicken",{cal:140,protein:26,carbs:0,fat:4},3.5),
    ]),
    it("Chicken & Rice (larb style)", "main", "refined", false, { cal:520, protein:36, carbs:48, fat:18 }, 12.5, [
      mod("no-rice","no rice",{cal:-200,protein:-4,carbs:-44,fat:0},0,{carbType:"none"}),
    ]),
  ]},
  chinese: { label: "Chinese", cuisines: ["Chinese"], items: () => [
    it("Chicken & Broccoli + rice", "main", "refined", false, { cal:700, protein:40, carbs:82, fat:22 }, 12.0, [
      mod("no-rice","no rice",{cal:-220,protein:-4,carbs:-46,fat:0},0,{carbType:"none"}),
    ]),
    it("Orange Chicken + rice", "main", "refined", false, { cal:820, protein:32, carbs:98, fat:32 }, 12.5, []),
  ]},
  korean: { label: "Korean", cuisines: ["Korean"], items: () => [
    it("Bibimbap (beef)", "main", "refined", false, { cal:720, protein:38, carbs:88, fat:24 }, 14.0, [
      mod("no-rice","no rice",{cal:-230,protein:-4,carbs:-48,fat:0},0,{carbType:"none"}),
    ]),
    it("Korean BBQ Bowl", "main", "refined", false, { cal:760, protein:44, carbs:72, fat:30 }, 15.0, []),
  ]},
  vietnamese: { label: "Vietnamese", cuisines: ["Vietnamese"], items: () => [
    it("Pho (beef)", "main", "refined", false, { cal:480, protein:32, carbs:58, fat:12 }, 13.0, [
      mod("extra-beef","extra beef",{cal:120,protein:20,carbs:0,fat:4},3.0),
    ]),
    it("Vermicelli Bowl (grilled chicken)", "main", "refined", false, { cal:560, protein:36, carbs:64, fat:16 }, 13.0, []),
  ]},
  indian: { label: "Indian", cuisines: ["Indian"], items: () => [
    it("Chicken Tikka Masala + rice", "main", "refined", true, { cal:780, protein:42, carbs:76, fat:30 }, 14.0, [
      mod("no-rice","no rice",{cal:-220,protein:-4,carbs:-46,fat:0},0,{carbType:"none"}),
    ]),
    it("Chana Masala + rice", "main", "refined", false, { cal:640, protein:20, carbs:92, fat:18 }, 12.0, []),
  ]},
  mediterranean: { label: "Mediterranean", cuisines: ["Mediterranean","Greek"], items: () => [
    it("Chicken Gyro Bowl", "main", "refined", true, { cal:640, protein:44, carbs:52, fat:28 }, 13.0, [
      mod("no-rice","no rice/pita",{cal:-180,protein:-4,carbs:-34,fat:-3},0,{carbType:"none"}),
      mod("double-chicken","double chicken",{cal:130,protein:25,carbs:1,fat:4},4.0),
      mod("no-feta","no feta",{cal:-90,protein:-5,carbs:-1,fat:-7},0,{cheese:false}),
    ]),
    it("Falafel Plate", "main", "refined", true, { cal:620, protein:20, carbs:72, fat:26 }, 12.0, []),
  ]},
  burger: { label: "Burgers / American", cuisines: ["American"], items: () => [
    it("Cheeseburger + fries", "main", "refined", true, { cal:920, protein:40, carbs:78, fat:52 }, 13.0, [
      mod("no-fries","no fries",{cal:-360,protein:-5,carbs:-44,fat:-17},0),
      mod("no-bun","no bun",{cal:-150,protein:-5,carbs:-28,fat:-2},0,{carbType:"none"}),
      mod("double-patty","double patty",{cal:220,protein:24,carbs:0,fat:16},3.0),
    ]),
    it("Grilled Chicken Sandwich", "main", "refined", true, { cal:620, protein:40, carbs:52, fat:26 }, 12.0, []),
  ]},
  salad: { label: "Salads", cuisines: ["Salads"], items: () => [
    it("Chicken Caesar Salad", "main", "none", true, { cal:520, protein:40, carbs:20, fat:30 }, 12.0, [
      mod("double-protein","double protein",{cal:120,protein:24,carbs:0,fat:2},4.0),
      mod("no-dressing","light dressing",{cal:-180,protein:-1,carbs:-2,fat:-19},0),
      mod("no-cheese","no cheese",{cal:-80,protein:-5,carbs:-1,fat:-7},0,{cheese:false}),
    ]),
  ]},
  sandwich: { label: "Sandwiches / Deli", cuisines: ["American"], items: () => [
    it("Turkey Sub (6 inch)", "main", "refined", true, { cal:520, protein:30, carbs:56, fat:18 }, 9.0, [
      mod("double-meat","double meat",{cal:120,protein:18,carbs:2,fat:4},3.0),
      mod("no-cheese","no cheese",{cal:-80,protein:-5,carbs:-1,fat:-6},0,{cheese:false}),
    ]),
  ]},
  chicken: { label: "Chicken", cuisines: ["American"], items: () => [
    it("Rotisserie Chicken Plate", "main", "refined", false, { cal:680, protein:52, carbs:44, fat:30 }, 13.0, [
      mod("no-side","no side",{cal:-180,protein:-3,carbs:-38,fat:-2},0),
    ]),
    it("Fried Chicken Sandwich", "main", "refined", true, { cal:700, protein:38, carbs:58, fat:34 }, 11.0, []),
  ]},
  bbq: { label: "BBQ", cuisines: ["BBQ"], items: () => [
    it("Pulled Pork Plate", "main", "refined", false, { cal:780, protein:46, carbs:52, fat:40 }, 15.0, [
      mod("no-side","no side",{cal:-180,protein:-3,carbs:-38,fat:-2},0),
    ]),
    it("Brisket Plate", "main", "none", false, { cal:720, protein:52, carbs:18, fat:48 }, 17.0, []),
  ]},
  seafood: { label: "Seafood", cuisines: ["Seafood"], items: () => [
    it("Grilled Salmon Plate", "main", "refined", false, { cal:620, protein:46, carbs:36, fat:30 }, 17.0, [
      mod("no-side","no side",{cal:-160,protein:-3,carbs:-34,fat:-1},0),
      mod("double-salmon","double salmon",{cal:220,protein:34,carbs:0,fat:12},6.0),
    ]),
  ]},
  breakfast: { label: "Breakfast", cuisines: ["Breakfast"], items: () => [
    it("Breakfast Burrito", "main", "refined", true, { cal:640, protein:30, carbs:56, fat:34 }, 10.0, [
      mod("no-potato","no potato",{cal:-160,protein:-4,carbs:-28,fat:-6},0),
    ]),
    it("Egg & Protein Plate", "main", "none", true, { cal:520, protein:38, carbs:18, fat:34 }, 12.0, []),
  ]},
  dessert: { label: "Bakery / Dessert", cuisines: ["Dessert","Bakery"], items: () => [
    it("Pastry", "dessert", "refined", false, { cal:380, protein:6, carbs:48, fat:18 }, 4.0, []),
    it("Cookies (2)", "dessert", "refined", false, { cal:360, protein:4, carbs:48, fat:18 }, 4.0, []),
    it("Muffin", "dessert", "refined", false, { cal:420, protein:6, carbs:58, fat:18 }, 4.0, []),
  ]},
  icecream: { label: "Ice Cream", cuisines: ["Ice Cream","Dessert"], items: () => [
    it("Ice Cream (2 scoops)", "dessert", "refined", false, { cal:380, protein:6, carbs:46, fat:20 }, 5.5, []),
    it("Sundae", "dessert", "refined", false, { cal:520, protein:8, carbs:70, fat:24 }, 6.5, []),
    it("Ice Cream Shake", "dessert", "refined", false, { cal:620, protein:12, carbs:88, fat:24 }, 6.0, []),
  ]},
  generic: { label: "Restaurant", cuisines: ["American"], items: () => [
    it("House Entrée (protein + side)", "main", "refined", false, { cal:650, protein:35, carbs:60, fat:26 }, 14.0, [
      mod("no-side","no side",{cal:-200,protein:-4,carbs:-42,fat:-2},0,{carbType:"none"}),
      mod("add-protein","extra protein",{cal:150,protein:25,carbs:0,fat:5},4.0),
    ]),
    it("Lighter Plate", "main", "refined", false, { cal:450, protein:30, carbs:38, fat:18 }, 12.0, []),
  ]},
};

// Map an OSM cuisine string + amenity to an archetype key.
function archetypeKey(cuisineStr, amenity) {
  const c = String(cuisineStr || "").toLowerCase();
  const has = (...k) => k.some(x => c.includes(x));
  if (has("pizza","italian")) return "pizza";
  if (has("mexican","burrito","taco","tex-mex","tex_mex")) return "mexican";
  if (has("sushi","poke")) return "sushi";
  if (has("japanese") && !has("ramen")) return "sushi";
  if (has("thai")) return "thai";
  if (has("chinese","cantonese","szechuan","dim_sum")) return "chinese";
  if (has("korean")) return "korean";
  if (has("vietnamese","pho")) return "vietnamese";
  if (has("indian","pakistani","curry")) return "indian";
  if (has("mediterranean","greek","lebanese","falafel","turkish","kebab","gyro","shawarma")) return "mediterranean";
  if (has("burger","american","diner","steak_house")) return "burger";
  if (has("salad")) return "salad";
  if (has("sandwich","deli","sub","bagel")) return "sandwich";
  if (has("chicken","wings","fried_chicken")) return "chicken";
  if (has("barbecue","bbq")) return "bbq";
  if (has("seafood","fish")) return "seafood";
  if (has("breakfast","brunch","pancake")) return "breakfast";
  if (has("ramen","noodle","asian","ramen")) return "thai";
  if (has("ice_cream","gelato","frozen_yogurt","froyo")) return "icecream";
  if (has("donut","doughnut","dessert","cake","bakery","pastry","coffee_shop","cafe","cookie")) return "dessert";
  if (amenity === "ice_cream") return "icecream";
  if (amenity === "cafe") return "dessert";
  if (amenity === "fast_food") return "burger"; // sensible default for unlabeled fast food
  return "generic";
}

// Map specific OSM cuisine tags to a broad browsable group, so "African",
// "Middle Eastern", "South American" etc. category chips can match a discovered
// place even though OSM tags it as e.g. ethiopian / lebanese / peruvian.
const CUISINE_GROUPS = [
  [["lebanese","persian","iranian","turkish","israeli","arab","syrian","falafel","shawarma","kebab","mediterranean"], "middle eastern"],
  [["ethiopian","eritrean","moroccan","nigerian","somali","senegalese","african","egyptian"], "african"],
  [["peruvian","brazilian","argentin","colombian","venezuelan","chilean"], "south american"],
  [["guatemalan","salvadoran","honduran","nicaraguan","costa_rican"], "central american"],
  [["russian","polish","ukrainian","czech","slovak","serbian","croatian","bulgarian"], "slavic"],
  [["taiwanese"], "taiwanese"],
  [["hawaiian","poke"], "hawaiian"],
  [["navajo","frybread"], "native american"],
  [["canadian","quebecois","poutine"], "canadian"],
  [["french","creperie","crepe"], "french"],
  [["spanish","tapas","basque"], "spanish"],
  [["german","bavarian","austrian"], "german"],
];
// Extra cuisine tags for a discovered place: its own OSM cuisine words plus any
// group label, so the food/craving filter can match broad categories.
function cuisineTags(raw) {
  const c = String(raw || "").toLowerCase();
  if (!c) return [];
  const tags = new Set();
  for (const w of c.split(/[;,_\s]+/)) if (w.length > 2) tags.add(w);
  for (const [subs, group] of CUISINE_GROUPS) if (subs.some(s => c.includes(s))) tags.add(group);
  return [...tags];
}

// Build a synthetic store from a discovered place.
// place: { name, lat, lng, cuisine, amenity }
// Returns the store with `archetypeKey` and `lowConfidence` flags so callers
// can discard places we have no real cuisine signal for ("no macro data yet").
function synthStore(place) {
  const key = archetypeKey(place.cuisine, place.amenity);
  const arch = ARCHETYPES[key] || ARCHETYPES.generic;
  // Low confidence = we fell back to the generic template AND we have no signal
  // at all: no cuisine tag AND it's not fast_food. Fast-food places are almost
  // always recognizable chains (McDonald's, Taco Bell) or estimable, so we keep
  // them even without a cuisine tag rather than discarding them.
  const isFastFood = place.amenity === "fast_food";
  const lowConfidence = (key === "generic") && !place.cuisine && !isFastFood;
  const source = "Estimated from typical " + arch.label + " dishes — NOT from " + place.name +
    ". This place was found nearby (OpenStreetMap) but isn't in the verified database and doesn't publish macros, so these numbers are a rough cuisine-based ballpark. Treat as an estimate and verify before relying on them.";
  const items = arch.items().map(i => ({ ...i, verified: false, templated: true, source }));
  return {
    restaurant: place.name,
    platform: null,           // unknown — UI offers both DoorDash + Uber Eats search
    region: arch.label,
    cuisines: [...new Set([...arch.cuisines, ...cuisineTags(place.cuisine)])],
    diets: [],                // unknown capabilities
    lat: place.lat, lng: place.lng,
    hours: place.hours || null,
    locationCount: place.locationCount || 1,
    discovered: true,
    archetypeKey: key,
    lowConfidence,
    items,
  };
}

module.exports = { synthStore, archetypeKey, ARCHETYPES };

/* ---------------------------------------------------------------------------
 * LLM UPGRADE PATH (optional): to use real LLM estimates instead of templates,
 * replace synthStore's item generation with a call like:
 *
 *   POST https://api.anthropic.com/v1/messages  (needs your ANTHROPIC_API_KEY)
 *   prompt: "Estimate a typical menu with per-item calories/protein/carbs/fat
 *            for a restaurant named X with cuisine Y. Return JSON."
 *
 * Keep the same item shape (base + modifiers + templated:true) and the rest of
 * the pipeline works unchanged. Templates are the zero-setup default.
 * ------------------------------------------------------------------------- */
