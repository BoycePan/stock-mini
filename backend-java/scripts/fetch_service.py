"""雅虎财经抓取服务（Python sidecar，方案 A）。

Java 后端通过 HTTP 调用本服务拉取国外指数 / 股票 / 板块 ETF / 期货 / 外汇 / 加密货币。
抓取脏活（雅虎 TLS 指纹、crumb、cookie、重试）全部由 yfinance 消化，本服务只做三件事：
  1. 接收 Java 的 HTTP 请求
  2. 调 yfinance 拉数据
  3. 转成 JSON 返回

代理策略：
  读取环境变量 HTTPS_PROXY / HTTP_PROXY（yfinance 底层 requests 会自动读取）。
  - 本机开发：启动时带上  HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890
  - 海外服务器：不带代理环境变量，yfinance 直连雅虎即可
  本文件内不需要写代理逻辑。

启动方式：
  HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 python3 scripts/fetch_service.py
"""

import os
import time

import uvicorn
import yfinance as yf
from fastapi import FastAPI

app = FastAPI(title="Yahoo Finance Sidecar", version="0.1.0")

# 简单 TTL 内存缓存：避免对雅虎高频请求触发 429 限流。
_CACHE: dict = {}
_CACHE_TTL_SECONDS = 60


def _cached(key: tuple, producer):
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < _CACHE_TTL_SECONDS:
        return hit[1]
    value = producer()
    _CACHE[key] = (now, value)
    return value


def _to_number(value, default=0.0):
    """NaN/None 统一转默认值，保证 JSON 序列化不报错。"""
    if value is None or value != value:
        return default
    return float(value)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/kline")
def kline(symbol: str, range: str = "1mo", interval: str = "1d"):
    """历史 K 线。

    参数：
      symbol   Yahoo 符号，如 ^GSPC / AAPL / 005930.KS / GC=F / BTC-USD
      range    周期，如 5d / 1mo / 3mo / 1y / max
      interval 周期粒度，如 1d / 1wk / 1mo / 5m / 1h

    返回：OHLCV JSON 数组。
    """

    def fetch():
        df = yf.Ticker(symbol).history(period=range, interval=interval)
        if df.empty:
            return []
        rows = []
        for idx, row in df.iterrows():
            rows.append({
                "date": idx.strftime("%Y-%m-%d %H:%M"),
                "open": _to_number(row.get("Open")),
                "high": _to_number(row.get("High")),
                "low": _to_number(row.get("Low")),
                "close": _to_number(row.get("Close")),
                "volume": int(_to_number(row.get("Volume"))),
            })
        return rows

    return _cached(("kline", symbol, range, interval), fetch)


@app.get("/quote")
def quote(symbol: str):
    """实时行情快照。"""

    def fetch():
        info = yf.Ticker(symbol).fast_info
        return {
            "symbol": symbol,
            "price": _to_number(info.last_price),
            "currency": str(info.currency or ""),
            "exchange": str(info.exchange or ""),
        }

    return _cached(("quote", symbol), fetch)


def _quotes_impl(symbols):
    """批量拉最新点位：优先 yf.download 一次带多个 symbol（快），当日无数据的用 fast_info 兜底。
    返回 [{symbol, price, prev_close, pct_change}]。此接口供 Java 定时任务低频调用，故不加缓存。"""
    result = []
    try:
        df = yf.download(symbols, period="2d", interval="1d", progress=False,
                         group_by="ticker", threads=False, auto_adjust=False)
    except Exception:
        df = None
    for s in symbols:
        price = None
        prev = 0.0
        try:
            if df is not None and not df.empty:
                if len(symbols) == 1:
                    closes = df["Close"].dropna()
                else:
                    closes = df[s, "Close"].dropna()
                if not closes.empty:
                    price = float(closes.iloc[-1])
                    prev = float(closes.iloc[-2]) if len(closes) >= 2 else price
        except Exception:
            pass
        if price is None:
            try:
                info = yf.Ticker(s).fast_info
                price = _to_number(info.last_price)
                prev = _to_number(getattr(info, "previous_close", 0))
            except Exception:
                price = 0.0
                prev = 0.0
        pct = (price - prev) / prev * 100 if prev and price else 0.0
        result.append({
            "symbol": s,
            "price": round(price, 4),
            "prev_close": round(prev, 4),
            "pct_change": round(pct, 2),
        })
    return result


@app.get("/quotes")
def quotes(symbols: str):
    """批量实时行情快照。symbols 逗号分隔，如 ^GSPC,^N225,GC=F。供定时任务刷新快照用。"""
    sym_list = [s.strip() for s in symbols.split(",") if s.strip()]
    if not sym_list:
        return []
    return _quotes_impl(sym_list)


if __name__ == "__main__":
    port = int(os.environ.get("FETCH_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
