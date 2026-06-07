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
  return res.json();
}

// Long-poll for updates (simple; switch to webhooks for production scale).
let offset = 0;
export async function getUpdates() {
  if (!TOKEN) return [];
  const res = await fetch(API("getUpdates") + `?timeout=30&offset=${offset}`);
  const data = await res.json();
  if (!data.ok) return [];
  for (const u of data.result) offset = u.update_id + 1;
  return data.result;
}
