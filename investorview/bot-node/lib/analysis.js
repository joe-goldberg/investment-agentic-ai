// Calls the Python analysis backend, then asks Claude to narrate the result
// in the user's language (Indonesian default). Returns a Markdown string.

const BACKEND = process.env.ANALYSIS_BACKEND_URL || "http://localhost:8000";
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

async function backend(path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`backend ${path} -> ${res.status}`);
  return res.json();
}

// Ask Claude to write the human-readable analysis. Falls back to a plain
// template if no API key is configured, so the pipeline always produces output.
async function narrate(kind, data, lang = "id") {
  if (!CLAUDE_KEY) return templateFallback(kind, data, lang);
  const langName = lang === "en" ? "English" : "Bahasa Indonesia";
  const prompt = `You are an equity analyst. Write a concise ${kind} note in ${langName} `
    + `for a retail investor, based ONLY on this JSON. Use short Markdown. `
    + `Be clear it is probabilistic, not a guarantee.\n\n${JSON.stringify(data)}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const j = await res.json();
    return j?.content?.[0]?.text || templateFallback(kind, data, lang);
  } catch (e) {
    console.error("[claude]", e.message);
    return templateFallback(kind, data, lang);
  }
}

function templateFallback(kind, data, lang) {
  const t = lang === "en"
    ? { pre: "Pre-market", post: "Post-market", price: "Last price", sig: "Signal", exp: "Expected" }
    : { pre: "Pra-pasar", post: "Pasca-pasar", price: "Harga terakhir", sig: "Sinyal", exp: "Perkiraan" };
  if (kind === "analyze") {
    return `*${data.ticker}* (${data.market})\n${t.price}: ${data.last_price} ${data.currency}\n`
      + `RSI14: ${data.indicators?.rsi14?.toFixed?.(1)}\n${t.sig}: *${data.signal}*`;
  }
  if (kind === "project") {
    return `*${data.ticker}* ${kind}\n${t.exp} (${data.horizon}d): `
      + `${data.consensus_expected_price?.toFixed?.(2)} ${data.currency}\n`
      + `MC p05–p95: ${data.monte_carlo?.p05?.toFixed?.(2)}–${data.monte_carlo?.p95?.toFixed?.(2)}`;
  }
  return "```\n" + JSON.stringify(data, null, 2).slice(0, 800) + "\n```";
}

export async function analyzeTicker(ticker, market = "IDX", lang = "id") {
  const data = await backend("/analyze", { ticker, market });
  return narrate("analyze", data, lang);
}

export async function projectTicker(ticker, market = "IDX", horizon = 30, lang = "id") {
  const data = await backend("/project", { ticker, market, horizon });
  return narrate("project", data, lang);
}

export async function portfolioProjection(holdings, horizon = 30, lang = "id") {
  const data = await backend("/portfolio", { holdings, horizon, lang });
  return narrate("project", data, lang);
}

// Pre/post-market notes are just analyze runs with different framing.
export async function preMarket(tickers, market = "IDX", lang = "id") {
  const parts = [];
  for (const t of tickers) parts.push(await analyzeTicker(t, market, lang));
  const head = lang === "en" ? "*Pre-market analysis*" : "*Analisis pra-pasar*";
  return head + "\n\n" + parts.join("\n\n");
}

export async function postMarket(tickers, market = "IDX", lang = "id") {
  const parts = [];
  for (const t of tickers) parts.push(await analyzeTicker(t, market, lang));
  const head = lang === "en" ? "*Post-market evaluation*" : "*Evaluasi pasca-pasar*";
  return head + "\n\n" + parts.join("\n\n");
}
