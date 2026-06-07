"""Portfolio / price projection engines.

Three complementary methods (flow #5):
  - Facebook Prophet (optional import; trend + seasonality)
  - Markov chain over discretized return states
  - Stochastic Monte Carlo (Geometric Brownian Motion)

Prophet is heavy and optional. If it is not installed the API still works
and simply omits the prophet projection (reported in `methods_available`).
"""
from __future__ import annotations

from typing import List, Dict, Optional
import numpy as np

try:  # optional heavy dependency
    from prophet import Prophet  # type: ignore
    import pandas as pd  # type: ignore
    _HAS_PROPHET = True
except Exception:  # pragma: no cover - environment dependent
    _HAS_PROPHET = False


def _returns(prices: List[float]) -> np.ndarray:
    a = np.asarray(prices, dtype=float)
    return np.diff(a) / a[:-1]


# ---------------------------------------------------------------- Monte Carlo
def monte_carlo_gbm(
    prices: List[float], horizon: int = 30, sims: int = 1000, seed: Optional[int] = 42
) -> Dict:
    rng = np.random.default_rng(seed)
    r = _returns(prices)
    mu = float(np.mean(r))
    sigma = float(np.std(r))
    s0 = float(prices[-1])
    # simulate daily log-ish steps
    steps = rng.normal(mu, sigma, size=(sims, horizon))
    paths = s0 * np.cumprod(1 + steps, axis=1)
    final = paths[:, -1]
    pct = lambda q: float(np.percentile(final, q))
    median_path = np.percentile(paths, 50, axis=0)
    return {
        "method": "monte_carlo_gbm",
        "horizon": horizon,
        "sims": sims,
        "start_price": s0,
        "expected_price": float(np.mean(final)),
        "median_price": pct(50),
        "p05": pct(5),
        "p25": pct(25),
        "p75": pct(75),
        "p95": pct(95),
        "prob_gain": float(np.mean(final > s0)),
        "median_path": [round(float(x), 4) for x in median_path],
    }


# ---------------------------------------------------------------- Markov chain
def markov_chain(
    prices: List[float], horizon: int = 30, n_states: int = 5
) -> Dict:
    r = _returns(prices)
    # discretize returns into n_states buckets by quantile edges
    edges = np.quantile(r, np.linspace(0, 1, n_states + 1))
    edges[0] = -np.inf
    edges[-1] = np.inf
    states = np.clip(np.digitize(r, edges) - 1, 0, n_states - 1)
    # transition matrix
    trans = np.zeros((n_states, n_states))
    for a, b in zip(states[:-1], states[1:]):
        trans[a, b] += 1
    row_sums = trans.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1
    trans = trans / row_sums
    # representative return per state (bucket mean)
    state_means = []
    for s in range(n_states):
        vals = r[states == s]
        state_means.append(float(vals.mean()) if len(vals) else 0.0)
    state_means = np.array(state_means)
    # project distribution forward from current state
    cur = np.zeros(n_states)
    cur[states[-1]] = 1.0
    s0 = float(prices[-1])
    price = s0
    path = []
    dist = cur.copy()
    for _ in range(horizon):
        dist = dist @ trans
        exp_ret = float(dist @ state_means)
        price = price * (1 + exp_ret)
        path.append(round(price, 4))
    labels = ["strong_down", "down", "flat", "up", "strong_up"][:n_states]
    return {
        "method": "markov_chain",
        "horizon": horizon,
        "n_states": n_states,
        "state_labels": labels,
        "start_price": s0,
        "expected_price": path[-1] if path else s0,
        "stationary_distribution": [round(float(x), 4) for x in dist],
        "expected_path": path,
    }


# ---------------------------------------------------------------- Prophet
def prophet_forecast(prices: List[float], horizon: int = 30) -> Optional[Dict]:
    if not _HAS_PROPHET:
        return None
    n = len(prices)
    dates = pd.date_range(end=pd.Timestamp.today().normalize(), periods=n, freq="D")
    df = pd.DataFrame({"ds": dates, "y": prices})
    m = Prophet(daily_seasonality=False, weekly_seasonality=True, yearly_seasonality=False)
    m.fit(df)
    future = m.make_future_dataframe(periods=horizon)
    fc = m.predict(future).tail(horizon)
    return {
        "method": "prophet",
        "horizon": horizon,
        "start_price": float(prices[-1]),
        "expected_price": float(fc["yhat"].iloc[-1]),
        "yhat": [round(float(x), 4) for x in fc["yhat"]],
        "yhat_lower": [round(float(x), 4) for x in fc["yhat_lower"]],
        "yhat_upper": [round(float(x), 4) for x in fc["yhat_upper"]],
    }


def project_all(prices: List[float], horizon: int = 30) -> Dict:
    methods_available = ["monte_carlo_gbm", "markov_chain"]
    result: Dict = {
        "horizon": horizon,
        "monte_carlo": monte_carlo_gbm(prices, horizon),
        "markov": markov_chain(prices, horizon),
    }
    p = prophet_forecast(prices, horizon)
    if p is not None:
        result["prophet"] = p
        methods_available.append("prophet")
    result["methods_available"] = methods_available
    # simple consensus on expected end price
    ends = [result["monte_carlo"]["expected_price"], result["markov"]["expected_price"]]
    if "prophet" in result:
        ends.append(result["prophet"]["expected_price"])
    result["consensus_expected_price"] = float(np.mean(ends))
    return result
