// InvestorView Telegram bot + scheduler + health server.
// SpendBot pattern: Node 18 native fetch, minimal deps, Railway-friendly.
import express from "express";
import { sendMessage, getUpdates } from "./lib/telegram.js";
import { startScheduler } from "./lib/scheduler.js";
import * as analysis from "./lib/analysis.js";
import * as store from "./lib/store.js";

const PORT = process.env.PORT || 3000;
const SUBSCRIBERS = (process.env.SUBSCRIBER_CHAT_IDS || "").split(",").filter(Boolean);
const DEFAULT_LANG = process.env.DEFAULT_LANG || "id";
const VALID_MARKETS = ["IDX", "EU", "US"];

const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok", service: "investorview-bot" }));
app.listen(PORT, () => { console.log(`[http] health on :${PORT}`); startBackgroundJobs(); });

function watchlistText(lang) {
  const w = store.allWatchlists();
  const en = lang === "en";
  let s = en ? "*Your watchlists*\n" : "*Watchlist Anda*\n";
  for (const m of VALID_MARKETS) s += `\n*${m}*: ${w[m] && w[m].length ? w[m].join(", ") : "—"}`;
  s += "\n\n" + (en
    ? "Edit: `/watchlist add BBRI`, `/watchlist remove TLKM`, `/watchlist set BBRI,BMRI`, market e.g. `/watchlist add SAP.DE EU`"
    : "Ubah: `/watchlist add BBRI`, `/watchlist remove TLKM`, `/watchlist set BBRI,BMRI`, pakai pasar mis. `/watchlist add SAP.DE EU`");
  if (!store.isPersistent()) s += "\n\n" + (en
    ? "⚠️ Not persistent: add a Railway Volume at /data so changes survive redeploys."
    : "⚠️ Belum persisten: tambah Railway Volume di /data agar perubahan tetap setelah redeploy.");
  return s;
}

async function handleWatchlist(chatId, args, lang) {
  if (!args.length) return send(chatId, watchlistText(lang));
  const sub = args[0].toLowerCase();
  const mk = (args.find((a) => VALID_MARKETS.includes(a.toUpperCase())) || "IDX").toUpperCase();
  if (sub === "add" && args[1]) { store.addTicker(mk, args[1]); return send(chatId, watchlistText(lang)); }
  if (sub === "remove" && args[1]) { store.removeTicker(mk, args[1]); return send(chatId, watchlistText(lang)); }
  if (sub === "set" && args[1]) { store.setWatchlist(mk, args[1].split(/[ ,]+/)); return send(chatId, watchlistText(lang)); }
  return send(chatId, watchlistText(lang));
}

async function handleCommand(chatId, text) {
  const [cmdRaw, ...args] = text.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/^\//, "");
  const lang = DEFAULT_LANG;
  try {
    switch (cmd) {
      case "start":
        return send(chatId, lang === "en"
          ? "InvestorView bot. Commands: /analyze <T> [MKT], /project <T>, /fundamental <T>, /premarket [MKT], /postmarket [MKT], /watchlist"
          : "Bot InvestorView. Perintah: /analyze <KODE> [PASAR], /project <KODE>, /fundamental <KODE>, /premarket [PASAR], /postmarket [PASAR], /watchlist");
      case "analyze": return send(chatId, await analysis.analyzeTicker(args[0] || "BBRI", (args[1] || "IDX").toUpperCase(), lang));
      case "project": case "proyeksi": return send(chatId, await analysis.projectTicker(args[0] || "BBRI", (args[1] || "IDX").toUpperCase(), 30, lang));
      case "fundamental": return send(chatId, await analysis.fundamentalTicker(args[0] || "BBRI", (args[1] || "IDX").toUpperCase(), lang));
      case "premarket": { const m = (args[0] || "IDX").toUpperCase(); return send(chatId, (await analysis.preMarket(store.getWatchlist(m), m, lang)) || "—"); }
      case "postmarket": { const m = (args[0] || "IDX").toUpperCase(); return send(chatId, (await analysis.postMarket(store.getWatchlist(m), m, lang)) || "—"); }
      case "watchlist": return handleWatchlist(chatId, args, lang);
      default: return send(chatId, lang === "en" ? "Unknown command. Try /start" : "Perintah tidak dikenal. Coba /start");
    }
  } catch (e) { console.error("[cmd]", e.message); return send(chatId, "⚠️ " + e.message); }
}

function send(chatId, text) { return sendMessage(chatId, text); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollLoop() {
  if (!process.env.TELEGRAM_BOT_TOKEN) { console.warn("[bot] TELEGRAM_BOT_TOKEN not set; polling disabled"); return; }
  while (true) {
    try {
      const updates = await getUpdates();
      for (const u of updates) { const msg = u.message; if (msg?.text) await handleCommand(msg.chat.id, msg.text); }
    } catch (e) { console.error("[poll]", e.message); await sleep(3000); }
    await sleep(1000);
  }
}

async function broadcast(kind, market) {
  const tickers = store.getWatchlist(market);
  if (!tickers.length) return;
  const text = kind === "pre"
    ? await analysis.preMarket(tickers, market, DEFAULT_LANG)
    : await analysis.postMarket(tickers, market, DEFAULT_LANG);
  if (!text) return;
  for (const chatId of SUBSCRIBERS) await sendMessage(chatId, text);
}

function startBackgroundJobs() {
  startScheduler([
    { market: "IDX", time: "08:00", run: () => broadcast("pre", "IDX") },
    { market: "IDX", time: "16:15", run: () => broadcast("post", "IDX") },
    { market: "EU", time: "08:30", run: () => broadcast("pre", "EU") },
    { market: "EU", time: "17:40", run: () => broadcast("post", "EU") },
    { market: "US", time: "09:00", run: () => broadcast("pre", "US") },
    { market: "US", time: "16:15", run: () => broadcast("post", "US") },
  ]);
  pollLoop();
  console.log("[bot] started; default lang:", DEFAULT_LANG);
}
