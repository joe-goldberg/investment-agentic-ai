"""Market data access.

Primary source: Yahoo Finance via `yfinance`, using a `curl_cffi` browser-
impersonating session so requests from datacenter IPs (Railway, etc.) are not
blocked by Yahoo's bot detection.
  - IDX tickers get a ".JK" suffix automatically (e.g. BBRI -> BBRI.JK)
  - US tickers are used as-is (e.g. AAPL)
  - EU tickers should be passed with their Yahoo suffix (e.g. ASML.AS, SAP.DE)

If Yahoo fails (offline, rate-limited, unknown ticker) we fall back to a
deterministic synthetic random walk so the rest of the system keeps working.
A tiny in-memory TTL cache avoids hammering Yahoo on repeated calls.
"""
from __future__ import annotations

from typing import List, Dict, Optional, Tuple
import time
import datetime as dt
import numpy as np

MARKETS = {
    "IDX": {"currency": "IDR", "tz": "Asia/Jakarta", "open": "09:00", "close": "16:00", "suffix": ".JK"},
    "EU": {"currency": "EUR", "tz": "Europe/Amsterdam", "open": "09:00", "close": "17:30", "suffix": ""},
    "US": {"currency": "USD", "tz": "America/New_York", "open": "09:30", "close": "16:00", "suffix": ""},
}

_CACHE: Dict[str, Tuple[float, Dict]] = {}
_CACHE_TTL = 300  # seconds


def _yahoo_symbol(ticker: str, market: str) -> str:
    t = ticker.upper().strip()
    suffix = MARKETS[market]["suffix"]
    if suffix and not t.endswith(suffix):
        return t + suffix
    return t


def _browser_session():
    """A curl_cffi session impersonating Chrome — key to avoiding Yahoo blocks
    from cloud IPs. Returns None if curl_cffi isn't available."""
    try:
        from curl_cffi import requests as cffi
        return cffi.Session(impersonate="chrome")
    except Exception:
        return None


def _synthetic(ticker: str, market: str, days: int) -> Dict:
    seed = abs(hash((ticker.upper(), market))) % (2**32)
    rng = np.random.default_rng(seed)
    base = {"IDX": 4000, "EU": 80, "US": 150}[market]
    drift = rng.normal(0.0005, 0.0002)
    vol = rng.uniform(0.012, 0.025)
    rets = rng.normal(drift, vol, days)
    close = base * np.cumprod(1 + rets)
    high = close * (1 + np.abs(rng.normal(0, vol / 2, days)))
    low = close * (1 - np.abs(rng.normal(0, vol / 2, days)))
    open_ = np.concatenate([[close[0]], close[:-1]])
    today = dt.date.today()
    dates = [(today - dt.timedelta(days=days - 1 - i)).isoformat() for i in range(days)]
    return {
        "ticker": ticker.upper(),
        "market": market,
        "currency": MARKETS[market]["currency"],
        "synthetic": True,
        "dates": dates,
        "close": [round(float(x), 4) for x in close],
        "open": [round(float(x), 4) for x in open_],
        "high": [round(float(x), 4) for x in high],
        "low": [round(float(x), 4) for x in low],
    }


def _df_to_dict(df, ticker: str, market: str, symbol: str) -> Optional[Dict]:
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
    return {
        "ticker": ticker.upper(),
        "market": market,
        "currency": MARKETS[market]["currency"],
        "synthetic": False,
        "yahoo_symbol": symbol,
        "dates": [d.strftime("%Y-%m-%d") for d in df.index],
        "close": close,
        "open": col("Open") or close,
        "high": col("High") or close,
        "low": col("Low") or close,
    }


def _from_yahoo(ticker: str, market: str, days: int) -> Optional[Dict]:
    try:
        import yfinance as yf  # imported lazily so tests run without it
    except Exception:
        return None
    symbol = _yahoo_symbol(ticker, market)
    period = "1y" if days <= 252 else "2y"
    session = _browser_session()
    for _ in range(2):  # one retry
        try:
            tk = yf.Ticker(symbol, session=session) if session else yf.Ticker(symbol)
            df = tk.history(period=period, interval="1d", auto_adjust=True)
            if df is not None and len(df) > 0:
                out = _df_to_dict(df, ticker, market, symbol)
                if out:
                    return out
        except Exception:
            pass
        time.sleep(0.5)
    return None


def get_history(ticker: str, market: str = "IDX", days: int = 180) -> Dict:
    market = market.upper()
    if market not in MARKETS:
        raise ValueError(f"Unknown market: {market}")

    key = f"{ticker.upper()}|{market}|{days}"
    now = time.time()
    cached = _CACHE.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    result = _from_yahoo(ticker, market, days) or _synthetic(ticker, market, days)
    _CACHE[key] = (now, result)
    return result
