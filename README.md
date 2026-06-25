# MacroEats

Tell it your macro target — say `800 cal, 60g protein` — and it finds real restaurants near you and **assembles a complete meal that hits the target**, with item-level modifiers ("no rice, double chicken"), the macro math shown, and a hand-off to DoorDash / Uber Eats to order.

Runs entirely on your own machine. No account, no API key required.

## Quick start

You need [Node.js](https://nodejs.org) (LTS is fine — one-time install).

**Windows:** double-click `start.bat`
**Mac/Linux:**
```bash
npm install
npm start
```

Then open **http://localhost:3000**, set your address, and search.

## How it works

1. **Discovery** — finds real restaurants near your address from OpenStreetMap (free, no key).
2. **Macros** — resolved in priority order for each restaurant:
   - **Your saved corrections** (the learned store) — anything you've fixed before, reused forever.
   - **Curated chains** — a small hand-built set (Chipotle, Chick-fil-A, Taco Bell, In-N-Out…) with real published macros *and* rich modifiers ("no rice, double chicken") and prices.
   - **MenuStat chains** — ~60 more national chains (Domino's, Golden Corral, Applebee's, Arby's, KFC, Burger King, Chili's, Dairy Queen…) with official published per-item macros, from the public [MenuStat](https://www.menustat.org) dataset.
   - **OpenNutrition chains** — ~48 chains' restaurant items (Whataburger, Olive Garden, Outback, Shake Shack, Tim Hortons, Smoothie King, Cheesecake Factory, IHOP, Denny's…) from the [OpenNutrition](https://www.opennutrition.app) dataset (ODbL — see [NOTICE.md](NOTICE.md)).
   - **Cuisine estimate** — for everything else, an educated guess from the cuisine type, clearly flagged as an estimate.

   Macros from the three verified sources are real (`✓`); prices are estimates. When a place matches several sources the highest-priority one is the base and the others' items are merged in for breadth (so e.g. McDonald's gets the curated modifier-rich items *plus* the long tail from MenuStat and OpenNutrition).
3. **Meal building** — items have a `base` plus toggleable `modifiers` (no rice, double protein, no cheese, add guac…), each with macro/price deltas. The engine *constructs* the variant that best hits your target rather than accepting or rejecting fixed presets.
4. **Ranking** — open-now first, verified macros ahead of estimates, then best fit to your target.

## Key features

- **Verified vs. estimated macros, always labeled.** `✓` = real published numbers. `*` = estimated from cuisine (hover for how it was figured). Estimates are ballpark — treat them as such.
- **More than macros (where the data has it).** Each card can show a **protein/carb/fat split ring**, a **"beyond macros" line** (sodium, fiber, sugar incl. added, saturated fat), and **allergen chips** from real ingredient data. Diet toggles for **low-sodium, gluten-free, dairy-free, nut-free** are backed by that data (allergen filters fail *closed* — a meal with no ingredient data is never labeled allergen-free). These appear for items that carry the data (the OpenNutrition/MenuStat chains); other meals just show the core macros.
- **Actionable meal cards.** On every result:
  - **✓ I ate this** — logs the meal's macros into your daily budget in one tap.
  - **✏️ Fix macros** — correct any meal's numbers; saved permanently so every future search for that place uses your real data and shows `✓`. **The tool gets more accurate the more you use it.**
  - **☆ Save** — bookmark to "your go-to meals" for one-tap re-log or re-order.
- **Re-roll & sub-search per restaurant.** 🎲 cycles other meals from a spot; the sub-search box takes free text ("chicken, no rice", "no fruit") scoped to that one restaurant.
- **Filter & sort.** Show/hide guessed vs. real macros, hide no-data spots, and sort by fit, most food by weight, most protein, protein per calorie, protein per dollar, closest, calories, or price.
- **Dessert switch.** A control next to "open now": **Full meal** (default), **Add a treat** (every result is a main *plus* a dessert), or **Just dessert** (sweet treats only) — handy for "I'd like something sweet with my meal" or a standalone treat run.
- **Food-type search.** Type a food in the box — `800 cal sandwich`, `chicken bowl 700 cal`, `600 cal burrito` — and results are filtered to that item (with sides), matched against item names and chain category.
- **Light & dark themes.** Dark by default; a header toggle (🌙 / ☀️) switches to light and is remembered across visits. The map retints to match the theme.
- **Daily budget + "Decide for me."** Set a daily target, log what you eat, and the app tracks what's *left*. One tap returns the top meals for your remaining macros.
- **Duplicate locations collapse** to the nearest open branch.
- **Saved profile** — default target, radius, dietary rules, daily budget, saved addresses. Stored in your browser.

## Making it more accurate

The macro data is the only real limitation, and it's designed to improve with use:

1. **Fix macros as you go (easiest, best).** When you know a restaurant's real numbers, hit **✏️ Fix macros** on any meal and enter them. Saved to `data/learned-chains.json` and reused forever. Do this for your regular rotation and you'll build a personal verified database.
2. **Add chains by hand.** `lib/chains.js` has a template at the top — paste in a chain's published macros and it's verified for every location of that chain.

## The honest limitation

**Discovery** and opening hours come from volunteer-mapped OpenStreetMap data, so coverage varies by area and hours are often missing. **Macros** are now real for ~100 national chains (curated + MenuStat + OpenNutrition); everything else is a cuisine-based estimate (clearly flagged) until you correct it. So the gap that remains is the long tail of *local, non-chain* restaurants — there's no free source with their macros, hence the estimate-and-correct design.

A note on the imported data: these are the chains' own published figures, but third-party snapshots, so a chain may have changed its menu since, and **prices are estimated** (neither source carries prices). Build-time quality steps drop bad data — MenuStat's Pizza Hut protein was systematically wrong and is dropped (its OpenNutrition figures are fine, so Pizza Hut is still covered); pure drinks/cocktails are filtered out of OpenNutrition. If you spot a bad number, **✏️ Fix macros** overrides it forever.

**Licensing note:** OpenNutrition data is **ODbL** (share-alike + attribution), unlike the MIT-licensed code. The required "OpenNutrition" / "© Open Food Facts contributors" attribution is shown in the app footer and embedded in each item's source; the derived data files are distributed under ODbL. See [NOTICE.md](NOTICE.md) before redistributing.

If you want substantially better discovery and real hours, a free [Foursquare](https://location.foursquare.com/developer/) key (no credit card) or a Google Places key (card on file, but free in practice for personal use) is the upgrade path; the app already has a dormant Places scaffold (`/api/place-status`).

## Project layout

```
macroeats-backend/
├── server.js                Express server + endpoints
├── lib/
│   ├── comboEngine.js       parser, meal builder, scoring, open-hours (pure, reusable)
│   ├── estimator.js         cuisine-based macro estimates for discovered places
│   ├── chains.js            curated verified chains (rich modifiers + prices)
│   ├── chainSource.js       shared loader/merge for generated verified-chain DBs
│   ├── menuStat.js          loader for the ~60 MenuStat verified chains
│   ├── openNutrition.js     loader for the ~48 OpenNutrition verified chains (ODbL)
│   └── learnedStore.js      persistent store of your saved corrections
├── data/
│   ├── restaurants.json         seed DB (empty by default — app runs on live discovery)
│   ├── menustat-chains.json     generated DB (built by build_menustat.py)
│   ├── opennutrition-chains.json generated DB, ODbL (built by build_opennutrition.py)
│   └── learned-chains.json      your saved macro corrections (git-ignored by default)
├── build_menustat.py        converts the MenuStat dataset → data/menustat-chains.json
├── build_opennutrition.py   converts OpenNutrition restaurant rows → data/opennutrition-chains.json
├── refresh_data.py          downloads the latest OpenNutrition release + rebuilds
├── nutrition-data/
│   ├── menustat-2022.xlsx              MenuStat source (NYC DOHMH public dataset)
│   └── opennutrition-restaurant.tsv   OpenNutrition restaurant subset (git-ignored; rebuilt by refresh)
├── public/
│   └── index.html           frontend (calls the API)
├── NOTICE.md                third-party data attribution + licensing
├── LICENSE-ODbL.txt / LICENSE-DbCL.txt   OpenNutrition data licenses
└── package.json
```

### Keeping the data fresh

OpenNutrition has no live API — it ships as a versioned ZIP. To pull the latest
release and rebuild (verifies the download, re-extracts the restaurant rows,
regenerates the JSON):

```bash
npm run refresh-data            # rebuild MenuStat + fetch latest OpenNutrition
# or directly:
python refresh_data.py          # find & download the newest release, rebuild
python refresh_data.py --version 2025.1     # pin a version
python refresh_data.py --source foods.tsv   # rebuild from a local dump (no download)
```

The big OpenNutrition dump (~270 MB) and its 11 MB restaurant subset are **not**
committed — `refresh_data.py` recreates the working subset and only the compact
`data/opennutrition-chains.json` (~750 KB) lives in git. To rebuild MenuStat
alone: `pip install openpyxl && python build_menustat.py`. Each build re-derives
everything, including the quality checks (protein sanity, drink filtering, caps).

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/combos` | main — discovery + macro-targeted meal building |
| `GET /api/store-meals` | ranked meals for one restaurant (re-roll / sub-search) |
| `GET /api/geocode` | address → coordinates (Nominatim) |
| `GET /api/meta` | dietary + cuisine taxonomy |
| `GET/POST/DELETE /api/learned` | manage your saved macro corrections |
| `GET /api/health` | status |
| `GET /api/place-status` | dormant Google Places scaffold (needs `GOOGLE_PLACES_KEY`) |

## Deploy

Standard Node/Express app — runs as-is on Railway, Render, or Fly.io. The pure logic in `lib/` is portable. Note that the learned store writes to a local JSON file, so a read-only or ephemeral host would need that swapped for a database.

## License

**Code:** MIT — do whatever you like with it.

**Bundled data:** some nutrition data carries its own license. The OpenNutrition-derived
files (`data/opennutrition-chains.json`, `nutrition-data/opennutrition-restaurant.tsv`)
are **ODbL** (attribution + share-alike), not MIT. See [NOTICE.md](NOTICE.md) for the
required attribution and your obligations if you redistribute.
