from app import indicators, projections
from app.data import get_history, get_fundamentals

def _p(): return get_history("BBRI","IDX","1Y")["close"]

def test_sma():
    s = indicators.sma(_p(),20); assert s[:19]==[None]*19 and s[19] is not None
def test_rsi():
    assert all(0<=x<=100 for x in indicators.rsi(_p(),14) if x is not None)
def test_boll():
    p=_p(); bb=indicators.bollinger(p); i=len(p)-1
    assert bb["lower"][i]<bb["middle"][i]<bb["upper"][i]
def test_mc():
    mc=projections.monte_carlo_gbm(_p(),30,500)
    assert mc["p05"]<=mc["median_price"]<=mc["p95"] and len(mc["median_path"])==30
def test_markov():
    mk=projections.markov_chain(_p(),30)
    assert len(mk["expected_path"])==30 and abs(sum(mk["stationary_distribution"])-1)<1e-3
def test_all():
    r=projections.project_all(_p(),30)
    assert {"monte_carlo_gbm","markov_chain"}<=set(r["methods_available"]) and r["consensus_expected_price"]>0
def test_tf():
    for tf in ["1D","5D","1M","6M","1Y","MAX"]:
        d=get_history("AAPL","US",tf)
        assert len(d["close"])>0 and len(d["times"])==len(d["close"]) and "intraday" in d
def test_pattern():
    d=get_history("BBRI","IDX","6M")
    pat=indicators.detect_pattern(d["open"],d["high"],d["low"],d["close"])
    assert "pattern" in pat and "direction" in pat
def test_fund():
    f=get_fundamentals("BBRI","IDX")
    assert "verdict" in f and "recommendation" in f and "trailingPE" in f
