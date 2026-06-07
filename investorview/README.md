# InvestorView — Agentic AI Investment Platform (v2.0)

Three parts: a **PWA frontend** (static, deploys to Netlify), a **Python
analysis service** (FastAPI — indicators, projections, market data via Yahoo
Finance), and a **Node Telegram bot + scheduler** (reusing the proven SpendBot
pattern). The frontend talks to the Python service over REST; scheduled and
on-demand analysis is delivered via Telegram and PWA push.

```
investorview/
├── frontend/           PWA (Netlify): index.html, app.js, i18n.js, sw.js, manifest.json
├── backend-python/     FastAPI: indicators, projections, market data (yfinance)
│   └── app/{main,indicators,projections,data,schemas}.py
├── bot-node/           Telegram bot, scheduler, Claude narration
│   └── lib/{telegram,scheduler,analysis}.js
├── netlify.toml        frontend deploy config
├── docker-compose.yml  run backend + bot locally
└── .env.example
```

## Why two services
Projection (flow #5) needs **Prophet (Python)**, plus Markov chains and Monte
Carlo. The Telegram delivery (flow #13) is lowest-risk on the **Node** stack
that already works in SpendBot. They communicate over HTTP, so they deploy and
scale independently.

## What's implemented
- **Frontend PWA** (`frontend/`): dashboard with optional portfolio (localStorage),
  technical page with **candlestick chart + SMA/Bollinger toggles + a "how to read
  candles" guide**, projection page (Monte Carlo / Markov / Prophet ranges),
  signals, and settings. **Bilingual ID (default) / EN**, installable, service
  worker for offline app-shell + push notifications. Backend URL is set in-app
  (Settings) — no build-time secret.
- **Indicators**: SMA, EMA, Bollinger, RSI, MACD (pure numpy).
- **Projections**: Monte Carlo (GBM) + Markov chain always on; **Prophet
  optional** (uncomment in `requirements.txt`). `/project` returns all three +
  a consensus expected price.
- **Real market data via Yahoo Finance** (`yfinance`): US as-is, IDX auto-suffixed
  `.JK`, EU with Yahoo suffix (e.g. `ASML.AS`). 5-min in-memory cache. **Falls back
  to synthetic data** automatically if Yahoo is unreachable, so nothing ever breaks.
- **Endpoints**: `/health`, `/markets`, `/analyze`, `/chart` (OHLC + overlays),
  `/project`, `/portfolio`.
- **Telegram bot**: `/analyze`, `/project`, `/premarket`, `/postmarket`,
  `/start`; scheduled pre-market (08:00) and post-market (16:00) broadcasts.
- **Bilingual** Telegram output via `DEFAULT_LANG`.

### Not yet built (next phases)
Fundamental analysis (financial statements, dividends, YTD/YoY), news feed,
real daily recommendations, other instruments + simulation, full Web Push wiring
(VAPID keys). The frontend and endpoints are structured to add these next.

## Secrets — never written to a file (SpendBot pattern)
Like SpendBot, **no API key or token is ever stored in the repo or in a `.env`
file.** Secrets live only in **Railway → Variables** (the dashboard). The repo
contains only `.env.example`, which lists variable *names* with empty values as
documentation. `.env` is git-ignored and you don't need to create one.

For local runs, pull the same secrets from Railway at runtime with the Railway
CLI instead of pasting them anywhere:
```bash
npm i -g @railway/cli      # one-time
railway login
railway link               # link this repo to your Railway project
# now run with secrets injected from Railway — nothing on disk:
railway run docker compose up --build
```

## Run locally
```bash
cd investorview
railway run docker compose up --build   # secrets injected by Railway CLI
# backend  -> http://localhost:8000/health
# bot      -> http://localhost:3000/health
```
> No Railway project yet? You can still boot the backend (no secrets needed) and
> exercise every endpoint with synthetic data. The bot only needs secrets once
> you want it to actually post to Telegram / call Claude.

Without Docker:
```bash
# backend
cd backend-python && pip install -r requirements.txt
uvicorn app.main:app --reload
# bot (new shell)
cd bot-node && npm install && npm start
```

Quick API check:
```bash
curl -s localhost:8000/health
curl -s -X POST localhost:8000/project -H 'content-type: application/json' \
  -d '{"ticker":"BBRI","market":"IDX","horizon":30}'
```

## Deploy (Railway — same host SpendBot uses)
Each service is its own Railway service with a Dockerfile + `railway.json`.

1. **Create the Telegram bot**: message [@BotFather](https://t.me/BotFather) →
   `/newbot` → copy the token.
2. **Push to GitHub** (one repo, two service dirs):
   ```bash
   cd investorview && git init && git add . && git commit -m "InvestorView v2 backend"
   git remote add origin <your-repo-url> && git push -u origin main
   ```
3. **Railway → New Project → Deploy from GitHub repo.**
   - Add service **backend-python** → root dir `backend-python`. Python needs a
     Dockerfile (numpy/pandas/optional Prophet), so this one builds via Docker;
     healthcheck `/health`. Note its public URL.
   - Add service **bot-node** → root dir `bot-node`. Like SpendBot, Railway
     **auto-detects Node via `package.json` (Nixpacks)** and runs `npm start` —
     no Dockerfile required. The included `Dockerfile`/`railway.json` are
     optional; delete them if you prefer pure Nixpacks like SpendBot.
4. **Set secrets in Railway only** (Railway → each service → Variables) — this is
   the single place keys live; never commit them. Variable names are in
   `.env.example`:
   - backend: `PORT` (Railway injects), optionally enable Prophet.
   - bot: `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `ANALYSIS_BACKEND_URL`
     (= the backend's Railway URL), `SUBSCRIBER_CHAT_IDS`, `WATCHLIST`,
     `DEFAULT_LANG`, `TZ_OFFSET_*`.
   - Tip: reference the backend URL without hardcoding it using Railway's
     variable references, e.g. `ANALYSIS_BACKEND_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}`.
5. **Link your chat**: DM your bot `/start`, then put your numeric chat id into
   `SUBSCRIBER_CHAT_IDS` so scheduled broadcasts reach you.
6. **Frontend (PWA) → Netlify**: New site from the same GitHub repo. `netlify.toml`
   already sets `publish = "frontend"`, so Netlify serves the PWA directly — no
   build step. After deploy, open the site → **Settings** → paste your backend's
   Railway URL (stored in the browser, not in the repo). The app is installable
   and works in Indonesian by default.

### Inherited SpendBot gotchas
- Railway can serve **stale code** if a push doesn't propagate — redeploy / use
  the GitHub web editor fallback.
- **DST is manual**: update `TZ_OFFSET_EU` / `TZ_OFFSET_US` on clock changes.
  Multi-market means more than one offset to watch.

## Tests
```bash
cd backend-python && pip install -r requirements.txt pytest && pytest -q
cd bot-node && npm test
```
