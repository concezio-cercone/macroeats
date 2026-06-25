#!/usr/bin/env python3
"""
build_opennutrition.py  —  MacroEats OpenNutrition importer (restaurant rows)
=============================================================================

Converts the OpenNutrition dataset's RESTAURANT rows into
data/opennutrition-chains.json, a verified-macro source layered alongside the
curated chains and MenuStat (see lib/chainSource.js / server.js).

Only `type == restaurant` rows are used — OpenNutrition is mostly generic
grocery/everyday foods, which don't fit MacroEats' "build a meal at a nearby
restaurant" model. Restaurant rows are chain-tagged in the name ("... by KFC")
and carry full per-100g nutrition + a serving size, which we convert to
per-serving macros.

SOURCE
  First run reads the full dataset from ORIGINAL (set below) and writes a small
  committable subset to nutrition-data/opennutrition-restaurant.tsv. Later runs
  read that subset, so the build is reproducible without the 270 MB original.

LICENSING (ODbL + DbCL) — the data is OpenNutrition's, not ours. Attribution to
  "OpenNutrition" (https://www.opennutrition.app) is REQUIRED wherever the data
  is shown; it's baked into each item's source string here, shown in the app
  footer, and recorded in NOTICE.md. The generated file is distributed as ODbL.

RE-RUN:  python build_opennutrition.py
"""
import csv
import json
import os
import re

csv.field_size_limit(10 ** 9)

HERE = os.path.dirname(os.path.abspath(__file__))
SUBSET = os.path.join(HERE, "nutrition-data", "opennutrition-restaurant.tsv")
# Only needed for the first extraction (to create SUBSET). User-specific path.
ORIGINAL = r"C:\Users\Concezio-WS25\Downloads\New folder (7)\opennutrition_foods.tsv"
OUT = os.path.join(HERE, "data", "opennutrition-chains.json")

ATTRIB = ("OpenNutrition (opennutrition.app), ODbL — official published "
          "nutrition for %s, converted from per-100g to per-serving. "
          "Price is an estimate.")

CAP_MAIN, CAP_SIDE, CAP_DESSERT = 30, 8, 6
PRICE = {"main": 11.0, "side": 5.0, "dessert": 6.0}

# region + cuisines + match fragments, keyed by the chain string parsed from the
# item name ("... by <chain>"). Fragments match a normalized place name.
CHAIN_META = {
    "Starbucks":                 ("Bakery",      ["Bakery", "Breakfast", "Dessert"], ["starbucks"]),
    "Dairy Queen":               ("Dessert",     ["Dessert", "American"],            ["dairy queen"]),
    "Dunkin'":                   ("Bakery",      ["Bakery", "Dessert", "Breakfast"], ["dunkin"]),
    "Panera Bread":              ("Sandwiches",  ["American", "Sandwiches", "Salads"], ["panera"]),
    "Jamba":                     ("Smoothies",   ["Dessert"],                        ["jamba"]),
    "Jersey Mike's Subs":        ("Sandwiches",  ["American", "Sandwiches"],         ["jersey mike"]),
    "Smoothie King":             ("Smoothies",   ["Dessert"],                        ["smoothie king"]),
    "The Cheesecake Factory":    ("American",    ["American"],                       ["cheesecake factory"]),
    "Tim Hortons":               ("Bakery",      ["Bakery", "Breakfast", "Dessert"], ["tim horton"]),
    "Domino's Pizza":            ("Pizza",       ["Italian", "Pizza"],               ["domino"]),
    "McDonald's":                ("Burgers",     ["American", "Burgers"],            ["mcdonald"]),
    "Whataburger":               ("Burgers",     ["American", "Burgers"],            ["whataburger"]),
    "IHOP":                      ("Breakfast",   ["American", "Breakfast"],          ["ihop"]),
    "Krispy Kreme":              ("Bakery",      ["Bakery", "Dessert"],              ["krispy kreme"]),
    "Applebee's":                ("American",    ["American"],                       ["applebee"]),
    "Outback Steakhouse":        ("American",    ["American", "Seafood"],            ["outback"]),
    "Chipotle Mexican Grill":    ("Mexican",     ["Mexican"],                        ["chipotle"]),
    "Chick-fil-A":               ("Chicken",     ["American", "Chicken"],            ["chick fil a", "chickfila"]),
    "Subway":                    ("Sandwiches",  ["American", "Sandwiches"],         ["subway"]),
    "Burger King":               ("Burgers",     ["American", "Burgers"],            ["burger king"]),
    "Wendy's":                   ("Burgers",     ["American", "Burgers"],            ["wendy"]),
    "TGI Fridays":               ("American",    ["American"],                       ["tgi friday", "tgi fridays", "fridays"]),
    "Jimmy John's":              ("Sandwiches",  ["American", "Sandwiches"],         ["jimmy john"]),
    "El Pollo Loco":             ("Mexican",     ["Mexican", "Chicken"],             ["el pollo loco", "pollo loco"]),
    "Olive Garden":              ("Italian",     ["Italian"],                        ["olive garden"]),
    "Taco Bell":                 ("Mexican",     ["Mexican"],                        ["taco bell"]),
    "Cracker Barrel":            ("American",    ["American", "Breakfast"],          ["cracker barrel"]),
    "Shake Shack":               ("Burgers",     ["American", "Burgers"],            ["shake shack"]),
    "Tropical Smoothie Cafe":    ("Smoothies",   ["American", "Sandwiches"],         ["tropical smoothie"]),
    "Jack in the Box":           ("Burgers",     ["American", "Burgers"],            ["jack in the box"]),
    "Waffle House":              ("Breakfast",   ["American", "Breakfast"],          ["waffle house"]),
    "Blue Bottle Coffee":        ("Coffee",      ["Bakery"],                         ["blue bottle"]),
    "Denny's":                   ("American",    ["American", "Breakfast"],          ["dennys"]),
    "Chili's Grill & Bar":       ("American",    ["American", "Mexican"],            ["chilis"]),
    "Del Taco":                  ("Mexican",     ["Mexican"],                        ["del taco"]),
    "Popeyes Louisiana Kitchen": ("Chicken",     ["American", "Chicken"],            ["popeyes"]),
    "Sonic Drive-In":            ("Burgers",     ["American", "Burgers"],            ["sonic"]),
    "Arby's":                    ("Sandwiches",  ["American", "Sandwiches"],         ["arbys"]),
    "Just Salad":                ("Salads",      ["Salads"],                         ["just salad"]),
    "Cava":                      ("Mediterranean", ["Mediterranean", "Greek"],       ["cava"]),
    "Panda Express":             ("Chinese",     ["Chinese", "Asian"],              ["panda express"]),
    "Pizza Hut":                 ("Pizza",       ["Italian", "Pizza"],               ["pizza hut"]),
    "KFC":                       ("Chicken",     ["American", "Chicken"],            ["kfc", "kentucky fried"]),
    "Sweetgreen":                ("Salads",      ["Salads", "American"],             ["sweetgreen"]),
    "Qdoba":                     ("Mexican",     ["Mexican"],                        ["qdoba"]),
    "Wingstop":                  ("Chicken",     ["American", "Chicken"],            ["wingstop"]),
    "Five Guys":                 ("Burgers",     ["American", "Burgers"],            ["five guys"]),
    "In-N-Out Burger":           ("Burgers",     ["American", "Burgers"],            ["in n out"]),
}

CHEESE_WORDS = ("cheese", "cheddar", "queso", "parmesan", "parm", "mozzarella",
                "provolone", "swiss", "gouda", "feta", "alfredo", "quesadilla",
                "nacho", "pizza")

# --- course classification keyword sets (matched on the cleaned item name) ---
STRONG_FOOD = ["sandwich", "bowl", "wrap", "panini", "salad", "burrito", "burger",
               "plate", "melt", "bagel", "biscuit", "pizza", "taco", "quesadilla",
               "sub", "flatbread", "omelette", "omelet", "pancake", "waffle", "toast",
               "oatmeal", "nuggets", "tenders", "wings", "gyro", "pasta", "steak",
               "chicken", "sausage", "bacon", "egg", "scramble", "hash", "fish",
               "shrimp", "rice", "noodle", "dog", "platter", "combo", "beef", "pork",
               "turkey", "ham", "salmon", "lamb", "brisket", "rib", "ribs", "meatball"]
DRINK_WORDS = ["latte", "cappuccino", "cappucino", "espresso", "americano", "macchiato",
               "mocha", "tea", "chai", "refresher", "lemonade", "juice", "soda", "cola",
               "frappuccino", "frappe", "cortado", "matcha", "coffee", "shandy", "fog",
               "spritzer", "cooler", "slush", "slushie", "freeze", "fizz", "cider",
               "kombucha", "limeade", "margarita", "martini", "mojito", "sangria",
               "cocktail", "beer", "wine", "mule", "mimosa", "daiquiri", "colada",
               "punch", "misty", "icee", "spritz"]
# NB: "smoothie" is deliberately NOT a drink word — smoothies are the actual
# product at Smoothie King / Jamba and stay as mains.
DRINK_SUBS = ["cold brew", "iced coffee", "iced tea", "hot tea", "flat white",
              "cold foam", "drip coffee", "hot chocolate"]
DESSERT_WORDS = ["cake", "cheesecake", "brownie", "cookie", "donut", "doughnut", "blizzard",
                 "sundae", "milkshake", "shake", "float", "muffin", "scone", "croissant",
                 "danish", "churro", "pie", "parfait", "custard", "pastry", "tart", "macaron",
                 "cupcake", "gelato", "mcflurry", "frosty", "concrete", "pudding", "tiramisu",
                 "cobbler", "cannoli", "sherbet", "sorbet", "brulee"]
DESSERT_SUBS = ["ice cream", "cinnamon roll", "waffle cone"]
SIDE_WORDS = ["fries", "chips", "tots", "tater", "breadstick", "breadsticks"]
SIDE_SUBS = ["hash brown", "onion rings", "side salad", "side of"]


def has_word(s, words):
    return any(re.search(r"\b" + re.escape(w) + r"\b", s) for w in words)


def classify(name):
    """main / side / dessert, or None to exclude (pure drinks)."""
    s = name.lower()
    food = has_word(s, STRONG_FOOD)
    drink = has_word(s, DRINK_WORDS) or any(w in s for w in DRINK_SUBS)
    if drink and not food:
        return None
    if has_word(s, DESSERT_WORDS) or any(w in s for w in DESSERT_SUBS):
        return "dessert"
    if has_word(s, SIDE_WORDS) or any(w in s for w in SIDE_SUBS):
        return "side"
    return "main"


def norm(s):
    s = (s or "").lower().replace("'", "").replace("’", "").replace("`", "")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")


def carb_type(name, carbs):
    if carbs <= 12:
        return "none"
    low = name.lower()
    if "brown rice" in low or "whole wheat" in low or "whole grain" in low:
        return "whole grain"
    return "refined"


def has_cheese(name):
    low = name.lower()
    return any(w in low for w in CHEESE_WORDS)


def modifiers_and_price(name, base, course):
    """Pizza slices get +1/+2 slice modifiers (see build_menustat.py)."""
    if "slice" in name.lower():
        per = 3.0
        x2 = {k: v * 2 for k, v in base.items()}
        return ([
            {"id": "add-slice", "label": "+1 slice", "default": False, "d": dict(base), "dPrice": per},
            {"id": "add-2-slices", "label": "+2 slices", "default": False, "d": x2, "dPrice": per * 2},
        ], per)
    return [], PRICE[course]


def spread(items, cap, key):
    if len(items) <= cap:
        return list(items)
    ordered = sorted(items, key=key)
    n = len(ordered)
    idxs = sorted({round(i * (n - 1) / (cap - 1)) for i in range(cap)})
    return [ordered[i] for i in idxs]


def select_mains(mains):
    if len(mains) <= CAP_MAIN:
        return mains
    chosen = {id(x): x for x in spread(mains, CAP_MAIN - 4, key=lambda r: r["base"]["cal"])}
    for r in sorted(mains, key=lambda r: -r["base"]["protein"])[:4]:
        chosen.setdefault(id(r), r)
    return list(chosen.values())


# NOTE: no chain-level protein "quality gate" here (unlike build_menustat.py).
# A 4-4-9 calorie/macro gap can't tell a real protein error (MenuStat's Pizza
# Hut) from merely under-counted fat/carbs (dressed salads, sauced ribs) or
# alcohol, so on this source it only produced false positives (it tried to drop
# Chipotle, Chili's, etc., whose protein is fine). OpenNutrition's restaurant
# data is clean; instead we just exclude non-food liquids (drinks/cocktails)
# below — any "main" with zero protein AND zero fat is a drink, not a meal.


def jload(s):
    try:
        return json.loads(s)
    except Exception:
        return None


# Extra per-serving nutrients we surface as optional visuals (sodium in mg, the
# rest in grams). Converted from per-100g like the macros.
def micros_of(n, f):
    def g(key):
        v = n.get(key)
        return round(v * f) if isinstance(v, (int, float)) else None
    return {"sodium": g("sodium"), "fiber": g("dietary_fiber"),
            "sugar": g("total_sugars"), "addedSugar": g("added_sugars"),
            "satFat": g("saturated_fats")}


# Allergens present in an item, from OpenNutrition's ingredient_analysis. Keys
# look like {"allergen_milk":[...], "gluten":[...], "allergen_tree_nuts":[...]}.
# Returns None when there is NO ingredient analysis (status unknown — important
# so an allergen filter never certifies an item it has no data for), [] when
# analyzed and clean, or a sorted list of the allergens found.
def allergens_of(ia_raw):
    ia = jload(ia_raw) or {}
    if not isinstance(ia, dict) or not ia:
        return None
    rename = {"soybeans": "soy"}
    out = set()
    for k in ia:
        if k == "gluten":
            out.add("gluten")
        elif k.startswith("allergen_"):
            a = k[len("allergen_"):]
            out.add(rename.get(a, a))
    return sorted(out)


def _extract_subset(src_tsv):
    """Write only the restaurant rows of a full dataset TSV to SUBSET."""
    os.makedirs(os.path.dirname(SUBSET), exist_ok=True)
    with open(src_tsv, encoding="utf-8", newline="") as f, \
         open(SUBSET, "w", encoding="utf-8", newline="") as out:
        r = csv.reader(f, delimiter="\t")
        w = csv.writer(out, delimiter="\t")
        hdr = next(r)
        w.writerow(hdr)
        ti = hdr.index("type")
        kept = 0
        for row in r:
            if len(row) == len(hdr) and row[ti] == "restaurant":
                w.writerow(row)
                kept += 1
    print("Extracted %d restaurant rows -> %s" % (kept, SUBSET))


def read_restaurant_rows():
    """Yield restaurant rows. Source priority:
       1. $OPENNUTRITION_TSV  — a freshly downloaded full dataset (refresh_data.py
          sets this); re-extracts the subset from it.
       2. the committed/cached SUBSET, if present.
       3. ORIGINAL (a local full dataset) — extracted on first run.
    """
    env_src = os.environ.get("OPENNUTRITION_TSV")
    if env_src:
        if not os.path.exists(env_src):
            raise SystemExit("OPENNUTRITION_TSV set but not found: %s" % env_src)
        _extract_subset(env_src)
    elif not os.path.exists(SUBSET):
        if not os.path.exists(ORIGINAL):
            raise SystemExit("Need $OPENNUTRITION_TSV, %s, or %s" % (SUBSET, ORIGINAL))
        _extract_subset(ORIGINAL)
    with open(SUBSET, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            yield row


def main():
    by_chain = {}
    seen = set()
    excluded_drinks = 0
    for row in read_restaurant_rows():
        name = (row.get("name") or "").strip()
        if " by " not in name:
            continue
        item_name, chain = name.rsplit(" by ", 1)
        item_name, chain = item_name.strip(), chain.strip()
        if chain not in CHAIN_META or not item_name:
            continue
        n = jload(row.get("nutrition_100g")) or {}
        serv = jload(row.get("serving")) or {}
        grams = (serv.get("metric") or {}).get("quantity")
        if not isinstance(grams, (int, float)) or grams <= 0:
            continue
        if not all(isinstance(n.get(k), (int, float)) for k in ("calories", "protein", "carbohydrates", "total_fat")):
            continue
        course = classify(item_name)
        if course is None:
            excluded_drinks += 1
            continue
        f = grams / 100.0
        base = {"cal": round(n["calories"] * f), "protein": round(n["protein"] * f),
                "carbs": round(n["carbohydrates"] * f), "fat": round(n["total_fat"] * f)}
        # A "main" with zero protein AND zero fat is a liquid (cocktail, soda,
        # juice, tea) that slipped the keyword filter — not a meal. Drop it.
        if course == "main" and base["protein"] == 0 and base["fat"] == 0:
            excluded_drinks += 1
            continue
        if course == "main" and base["cal"] < 50:
            continue
        # Condiments/garnishes (cream cheese, dipping sauce, a tortilla, candy)
        # default to "main" by name but aren't meals. A real main is either
        # substantial or has real protein — demote the rest to an optional side.
        if course == "main" and base["cal"] < 120 and base["protein"] < 8:
            course = "side"
        dedup = (chain, item_name.lower(), base["cal"], base["protein"])
        if dedup in seen:
            continue
        seen.add(dedup)
        mods, price = modifiers_and_price(item_name, base, course)
        by_chain.setdefault(chain, []).append({
            "name": item_name, "course": course,
            "carbType": carb_type(item_name, base["carbs"]),
            "cheese": has_cheese(item_name), "price": price,
            "base": base, "modifiers": mods,
            "micros": micros_of(n, f),
            "allergens": allergens_of(row.get("ingredient_analysis")),
        })

    chains = {}
    total = 0
    for chain, items in sorted(by_chain.items()):
        region, cuisines, match = CHAIN_META[chain]
        mains = select_mains([i for i in items if i["course"] == "main"])
        sides = spread([i for i in items if i["course"] == "side"], CAP_SIDE, key=lambda r: r["base"]["cal"])
        desserts = spread([i for i in items if i["course"] == "dessert"], CAP_DESSERT, key=lambda r: r["base"]["cal"])
        kept = mains + sides + desserts
        if not kept:
            continue
        diets = []
        if any(i["base"]["protein"] >= 30 for i in mains):
            diets.append("high-protein")
        if any(i["base"]["carbs"] <= 20 and i["base"]["protein"] >= 20 for i in mains):
            diets.append("keto-option")
        src = ATTRIB % chain
        out_items = [{
            "name": i["name"], "course": i["course"], "carbType": i["carbType"],
            "cheese": i["cheese"], "price": i["price"], "base": i["base"],
            "modifiers": i["modifiers"], "micros": i["micros"],
            "allergens": i["allergens"], "source": src,
        } for i in kept]
        total += len(out_items)
        chains[slug(chain)] = {
            "name": chain, "match": match, "region": region,
            "cuisines": cuisines, "diets": diets, "items": out_items,
        }

    payload = {
        "source": "OpenNutrition dataset (https://www.opennutrition.app), restaurant "
                  "rows only, licensed under ODbL. Macros are official published "
                  "figures converted from per-100g; prices are estimates.",
        "attribution": "OpenNutrition — https://www.opennutrition.app (ODbL)",
        "chainCount": len(chains),
        "itemCount": total,
        "chains": chains,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    print("Wrote %s" % OUT)
    print("  chains: %d   items: %d   (excluded drinks: %d)" % (len(chains), total, excluded_drinks))


if __name__ == "__main__":
    main()
