"""InvestorView analysis backend (FastAPI).

Endpoints used by the PWA frontend and the Node Telegram bot:
  GET  /health
  GET  /markets
  POST /analyze        -> technical snapshot for a ticker
  POST /project        -> projections (MC + Markov + Prophet if available)
  POST /portfolio      -> aggregate portfolio projection across holdings
"""
from __future__ import annotations

from typing import Dict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import indicators, projections
from .data import get_history, MARKETS
from .schemas import AnalyzeRequest, ProjectRequest, PortfolioRequest

app = FastAPI(title="InvestorView Analysis API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to the PWA origin in production
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict:
    return {"status": "ok", "prophet": projections._HAS_PROPHET}


@app.get("/markets")
def markets() -> Dict:
    return MARKETS


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> Dict:
    hist = get_history(req.ticker, req.market, req.days)
    close = hist["close"]
    snap = indicators.latest_snapshot(close)
    rsi_v = snap.get("rsi14")
    signal = "HOLD"
    if rsi_v is not None:
        if rsi_v < 35:
            signal = "BUY"
        elif rsi_v > 65:
            signal = "SELL"
    return {
        "ticker": hist["ticker"],
        "market": hist["market"],
        "currency": hist["currency"],
        "last_price": close[-1],
        "indicators": snap,
        "signal": signal,
        "synthetic": hist["synthetic"],
    }


@app.post("/chart")
def chart(req: AnalyzeRequest) -> Dict:
    """OHLC series + indicator overlays for candlestick rendering."""
    hist = get_history(req.ticker, req.market, req.days)
    close = hist["close"]
    bb = indicators.bollinger(close, 20, 2)
    return {
        "ticker": hist["ticker"],
        "market": hist["market"],
        "currency": hist["currency"],
        "synthetic": hist["synthetic"],
        "dates": hist["dates"],
        "open": hist["open"],
        "high": hist["high"],
        "low": hist["low"],
        "close": close,
        "sma20": indicators.sma(close, 20),
        "sma50": indicators.sma(close, 50),
        "bb_upper": bb["upper"],
        "bb_lower": bb["lower"],
        "rsi14": indicators.rsi(close, 14),
    }


@app.post("/project")
def project(req: ProjectRequest) -> Dict:
    hist = get_history(req.ticker, req.market, req.days)
    proj = projections.project_all(hist["close"], req.horizon)
    proj["ticker"] = hist["ticker"]
    proj["market"] = hist["market"]
    proj["currency"] = hist["currency"]
    return proj


@app.post("/portfolio")
def portfolio(req: PortfolioRequest) -> Dict:
    if not req.holdings:
        # discovery mode: no portfolio supplied
        return {"mode": "discovery", "holdings": [], "message": "No portfolio supplied"}
    per_holding = []
    total_value = 0.0
    total_expected = 0.0
    for h in req.holdings:
        hist = get_history(h.ticker, h.market)
        last = hist["close"][-1]
        proj = projections.project_all(hist["close"], req.horizon)
        exp = proj["consensus_expected_price"]
        value = last * h.shares
        expected_value = exp * h.shares
        total_value += value
        total_expected += expected_value
        per_holding.append({
            "ticker": hist["ticker"],
            "market": hist["market"],
            "currency": hist["currency"],
            "shares": h.shares,
            "last_price": last,
            "value": round(value, 2),
            "consensus_expected_price": round(exp, 4),
            "expected_value": round(expected_value, 2),
        })
    return {
        "mode": "portfolio",
        "horizon": req.horizon,
        "lang": req.lang,
        "total_value": round(total_value, 2),
        "total_expected_value": round(total_expected, 2),
        "expected_return_pct": round((total_expected / total_value - 1) * 100, 2) if total_value else 0,
        "holdings": per_holding,
    }
