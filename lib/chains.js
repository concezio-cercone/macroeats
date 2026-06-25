/* ===========================================================================
 * chains.js — VERIFIED published macros for common chains.
 *
 * When discovery finds a restaurant whose name matches one of these chains, it
 * gets these REAL published numbers (verified:true, ✓) instead of the cuisine
 * estimate. Numbers are from each chain's official nutrition info (rounded per
 * FDA labeling); items include size/option modifiers like the rest of the data
 * model. Because chains publish per-item, these are as accurate as the chain's
 * own figures — far better than the cuisine template.
 *
 * To add a chain: copy a block, set the name (lowercase, matched loosely),
 * and fill items from the chain's nutrition page. Keep `verified:true` and cite
 * the source. This is the no-API-key path to real macros and it grows by hand.
 * ======================================================================== */

function mod(id, label, d, dPrice, sets) {
  return { id, label, default: false, d, dPrice: dPrice || 0, ...(sets ? { sets } : {}) };
}
function item(name, course, carbType, cheese, base, price, src, modifiers) {
  return { name, course, carbType, cheese, price, base, verified: true, source: src, modifiers: modifiers || [] };
}

// Keyed by a normalized chain name. `match` lists name fragments that map here.
const CHAINS = {
  "chipotle": {
    match: ["chipotle"],
    region: "Mexican", cuisines: ["Mexican"],
    diets: ["gluten-free-option","vegetarian-option","vegan-option","high-protein","keto-option","dairy-free-option"],
    items: [
      item("Chicken Burrito Bowl", "main", "refined", true, { cal:680, protein:52, carbs:73, fat:21 }, 11.95,
        "Chipotle official nutrition (white rice, black beans, chicken, salsa, cheese, lettuce), summed per-ingredient.", [
        mod("no-rice","no white rice",{cal:-210,protein:-4,carbs:-40,fat:-0.5},0,{carbType:"legume"}),
        mod("double-chicken","double chicken",{cal:180,protein:31,carbs:0,fat:7},4.75),
        mod("no-cheese","no cheese",{cal:-110,protein:-6,carbs:-1,fat:-8.5},0,{cheese:false}),
        mod("add-guac","add guacamole",{cal:230,protein:2,carbs:8,fat:22},2.95),
        mod("no-beans","no black beans",{cal:-130,protein:-8,carbs:-22,fat:-1.5},0),
      ]),
      item("Steak Burrito Bowl", "main", "refined", true, { cal:650, protein:41, carbs:73, fat:19 }, 13.95,
        "Chipotle official per-ingredient values (steak ~150cal/21g) on the bowl base.", [
        mod("no-rice","no white rice",{cal:-210,protein:-4,carbs:-40,fat:-0.5},0,{carbType:"legume"}),
        mod("double-steak","double steak",{cal:150,protein:21,carbs:0,fat:7},5.25),
        mod("no-cheese","no cheese",{cal:-110,protein:-6,carbs:-1,fat:-8.5},0,{cheese:false}),
        mod("add-guac","add guacamole",{cal:230,protein:2,carbs:8,fat:22},2.95),
      ]),
    ],
  },
  "jersey mikes": {
    match: ["jersey mike"],
    region: "Sandwiches", cuisines: ["American","Sandwiches"],
    diets: ["high-protein"],
    items: [
      item("#7 Turkey & Provolone (regular, white)", "main", "refined", true, { cal:800, protein:43, carbs:67, fat:39 }, 11.45,
        "Jersey Mike's official nutrition — regular sub, white bread, with the standard 'Mike's Way' build.", [
        mod("in-a-tub","in a tub (no bread)",{cal:-310,protein:-13,carbs:-58,fat:-1},0,{carbType:"none"}),
        mod("wheat","sub wheat bread",{cal:-30,protein:0,carbs:-3,fat:0},0,{carbType:"whole grain"}),
        mod("no-mayo","no mayo/oil",{cal:-235,protein:0,carbs:-2,fat:-26},0),
      ]),
      item("#9 Club Supreme (regular, white)", "main", "refined", true, { cal:900, protein:48, carbs:69, fat:46 }, 12.95,
        "Jersey Mike's official nutrition — regular sub, white bread.", [
        mod("in-a-tub","in a tub (no bread)",{cal:-310,protein:-13,carbs:-58,fat:-1},0,{carbType:"none"}),
        mod("no-mayo","no mayo",{cal:-100,protein:0,carbs:0,fat:-11},0),
      ]),
    ],
  },
  "chick-fil-a": {
    match: ["chick-fil-a","chick fil a","chickfila"],
    region: "Chicken", cuisines: ["American","Chicken"],
    diets: ["high-protein"],
    items: [
      item("Grilled Chicken Sandwich", "main", "whole grain", false, { cal:380, protein:28, carbs:44, fat:11 }, 6.49,
        "Chick-fil-A official nutrition — grilled chicken on multigrain bun, lettuce, tomato.", [
        mod("no-bun","no bun",{cal:-150,protein:-6,carbs:-41,fat:-2},0,{carbType:"none"}),
      ]),
      item("Grilled Nuggets (12 ct)", "main", "none", false, { cal:200, protein:38, carbs:2, fat:4.5 }, 6.75,
        "Chick-fil-A official nutrition — 12-count grilled nuggets.", [
        mod("eight-ct","8-count instead",{cal:-70,protein:-13,carbs:-1,fat:-1.5},-1.5),
      ]),
      item("Cobb Salad w/ Grilled Chicken (no dressing)", "main", "none", true, { cal:330, protein:40, carbs:13, fat:14 }, 9.65,
        "Chick-fil-A official nutrition — Cobb salad, grilled filet, without dressing.", [
        mod("add-avocado-ranch","add avocado lime ranch",{cal:310,protein:1,carbs:4,fat:32},0),
      ]),
    ],
  },
  "panera": {
    match: ["panera"],
    region: "Sandwiches", cuisines: ["American","Sandwiches","Salads"],
    diets: ["vegetarian-option"],
    items: [
      item("Green Goddess Cobb w/ Chicken (whole)", "main", "none", true, { cal:530, protein:38, carbs:25, fat:32 }, 12.79,
        "Panera official nutrition — whole salad with chicken.", [
        mod("half","half salad",{cal:-265,protein:-19,carbs:-12,fat:-16},-3.5),
      ]),
      item("Chipotle Chicken Avocado Melt (whole)", "main", "refined", true, { cal:860, protein:46, carbs:74, fat:42 }, 13.49,
        "Panera official nutrition — whole melt on black pepper focaccia.", [
        mod("half","half sandwich",{cal:-430,protein:-23,carbs:-37,fat:-21},-3.5),
      ]),
    ],
  },
  "subway": {
    match: ["subway"],
    region: "Sandwiches", cuisines: ["American","Sandwiches"],
    diets: ["vegetarian-option","high-protein"],
    items: [
      item("Oven Roasted Turkey (6-inch)", "main", "refined", false, { cal:280, protein:19, carbs:41, fat:4 }, 6.49,
        "Subway official nutrition — 6-inch on white, no cheese/sauce.", [
        mod("footlong","make it a footlong",{cal:280,protein:19,carbs:41,fat:4},3.5),
        mod("add-cheese","add provolone",{cal:50,protein:4,carbs:1,fat:4},0,{cheese:true}),
        mod("double-meat","double meat",{cal:100,protein:18,carbs:1,fat:2},2.5),
      ]),
      item("Rotisserie-Style Chicken (6-inch)", "main", "refined", false, { cal:320, protein:26, carbs:42, fat:6 }, 7.29,
        "Subway official nutrition — 6-inch on white, no cheese/sauce.", [
        mod("footlong","make it a footlong",{cal:320,protein:26,carbs:42,fat:6},3.5),
        mod("add-cheese","add provolone",{cal:50,protein:4,carbs:1,fat:4},0,{cheese:true}),
      ]),
    ],
  },
  "cava": {
    match: ["cava"],
    region: "Mediterranean", cuisines: ["Mediterranean","Greek"],
    diets: ["gluten-free-option","vegetarian-option","vegan-option","high-protein","dairy-free-option"],
    items: [
      item("Greens + Grains, Grilled Chicken", "main", "whole grain", true, { cal:640, protein:52, carbs:45, fat:26 }, 13.45,
        "CAVA official nutrition — greens+grains base, grilled chicken, harissa, feta.", [
        mod("no-grains","greens only",{cal:-180,protein:-4,carbs:-34,fat:-3},0,{carbType:"none"}),
        mod("double-chicken","double grilled chicken",{cal:130,protein:25,carbs:1,fat:4},3.95),
        mod("no-feta","no feta",{cal:-90,protein:-5,carbs:-1,fat:-7},0,{cheese:false}),
      ]),
    ],
  },
  "sweetgreen": {
    match: ["sweetgreen"],
    region: "Salads", cuisines: ["Salads","American"],
    diets: ["gluten-free-option","vegetarian-option","vegan-option"],
    items: [
      item("Harvest Bowl", "main", "whole grain", true, { cal:705, protein:28, carbs:76, fat:32 }, 14.95,
        "Sweetgreen official nutrition — wild rice, chicken, sweet potato, apples, goat cheese, almonds.", [
        mod("no-rice","no wild rice",{cal:-190,protein:-4,carbs:-38,fat:-3},0,{carbType:"none"}),
        mod("double-chicken","double chicken",{cal:170,protein:30,carbs:1,fat:5},4.50),
      ]),
    ],
  },
  "panda express": {
    match: ["panda express"],
    region: "Chinese", cuisines: ["Chinese","Asian"],
    diets: [],
    items: [
      item("Grilled Teriyaki Chicken + Fried Rice", "main", "refined", false, { cal:920, protein:42, carbs:103, fat:36 }, 9.40,
        "Panda Express official nutrition — 1 entree + fried rice side.", [
        mod("super-greens","sub super greens for rice",{cal:-380,protein:0,carbs:-82,fat:-22},0,{carbType:"none"}),
        mod("white-rice","sub white rice",{cal:-150,protein:-2,carbs:-2,fat:-12},0),
      ]),
      item("String Bean Chicken Breast + Super Greens", "main", "none", false, { cal:330, protein:16, carbs:26, fat:18 }, 9.40,
        "Panda Express official nutrition — entree + super greens side.", []),
    ],
  },
  "in-n-out": {
    match: ["in-n-out","in n out"],
    region: "Burgers", cuisines: ["American"],
    diets: ["high-protein"],
    items: [
      item("Hamburger", "main", "refined", false, { cal:390, protein:16, carbs:39, fat:19 }, 2.65,
        "In-N-Out official nutrition — hamburger with onion.", [
        mod("protein-style","protein style (lettuce wrap)",{cal:-150,protein:-1,carbs:-28,fat:-2},0,{carbType:"none"}),
        mod("add-cheese","cheeseburger",{cal:90,protein:7,carbs:1,fat:7},0.6,{cheese:true}),
        mod("double-double","make it a Double-Double",{cal:280,protein:21,carbs:2,fat:24},1.7),
      ]),
    ],
  },
  "mcdonalds": {
    match: ["mcdonald"],
    region: "Burgers", cuisines: ["American"],
    diets: [],
    items: [
      item("McChicken", "main", "refined", false, { cal:400, protein:14, carbs:39, fat:21 }, 2.79,
        "McDonald's official nutrition.", []),
      item("Quarter Pounder with Cheese", "main", "refined", true, { cal:520, protein:30, carbs:42, fat:26 }, 5.69,
        "McDonald's official nutrition.", [
        mod("no-bun","no bun",{cal:-150,protein:-6,carbs:-38,fat:-3},0,{carbType:"none"}),
      ]),
    ],
  },
  "taco bell": {
    match: ["taco bell"],
    region: "Mexican", cuisines: ["Mexican","Tex-Mex"],
    diets: ["vegetarian-option","high-protein"],
    items: [
      item("Cantina Chicken Bowl", "main", "refined", true, { cal:490, protein:29, carbs:49, fat:20 }, 6.99,
        "Taco Bell official nutrition — grilled chicken, rice, black beans, cheese, sour cream, guac.", [
        mod("no-rice","no rice",{cal:-170,protein:-3,carbs:-25,fat:-5},0,{carbType:"legume"}),
        mod("extra-chicken","extra chicken",{cal:60,protein:8,carbs:0,fat:3},1.50),
        mod("no-cheese","no cheese",{cal:-50,protein:-3,carbs:-1,fat:-4},0,{cheese:false}),
        mod("no-sour-cream","no sour cream",{cal:-60,protein:-1,carbs:-2,fat:-5},0),
      ]),
      item("Power Menu Bowl - Chicken", "main", "refined", true, { cal:470, protein:27, carbs:50, fat:18 }, 6.49,
        "Taco Bell official nutrition — grilled chicken power bowl.", [
        mod("no-rice","no rice",{cal:-150,protein:-5,carbs:-26,fat:-3},0,{carbType:"legume"}),
        mod("extra-chicken","extra chicken",{cal:80,protein:10,carbs:0,fat:4},1.50),
      ]),
    ],
  },
  "wendys": {
    match: ["wendy"],
    region: "Burgers", cuisines: ["American"],
    diets: ["high-protein"],
    items: [
      item("Grilled Chicken Sandwich", "main", "refined", false, { cal:370, protein:34, carbs:38, fat:9 }, 6.29,
        "Wendy's official nutrition — grilled chicken on bun.", [
        mod("no-bun","no bun",{cal:-160,protein:-6,carbs:-34,fat:-2},0,{carbType:"none"}),
      ]),
      item("Dave's Single", "main", "refined", true, { cal:590, protein:30, carbs:39, fat:34 }, 6.99,
        "Wendy's official nutrition — quarter-pound single with cheese.", [
        mod("no-bun","no bun",{cal:-150,protein:-5,carbs:-34,fat:-3},0,{carbType:"none"}),
      ]),
      item("Apple Pecan Salad w/ Grilled Chicken (full)", "main", "none", true, { cal:430, protein:32, carbs:32, fat:21 }, 8.49,
        "Wendy's official nutrition — full salad, grilled chicken, without dressing.", []),
    ],
  },
  "five guys": {
    match: ["five guys"],
    region: "Burgers", cuisines: ["American"],
    diets: ["high-protein"],
    items: [
      item("Little Hamburger", "main", "refined", false, { cal:480, protein:23, carbs:39, fat:26 }, 8.99,
        "Five Guys official nutrition — single-patty 'little' burger.", [
        mod("lettuce-wrap","bunless (lettuce wrap)",{cal:-220,protein:-2,carbs:-39,fat:-3},0,{carbType:"none"}),
        mod("add-bacon","add bacon",{cal:80,protein:6,carbs:0,fat:7},1.50),
      ]),
    ],
  },
};

// Build a fast lookup from name-fragment -> chain key.
const MATCH_INDEX = [];
for (const [key, def] of Object.entries(CHAINS)) {
  for (const frag of def.match) MATCH_INDEX.push({ frag, key });
}
// longer fragments first so "chick-fil-a" matches before a generic "chick"
MATCH_INDEX.sort((a, b) => b.frag.length - a.frag.length);

// Given a discovered place name, return a verified chain store or null.
function chainStoreFor(placeName, place) {
  const n = String(placeName || "").toLowerCase();
  const hit = MATCH_INDEX.find(m => n.includes(m.frag));
  if (!hit) return null;
  const def = CHAINS[hit.key];
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
    chain: true,                 // flag: this came from the verified chain map
    items: def.items.map(i => ({ ...i })),
  };
}

module.exports = { chainStoreFor, CHAINS };
