// Thin Telegram Bot API wrapper using native fetch (Node 18+), SpendBot style.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

export async function sendMessage(chatId, text, opts = {}) {
  if (!TOKEN) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN not set; would send:", text.slice(0, 120));
    return { ok: false, skipped: true };
  }
  const res = await fetch(API("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      ...opts,
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("[telegram] sendMessage failed:", data.error_code, data.description);
    // Markdown can break on some characters — retry once as plain text.
    if (data.description && /can't parse entities/i.test(data.description)) {
      const retry = await fetch(API("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      return retry.json();
    }
  }
  return data;
}

// Long-poll for updates (simple; switch to webhooks for production scale).
let offset = 0;
export async function getUpdates() {
  if (!TOKEN) return [];
  const res = await fetch(API("getUpdates") + `?timeout=30&offset=${offset}`);
  const data = await res.json();
  if (!data.ok) {
    console.error("[telegram] getUpdates failed:", data.error_code, data.description);
    return [];
  }
  for (const u of data.result) offset = u.update_id + 1;
  if (data.result.length) console.log("[telegram] received", data.result.length, "update(s)");
  return data.result;
}
