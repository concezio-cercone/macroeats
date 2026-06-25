/* ===========================================================================
 * menuStat.js — VERIFIED macros for ~60 chains, imported from MenuStat 2022.
 *
 * The bulk verified-macro source for the long tail of national chains (Golden
 * Corral, Applebee's, Arby's, KFC, Burger King, Domino's, Dairy Queen …), with
 * official published per-item nutrition. Thin wrapper over chainSource.js.
 *
 * Macros are real (verified:true → green check). Prices are estimates (MenuStat
 * has no prices); pizza-slice items carry "+1 / +2 slices" modifiers so a slice
 * isn't treated as a whole meal.
 *
 * Regenerate the data file:  python build_menustat.py
 * ======================================================================== */

const path = require("path");
const { makeChainSource, mergeInto } = require("./chainSource");

const src = makeChainSource(path.join(__dirname, "..", "data", "menustat-chains.json"),
  { flag: "menustat" });

module.exports = {
  menuStatStoreFor: src.storeFor,
  mergeInto,
  stats: src.stats,
  CHAINS: src.CHAINS,
};
