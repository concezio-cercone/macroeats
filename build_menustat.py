#!/usr/bin/env python3
"""
build_menustat.py  —  MacroEats MenuStat importer
==================================================

Converts the MenuStat annual dataset (NYC DOHMH's public chain-restaurant
nutrition database) into data/menustat-chains.json, which the live app loads as
a VERIFIED macro source for ~60 chains it doesn't hand-code in lib/chains.js.

Source file: nutrition-data/menustat-2022.xlsx
  (MenuStat ships it as ms_annual_data_*.xls but it's really a modern .xlsx;
   we read it through a BytesIO buffer so openpyxl doesn't reject the extension.)

WHAT IT DOES
  - Keeps only real MEAL items (drops Beverages and Toppings & Ingredients).
  - Keeps only rows with complete macros (calories+protein+carbs+fat numeric).
  - Maps each food_category to a course (main / side / dessert).
  - Infers carbType, cheese, an estimated price, and per-chain diet capability.
  - CAPS items per chain with a calorie SPREAD so (a) the combo engine's
    mains x sides x desserts loop stays fast and (b) there's always a main near
    any target. Mains also keep the highest-protein options.
  - Assigns each chain a region + cuisines from CHAIN_META below.

Macros are the chain's official published figures (verified:true, shows the green
check in the UI). PRICE is an estimate (MenuStat has no prices) and is labeled as
such in each item's source string.

RE-RUN:  python build_menustat.py
"""
import io
import json
import os
import re
import statistics

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "nutrition-data", "menustat-2022.xlsx")
OUT = os.path.join(HERE, "data", "menustat-chains.json")

# Categories that are actual meal components (everything else, e.g. Beverages and
# Toppings & Ingredients, is dropped) and the course each maps to.
COURSE = {
    "Entrees": "main", "Sandwiches": "main", "Burgers": "main",
    "Pizza": "main", "Salads": "main", "Soup": "main",
    "Appetizers & Sides": "side", "Fried Potatoes": "side",
    "Desserts": "dessert", "Baked Goods": "dessert",
}
# Rough per-item price estimate by original category (MenuStat has no prices).
PRICE = {
    "Entrees": 13.0, "Sandwiches": 9.0, "Burgers": 9.0, "Pizza": 11.0,
    "Salads": 11.0, "Soup": 6.0, "Appetizers & Sides": 5.0,
    "Fried Potatoes": 4.0, "Desserts": 6.0, "Baked Goods": 4.0,
}

# Per-chain region + cuisines (for the cuisine filter / display) and the name
# fragments that map a discovered OSM place to this chain. Fragments are matched
# against a NORMALIZED place name (lowercase, apostrophes removed, non-alphanum
# collapsed to single spaces) via substring containment, so write them the same
# way (no apostrophes). Keyed by the exact MenuStat `restaurant` string.
CHAIN_META = {
    "Applebee's":                     ("American",   ["American"],                       ["applebee"]),
    "Arby's":                         ("Sandwiches", ["American", "Sandwiches"],         ["arbys"]),
    "Auntie Anne's":                  ("Bakery",     ["Bakery", "Dessert"],              ["auntie anne"]),
    "BJ's Restaurant & Brewhouse":    ("American",   ["American", "Pizza"],              ["bjs restaurant", "bjs brewhouse"]),
    "Baskin Robbins":                 ("Dessert",    ["Dessert"],                        ["baskin robbins", "baskin"]),
    "Bojangles":                      ("Chicken",    ["American", "Chicken"],            ["bojangles"]),
    "Bonefish Grill":                 ("Seafood",    ["Seafood"],                        ["bonefish"]),
    "Burger King":                    ("Burgers",    ["American", "Burgers"],            ["burger king"]),
    "California Pizza Kitchen":       ("Pizza",      ["Italian", "Pizza"],               ["california pizza"]),
    "Captain D's":                    ("Seafood",    ["Seafood"],                        ["captain d"]),
    "Carls Jr":                       ("Burgers",    ["American", "Burgers"],            ["carls jr"]),
    "Carrabba's Italian Grill":       ("Italian",    ["Italian"],                        ["carrabba"]),
    "Casey's General Store":          ("Pizza",      ["Pizza", "American"],              ["caseys general", "caseys"]),
    "Checker's Drive-In/ Rally's":    ("Burgers",    ["American", "Burgers"],            ["checkers", "rallys"]),
    "Chick Fil A":                    ("Chicken",    ["American", "Chicken"],            ["chick fil a", "chickfila"]),
    "Chili's":                        ("American",   ["American", "Mexican"],            ["chilis"]),
    "Chipotle":                       ("Mexican",    ["Mexican"],                        ["chipotle"]),
    "Chuck E. Cheese":                ("Pizza",      ["Italian", "Pizza"],               ["chuck e cheese", "chuck e"]),
    "Ci Ci's":                        ("Pizza",      ["Italian", "Pizza"],               ["ci ci", "cicis"]),
    "Culver's":                       ("Burgers",    ["American", "Burgers"],            ["culvers"]),
    "Dairy Queen":                    ("Dessert",    ["Dessert", "American"],            ["dairy queen"]),
    "Dickey's Barbeque":              ("BBQ",        ["BBQ"],                            ["dickey"]),
    "Domino's":                       ("Pizza",      ["Italian", "Pizza"],               ["domino"]),
    "Dunkin' Donuts":                 ("Bakery",     ["Bakery", "Dessert", "Breakfast"], ["dunkin"]),
    "Einstein Bros":                  ("Sandwiches", ["American", "Sandwiches", "Breakfast"], ["einstein"]),
    "El Pollo Loco":                  ("Mexican",    ["Mexican", "Chicken"],             ["el pollo loco", "pollo loco"]),
    "Famous Dave's":                  ("BBQ",        ["BBQ"],                            ["famous dave"]),
    "Firehouse Subs":                 ("Sandwiches", ["American", "Sandwiches"],         ["firehouse"]),
    "Five Guys":                      ("Burgers",    ["American", "Burgers"],            ["five guys"]),
    "Golden Corral":                  ("American",   ["American"],                       ["golden corral"]),
    "Hardee's":                       ("Burgers",    ["American", "Burgers"],            ["hardee"]),
    "In-N-Out":                       ("Burgers",    ["American", "Burgers"],            ["in n out"]),
    "Jack in the Box":                ("Burgers",    ["American", "Burgers"],            ["jack in the box"]),
    "Jamba Juice":                    ("Smoothies",  ["Dessert"],                        ["jamba"]),
    "Jimmy John's":                   ("Sandwiches", ["American", "Sandwiches"],         ["jimmy john"]),
    "KFC":                            ("Chicken",    ["American", "Chicken"],            ["kfc", "kentucky fried"]),
    "Krispy Kreme":                   ("Bakery",     ["Bakery", "Dessert"],              ["krispy kreme"]),
    "Krystal":                        ("Burgers",    ["American", "Burgers"],            ["krystal"]),
    "Long John Silver's":             ("Seafood",    ["Seafood"],                        ["long john silver"]),
    "McDonald's":                     ("Burgers",    ["American", "Burgers"],            ["mcdonald"]),
    "Moe's Southwest Grill":          ("Mexican",    ["Mexican"],                        ["moes southwest"]),
    "O'Charley's":                    ("American",   ["American"],                       ["ocharley"]),
    "On The Border":                  ("Mexican",    ["Mexican"],                        ["on the border"]),
    "Panda Express":                  ("Chinese",    ["Chinese", "Asian"],              ["panda express"]),
    "Panera Bread":                   ("Sandwiches", ["American", "Sandwiches", "Salads"], ["panera"]),
    "Papa John's":                    ("Pizza",      ["Italian", "Pizza"],               ["papa john"]),
    "Papa Murphy's":                  ("Pizza",      ["Italian", "Pizza"],               ["papa murphy"]),
    "Perkins":                        ("American",   ["American", "Breakfast"],          ["perkins"]),
    "Pizza Hut":                      ("Pizza",      ["Italian", "Pizza"],               ["pizza hut"]),
    "Portillo's":                     ("American",   ["American"],                       ["portillo"]),
    "Raising Cane's Chicken Fingers": ("Chicken",    ["American", "Chicken"],            ["raising cane", "canes"]),
    "Red Robin":                      ("Burgers",    ["American", "Burgers"],            ["red robin"]),
    "Romano's Macaroni & Grill":      ("Italian",    ["Italian"],                        ["macaroni grill", "romanos"]),
    "Round Table Pizza":              ("Pizza",      ["Italian", "Pizza"],               ["round table"]),
    "Sbarro":                         ("Pizza",      ["Italian", "Pizza"],               ["sbarro"]),
    "Sonic":                          ("Burgers",    ["American", "Burgers"],            ["sonic"]),
    "Starbucks":                      ("Bakery",     ["Bakery", "Breakfast", "Dessert"], ["starbucks"]),
    "Subway":                         ("Sandwiches", ["American", "Sandwiches"],         ["subway"]),
    "Tropical Smoothie Café":         ("Smoothies",  ["American", "Sandwiches"],         ["tropical smoothie"]),
    "Waffle House":                   ("Breakfast",  ["American", "Breakfast"],          ["waffle house"]),
    "Wingstop":                       ("Chicken",    ["American", "Chicken"],            ["wingstop"]),
    "Zaxby's":                        ("Chicken",    ["American", "Chicken"],            ["zaxby"]),
}

# Per-chain caps. A calorie SPREAD is selected so any target has a nearby main.
CAP_MAIN, CAP_SIDE, CAP_DESSERT = 30, 8, 6

CHEESE_WORDS = ("cheese", "cheddar", "queso", "parmesan", "parm", "mozzarella",
                "provolone", "swiss", "gouda", "feta", "alfredo", "quesadilla",
                "nacho", "pizza")


def norm(s):
    """Match-normalize a name: lowercase, drop apostrophes, collapse to spaces."""
    s = (s or "").lower().replace("'", "").replace("’", "").replace("`", "")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")


def carb_type(category, name, carbs):
    if carbs <= 12:
        return "none"
    low = name.lower()
    if "brown rice" in low or "whole wheat" in low or "whole grain" in low:
        return "whole grain"
    return "refined"


def has_cheese(name):
    low = name.lower()
    return any(w in low for w in CHEESE_WORDS)


def modifiers_and_price(name, base, default_price):
    """Per-item modifiers + a better price.

    MenuStat stores pizza PER SLICE, but a slice isn't a meal — people eat
    several. So slice items get "+1 slice" / "+2 slices" modifiers (additive
    deltas of the per-slice macros, the same trick estimator.js uses) and a
    realistic per-slice price, letting the engine serve 1–4 slices and actually
    reach a calorie/protein target. Everything else has no modifiers.
    """
    if "slice" in name.lower():
        per_slice = 3.0
        x2 = {k: v * 2 for k, v in base.items()}
        mods = [
            {"id": "add-slice", "label": "+1 slice", "default": False,
             "d": dict(base), "dPrice": per_slice},
            {"id": "add-2-slices", "label": "+2 slices", "default": False,
             "d": x2, "dPrice": per_slice * 2},
        ]
        return mods, per_slice
    return [], default_price


def spread(items, cap, key):
    """Pick `cap` items evenly spread across the sorted-by-`key` range."""
    if len(items) <= cap:
        return list(items)
    ordered = sorted(items, key=key)
    n = len(ordered)
    idxs = sorted({round(i * (n - 1) / (cap - 1)) for i in range(cap)})
    return [ordered[i] for i in idxs]


def protein_suspect(items):
    """True if a chain's PROTEIN field looks systematically wrong.

    For a macro app, a bad protein number under a "verified" check is worse than
    no data, so we drop the whole chain and let the cuisine estimator handle it
    (clearly flagged as an estimate). We compare reported protein to what the
    calories imply: implied = (cal - 4*carbs - 9*fat) / 4. A small spread is
    normal (fiber, sugar alcohols, rounding); a large, one-sided gap is not.
    In MenuStat 2022 this flags Pizza Hut (protein ~8 g/item too low) and nothing
    else.
    """
    deltas, severe = [], 0
    for i in items:
        b = i["base"]
        if b["cal"] < 80:
            continue
        implied = (b["cal"] - 4 * b["carbs"] - 9 * b["fat"]) / 4.0
        if implied < 0:
            continue
        deltas.append(implied - b["protein"])
        if (implied - b["protein"]) > 8 and b["protein"] < 0.5 * implied:
            severe += 1
    if not deltas:
        return False
    return statistics.median(deltas) >= 5.0 or (severe / len(deltas)) >= 0.30


def select_mains(mains):
    """Calorie spread, but guarantee the top protein options are kept."""
    if len(mains) <= CAP_MAIN:
        return mains
    chosen = {id(x): x for x in spread(mains, CAP_MAIN - 4, key=lambda r: r["base"]["cal"])}
    for r in sorted(mains, key=lambda r: -r["base"]["protein"])[:4]:
        chosen.setdefault(id(r), r)
    return list(chosen.values())


def main():
    with open(SRC, "rb") as f:
        buf = io.BytesIO(f.read())
    wb = openpyxl.load_workbook(buf, read_only=True, data_only=True)
    ws = wb["Sheet1"]
    rows = ws.iter_rows(values_only=True)
    H = list(next(rows))
    idx = {h: i for i, h in enumerate(H)}

    def cell(r, k):
        return r[idx[k]]

    def isnum(x):
        return isinstance(x, (int, float))

    # group rows by chain
    by_chain = {}
    seen = set()  # de-dup exact (chain, name, cal, protein) repeats
    for r in rows:
        rest = cell(r, "restaurant")
        cat = cell(r, "food_category")
        if not rest or cat not in COURSE:
            continue
        cal, pro, carb, fat = (cell(r, "calories"), cell(r, "protein"),
                               cell(r, "carbohydrates"), cell(r, "total_fat"))
        if not all(isnum(x) for x in (cal, pro, carb, fat)):
            continue
        name = (cell(r, "item_name") or "").strip()
        if not name:
            continue
        # Drop trivially tiny "mains" — MenuStat files garnishes (Lettuce, a
        # plain Side Salad, a lemon wedge) under Salads/Entrees, and as a sole
        # meal they're nonsense. Sides/desserts may legitimately be small.
        if COURSE[cat] == "main" and round(cal) < 50:
            continue
        dedup = (rest, name.lower(), round(cal), round(pro))
        if dedup in seen:
            continue
        seen.add(dedup)
        base = {"cal": round(cal), "protein": round(pro),
                "carbs": round(carb), "fat": round(fat)}
        mods, price = modifiers_and_price(name, base, PRICE[cat])
        item = {
            "name": name,
            "course": COURSE[cat],
            "carbType": carb_type(cat, name, carb),
            "cheese": has_cheese(name),
            "price": price,
            "base": base,
            "modifiers": mods,
            "_cat": cat,
        }
        by_chain.setdefault(rest, []).append(item)

    chains = {}
    total_items = 0
    skipped_meta = []
    dropped_quality = []
    for rest, items in sorted(by_chain.items()):
        if rest not in CHAIN_META:
            skipped_meta.append(rest)
            continue
        # Quality gate: skip chains whose protein data is systematically wrong.
        if protein_suspect(items):
            dropped_quality.append(rest)
            continue
        region, cuisines, match = CHAIN_META[rest]
        mains = [i for i in items if i["course"] == "main"]
        sides = [i for i in items if i["course"] == "side"]
        desserts = [i for i in items if i["course"] == "dessert"]

        mains = select_mains(mains)
        sides = spread(sides, CAP_SIDE, key=lambda r: r["base"]["cal"])
        desserts = spread(desserts, CAP_DESSERT, key=lambda r: r["base"]["cal"])
        kept = mains + sides + desserts

        # infer diet capability from the kept mains
        diets = []
        if any(i["base"]["protein"] >= 30 for i in mains):
            diets.append("high-protein")
        if any(i["base"]["carbs"] <= 20 and i["base"]["protein"] >= 20 for i in mains):
            diets.append("keto-option")

        src = ("MenuStat 2022 (NYC DOHMH public dataset) — official published "
               "nutrition for " + rest + ". Price is an estimate.")
        out_items = []
        for i in kept:
            out_items.append({
                "name": i["name"],
                "course": i["course"],
                "carbType": i["carbType"],
                "cheese": i["cheese"],
                "price": i["price"],
                "base": i["base"],
                "modifiers": i["modifiers"],
                "source": src,
            })
        total_items += len(out_items)
        chains[slug(rest)] = {
            "name": rest,
            "match": match,
            "region": region,
            "cuisines": cuisines,
            "diets": diets,
            "items": out_items,
        }

    payload = {
        "source": "MenuStat 2022 annual data (NYC DOHMH). Macros are official "
                  "published figures; prices are estimates.",
        "chainCount": len(chains),
        "itemCount": total_items,
        "chains": chains,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    print("Wrote %s" % OUT)
    print("  chains: %d   items: %d" % (len(chains), total_items))
    if dropped_quality:
        print("  (dropped — protein data unreliable: %s)" % ", ".join(dropped_quality))
    if skipped_meta:
        print("  (skipped — no CHAIN_META entry: %s)" % ", ".join(skipped_meta))


if __name__ == "__main__":
    main()
