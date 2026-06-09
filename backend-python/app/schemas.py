from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


class Holding(BaseModel):
    ticker: str
    market: str = "IDX"
    shares: float = 0
    avg_price: float = 0


class AnalyzeRequest(BaseModel):
    ticker: str
    market: str = "IDX"


class ChartRequest(BaseModel):
    ticker: str
    market: str = "IDX"
    timeframe: str = "6M"  # 1D, 5D, 1M, 3M, 6M, 1Y, MAX


class FundamentalRequest(BaseModel):
    ticker: str
    market: str = "IDX"


class MarketRequest(BaseModel):
    market: str = "IDX"


class NewsRequest(BaseModel):
    ticker: str
    market: str = "IDX"
    limit: int = 5


class ProjectRequest(BaseModel):
    ticker: str
    market: str = "IDX"
    horizon: int = 30


class PortfolioRequest(BaseModel):
    holdings: List[Holding] = Field(default_factory=list)
    horizon: int = 30
    lang: str = "id"
