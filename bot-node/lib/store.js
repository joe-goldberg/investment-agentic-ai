// Persistent watchlist store, editable via Telegram.
// Saved as JSON at WATCHLIST_FILE (default /data/watchlist.json — point this at
// a Railway Volume so it survives redeploys). If the path isn't writable it
// gracefully falls back to in-memory only (seeded from env), so the bot still
// works without a volume — it just won't persist across redeploys.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const FILE = process.env.WATCHLIST_FILE || "/data/watchlist.json";
const MARKETS = ["IDX", "EU", "US"];
let mem = null;
let persistent = true;

function seed() {
  const env = (k, d) => (process.env[k] || d || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return {
    IDX: env("WATCHLIST", "BBRI,TLKM,BBCA"),
    EU: env("WATCHLIST_EU", ""),
    US: env("WATCHLIST_US", ""),
  };
}

function load() {
  if (mem) return mem;
  try {
    mem = JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    mem = seed();
    save();
  }
  for (const m of MARKETS) if (!Array.isArray(mem[m])) mem[m] = [];
  return mem;
}

function save() {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(mem || seed(), null, 2));
  } catch (e) {
    if (persistent) console.warn("[store] not persistent (no writable volume):", e.message);
    persistent = false;
  }
}

export function getWatchlist(market) { return [...(load()[(market || "IDX").toUpperCase()] || [])]; }
export function allWatchlists() { return load(); }
export function isPersistent() { return persistent; }

export function addTicker(market, ticker) {
  const m = (market || "IDX").toUpperCase(); const t = ticker.trim().toUpperCase();
  const w = load(); if (!w[m]) w[m] = [];
  if (!w[m].includes(t)) w[m].push(t);
  save(); return w[m];
}
export function removeTicker(market, ticker) {
  const m = (market || "IDX").toUpperCase(); const t = ticker.trim().toUpperCase();
  const w = load(); w[m] = (w[m] || []).filter((x) => x !== t);
  save(); return w[m];
}
export function setWatchlist(market, tickers) {
  const m = (market || "IDX").toUpperCase();
  const w = load(); w[m] = tickers.map((x) => x.trim().toUpperCase()).filter(Boolean);
  save(); return w[m];
}
