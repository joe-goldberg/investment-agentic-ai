// InvestorView Telegram bot + scheduler + health server.
// SpendBot pattern: Node 18 native fetch, minimal deps, Railway-friendly.
import express from "express";
import { sendMessage, getUpdates } from "./lib/telegram.js";
import { startScheduler } from "./lib/scheduler.js";
import * as analysis from "./lib/analysis.js";

const PORT = process.env.PORT || 3000;
// Comma-separated subscriber chat ids for scheduled broadcasts.
const SUBSCRIBERS = (process.env.SUBSCRIBER_CHAT_IDS || "").split(",").filter(Boolean);
// Default watchlist used for scheduled pre/post-market notes.
const WATCHLIST = (process.env.WATCHLIST || "BBRI,TLKM,BBCA").split(",");
const DEFAULT_LANG = process.env.DEFAULT_LANG || "id"; // Indonesian default

// ---- Health server (Railway healthcheck) ----
const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok", service: "investorview-bot" }));
app.listen(PORT, () => console.log(`[http] health on :${PORT}`));

// ---- Command handling ----
async function handleCommand(chatId, text) {
  const [cmdRaw, ...args] = text.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/^\//, "");
  const lang = DEFAULT_LANG;
  try {
    switch (cmd) {
      case "start":
        return send(chatId,
          lang === "en"
            ? "Welcome to InvestorView. Commands: analyze <TICKER>, project <TICKER>, premarket, postmarket"
            : "Selamat datang di InvestorView. Perintah: analyze <TICKER>, project <TICKER>, premarket, postmarket");
      case "analyze":
        return send(chatId, await analysis.analyzeTicker(args[0] || "BBRI", args[1] || "IDX", lang));
      case "project":
      case "proyeksi":
        return send(chatId, await analysis.projectTicker(args[0] || "BBRI", args[1] || "IDX", 30, lang));
      case "premarket":
        return send(chatId, await analysis.preMarket(WATCHLIST, "IDX", lang));
      case "postmarket":
        return send(chatId, await analysis.postMarket(WATCHLIST, "IDX", lang));
      default:
        return send(chatId, lang === "en" ? "Unknown command." : "Perintah tidak dikenal.");
    }
  } catch (e) {
    console.error("[cmd]", e.message);
    return send(chatId, "⚠️ " + e.message);
  }
}

function send(chatId, text) { return sendMessage(chatId, text); }

// ---- Poll loop ----
async function pollLoop() {
  while (true) {
    try {
      const updates = await getUpdates();
      for (const u of updates) {
        const msg = u.message;
        if (msg?.text) await handleCommand(msg.chat.id, msg.text);
      }
    } catch (e) {
      console.error("[poll]", e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// ---- Scheduled broadcasts (flow #3, #4, #13) ----
async function broadcast(builder) {
  const text = await builder();
  for (const chatId of SUBSCRIBERS) await sendMessage(chatId, text);
}

startScheduler([
  { market: "IDX", time: "08:00", run: () => broadcast(() => analysis.preMarket(WATCHLIST, "IDX", DEFAULT_LANG)) },
  { market: "IDX", time: "16:00", run: () => broadcast(() => analysis.postMarket(WATCHLIST, "IDX", DEFAULT_LANG)) },
  // Add EU/US jobs at their own open/close, e.g.:
  // { market: "US", time: "09:30", run: () => broadcast(() => analysis.preMarket(["AAPL","MSFT"], "US", DEFAULT_LANG)) },
]);

pollLoop();
console.log("[bot] started; default lang:", DEFAULT_LANG);
