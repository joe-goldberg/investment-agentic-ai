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
    days: int = 180


class ProjectRequest(BaseModel):
    ticker: str
    market: str = "IDX"
    days: int = 180
    horizon: int = 30


class PortfolioRequest(BaseModel):
    holdings: List[Holding] = Field(default_factory=list)
    horizon: int = 30
    lang: str = "id"  # id (default) | en
