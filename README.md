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
   - **Built-in verified chains** — ~13 chains (Chipotle, Chick-fil-A, Taco Bell, In-N-Out…) with real published macros.
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

Discovery and opening hours come from volunteer-mapped OpenStreetMap data, so coverage varies by area and hours are often missing. There's no free source that has both "restaurants near me" *and* "their macros" — hence the estimate-and-correct design. If you want substantially better discovery and real hours, a free [Foursquare](https://location.foursquare.com/developer/) key (no credit card) or a Google Places key (card on file, but free in practice for personal use) is the upgrade path; the app already has a dormant Places scaffold (`/api/place-status`).

## Project layout

```
macroeats-backend/
├── server.js                Express server + endpoints
├── lib/
│   ├── comboEngine.js       parser, meal builder, scoring, open-hours (pure, reusable)
│   ├── estimator.js         cuisine-based macro estimates for discovered places
│   ├── chains.js            verified published macros for known chains
│   └── learnedStore.js      persistent store of your saved corrections
├── data/
│   ├── restaurants.json     seed DB (empty by default — app runs on live discovery)
│   └── learned-chains.json  your saved macro corrections (git-ignored by default)
├── public/
│   └── index.html           frontend (calls the API)
└── package.json
```

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
