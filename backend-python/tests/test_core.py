import numpy as np
from app import indicators, projections
from app.data import get_history


def _prices():
    return get_history("BBRI", "IDX", 180)["close"]


def test_sma_alignment():
    p = _prices()
    s = indicators.sma(p, 20)
    assert len(s) == len(p)
    assert s[:19] == [None] * 19
    assert s[19] is not None


def test_rsi_bounds():
    p = _prices()
    r = [x for x in indicators.rsi(p, 14) if x is not None]
    assert all(0 <= x <= 100 for x in r)


def test_bollinger_order():
    p = _prices()
    bb = indicators.bollinger(p)
    i = len(p) - 1
    assert bb["lower"][i] < bb["middle"][i] < bb["upper"][i]


def test_monte_carlo_keys():
    p = _prices()
    mc = projections.monte_carlo_gbm(p, horizon=30, sims=500)
    for k in ("expected_price", "p05", "p95", "prob_gain", "median_path"):
        assert k in mc
    assert mc["p05"] <= mc["median_price"] <= mc["p95"]
    assert len(mc["median_path"]) == 30


def test_markov_path():
    p = _prices()
    mk = projections.markov_chain(p, horizon=30)
    assert len(mk["expected_path"]) == 30
    # values are rounded to 4dp for display, so allow a small tolerance
    assert abs(sum(mk["stationary_distribution"]) - 1.0) < 1e-3


def test_project_all_consensus():
    p = _prices()
    res = projections.project_all(p, horizon=30)
    assert "monte_carlo_gbm" in res["methods_available"]
    assert "markov_chain" in res["methods_available"]
    assert res["consensus_expected_price"] > 0
