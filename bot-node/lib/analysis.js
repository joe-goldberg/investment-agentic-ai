// Calls the Python analysis backend, then asks Claude to narrate results in the
// user's language (Indonesian default). Returns Markdown strings for Telegram.

const BACKEND = process.env.ANALYSIS_BACKEND_URL || "http://localhost:8000";
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

async function backend(path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`backend ${path} -> ${res.status}`);
  return res.json();
}

async function claude(prompt, maxTokens = 900) {
  if (!CLAUDE_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    const j = await res.json();
    return j?.content?.[0]?.text || null;
  } catch (e) { console.error("[claude]", e.message); return null; }
}

const getAnalyze = (t, m) => backend("/analyze", { ticker: t, market: m }).catch(() => null);
const getMarket = (m) => backend("/market", { market: m }).catch(() => null);
const getNews = (t, m, n = 3) => backend("/news", { ticker: t, market: m, limit: n }).catch(() => ({ items: [] }));
const getProject = (t, m, h = 30) => backend("/project", { ticker: t, market: m, horizon: h }).catch(() => null);
const getFundamental = (t, m) => backend("/fundamental", { ticker: t, market: m }).catch(() => null);

async function narrate(kind, data, lang) {
  const langName = lang === "en" ? "English" : "Bahasa Indonesia";
  const out = await claude(`You are an equity analyst. Write a concise ${kind} note in ${langName} `
    + `for a retail investor, based ONLY on this JSON. Short Markdown. Probabilistic, not a guarantee.\n\n${JSON.stringify(data)}`);
  return out || templateOne(kind, data, lang);
}
function templateOne(kind, d, lang) {
  const T = lang === "en"
    ? { price: "Last price", sig: "Signal", exp: "Expected" } : { price: "Harga terakhir", sig: "Sinyal", exp: "Perkiraan" };
  if (kind === "analyze") return `*${d.ticker}* (${d.market})\n${T.price}: ${d.last_price} ${d.currency}\nRSI: ${d.indicators?.rsi14?.toFixed?.(1)}\n${T.sig}: *${d.signal}*`;
  if (kind === "project") return `*${d.ticker}*\n${T.exp} (${d.horizon}d): ${d.consensus_expected_price?.toFixed?.(2)} ${d.currency}\np05–p95: ${d.monte_carlo?.p05?.toFixed?.(2)}–${d.monte_carlo?.p95?.toFixed?.(2)}`;
  return "```\n" + JSON.stringify(d, null, 2).slice(0, 800) + "\n```";
}

export async function analyzeTicker(t, m = "IDX", lang = "id") { const d = await getAnalyze(t, m); return d ? narrate("analyze", d, lang) : "⚠️ no data"; }
export async function projectTicker(t, m = "IDX", h = 30, lang = "id") { const d = await getProject(t, m, h); return d ? narrate("project", d, lang) : "⚠️ no data"; }
export async function fundamentalTicker(t, m = "IDX", lang = "id") { const d = await getFundamental(t, m); return d ? narrate("fundamental", d, lang) : "⚠️ no data"; }

async function gather(market, tickers) {
  const index = await getMarket(market);
  const stocks = [];
  for (const t of tickers) { const a = await getAnalyze(t, market); if (a) stocks.push(a); }
  const news = [];
  for (const t of tickers.slice(0, 3)) {
    const n = await getNews(t, market, 2);
    for (const it of (n.items || []).slice(0, 2)) news.push({ ticker: t, title: it.title, publisher: it.publisher });
  }
  return { market, index, stocks, news };
}

async function briefing(kind, market, tickers, lang) {
  if (!tickers || !tickers.length) return null;
  const data = await gather(market, tickers);
  const langName = lang === "en" ? "English" : "Bahasa Indonesia";
  const title = kind === "pre"
    ? (lang === "en" ? "pre-market briefing" : "ringkasan pra-pasar")
    : (lang === "en" ? "post-market evaluation" : "evaluasi pasca-pasar");
  const ask = `You are an equity analyst writing a ${title} for the ${market} market in ${langName}.\n`
    + `Use ONLY this JSON data. Short Telegram Markdown with clear sections:\n`
    + `1) Ringkasan Pasar (index level & % change)\n`
    + `2) Sorotan / highlights\n`
    + `3) Rekomendasi saham bergaya morning call — untuk tiap saham tulis: `
    + `*[ACTION] TICKER*: Entry <levels.entry>; Target <levels.target>; Stop Loss <levels.stop> (gunakan angka dari field "levels")\n`
    + `4) Per-saham: harga & RSI singkat\n`
    + `5) Berita relevan (judul singkat)\n`
    + `Keep it tight. Probabilistic, not financial advice.\n\nDATA:\n${JSON.stringify(data)}`;
  const out = await claude(ask, 1100);
  return out || templateBriefing(kind, data, lang);
}

function templateBriefing(kind, d, lang) {
  const en = lang === "en";
  const head = kind === "pre" ? (en ? "*Pre-market briefing*" : "*Ringkasan pra-pasar*") : (en ? "*Post-market evaluation*" : "*Evaluasi pasca-pasar*");
  let s = `${head} — ${d.market}\n`;
  if (d.index) s += `\n📊 ${d.index.name}: ${d.index.last} (${d.index.change_pct >= 0 ? "+" : ""}${d.index.change_pct}%)\n`;
  s += `\n${en ? "Recommendations" : "Rekomendasi"}:\n`;
  for (const a of d.stocks) {
    const L = a.levels || {};
    s += `• *[${a.signal}] ${a.ticker}*: Entry ${L.entry} · TP ${L.target} · SL ${L.stop} (RSI ${a.indicators?.rsi14?.toFixed?.(0)})\n`;
  }
  if (d.news.length) { s += `\n📰 ${en ? "News" : "Berita"}:\n`; for (const n of d.news) s += `• ${n.ticker}: ${n.title}\n`; }
  return s;
}

export const preMarket = (tickers, market = "IDX", lang = "id") => briefing("pre", market, tickers, lang);
export const postMarket = (tickers, market = "IDX", lang = "id") => briefing("post", market, tickers, lang);
