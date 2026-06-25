/* ===========================================================================
 * openNutrition.js — VERIFIED macros for ~45 chains, from the OpenNutrition
 * dataset (https://www.opennutrition.app), restaurant rows only.
 *
 * Adds chains and items beyond MenuStat/curated (Whataburger, Olive Garden,
 * Outback, Shake Shack, Tim Hortons, Smoothie King, Cheesecake Factory, IHOP,
 * Denny's …). Thin wrapper over chainSource.js.
 *
 * LICENSING — IMPORTANT. OpenNutrition data is licensed under the Open Database
 * License (ODbL) + Database Contents License (DbCL). Any UI that displays this
 * data MUST show visible attribution to "OpenNutrition" with a link to
 * https://www.opennutrition.app (see public/index.html footer and NOTICE.md).
 * The attribution is also baked into each item's `source` string. The derived
 * data file is distributed under ODbL (see data/ and NOTICE.md).
 *
 * Macros are real (verified:true → green check). Prices are estimates
 * (OpenNutrition has no prices). Built from per-100g values × serving grams.
 *
 * Regenerate the data file:  python build_opennutrition.py
 * ======================================================================== */

const path = require("path");
const { makeChainSource, mergeInto } = require("./chainSource");

const src = makeChainSource(path.join(__dirname, "..", "data", "opennutrition-chains.json"),
  { flag: "opennutrition" });

module.exports = {
  openNutritionStoreFor: src.storeFor,
  mergeInto,
  stats: src.stats,
  CHAINS: src.CHAINS,
};
