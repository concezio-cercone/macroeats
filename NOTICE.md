# NOTICE — third-party data & licensing

MacroEats' **code** is licensed under the MIT License (see [LICENSE](LICENSE)).
Some of the **nutrition data** bundled with it comes from third parties under
their own licenses, summarized here.

## OpenNutrition (ODbL)

`data/opennutrition-chains.json` and `nutrition-data/opennutrition-restaurant.tsv`
are derived from the **OpenNutrition** dataset (restaurant rows only), licensed
under the **Open Database License v1.0 (ODbL)** with contents under the
**Database Contents License (DbCL)**. See [LICENSE-ODbL.txt](LICENSE-ODbL.txt)
and [LICENSE-DbCL.txt](LICENSE-DbCL.txt).

- **Attribution (required):** This product includes data from **OpenNutrition** —
  <https://www.opennutrition.app>. The attribution is shown in the app UI
  (footer of `public/index.html`) and is embedded in each item's `source` field.
- **Open Food Facts:** Portions of OpenNutrition incorporate data from Open Food
  Facts: **© Open Food Facts contributors** — <https://world.openfoodfacts.org>
  (also ODbL). Credited in the same places.
- **Share-Alike:** The two derived files above are a Derivative Database and are
  distributed under the **ODbL**, not MIT. If you redistribute or publicly use
  them (or a further derivative), you must keep them under ODbL and preserve this
  attribution. The rest of the repository (code) remains MIT.
- **Regenerate:** `python build_opennutrition.py` (transforms the dataset into
  the JSON the app loads).

## MenuStat

`data/menustat-chains.json` is derived from **MenuStat** (NYC Department of Health
public dataset), <https://www.menustat.org>. Regenerate with
`python build_menustat.py`.

## Discovery / hours

Restaurant discovery and opening hours come from **OpenStreetMap** contributors
(<https://www.openstreetmap.org/copyright>, ODbL) via the Overpass and Nominatim
APIs, queried live at runtime.
