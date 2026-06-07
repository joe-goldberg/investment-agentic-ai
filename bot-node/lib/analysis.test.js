// Lightweight smoke test for the template fallback (no network needed).
// Run: node lib/analysis.test.js   (requires backend running for live calls)
import assert from "node:assert";

// Re-implement the fallback check by importing the module's behavior indirectly:
// we just assert the module loads and exports the expected functions.
const mod = await import("./analysis.js");
for (const fn of ["analyzeTicker", "projectTicker", "portfolioProjection", "preMarket", "postMarket"]) {
  assert.equal(typeof mod[fn], "function", `missing export ${fn}`);
}
console.log("OK: analysis.js exports verified");
