from app import indicators, projections
from app.data import get_history, get_fundamentals, get_index_summary, get_news
def _p(): return get_history("BBRI","IDX","1Y")["close"]
def test_boll():
    p=_p(); bb=indicators.bollinger(p); i=len(p)-1; assert bb["lower"][i]<bb["middle"][i]<bb["upper"][i]
def test_proj():
    assert projections.project_all(_p(),30)["consensus_expected_price"]>0
def test_tf():
    for tf in ["1D","6M","MAX"]:
        d=get_history("AAPL","US",tf); assert len(d["times"])==len(d["close"])>0
def test_pattern():
    d=get_history("BBRI","IDX","6M"); assert "pattern" in indicators.detect_pattern(d["open"],d["high"],d["low"],d["close"])
def test_fund():
    assert "verdict" in get_fundamentals("BBRI","IDX")
def test_index():
    s=get_index_summary("IDX"); assert s["name"]=="IHSG" and "last" in s
def test_news():
    assert isinstance(get_news("BBRI","IDX")["items"],list)
def test_levels():
    d=get_history("BBRI","IDX","1Y")
    L=indicators.recommend_levels(d["open"],d["high"],d["low"],d["close"],"IDX")
    assert L["action"] in ("BUY","SELL","HOLD") and L["entry"]>0 and L["target"]>0 and L["stop"]>0
