"""Technical indicators. Pure numpy, no heavy deps.

All functions take a 1-D list/array of closing prices and return arrays
aligned to the input length (leading values are None/NaN where undefined).
"""
from __future__ import annotations

from typing import List, Optional, Dict
import numpy as np


def _arr(data: List[float]) -> np.ndarray:
    return np.asarray(data, dtype=float)


def sma(data: List[float], period: int = 20) -> List[Optional[float]]:
    a = _arr(data)
    out: List[Optional[float]] = [None] * len(a)
    if len(a) < period:
        return out
    csum = np.cumsum(np.insert(a, 0, 0.0))
    means = (csum[period:] - csum[:-period]) / period
    for i, v in enumerate(means):
        out[period - 1 + i] = float(v)
    return out


def ema(data: List[float], period: int = 20) -> List[Optional[float]]:
    a = _arr(data)
    out: List[Optional[float]] = [None] * len(a)
    if len(a) == 0:
        return out
    k = 2.0 / (period + 1.0)
    prev = a[0]
    out[0] = float(prev)
    for i in range(1, len(a)):
        prev = a[i] * k + prev * (1 - k)
        out[i] = float(prev)
    return out


def bollinger(data: List[float], period: int = 20, mult: float = 2.0) -> Dict[str, List[Optional[float]]]:
    a = _arr(data)
    mid = sma(data, period)
    upper: List[Optional[float]] = [None] * len(a)
    lower: List[Optional[float]] = [None] * len(a)
    for i in range(period - 1, len(a)):
        window = a[i - period + 1 : i + 1]
        sd = float(np.std(window))
        m = mid[i]
        if m is not None:
            upper[i] = m + mult * sd
            lower[i] = m - mult * sd
    return {"middle": mid, "upper": upper, "lower": lower}


def rsi(data: List[float], period: int = 14) -> List[Optional[float]]:
    a = _arr(data)
    out: List[Optional[float]] = [None] * len(a)
    if len(a) <= period:
        return out
    deltas = np.diff(a)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = gains[:period].mean()
    avg_loss = losses[:period].mean()
    for i in range(period, len(a)):
        if i > period:
            avg_gain = (avg_gain * (period - 1) + gains[i - 1]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i - 1]) / period
        rs = avg_gain / avg_loss if avg_loss != 0 else float("inf")
        out[i] = 100.0 - (100.0 / (1.0 + rs))
    return out


def macd(data: List[float], fast: int = 12, slow: int = 26, signal: int = 9) -> Dict[str, List[Optional[float]]]:
    ema_fast = ema(data, fast)
    ema_slow = ema(data, slow)
    macd_line: List[Optional[float]] = [
        (f - s) if (f is not None and s is not None) else None
        for f, s in zip(ema_fast, ema_slow)
    ]
    clean = [v for v in macd_line if v is not None]
    sig_clean = ema(clean, signal)
    signal_line: List[Optional[float]] = [None] * len(macd_line)
    j = 0
    for i, v in enumerate(macd_line):
        if v is not None:
            signal_line[i] = sig_clean[j]
            j += 1
    hist: List[Optional[float]] = [
        (m - s) if (m is not None and s is not None) else None
        for m, s in zip(macd_line, signal_line)
    ]
    return {"macd": macd_line, "signal": signal_line, "histogram": hist}


def detect_pattern(open_, high, low, close) -> Dict[str, Optional[str]]:
    """Detect the candlestick pattern formed by the most recent candle(s).

    Returns {"pattern": <key>, "direction": bullish|bearish|neutral} where
    <key> matches the descriptions in the frontend i18n (CANDLE_PATTERNS).
    Checks triple -> double -> single patterns, returns the first match.
    """
    n = len(close)
    if n < 3:
        return {"pattern": None, "direction": "neutral"}

    o, h, l, c = open_, high, low, close
    def body(i): return abs(c[i] - o[i])
    def rng(i): return max(h[i] - l[i], 1e-9)
    def upper(i): return h[i] - max(o[i], c[i])
    def lower(i): return min(o[i], c[i]) - l[i]
    def bull(i): return c[i] > o[i]
    def bear(i): return c[i] < o[i]
    i = n - 1  # last candle

    # ---- triple-candle ----
    if bear(i-2) and body(i-1) < body(i-2) * 0.5 and bull(i) and c[i] > (o[i-2] + c[i-2]) / 2:
        return {"pattern": "morning_star", "direction": "bullish"}
    if bull(i-2) and body(i-1) < body(i-2) * 0.5 and bear(i) and c[i] < (o[i-2] + c[i-2]) / 2:
        return {"pattern": "evening_star", "direction": "bearish"}
    if bull(i) and bull(i-1) and bull(i-2) and c[i] > c[i-1] > c[i-2]:
        return {"pattern": "three_white_soldiers", "direction": "bullish"}
    if bear(i) and bear(i-1) and bear(i-2) and c[i] < c[i-1] < c[i-2]:
        return {"pattern": "three_black_crows", "direction": "bearish"}

    # ---- double-candle ----
    if bear(i-1) and bull(i) and c[i] >= o[i-1] and o[i] <= c[i-1]:
        return {"pattern": "bullish_engulfing", "direction": "bullish"}
    if bull(i-1) and bear(i) and o[i] >= c[i-1] and c[i] <= o[i-1]:
        return {"pattern": "bearish_engulfing", "direction": "bearish"}
    if bear(i-1) and bull(i) and o[i] < l[i-1] and c[i] > (o[i-1] + c[i-1]) / 2 and c[i] < o[i-1]:
        return {"pattern": "piercing", "direction": "bullish"}
    if bull(i-1) and bear(i) and o[i] > h[i-1] and c[i] < (o[i-1] + c[i-1]) / 2 and c[i] > o[i-1]:
        return {"pattern": "dark_cloud_cover", "direction": "bearish"}
    if body(i) < body(i-1) * 0.6 and max(o[i], c[i]) < max(o[i-1], c[i-1]) and min(o[i], c[i]) > min(o[i-1], c[i-1]):
        return {"pattern": "harami", "direction": "bullish" if bear(i-1) else "bearish"}

    # ---- single-candle ----
    b, r = body(i), rng(i)
    if b <= r * 0.1:
        return {"pattern": "doji", "direction": "neutral"}
    if lower(i) >= b * 2 and upper(i) <= b * 0.5:
        return {"pattern": "hammer" if bull(i) else "hanging_man",
                "direction": "bullish" if bull(i) else "bearish"}
    if upper(i) >= b * 2 and lower(i) <= b * 0.5:
        return {"pattern": "inverted_hammer" if bull(i) else "shooting_star",
                "direction": "bullish" if bull(i) else "bearish"}
    if b >= r * 0.9:
        return {"pattern": "marubozu", "direction": "bullish" if bull(i) else "bearish"}
    if b <= r * 0.3 and upper(i) > b and lower(i) > b:
        return {"pattern": "spinning_top", "direction": "neutral"}
    return {"pattern": None, "direction": "bullish" if bull(i) else "bearish"}


def latest_snapshot(data: List[float]) -> Dict[str, Optional[float]]:
    """Convenience: last value of each indicator for quick signals."""
    def last(xs):
        for v in reversed(xs):
            if v is not None:
                return v
        return None
    bb = bollinger(data)
    return {
        "sma20": last(sma(data, 20)),
        "sma50": last(sma(data, 50)),
        "ema12": last(ema(data, 12)),
        "rsi14": last(rsi(data, 14)),
        "bb_upper": last(bb["upper"]),
        "bb_lower": last(bb["lower"]),
        "macd": last(macd(data)["macd"]),
    }
