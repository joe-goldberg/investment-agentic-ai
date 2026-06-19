"""InvestorView analysis backend (FastAPI).

Endpoints used by the PWA frontend and the Node Telegram bot:
  GET  /health
  GET  /markets
  GET  /market-summary    -> index summary (IHSG/S&P 500 level + % change)
  POST /analyze           -> technical snapshot + signal for a ticker
  POST /chart             -> OHLC series (by timeframe) + overlays + candle pattern
  POST /fundamental       -> financial ratios + verdict
  POST /news              -> recent news for a ticker (via yfinance)
  POST /project           -> projections (MC + Markov + Prophet if available)
  POST /portfolio         -> aggregate portfolio projection across holdings
"""
from __future__ import annotations

from typing import Dict
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import indicators, projections
from .data import get_history, get_fundamentals, get_index_summary, get_news, MARKETS
from .schemas import (AnalyzeRequest, ChartRequest, FundamentalRequest,
                      MarketRequest, NewsRequest, ProjectRequest, PortfolioRequest)

app = FastAPI(title="InvestorView Analysis API", version="2.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    hist = get_history(req.ticker, req.market, "1Y")
    close = hist["close"]
    snap = indicators.latest_snapshot(close)
    levels = indicators.recommend_levels(hist["open"], hist["high"], hist["low"], close, hist["market"])
    return {
        "ticker": hist["ticker"], "market": hist["market"], "currency": hist["currency"],
        "last_price": close[-1], "indicators": snap, "signal": levels["action"],
        "levels": levels, "synthetic": hist["synthetic"],
    }


@app.post("/chart")
def chart(req: ChartRequest) -> Dict:
    hist = get_history(req.ticker, req.market, req.timeframe)
    close = hist["close"]
    bb = indicators.bollinger(close, 20, 2)
    pattern = indicators.detect_pattern(hist["open"], hist["high"], hist["low"], close)
    return {
        "ticker": hist["ticker"], "market": hist["market"], "currency": hist["currency"],
        "synthetic": hist["synthetic"], "intraday": hist["intraday"], "timeframe": hist["timeframe"],
        "times": hist["times"], "open": hist["open"], "high": hist["high"],
        "low": hist["low"], "close": close,
        "sma20": indicators.sma(close, 20), "sma50": indicators.sma(close, 50),
        "bb_upper": bb["upper"], "bb_lower": bb["lower"],
        "rsi14": indicators.rsi(close, 14), "pattern": pattern,
    }


@app.post("/fundamental")
def fundamental(req: FundamentalRequest) -> Dict:
    return get_fundamentals(req.ticker, req.market)


@app.post("/project")
def project(req: ProjectRequest) -> Dict:
    hist = get_history(req.ticker, req.market, "1Y")
    proj = projections.project_all(hist["close"], req.horizon)
    proj["ticker"] = hist["ticker"]
    proj["market"] = hist["market"]
    proj["currency"] = hist["currency"]
    proj["last_price"] = hist["close"][-1]
    proj["recent_close"] = hist["close"][-60:]
    proj["recent_times"] = hist["times"][-60:]
    return proj


@app.post("/news")
def news(req: NewsRequest) -> Dict:
    return get_news(req.ticker, req.market, req.limit)


@app.get("/market-summary")
def market_summary(market: str = "IDX") -> Dict:
    return get_index_summary(market)


@app.post("/portfolio")
def portfolio(req: PortfolioRequest) -> Dict:
    if not req.holdings:
        return {"mode": "discovery", "holdings": [], "message": "No portfolio supplied"}
    per_holding = []
    total_value = 0.0
    total_expected = 0.0
    for h in req.holdings:
        hist = get_history(h.ticker, h.market, "1Y")
        last = hist["close"][-1]
        proj = projections.project_all(hist["close"], req.horizon)
        exp = proj["consensus_expected_price"]
        value = last * h.shares
        expected_value = exp * h.shares
        total_value += value
        total_expected += expected_value
        per_holding.append({
            "ticker": hist["ticker"], "market": hist["market"], "currency": hist["currency"],
            "shares": h.shares, "last_price": last, "value": round(value, 2),
            "consensus_expected_price": round(exp, 4), "expected_value": round(expected_value, 2),
        })
    return {
        "mode": "portfolio", "horizon": req.horizon, "lang": req.lang,
        "total_value": round(total_value, 2), "total_expected_value": round(total_expected, 2),
        "expected_return_pct": round((total_expected / total_value - 1) * 100, 2) if total_value else 0,
        "holdings": per_holding,
    }
