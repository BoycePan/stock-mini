"""雅虎财经抓取服务（Python sidecar，方案 A）。

Java 后端通过 HTTP 调用本服务拉取国外指数 / 股票 / 板块 ETF / 期货 / 外汇 / 加密货币。
抓取脏活（雅虎 TLS 指纹、crumb、cookie、重试）全部由 yfinance 消化，本服务只做三件事：
  1. 接收 Java 的 HTTP 请求
  2. 调 yfinance 拉数据
  3. 转成 JSON 返回

数据通道（二选一，按环境变量切换）：
  A. Cloudflare Worker 反向代理（推荐，海外/国内服务器都无需 Clash）：
        YF_WORKER_BASE=https://proxy.lilaiyun.online
        YF_AUTH_TOKEN=<worker 鉴权 token>
     本文件内部把 yfinance 对 yahoo.com 的请求重写到 Worker 并加 X-Auth-Token。
     注意：yfinance 1.2.0 要求 curl_cffi session（TLS 指纹模拟），普通 requests.Session 不行。
  B. 直连雅虎（海外服务器或本机走 Clash）：
        不设 YF_WORKER_BASE，走环境变量 HTTPS_PROXY / HTTP_PROXY（yfinance 底层自动读取）。
      本机开发：HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890

启动方式：
  方式 A：YF_WORKER_BASE=... YF_AUTH_TOKEN=... python3 scripts/fetch_service.py
  方式 B：HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 python3 scripts/fetch_service.py
"""

import os
import time

import uvicorn
import yfinance as yf
from curl_cffi import requests as curl_requests
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


# ---- Cloudflare Worker 反向代理通道 ----
WORKER_BASE = os.environ.get("YF_WORKER_BASE", "").strip().rstrip("/")
AUTH_TOKEN = os.environ.get("YF_AUTH_TOKEN", "").strip()


class WorkerSession(curl_requests.Session):
    """把所有到 yahoo.com 的请求重写到 Worker 并加 X-Auth-Token。"""

    def request(self, method, url, **kwargs):
        if WORKER_BASE and "yahoo.com" in url:
            url = WORKER_BASE + "/" + url
            headers = dict(kwargs.get("headers", {}))
            if AUTH_TOKEN:
                headers["X-Auth-Token"] = AUTH_TOKEN
            kwargs["headers"] = headers
        return super().request(method, url, **kwargs)


# 配置了 Worker 才用 WorkerSession；否则 None（yfinance 走直连/代理）
_SESSION = WorkerSession() if (WORKER_BASE and AUTH_TOKEN) else None


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
        df = yf.Ticker(symbol, session=_SESSION).history(period=range, interval=interval)
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
        info = yf.Ticker(symbol, session=_SESSION).fast_info
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
                         group_by="ticker", threads=False, auto_adjust=False, session=_SESSION)
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
                    prev = float(closes.iloc[-2]) if len(closes) >= 2 else 0.0
        except Exception:
            pass
        if not price:
            try:
                info = yf.Ticker(s, session=_SESSION).fast_info
                price = _to_number(info.last_price)
                prev = _to_number(getattr(info, "previous_close", 0))
            except Exception:
                # 两条路径都失败：跳过该 symbol，避免 Java 侧用 0 覆盖有效快照
                continue
        if not price:
            # fast_info 兜底仍返回 0/NaN：视为失败，同样跳过
            continue
        # prev 缺失（如下载只剩当日 bar，历史空洞）：用 fast_info.previous_close 兜底，
        # 避免把"缺昨收"误算成平盘（pct_change=0 的假象）。
        if not prev:
            try:
                info = yf.Ticker(s, session=_SESSION).fast_info
                prev = _to_number(getattr(info, "previous_close", 0))
            except Exception:
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
