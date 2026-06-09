"""Market data access (Yahoo Finance via yfinance + curl_cffi, synthetic fallback)."""
from __future__ import annotations

from typing import Dict, Optional, Tuple
import time
import datetime as dt
import numpy as np

MARKETS = {
    "IDX": {"currency": "IDR", "tz": "Asia/Jakarta", "open": "09:00", "close": "16:00", "suffix": ".JK", "lot": 100},
    "EU": {"currency": "EUR", "tz": "Europe/Amsterdam", "open": "09:00", "close": "17:30", "suffix": "", "lot": 1},
    "US": {"currency": "USD", "tz": "America/New_York", "open": "09:30", "close": "16:00", "suffix": "", "lot": 1},
}

TIMEFRAMES = {
    "1D": ("1d", "5m", True, 78),
    "5D": ("5d", "30m", True, 65),
    "1M": ("1mo", "1d", False, 22),
    "3M": ("3mo", "1d", False, 66),
    "6M": ("6mo", "1d", False, 126),
    "1Y": ("1y", "1d", False, 252),
    "MAX": ("5y", "1wk", False, 260),
}
_INTERVAL_SECONDS = {"5m": 300, "30m": 1800, "1d": 86400, "1wk": 604800}

_CACHE: Dict[str, Tuple[float, Dict]] = {}
_CACHE_TTL = 300


def _norm_tf(timeframe) -> str:
    return str(timeframe or "6M").upper()


def _tf(timeframe):
    return TIMEFRAMES.get(_norm_tf(timeframe), TIMEFRAMES["6M"])


def _yahoo_symbol(ticker: str, market: str) -> str:
    t = ticker.upper().strip()
    suffix = MARKETS[market]["suffix"]
    if suffix and not t.endswith(suffix):
        return t + suffix
    return t


def _browser_session():
    try:
        from curl_cffi import requests as cffi
        return cffi.Session(impersonate="chrome")
    except Exception:
        return None


def _synthetic(ticker, market, timeframe) -> Dict:
    period, interval, intraday, n = _tf(timeframe)
    seed = abs(hash((ticker.upper(), market, _norm_tf(timeframe)))) % (2**32)
    rng = np.random.default_rng(seed)
    base = {"IDX": 4000, "EU": 80, "US": 150}[market]
    drift = rng.normal(0.0005, 0.0002)
    vol = rng.uniform(0.012, 0.025) * (0.3 if intraday else 1.0)
    rets = rng.normal(drift, vol, n)
    close = base * np.cumprod(1 + rets)
    high = close * (1 + np.abs(rng.normal(0, vol / 2, n)))
    low = close * (1 - np.abs(rng.normal(0, vol / 2, n)))
    open_ = np.concatenate([[close[0]], close[:-1]])
    step = _INTERVAL_SECONDS[interval]
    now = int(time.time())
    if intraday:
        times = [now - step * (n - 1 - i) for i in range(n)]
    else:
        today = dt.date.today()
        gap = 7 if interval == "1wk" else 1
        times = [(today - dt.timedelta(days=(n - 1 - i) * gap)).isoformat() for i in range(n)]
    return {
        "ticker": ticker.upper(), "market": market, "currency": MARKETS[market]["currency"],
        "synthetic": True, "intraday": intraday, "timeframe": _norm_tf(timeframe),
        "times": times,
        "close": [round(float(x), 4) for x in close],
        "open": [round(float(x), 4) for x in open_],
        "high": [round(float(x), 4) for x in high],
        "low": [round(float(x), 4) for x in low],
    }


def _df_to_dict(df, ticker, market, symbol, timeframe, intraday) -> Optional[Dict]:
    def col(name):
        try:
            s = df[name]
            if hasattr(s, "columns"):
                s = s.iloc[:, 0]
            return [round(float(x), 4) for x in s.tolist()]
        except Exception:
            return None
    close = col("Close")
    if not close:
        return None
    if intraday:
        times = [int(ts.timestamp()) for ts in df.index]
    else:
        times = [ts.strftime("%Y-%m-%d") for ts in df.index]
    return {
        "ticker": ticker.upper(), "market": market, "currency": MARKETS[market]["currency"],
        "synthetic": False, "intraday": intraday, "timeframe": _norm_tf(timeframe),
        "yahoo_symbol": symbol, "times": times, "close": close,
        "open": col("Open") or close, "high": col("High") or close, "low": col("Low") or close,
    }


def _from_yahoo(ticker, market, timeframe) -> Optional[Dict]:
    try:
        import yfinance as yf
    except Exception:
        return None
    period, interval, intraday, _ = _tf(timeframe)
    symbol = _yahoo_symbol(ticker, market)
    session = _browser_session()
    for _ in range(2):
        try:
            tk = yf.Ticker(symbol, session=session) if session else yf.Ticker(symbol)
            df = tk.history(period=period, interval=interval, auto_adjust=True)
            if df is not None and len(df) > 0:
                out = _df_to_dict(df, ticker, market, symbol, timeframe, intraday)
                if out:
                    return out
        except Exception:
            pass
        time.sleep(0.4)
    return None


def get_history(ticker: str, market: str = "IDX", timeframe: str = "6M") -> Dict:
    market = market.upper()
    if market not in MARKETS:
        raise ValueError("Unknown market: " + str(market))
    key = ticker.upper() + "|" + market + "|" + _norm_tf(timeframe)
    now = time.time()
    cached = _CACHE.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]
    result = _from_yahoo(ticker, market, timeframe) or _synthetic(ticker, market, timeframe)
    _CACHE[key] = (now, result)
    return result


# ---------------------------------------------------------------- fundamentals
_FUND_FIELDS = [
    "trailingPE", "forwardPE", "priceToBook", "returnOnEquity", "debtToEquity",
    "trailingEps", "dividendYield", "payoutRatio", "profitMargins",
    "revenueGrowth", "earningsGrowth", "marketCap", "beta",
]


def get_fundamentals(ticker: str, market: str = "IDX") -> Dict:
    market = market.upper()
    symbol = _yahoo_symbol(ticker, market)
    info = None
    try:
        import yfinance as yf
        session = _browser_session()
        tk = yf.Ticker(symbol, session=session) if session else yf.Ticker(symbol)
        info = tk.info
    except Exception:
        info = None

    if info and (info.get("trailingPE") or info.get("marketCap")):
        data = {k: info.get(k) for k in _FUND_FIELDS}
        data["name"] = info.get("longName") or info.get("shortName") or ticker.upper()
        data["sector"] = info.get("sector")
        data["industry"] = info.get("industry")
        data["synthetic"] = False
    else:
        seed = abs(hash((ticker.upper(), market))) % (2**32)
        rng = np.random.default_rng(seed)
        data = {
            "trailingPE": round(float(rng.uniform(6, 25)), 2),
            "forwardPE": round(float(rng.uniform(6, 22)), 2),
            "priceToBook": round(float(rng.uniform(0.8, 4)), 2),
            "returnOnEquity": round(float(rng.uniform(0.05, 0.25)), 4),
            "debtToEquity": round(float(rng.uniform(20, 150)), 2),
            "trailingEps": round(float(rng.uniform(50, 600)), 2),
            "dividendYield": round(float(rng.uniform(0.0, 0.06)), 4),
            "payoutRatio": round(float(rng.uniform(0.1, 0.6)), 4),
            "profitMargins": round(float(rng.uniform(0.05, 0.3)), 4),
            "revenueGrowth": round(float(rng.uniform(-0.05, 0.25)), 4),
            "earningsGrowth": round(float(rng.uniform(-0.1, 0.3)), 4),
            "marketCap": int(rng.uniform(1e12, 5e14)),
            "beta": round(float(rng.uniform(0.6, 1.6)), 2),
            "name": ticker.upper(), "sector": None, "industry": None, "synthetic": True,
        }
    data["ticker"] = ticker.upper()
    data["market"] = market
    data["currency"] = MARKETS[market]["currency"]
    score = 0
    if data.get("returnOnEquity") and data["returnOnEquity"] > 0.15:
        score += 1
    if data.get("trailingPE") and 0 < data["trailingPE"] < 15:
        score += 1
    if data.get("debtToEquity") and data["debtToEquity"] < 100:
        score += 1
    if data.get("revenueGrowth") and data["revenueGrowth"] > 0.05:
        score += 1
    data["verdict"] = "BAIK" if score >= 3 else ("CUKUP" if score >= 1 else "HATI-HATI")
    data["recommendation"] = "BUY" if score >= 3 else ("HOLD" if score >= 1 else "SELL")
    return data
