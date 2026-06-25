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
   - **MenuStat chains** — ~60 more national chains (Pizza Hut–style data excluded for quality; includes Domino's, Golden Corral, Applebee's, Arby's, KFC, Burger King, Chili's, Dairy Queen…) with official published per-item macros, imported from the public [MenuStat](https://www.menustat.org) dataset. Macros are real (`✓`); prices are estimates. Where a place is in both, the curated entry wins and MenuStat items are merged in for extra breadth.
   - **Cuisine estimate** — for everything else, an educated guess from the cuisine type, clearly flagged as an estimate.
3. **Meal building** — items have a `base` plus toggleable `modifiers` (no rice, double protein, no cheese, add guac…), each with macro/price deltas. The engine *constructs* the variant that best hits your target rather than accepting or rejecting fixed presets.
4. **Ranking** — open-now first, verified macros ahead of estimates, then best fit to your target.

## Key features

- **Verified vs. estimated macros, always labeled.** `✓` = real published numbers. `*` = estimated from cuisine (hover for how it was figured). Estimates are ballpark — treat them as such.
- **Actionable meal cards.** On every result:
  - **✓ I ate this** — logs the meal's macros into your daily budget in one tap.
  - **✏️ Fix macros** — correct any meal's numbers; saved permanently so every future search for that place uses your real data and shows `✓`. **The tool gets more accurate the more you use it.**
  - **☆ Save** — bookmark to "your go-to meals" for one-tap re-log or re-order.
- **Re-roll & sub-search per restaurant.** 🎲 cycles other meals from a spot; the sub-search box takes free text ("chicken, no rice", "no fruit") scoped to that one restaurant.
- **Filter & sort.** Show/hide guessed vs. real macros, hide no-data spots, and sort by fit, most food by weight, most protein, protein per calorie, protein per dollar, closest, calories, or price.
- **Daily budget + "Decide for me."** Set a daily target, log what you eat, and the app tracks what's *left*. One tap returns the top meals for your remaining macros.
- **Duplicate locations collapse** to the nearest open branch.
- **Saved profile** — default target, radius, dietary rules, daily budget, saved addresses. Stored in your browser.

## Making it more accurate

The macro data is the only real limitation, and it's designed to improve with use:

1. **Fix macros as you go (easiest, best).** When you know a restaurant's real numbers, hit **✏️ Fix macros** on any meal and enter them. Saved to `data/learned-chains.json` and reused forever. Do this for your regular rotation and you'll build a personal verified database.
2. **Add chains by hand.** `lib/chains.js` has a template at the top — paste in a chain's published macros and it's verified for every location of that chain.

## The honest limitation

**Discovery** and opening hours come from volunteer-mapped OpenStreetMap data, so coverage varies by area and hours are often missing. **Macros** are now real for the ~60 national chains in the MenuStat import plus the curated set; everything else is a cuisine-based estimate (clearly flagged) until you correct it. So the gap that remains is the long tail of *local, non-chain* restaurants — there's no free source with their macros, hence the estimate-and-correct design.

A note on the MenuStat data: it's the chains' own published figures, but it's a third-party annual snapshot, so a chain may have changed its menu since, and **prices are estimated** (MenuStat carries no prices). One chain (Pizza Hut) was dropped at build time because its protein values were systematically wrong — see `build_menustat.py`. If you spot a bad number, **✏️ Fix macros** overrides it forever.

If you want substantially better discovery and real hours, a free [Foursquare](https://location.foursquare.com/developer/) key (no credit card) or a Google Places key (card on file, but free in practice for personal use) is the upgrade path; the app already has a dormant Places scaffold (`/api/place-status`).

## Project layout

```
macroeats-backend/
├── server.js                Express server + endpoints
├── lib/
│   ├── comboEngine.js       parser, meal builder, scoring, open-hours (pure, reusable)
│   ├── estimator.js         cuisine-based macro estimates for discovered places
│   ├── chains.js            curated verified chains (rich modifiers + prices)
│   ├── menuStat.js          loader for the ~60 MenuStat verified chains
│   └── learnedStore.js      persistent store of your saved corrections
├── data/
│   ├── restaurants.json     seed DB (empty by default — app runs on live discovery)
│   ├── menustat-chains.json generated verified-macro DB (built by build_menustat.py)
│   └── learned-chains.json  your saved macro corrections (git-ignored by default)
├── build_menustat.py        converts the MenuStat dataset → data/menustat-chains.json
├── nutrition-data/
│   └── menustat-2022.xlsx   MenuStat source data (NYC DOHMH public dataset)
├── public/
│   └── index.html           frontend (calls the API)
└── package.json
```

To rebuild the MenuStat database (e.g. after dropping in a newer annual file):
`pip install openpyxl && python build_menustat.py`. It re-derives everything,
including the per-chain protein sanity check that drops unreliable chains.

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

MIT — do whatever you like with it.
