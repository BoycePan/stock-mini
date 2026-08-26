# 股御信息 — 股票行情 API 文档

> 服务地址：`http://localhost:18487/api/v1`
> 数据源：**雅虎 Finance（全球市场）** / 新浪财经 / 同花顺 / 巨潮资讯
> 更新时间：2026-08-12

---

## 通用说明

### 基础信息

- **接口前缀：** `/api/v1`
- **请求/响应格式：** JSON（`Content-Type: application/json`）
- **认证方式：** 除登录外均不强制鉴权；`/user/profile` 需要 `Authorization: Bearer {token}`
- **URL 编码：** 路径中的行情代码需做 URL 编码：`^` → `%5E`，`=` → `%3D`。例如 `^GSPC` → `%5EGSPC`，`GC=F` → `GC%3DF`，`JPY=X` → `JPY%3DX`

### 响应格式

所有接口统一返回以下结构，HTTP 响应状态码固定为 200：

```json
{"code": 200, "msg": "success", "data": {...}}
```

`code` 字段语义：`200` 成功、`400` 参数错误、`500` 服务端错误等（见下表）。`data` 为业务数据，失败时为 `null`。

### 错误码

| code | 说明 | 常见触发场景 |
|------|------|-------------|
| 200  | 成功（success） | — |
| 400  | 参数错误（param error） | 缺少必填参数、非法 type、股票代码为空等 |
| 401  | 未认证（unauthorized） | Token 缺失或无效 |
| 403  | 禁止访问（forbidden） | 无权限 |
| 404  | 资源不存在（not found） | 代码不存在 |
| 500  | 服务端错误（server error） | 上游数据源异常、数据库异常等 |
| 1001 | Token 无效或已过期 | 携带过期 token |
| 1002 | 缺少 Token | 未携带 token |
| 1003 | 微信登录失败 | wx.login code 校验失败 |

### 交易时段（北京时间）

列表接口返回的 `tradingHours` / `isTrading` 字段基于下表判断（简化约定：忽略午休、按夏令时基准、外汇近似全天、加密 7×24）：

| market | 交易时段 | 说明 |
|--------|----------|------|
| us / global / ca | `21:30-04:00` | 美股（含 iShares 全球行业 ETF、美债、美股个股） |
| cn | `09:30-15:02` | A 股（留 2 分钟结算缓冲） |
| hk | `09:30-16:00` | 港股 |
| tw | `09:00-13:30` | 台湾 |
| jp / kr | `08:00-14:30` | 日本 / 韩国 |
| au | `08:00-14:00` | 澳洲 |
| sg | `09:00-17:00` | 新加坡 |
| in | `11:15-17:30` | 印度 |
| vn / id / th | `10:00-15:30` / `10:00-16:30` / `11:00-17:30` | 越南 / 印尼 / 泰国 |
| gb / de / fr / eu / es / nl | `15:00-23:30` | 欧洲各国 |
| br / mx | `21:00-04:00` / `22:30-05:00` | 巴西 / 墨西哥 |
| commodity | `06:00-05:00` | 大宗商品期货 |
| forex | `05:00-05:00` | 外汇 |
| crypto | `24H` | 加密 7×24 |

### 缓存策略

| 数据类型 | 缓存位置 | TTL |
|----------|----------|-----|
| 全球资产实时快照（指数/板块/资产） | PostgreSQL（quote_snapshot） | 60s 定时刷新，仅刷当前开市资产 |
| 全球资产 K 线（指数/板块/资产） | PostgreSQL（stock_kline） | 每日 6:00 拉取，查询走 60s 内存缓存 |
| 全球资产实时行情（透传 sidecar） | 内存 | 10s |
| A 股分钟 K 线 | 内存 | 30–180s |
| A 股日线 / 周线 | PostgreSQL | 永久 |
| A 股实时行情 | 内存 | 3s |
| 概念板块 K 线 | 内存 | 60s |
| 个股新闻 | 内存 | 60s |
| 通用新闻 | PostgreSQL | 永久（后台 5min 拉取） |
| 个股公告 | 内存 | 5min |

---

## 一、全球指数（雅虎 Finance）

> 数据源：**雅虎 Finance**（经 Cloudflare Worker 反向代理），覆盖美国 / 中国 / 亚太 / 欧洲 / 美洲主流市场，共 **29 个指数**。

### 1.1 指数清单

`{code}` 路径参数可用的全部指数（按 `market` 分组，`tradingHours` 为北京时间）：

| code | name | market | tradingHours |
|------|------|--------|--------------|
| ^GSPC | 标普500 | us | 21:30-04:00 |
| ^DJI | 道琼斯 | us | 21:30-04:00 |
| ^IXIC | 纳斯达克综合 | us | 21:30-04:00 |
| ^NDX | 纳斯达克100 | us | 21:30-04:00 |
| ^RUT | 罗素2000 | us | 21:30-04:00 |
| ^VIX | VIX波动率 | us | 21:30-04:00 |
| ^SOX | 费城半导体 | us | 21:30-04:00 |
| 000001.SS | 上证综指 | cn | 09:30-15:02 |
| 399001.SZ | 深证成指 | cn | 09:30-15:02 |
| 000300.SS | 沪深300 | cn | 09:30-15:02 |
| ^HSI | 恒生指数 | hk | 09:30-16:00 |
| ^TWII | 台湾加权 | tw | 09:00-13:30 |
| ^N225 | 日经225 | jp | 08:00-14:30 |
| ^KS11 | 韩国KOSPI | kr | 08:00-14:30 |
| ^BSESN | 印度SENSEX | in | 11:15-17:30 |
| ^AXJO | 澳洲ASX200 | au | 08:00-14:00 |
| ^STI | 新加坡海峡 | sg | 09:00-17:00 |
| VNM | 越南VN30 | vn | 10:00-15:30 |
| EIDO | 印尼 | id | 10:00-16:30 |
| THD | 泰国 | th | 11:00-17:30 |
| ^FTSE | 英国富时100 | gb | 15:00-23:30 |
| ^GDAXI | 德国DAX | de | 15:00-23:30 |
| ^FCHI | 法国CAC40 | fr | 15:00-23:30 |
| ^STOXX50E | 欧元区50 | eu | 15:00-23:30 |
| ^IBEX | 西班牙IBEX35 | es | 15:00-23:30 |
| ^AEX | 荷兰AEX | nl | 15:00-23:30 |
| ^GSPTSE | 加拿大TSX | ca | 21:30-04:00 |
| ^BVSP | 巴西Bovespa | br | 21:00-04:00 |
| ^MXX | 墨西哥IPC | mx | 22:30-05:00 |

### 1.2 指数列表

```
GET /api/v1/index/list?trading={trading}
```

返回全部指数列表，按 `market` 分组展示，点位来自 `quote_snapshot` 实时快照（每 60s 刷新）。

**入参（Request Parameters）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| trading | boolean | 否 | 按开市状态过滤：`true`=只返回当前开市，`false`=只返回闭市；不传返回全部 |

**响应参数（Response Parameters）**

`data` 为数组，元素字段如下：

| 字段 | 类型 | 说明 |
|------|------|------|
| code | string | 行情代码，如 `^GSPC` |
| name | string | 指数中文名 |
| market | string | 交易市场：`us` / `cn` / `hk` / `tw` / `jp` / `kr` / ... |
| price | number | 最新点位（60s 快照；未开市或快照未刷新时为 null） |
| pctChange | number | 涨跌幅（%），相对昨收 |
| updatedAt | string | 快照更新时间，`LocalDateTime` 格式：`2026-08-11T19:40:03` |
| tradingHours | string | 交易时段（北京时间），如 `21:30-04:00` / `24H` |
| isTrading | boolean | 当前是否开市 |

**响应示例（Response Example）**

```json
{
  "code": 200,
  "msg": "success",
  "data": [
    {"code": "^GSPC", "name": "标普500", "market": "us", "price": 7753.11, "pctChange": -0.06, "updatedAt": "2026-08-11T19:40:03", "tradingHours": "21:30-04:00", "isTrading": false},
    {"code": "000001.SS", "name": "上证综指", "market": "cn", "price": 3421.50, "pctChange": 0.32, "updatedAt": "2026-08-12T15:02:00", "tradingHours": "09:30-15:02", "isTrading": false},
    {"code": "^N225", "name": "日经225", "market": "jp", "price": 39240.5, "pctChange": 1.02, "updatedAt": "2026-08-12T14:30:01", "tradingHours": "08:00-14:30", "isTrading": false}
  ]
}
```

### 1.3 指数 K 线

```
GET /api/v1/index/{code}/klines?range={range}
```

返回指数日线历史（DB 有则查库，无则返回空数组），并附带最新实时快照。

**入参（Request Parameters）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | 路径参数，指数代码，需 URL 编码（如 `^GSPC` → `%5EGSPC`） |
| range | string | 否 | 时间范围，默认 `1y`，可选值见下表 |

`range` 可选值：

| range | 说明 | 换算起始日 |
|-------|------|-----------|
| 1d | 近 1 天 | 昨天 |
| 5d | 近 5 天 | 7 天前 |
| 1mo | 近 1 个月 | 1 个月前 |
| 3mo | 近 3 个月 | 3 个月前 |
| 6mo | 近 6 个月 | 6 个月前 |
| ytd | 年初至今 | 今年 1 月 1 日 |
| 1y | 近 1 年（默认） | 1 年前 |
| 2y / 5y / 10y | 近 2 / 5 / 10 年 | 2 / 5 / 10 年前 |
| max | 全部历史 | 不限 |

**响应参数（Response Parameters）**

| 字段 | 类型 | 说明 |
|------|------|------|
| code | string | 指数代码 |
| range | string | 请求的时间范围 |
| scale | string | K 线周期，固定 `1d` |
| klines | array | K 线数组，按时间升序 |
| count | integer | K 线条数 |
| latest | object / null | 最新实时快照（quote_snapshot，60s 刷新），无记录时为 null |

`klines` 数组元素：

| 字段 | 类型 | 说明 |
|------|------|------|
| time | string | 日期，`yyyy-MM-dd` |
| open / high / low / close | number | 开 / 高 / 低 / 收 |
| volume | number | 成交量 |

`latest` 对象：

| 字段 | 类型 | 说明 |
|------|------|------|
| price | number | 最新点位 |
| pctChange | number | 涨跌幅（%） |
| updatedAt | string | 快照更新时间 |

**响应示例（Response Example）**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "code": "^GSPC",
    "range": "1mo",
    "scale": "1d",
    "klines": [
      {"time": "2026-07-13", "open": 7660.2, "high": 7720.8, "low": 7651.4, "close": 7710.3, "volume": 2147483647},
      {"time": "2026-07-14", "open": 7718.6, "high": 7760.1, "low": 7698.3, "close": 7753.1, "volume": 2147483647}
    ],
    "count": 21,
    "latest": {"price": 7753.11, "pctChange": -0.06, "updatedAt": "2026-08-11T19:40:03"}
  }
}
```

### 1.4 指数实时行情

```
GET /api/v1/index/{code}/quote
```

透传 sidecar 实时行情（10s 缓存），不落库。

**入参（Request Parameters）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | 路径参数，指数代码 |

**响应参数（Response Parameters）**

| 字段 | 类型 | 说明 |
|------|------|------|
| symbol | string | 行情代码 |
| price | number | 最新价 |
| currency | string | 计价货币，如 `USD` |
| exchange | string | 交易所，如 `CMX` |

**响应示例（Response Example）**

```json
{"code": 200, "msg": "success", "data": {"symbol": "^GSPC", "price": 7753.11, "currency": "USD", "exchange": "CME"}}
```

### 1.5 数据拉取与同步（手动触发，运维用）

| 接口 | 入参 | 说明 | 响应 |
|------|------|------|------|
| `GET /api/v1/index/fetch-indices` | `range`（可选，默认 `1y`） | 拉全部指数日线落库 stock_kline（type=index） | `{"range": "1y", "ok": 29, "total": 29}` |
| `GET /api/v1/index/sync-info` | 无 | 同步指数元数据到 stock_info（含 market、交易时段） | `{"synced": 29, "total": 29}` |

---

## 二、国外金融数据

> 数据源：**雅虎 Finance**。包括全球板块 ETF（美股行业 / 主题 / 全球行业）与全球资产（商品 / 外汇 / 加密 / 美债 / 美股个股）。

### 2.1 全球板块列表

```
GET /api/v1/global-sector/list?market={market}&trading={trading}
```

返回板块 ETF 列表，按 `market` + `board`（industry / theme）分组。共 **45 个**：us 行业 9 + us 主题 26 + global 行业 10。

**入参（Request Parameters）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| market | string | 否 | 按市场过滤：`us` / `global`；不传返回全部 |
| trading | boolean | 否 | 按开市状态过滤：`true`=只返回当前开市，`false`=只返回闭市；不传返回全部 |

**响应参数（Response Parameters）**

`data` 为数组，元素字段（比指数多一个 `board`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| code | string | 板块代码（ETF 代码），如 `XLK` |
| name | string | 板块中文名 |
| market | string | 交易市场：`us` / `global` |
| board | string | 板块分类：`industry`（行业）/ `theme`（主题） |
| price | number | 最新点位（60s 快照） |
| pctChange | number | 涨跌幅（%） |
| updatedAt | string | 快照更新时间 |
| tradingHours | string | 交易时段（北京时间） |
| isTrading | boolean | 当前是否开市 |

**响应示例（Response Example）**

```json
{
  "code": 200,
  "msg": "success",
  "data": [
    {"code": "XLK", "name": "科技", "market": "us", "board": "industry", "price": 186.32, "pctChange": -0.88, "updatedAt": "2026-08-11T19:40:03", "tradingHours": "21:30-04:00", "isTrading": false},
    {"code": "BOTZ", "name": "机器人AI", "market": "us", "board": "theme", "price": 37.42, "pctChange": -0.51, "updatedAt": "2026-08-11T19:40:03", "tradingHours": "21:30-04:00", "isTrading": false},
    {"code": "IXN", "name": "全球科技", "market": "global", "board": "industry", "price": 98.10, "pctChange": 0.30, "updatedAt": "2026-08-11T19:40:03", "tradingHours": "21:30-04:00", "isTrading": false}
  ]
}
```

**板块清单（45 个）**

美股行业板块（`board=industry`，9 个）：

| code | name | code | name | code | name |
|------|------|------|------|------|------|
| XLK | 科技 | XLF | 金融 | XLE | 能源 |
| XLP | 必需消费 | XLV | 医疗 | XLI | 工业 |
| XLB | 材料 | XLU | 公用事业 | VNQ | 房地产 |

美股热门主题（`board=theme`，26 个）：

| code | name | code | name | code | name |
|------|------|------|------|------|------|
| SMH | 半导体 | SOXX | 半导体 | XSD | 半导体 |
| GLD | 黄金 | GDX | 金矿 | SLV | 白银 |
| REMX | 稀土 | URA | 铀 | ITA | 军工 |
| BOTZ | 机器人AI | AIQ | 全球AI | ARKQ | 自主科技 |
| ROBO | 机器人 | ARKX | 太空探索 | UFO | 太空 |
| CLOU | 云计算 | SKYY | 云计算 | HACK | 网络安全 |
| DRIV | 电动车 | ICLN | 清洁能源 | TAN | 太阳能 |
| QCLN | 绿色能源 | XBI | 生物科技 | IBB | 生物科技 |
| BLOK | 区块链 | BKCH | 区块链 | | |

全球行业板块（`board=industry`，10 个，iShares MSCI 系列，美股上市覆盖全球）：

| code | name | code | name |
|------|------|------|------|
| IXN | 全球科技 | IXG | 全球金融 |
| IXJ | 全球医疗 | IXC | 全球能源 |
| IXP | 全球通讯 | KXI | 全球必需消费 |
| RXI | 全球可选消费 | EXI | 全球工业 |
| JXI | 全球公用事业 | MXI | 全球材料 |

### 2.2 全球板块 K 线

```
GET /api/v1/global-sector/{code}/klines?range={range}
```

入参与响应同 **1.3 指数 K 线**（`code` 为板块 ETF 代码，`range` 可选值一致，`scale` 固定 `1d`）。

### 2.3 全球板块实时行情

```
GET /api/v1/global-sector/{code}/quote
```

入参与响应同 **1.4 指数实时行情**。

### 2.4 全球资产列表

```
GET /api/v1/asset/list?type={type}&market={market}&trading={trading}
```

返回指定类型的全球资产列表（商品 / 外汇 / 加密 / 美债 / 美股个股），按 `type` + `board` 分组。共 **41 个**。

**入参（Request Parameters）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | 资产类型，可选 `commodity` / `forex` / `crypto` / `bond` / `stock` |
| market | string | 否 | 按市场过滤：`global` / `us`；不传返回全部 |
| trading | boolean | 否 | 按开市状态过滤：`true`=只返回当前开市，`false`=只返回闭市；不传返回全部 |

> 说明：`type=stock` 查询的是美股 / 中概个股（存储 type 为 `us-stock`，与 A 股 `stock` 区分）；`type` 非法或为空时返回 400。

**响应参数（Response Parameters）**

`data` 为数组，元素字段（比指数多 `type` 和 `board`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| code | string | 行情代码，如 `GC=F` / `NVDA` |
| name | string | 资产中文名 |
| type | string | 资产类型：`commodity` / `forex` / `crypto` / `bond` / `us-stock` |
| market | string | 交易市场：`global` / `us` |
| board | string | 细分分类，如 `贵金属` / `能源` / `中概股` / `美债` / `主流货币` |
| price | number | 最新点位（60s 快照） |
| pctChange | number | 涨跌幅（%） |
| updatedAt | string | 快照更新时间 |
| tradingHours | string | 交易时段（北京时间） |
| isTrading | boolean | 当前是否开市 |

**响应示例（Response Example）**

```json
{
  "code": 200,
  "msg": "success",
  "data": [
    {"code": "GC=F", "name": "黄金", "type": "commodity", "market": "global", "board": "贵金属", "price": 4443.00, "pctChange": 1.67, "updatedAt": "2026-08-12T04:00:05", "tradingHours": "06:00-05:00", "isTrading": true},
    {"code": "CL=F", "name": "WTI原油", "type": "commodity", "market": "global", "board": "能源", "price": 82.35, "pctChange": -0.42, "updatedAt": "2026-08-12T04:00:05", "tradingHours": "06:00-05:00", "isTrading": true},
    {"code": "NVDA", "name": "英伟达", "type": "us-stock", "market": "us", "board": "美股科技", "price": 313.33, "pctChange": 2.10, "updatedAt": "2026-08-11T19:40:03", "tradingHours": "21:30-04:00", "isTrading": false},
    {"code": "BTC-USD", "name": "比特币", "type": "crypto", "market": "global", "board": "龙头", "price": 64320.5, "pctChange": 0.85, "updatedAt": "2026-08-12T04:00:05", "tradingHours": "24H", "isTrading": true}
  ]
}
```

**资产清单（41 个）**

商品 / 期货（`type=commodity`，15 个）：

| code | name | board | code | name | board |
|------|------|-------|------|------|-------|
| GC=F | 黄金 | 贵金属 | SI=F | 白银 | 贵金属 |
| PL=F | 铂金 | 贵金属 | PA=F | 钯金 | 贵金属 |
| HG=F | 铜 | 有色金属 | ALI=F | 铝 | 有色金属 |
| LIT | 锂 | 有色金属 | CL=F | WTI原油 | 能源 |
| BZ=F | 布伦特原油 | 能源 | NG=F | 天然气 | 能源 |
| ZC=F | 玉米 | 农产品 | ZS=F | 大豆 | 农产品 |
| ZW=F | 小麦 | 农产品 | ES=F | 标普500期货 | 股指期货 |
| NQ=F | 纳指期货 | 股指期货 | | | |

外汇（`type=forex`，5 个）：

| code | name | board |
|------|------|-------|
| DX-Y.NYB | 美元指数 | 美元指数 |
| EURUSD=X | 欧元/美元 | 主流货币 |
| JPY=X | 美元/日元 | 主流货币 |
| GBPUSD=X | 英镑/美元 | 主流货币 |
| CNY=X | 美元/人民币 | 人民币 |

加密货币（`type=crypto`，2 个）：

| code | name | board |
|------|------|-------|
| BTC-USD | 比特币 | 龙头 |
| ETH-USD | 以太坊 | 龙头 |

美债（`type=bond`，3 个）：

| code | name | board |
|------|------|-------|
| TLT | 美国20年期国债 | 美债 |
| IEF | 美国10年期国债 | 美债 |
| SHY | 美国短期国债 | 美债 |

美股 / 中概个股（`type=stock`，16 个，存储 type 为 `us-stock`）：

| code | name | board | code | name | board |
|------|------|-------|------|------|-------|
| NVDA | 英伟达 | 美股科技 | AAPL | 苹果 | 美股科技 |
| MSFT | 微软 | 美股科技 | GOOGL | 谷歌 | 美股科技 |
| AMZN | 亚马逊 | 美股科技 | META | Meta | 美股科技 |
| TSLA | 特斯拉 | 美股科技 | BABA | 阿里巴巴 | 中概股 |
| PDD | 拼多多 | 中概股 | JD | 京东 | 中概股 |
| BIDU | 百度 | 中概股 | NIO | 蔚来 | 中概股 |
| LI | 理想汽车 | 中概股 | XPEV | 小鹏汽车 | 中概股 |
| NTES | 网易 | 中概股 | BILI | 哔哩哔哩 | 中概股 |

### 2.5 全球资产 K 线

```
GET /api/v1/asset/{code}/klines?range={range}
```

入参与响应同 **1.3 指数 K 线**（`code` 为资产代码，需 URL 编码，如 `GC=F` → `GC%3DF`，`range` 可选值一致，`scale` 固定 `1d`）。

### 2.6 全球资产实时行情

```
GET /api/v1/asset/{code}/quote
```

入参与响应同 **1.4 指数实时行情**。

### 2.7 数据拉取与同步（手动触发，运维用）

| 接口 | 入参 | 说明 | 响应 |
|------|------|------|------|
| `GET /api/v1/global-sector/fetch-sectors` | `range`（可选，默认 `1y`） | 拉全部板块 ETF 日线落库 stock_kline（type=sector） | `{"range": "1y", "ok": 45, "total": 45}` |
| `GET /api/v1/global-sector/sync-info` | 无 | 同步板块元数据到 stock_info（含 board 分类） | `{"synced": 45, "total": 45}` |
| `GET /api/v1/asset/fetch` | `type`（必填）+ `range`（可选，默认 `1y`） | 拉一类资产日线落库 stock_kline | `{"type": "commodity", "range": "1y", "ok": 15, "total": 15}` |
| `GET /api/v1/asset/sync-info` | `type`（必填） | 同步一类资产元数据到 stock_info | `{"type": "commodity", "synced": 15, "total": 15}` |

> 注：`asset/fetch` 与 `asset/sync-info` 的 `type` 取值同 **2.4 全球资产列表**，非法 type 返回 400。

---

## 三、A 股行情

> 数据源：**新浪财经** / 同花顺。

### 3.1 股票搜索

```
GET /api/v1/stock/search?q={关键词}&limit={条数}
```

按代码或名称前缀搜索，优先级：代码精确匹配 > 名称前缀 > 代码前缀 > 名称包含。

**入参（Request Parameters）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词 |
| limit | int | 否 | 返回条数，默认 20，最大 100 |

**响应示例（Response Example）**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "count": 1,
    "keyword": "茅台",
    "stocks": [
      {"code": "600519", "name": "贵州茅台", "type": "stock", "market": "sh", "board": "main", "industry": "", "is_active": true}
    ]
  }
}
```

### 3.2 实时行情

```
GET /api/v1/stock/{code}/quote
```

单只股票最新行情快照（3s 缓存）。**示例：** `GET /api/v1/stock/000001/quote`

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "code": "000001", "name": "平安银行",
    "open": 11.41, "prev_close": 11.44, "price": 11.25,
    "high": 11.5, "low": 11.18,
    "volume": 151150993, "amount": 1703942517.43,
    "date": "2026-08-05", "time": "16:30:00",
    "turnover": 0, "pct_change": -1.6608391608391566
  }
}
```

### 3.3 批量行情

```
GET /api/v1/stock/quotes?codes={code1,code2,...}
```

一次最多 50 只（3s 缓存，缓存 key 为排序后的 codes）。**示例：** `GET /api/v1/stock/quotes?codes=000001,600519,000858`，返回 `data` 为行情对象数组，字段同 3.2。

### 3.4 K 线数据

```
GET /api/v1/stock/{code}/klines?scale={周期}&count={条数}
```

**入参（Request Parameters）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | 6 位股票代码 |
| scale | string | 是 | 周期：`5` / `15` / `30` / `60`（分钟线，内存缓存不落库）/ `240`（日线）/ `1200`（周线） |
| count | int | 否 | 返回条数，默认 100 |

**响应示例（Response Example）**：`GET /api/v1/stock/000001/klines?scale=240&count=2`

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "code": "000001",
    "scale": "240",
    "klines": [
      {"time": "2026-08-04", "open": 11.58, "high": 11.62, "low": 11.42, "close": 11.44, "volume": 122112984},
      {"time": "2026-08-05", "open": 11.41, "high": 11.5, "low": 11.18, "close": 11.25, "volume": 151150993}
    ],
    "count": 2
  }
}
```

---

## 四、A 股概念板块

### 4.1 板块列表

```
GET /api/v1/sector/boards?top={数量}
```

返回热门概念板块（数据库读取，定时任务 9:05 刷新）。**入参：** `top`（可选，默认 20，最大 100）。**响应示例：**

```json
{
  "code": 200,
  "msg": "success",
  "data": [
    {"plate_code": "885343", "plate_name": "稀土永磁", "cid": 300382},
    {"plate_code": "885355", "plate_name": "石墨烯", "cid": 300337}
  ]
}
```

| 字段 | 说明 |
|------|------|
| plate_code | 板块代码 |
| plate_name | 板块名称 |
| cid | 板块 ID（用于查询成分股） |

### 4.2 板块 K 线

```
GET /api/v1/sector/board/{code}/klines?count={条数}
```

板块代码从板块列表接口获取（60s 缓存）。**入参：** `code`（路径，必填）、`count`（可选，默认 100）。**响应示例：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "code": "885333",
    "count": 2,
    "klines": [
      {"date": "2026-08-04", "open": 2176.445, "high": 2204.534, "low": 2168.937, "close": 2202.177, "volume": 1980188600, "amount": 33240435000},
      {"date": "2026-08-05", "open": 2197.652, "high": 2252.359, "low": 2197.652, "close": 2238.847, "volume": 2137047900, "amount": 37059443000}
    ]
  }
}
```

### 4.3 板块成分股

```
GET /api/v1/sector/members/{cid}
```

`cid` 从板块列表接口获取，返回该板块包含的股票代码列表。**响应示例：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "cid": 300188,
    "count": 74,
    "stocks": ["300248", "002908", "002396", "002721", "301536", "002138", "300525", "301171", "300096", "300130"]
  }
}
```

---

## 五、新闻与公告

### 5.1 个股新闻

```
GET /api/v1/stock/{code}/news?page={页码}
```

从新浪个股新闻页实时拉取（60s 缓存），同时异步存入 news_feed 表。**入参：** `code`（路径，必填）、`page`（可选，默认 1）。**响应示例：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "code": "600519",
    "count": 39,
    "news": [
      {
        "title": "逼近历史新高，分红超2300亿：这台「水电印钞机」到底有多猛？",
        "summary": "",
        "url": "https://finance.sina.com.cn/jjxw/2026-08-05/doc-inimhpnf4488068.shtml",
        "time": "2026-08-05 20:00",
        "source": "新浪"
      }
    ]
  }
}
```

| 字段 | 说明 |
|------|------|
| title | 新闻标题 |
| summary | 新闻摘要（可能为空） |
| url | 新闻详情页 URL |
| time | 发布时间 |
| source | 来源 |

### 5.2 通用财经新闻

```
GET /api/v1/news/feed?page={页码}&size={每页条数}&id={id 上限}
```

通用新闻（新浪 feed + RSS 来源，`stock_code` 为空的记录）按发布时间倒序分页返回，只查 `news_feed` 表。
新浪 feed 由后台定时任务（SinaFeedScheduler）每 5 分钟拉取落库，接口本身不再实时打新浪。**入参：** `page`（可选，默认 1）、`size`（可选，默认 20，最大 100）、`id`（可选，默认 0；大于 0 时按 `news_feed.id <= id` 过滤，用于按 id 上限滑动分页）。**响应示例：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "page": 1,
    "size": 20,
    "count": 2,
    "hasMore": false,
    "news": [
      {"id": 42, "title": "*ST萃华俩股东被立案调查", "summary": "...", "url": "https://...", "time": "2026-08-05 21:00", "source": "市场资讯"}
    ]
  }
}
```

| 字段 | 说明 |
|------|------|
| id | 记录主键（news_feed.id），可用于按 id 增量/滑动拉取 |
| title | 新闻标题 |
| summary | 新闻摘要（可能为空） |
| url | 新闻详情页 URL |
| time | 发布时间 |
| source | 来源 |

### 5.3 单条新闻详情

```
GET /api/v1/news/{id}
```

按 `news_feed` 主键查询单条新闻。**入参：** `id`（路径，必填）。不存在或 `id <= 0` 时返回业务码 `404`。**响应示例：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "id": 42,
    "title": "*ST萃华俩股东被立案调查",
    "summary": "...",
    "url": "https://...",
    "time": "2026-08-05 21:00",
    "source": "市场资讯"
  }
}
```

不存在时：

```json
{
  "code": 404,
  "msg": "新闻不存在: id=99999",
  "data": null
}
```

### 5.4 个股公告

```
GET /api/v1/stock/{code}/announcements?page={页码}&size={条数}
```

来自巨潮资讯（证监会指定披露平台），5min 缓存。**入参：** `code`（路径，必填）、`page`（可选，默认 1）、`size`（可选，默认 20，最大 100）。**响应示例：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "code": "600519",
    "count": 2,
    "items": [
      {"id": "1225431263", "title": "贵州茅台重大事项公告", "time": "2026-07-18", "url": "http://www.cninfo.com.cn/new/disclosure/detail?announcementId=1225431263", "pdf": "https://static.cninfo.com.cn/finalpage/2026-07-18/1225431263.PDF"}
    ]
  }
}
```

| 字段 | 说明 |
|------|------|
| id | 公告 ID |
| title | 公告标题 |
| time | 发布日期 |
| url | 公告详情页 URL |
| pdf | PDF 附件地址 |

---

## 六、认证

### 6.1 微信登录

```
POST /api/v1/auth/login
Content-Type: application/json
```

**请求体（Request Body）：**

```json
{"code": "微信小程序 wx.login() 返回的 code", "source": "shiChang-tracker"}
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| code | string | 是 | 微信小程序 `wx.login()` 返回的 code |
| source | string | 否 | 来源小程序标识（如 `shiChang-tracker` / `hangQing-tracker`）；不传或空白时使用配置的 `app.wechat.default-source`（默认 `shiChang-tracker`，兼容已发布旧小程序）。未配置的 source 返回 `400` |

**响应（Response）：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "token": "eyJhbG...",
    "expires_in": 86400,
    "user": {"id": 1, "source": "shiChang-tracker", "nickname": null}
  }
}
```

> 说明：多个小程序共用同一张 `users` 表，`openid` 仅在 `(source, openid)` 维度内唯一；token 由共享 `JWT_SECRET` 签发，各小程序登录 token 全接口通用。

### 6.2 用户信息（需认证）

```
GET /api/v1/user/profile
Authorization: Bearer {token}
```

---

## 七、用户行为打点

### 7.1 批量上报事件

```
POST /api/v1/track/events
Content-Type: application/json
Authorization: Bearer {token}     // 可选：登录后携带以解析 user_id；匿名上报也放行
```

前端埋点 SDK 攒批上报，一次提交多条用户行为事件。服务端按 `event_id` 幂等去重（重复上报静默跳过，不重复计数）。

**请求体（Request Body）：**

```json
{
  "events": [
    {
      "eventId": "1724000000000-abc123-1",
      "eventName": "search.submit",
      "eventType": "action",
      "page": "pages/search/index",
      "target": "",
      "props": { "keyword": "茅台" },
      "durationMs": null,
      "sessionId": "1724000000000-abc123",
      "clientTs": 1724000000123,
      "platform": "ios",
      "appVersion": "1.2.3"
    }
  ]
}
```

**入参（Request Parameters）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| events | array | 是 | 事件数组，单批 ≤ 100（超出返回 400） |

`events` 元素字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| eventId | string | 是 | 客户端幂等键（sessionId + 自增序号），唯一去重 |
| eventName | string | 是 | 点分事件名，如 `search.submit` |
| eventType | string | 否 | 事件大类：`page_view` / `page_hide` / `tap` / `action` |
| page | string | 否 | 触发页路由，如 `pages/search/index` |
| target | string | 否 | 目标：跳转页 / 标的 code / Tab 名 |
| props | object | 否 | 扩展属性（任意 JSON 对象，如 `{"keyword":"茅台"}`） |
| durationMs | integer | 否 | 页面停留时长（毫秒） |
| sessionId | string | 否 | 会话 id（小程序一次启动） |
| clientTs | integer | 否 | 客户端事件时间戳（毫秒） |
| platform | string | 否 | `devtools` / `ios` / `android` |
| appVersion | string | 否 | 小程序版本号 |

**响应示例（Response Example）：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "accepted": 1,
    "duplicated": 0,
    "invalid": 0
  }
}
```

| 字段 | 说明 |
|------|------|
| accepted | 实际新入库条数 |
| duplicated | 有效但 event_id 已存在、被幂等跳过的条数 |
| invalid | 因缺少 eventId / eventName 被丢弃的条数 |

> 事件命名规范见 `docs/埋点打点方案.md`；`user_id` 由后端从 JWT 解析（匿名上报为 null），`ip` / `server_ts` 由后端补充。

---

## 八、定时任务

| 时间 | 任务 | 耗时 |
|------|------|------|
| 每日 6:00 | 拉取雅虎全球资产日线（指数 / 板块 / 商品 / 外汇 / 加密 / 美债 / 个股）落库 stock_kline | ~3 分钟 |
| 每 60s | 刷新雅虎实时快照 quote_snapshot（仅刷当前开市资产，按交易时段过滤） | ~10s |
| 交易日 9:00 | 刷新 A 股股票列表 + 行业分类 | ~2 分钟 |
| 交易日 9:05 | 刷新概念板块 + 成分股 | ~2 分钟 |
| 交易日 15:30 | 全量日 K 线采集 | ~90 分钟 |

---

## 九、数据库表

| 表 | 说明 | 数据量 |
|----|------|--------|
| stock_info | 股票 / 指数 / 板块 / 资产基本信息（含 trading_hours 交易时段、market、board） | 5,300+ |
| stock_kline | K 线（日 / 周），type 区分 index / sector / commodity / forex / crypto / bond / us-stock | 按需积累 |
| quote_snapshot | 雅虎实时快照（每 60s 覆盖，仅存最新值） | 115 |
| concept_board | A 股概念板块 | 100 |
| concept_stock | A 股板块成分股 | 7,641 |
| news_feed | 新闻 / 公告 | 按需积累 |
| click_event | 用户点击/行为打点（前端埋点批量上报） | 按需积累 |
| users | 微信用户 | — |
