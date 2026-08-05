# A股量化选股系统 — 外部接口调用完整分析

> 基于 `/Users/lilaiyun/Code/python/stock/stock` 源码分析
> 生成时间: 2026-08-05
> 用途: 为 Java/其他语言重构提供精确的接口规格参考

---

## 目录

1. [总体架构与调用链](#1-总体架构与调用链)
2. [新浪财经 API](#2-新浪财经-api)
3. [Baostock 证券宝](#3-baostock-证券宝)
4. [同花顺 API (10jqka)](#4-同花顺-api-10jqka)
5. [东方财富 API](#5-东方财富-api)
6. [巨潮资讯 API](#6-巨潮资讯-api)
7. [yfinance 雅虎财经](#7-yfinance-雅虎财经)
8. [OpenAI API](#8-openai-api)
9. [飞书开放平台 API](#9-飞书开放平台-api)
10. [自身对外 API (FastAPI)](#10-自身对外-api-fastapi)
11. [错误处理与重试机制](#11-错误处理与重试机制)
12. [配置依赖](#12-配置依赖)

---

## 1. 总体架构与调用链

```
┌─────────────────────────────────────────────────────────────────────┐
│                          定时调度器 (APScheduler)                      │
│                    每个交易日 15:30 数据采集 / 16:00 选股扫描            │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              ▼                                      ▼
     ┌────────────────┐                    ┌────────────────┐
     │  stock-fetch    │                    │   stock-run    │
     │  数据采集命令行   │                    │  选股扫描命令行  │
     └───────┬────────┘                    └───────┬────────┘
             │                                     │
    ┌────────┼────────┬───────┬──────┐    ┌───────┼───────┬───────┐
    ▼        ▼        ▼       ▼      ▼    ▼       ▼       ▼       ▼
  新浪    Baostock  同花顺  东方财富 yf   板块    新闻    风控    AI分析
  K线      补充     概念板块  新闻    国际  趋势    公告    评估   OpenAI
  列表    成交额    成分股   备用K线 美股   分析    巨潮    ATR    飞书
  行业    换手率            搜索    韩股   (本地)  新浪    仓位    通知
  基本面
```

### 调用层级

| 层级 | 模块 | 外部依赖 |
|------|------|----------|
| 数据采集 | `cli/fetch.py` | 新浪, Baostock, 同花顺, 东方财富, yfinance |
| 数据访问 | `data/collector.py` | 新浪, Baostock (运行时实时拉取 + 本地缓存 fallback) |
| 概念板块 | `data/ths.py`, `data/eastmoney.py` | 同花顺(主), 东方财富(备) |
| 财经新闻 | `data/news.py` | 东方财富搜索 |
| 个股新闻 | `analysis/news.py` | 新浪个股, 新浪feed, 巨潮资讯 |
| AI 分析 | `analysis/ai.py` | OpenAI (可降级离线) |
| 通知推送 | `notify/feishu.py` | 飞书开放平台 |
| 自身服务 | `api/__init__.py` | FastAPI (对外暴露 REST) |

---

## 2. 新浪财经 API

### 2.1 日K线数据

**基本信息**
- URL: `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData`
- 方法: GET
- 编码: `r.apparent_encoding` (自动检测, utf-8 或 gbk)
- Referer: `https://finance.sina.com.cn`
- 来源文件: `data/collector.py:122-166`, `cli/fetch.py:150-176`

**请求参数**
| 参数 | 值 | 说明 |
|------|-----|------|
| `symbol` | `sh600001` / `sz000001` | 6开头加 sh，其他加 sz |
| `scale` | `240` | 日线 |
| `ma` | `no` | 不需要均线 |
| `datalen` | `100` | 返回最近100条 |

**symbol 转换规则**
```
6xxxxx, 9xxxxx → sh{code}
0xxxxx, 3xxxxx, 0xxxxx → sz{code}
```

**返回格式** (JSON 数组)
```json
[
  {
    "day": "2024-01-15",
    "open": "10.500",
    "high": "11.200",
    "low": "10.300",
    "close": "10.800",
    "volume": "12345678"
  }
]
```

**解析处理**
- 重命名列: day→日期, open→开盘, high→最高, low→最低, close→收盘, volume→成交量
- 计算派生字段: 涨跌额(diff), 涨跌幅(pct_change*100), 振幅
- **注意**: 新浪K线不含成交额和换手率，需后续从 Baostock 补充

### 2.2 股票列表

**基本信息**
- URL: `http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData`
- 方法: GET
- 来源文件: `cli/fetch.py:112-134`

**请求参数**
| 参数 | 值 | 说明 |
|------|-----|------|
| `page` | `1, 2, 3...` | 分页，每页80条 |
| `num` | `80` | 每页数量 |
| `sort` | `symbol` | 按代码排序 |
| `asc` | `1` | 升序 |
| `node` | `sh_a` 或 `sz_a` | 沪市A股 / 深市A股 |
| `symbol` | `` | 留空 |
| `_s_r_a` | `auto` | 防盗链参数 |

**调用方式**: 循环翻页直到返回数据不足80条，`sh_a` 和 `sz_a` 两个节点都拉，间隔 150ms
```python
for node in ['sh_a', 'sz_a']:
    for page in range(1, 100):
        # request...
        if len(data) < 80: break
        time.sleep(0.15)
```

**返回格式** (JSON 数组)
```json
[
  {"code": "600001", "name": "邯郸钢铁"},
  ...
]
```
解析后 code 补零到6位: `str(code).zfill(6)`

### 2.3 行业分类映射

**基本信息**
- URL: `http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php`
- 方法: GET
- 编码: gbk
- 来源文件: `cli/fetch.py:388-419`

**解析方式**: 正则提取 `"new_\w+":"([^"]+)"` 条目
每个条目格式: `new_XXXX:"X,行业名,X,X,X,X,X,X,sh600001,股票名,价格,涨跌幅,..."`

解析规则:
- `parts[1]` = 行业名
- `parts[8:]` 每4个字段一组 = (代码, 名称, 价格, 涨跌幅)
- 代码去掉 `sh`/`sz`/`bj` 前缀，补零到6位

**输出**: `stock_industry.csv` (code, industry)

### 2.4 实时行情（基本面）

**基本信息**
- URL: `http://hq.sinajs.cn/list=sh600001,sz000001,...`
- 方法: GET
- 编码: gbk
- 来源文件: `cli/fetch.py:627-698`

**请求方式**: 批量拼接，每批50只，多线程并发
```
http://hq.sinajs.cn/list=sh600001,sz000002,sh600003,...
```

**返回格式** (每行一只)
```
var hq_str_sh600001="邯郸钢铁,10.50,10.30,10.80,11.20,10.00,10.80,10.80,12345678,133000000,...";
```

**解析字段** (按逗号分隔的索引)
| 索引 | 字段 | 说明 |
|------|------|------|
| 0 | 名称 | 股票名称 |
| 1 | 今开 | open |
| 2 | 昨收 | previous close |
| 3 | 当前价 | close |
| 4 | 最高 | high |
| 5 | 最低 | low |
| 8 | 成交量 | volume (股) |
| 9 | 成交额 | amount (元) |
| 37 | 换手率 | turnover_rate |
| ... | PE/PB | 具体实现见 `factors/fundamental.py::_parse_sina_quote()` |

### 2.5 个股新闻（精确匹配）

**基本信息**
- URL: `http://vip.stock.finance.sina.com.cn/corp/view/vCB_AllNewsStock.php`
- 方法: GET
- 编码: gb2312
- 来源文件: `analysis/news.py:240-267`

**请求参数**
| 参数 | 值 | 说明 |
|------|-----|------|
| `symbol` | `sh600001` / `sz000001` | 同上转换规则 |
| `Page` | `1` | 页码 |

**返回格式** (HTML页面，正则解析)
```html
2024-01-15&nbsp;10:30&nbsp;&nbsp;<a href="...">新闻标题</a>
```

**解析正则**: `(\d{4}-\d{2}-\d{2})&nbsp;(\d{2}:\d{2})&nbsp;&nbsp;<a[^>]*href=['\"]([^'\"]+)['\"][^>]*>([^<]+)</a>`

### 2.6 通用财经新闻（fallback）

**基本信息**
- URL: `https://feed.mix.sina.com.cn/api/roll/get`
- 方法: GET
- 编码: utf-8
- 来源文件: `analysis/news.py:99-196`

**请求参数**
| 参数 | 值 | 说明 |
|------|-----|------|
| `pageid` | `153` | 财经新闻页面ID |
| `lid` | `2516` | 列表ID |
| `k` | `000001` | 6位股票代码 |
| `num` | `20` | 返回条数 |
| `page` | `1` | 页码 |
| `r` | 毫秒时间戳(13位) | 防缓存 |
| `callback` | `jsonp_{timestamp}` | JSONP回调 |

**返回格式**: JSONP → 去壳解析 → `data.result.data` 数组
```json
{
  "result": {
    "data": [
      {
        "title": "新闻标题",
        "intro": "新闻摘要",
        "ctime": "1705305000"
      }
    ]
  }
}
```
`ctime` 是 Unix 时间戳(秒)，转换: `datetime.fromtimestamp(int(ctime))`

---

## 3. Baostock 证券宝

### 3.1 日K线数据（含成交额/换手率）

**基本信息**
- 库: `baostock` (pip 安装)
- 登录: `bs.login()` — 全局幂等登录，只需一次
- 登出: `bs.logout()` — 采集完成后调用
- 来源文件: `data/collector.py:198-260`, `cli/fetch.py:204-254`, `factors/fundamental.py`

**调用接口**
```python
bs.login()
rs = bs.query_history_k_data_plus(
    code,                          # 格式: sh.600001 或 sz.000001
    "date,open,high,low,close,volume,amount,turn,pctChg",
    start_date="2024-01-01",      # 格式: YYYY-MM-DD
    end_date="2024-02-01",
    frequency="d",                 # 日线
    adjustflag="2"                 # 2=前复权
)
# 迭代结果
while rs.next():
    row = rs.get_row_data()
```

**返回字段顺序**
```
date, open, high, low, close, volume, amount, turn, pctChg
```

**代码转换规则**
```
6xxxxx, 9xxxxx → sh.{code}
其他 → sz.{code}
```

**使用场景**: 
- **补充模式**: 新浪K线成功后，额外调用 Baostock 补充 `成交额` 和 `换手率` 两列，通过日期列 merge
- **Fallback 模式**: 新浪K线失败时，Baostock 作为主数据源兜底

### 3.2 基本面数据

**调用接口**
```python
rs = bs.query_stock_basic(code="sh.600001")
# 返回: code, code_name, ipoDate, outDate, type, status

# 行业分类
rs = bs.query_stock_industry()
# 返回: code, code_name, industry, updateDate

# 季频估值
rs = bs.query_history_k_data_plus(code, "peTTM,pbMRQ,psTTM,pcfNcfTTM",
    start_date=..., end_date=..., frequency="d", adjustflag="2")
```

来源文件: `factors/fundamental.py`

**回报字段含义**:
| 字段 | 含义 |
|------|------|
| peTTM | 滚动市盈率 |
| pbMRQ | 市净率 |
| psTTM | 滚动市销率 |
| pcfNcfTTM | 滚动市现率 |

---

## 4. 同花顺 API (10jqka)

> **反爬处理**: 使用 `curl_cffi` 模拟 Chrome120 TLS 指纹 (`impersonate="chrome120"`)
> 基础UA: `Mozilla/5.0 ... Chrome/150.0.0.0 Safari/537.36`
> 默认Referer: `https://q.10jqka.com.cn/`

来源文件: `data/ths.py`

### 4.1 概念板块列表

**基本信息**
- URL: `https://q.10jqka.com.cn/gn/`
- 方法: GET
- 说明: 概念板块首页，包含隐藏字段 `#gnSection`

**解析方式**
```python
pattern = re.search(r'id="gnSection"[^>]*value=\'([^\']*)\'', r.text)
data = json.loads(unescape(pattern.group(1)))
```

**隐藏字段 JSON 结构**
```json
{
  "300188": {
    "cid": 300188,
    "platecode": "BK0999",
    "platename": "人工智能",
    "199112": 3.45
  }
}
```

**提取字段**
| 字段 | 含义 |
|------|------|
| `cid` | 同花顺概念ID (用于后续K线/成分股查询) |
| `platecode` | 板块代码 (如 BK0999) |
| `platename` | 概念名称 |
| `199112` | 当日涨跌幅(%) |

**返回**: 按涨跌幅降序排序，取前 N 个（默认60）

### 4.2 概念板块日K线

**基本信息**
- URL: `https://d.10jqka.com.cn/v4/line/bk_{platecode}/01/last.js`
- 方法: GET
- 格式: JSONP (需要正则去壳)

**调用流程**
1. 先通过 `_get_board_map()` 获取 cid→platecode 映射（带缓存）
2. 拼接 URL: `https://d.10jqka.com.cn/v4/line/bk_BK0999/01/last.js`
3. 正则提取 JSON: `\((.*)\)`
4. 解析 klines 字符串

**返回 JSON 结构**
```json
{
  "data": "20240801,10.50,11.20,10.30,10.80,12345678,133000000;20240731,..."
}
```

**K线解析** (分号分隔，每行逗号分隔)
```
date, open, high, low, close, volume, amount
```
7个字段，取前7个:
```python
parts = line.split(",")
if len(parts) >= 7:
    date   = parts[0]  # YYYYMMDD
    open   = float(parts[1])
    high   = float(parts[2])
    low    = float(parts[3])
    close  = float(parts[4])
    volume = float(parts[5])
    amount = float(parts[6])
```

### 4.3 概念板块成分股

**基本信息**
- URL: `http://q.10jqka.com.cn/gn/detail/order/desc/page/1/size/200/code/{cid}/`
- 方法: GET
- 格式: HTML页面，正则提取

**解析方式**
```python
pattern = re.findall(
    r"<td[^>]*>\s*<a[^>]*>\s*(\d{6})\s*</a>\s*</td>",
    r.text
)
# 过滤: 只保留 0/3/6 开头的6位代码
```

**返回**: 6位股票代码的 Set

### 4.4 请求速率控制

同花顺 API 的速率限制参数 (`data/ths.py`):
```python
_MIN_REQUEST_INTERVAL = 0.5  # 两次请求至少间隔 0.5 秒
_COOLDOWN_AFTER_FAILURE = 3.0  # 连接失败后冷却 3 秒
_MAX_RETRIES = 3  # 最多重试 3 次
```

重试策略: 指数退避 `time.sleep(2 ** attempt)`

---

## 5. 东方财富 API

来源文件: `data/eastmoney.py`, `data/news.py`, `cli/fetch.py:447-490`

### 5.1 概念板块日K线（备用）

**基本信息**
- URL: `https://push2his.eastmoney.com/api/qt/stock/kline/get`
- 方法: GET
- 说明: 当同花顺K线数据不足时作为备选

**请求参数**
| 参数 | 值 | 说明 |
|------|-----|------|
| `secid` | `90.BK0999` | 板块代码，BK开头 |
| `fields1` | `f1,f2,f3,f4,f5,f6` | 基础字段 |
| `fields2` | `f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` | K线字段 |
| `klt` | `101` | 日线 |
| `fqt` | `1` | 前复权 |
| `end` | `20500101` | 截止日期(未来) |
| `lmt` | `30` | 返回条数 |

**返回格式**
```json
{
  "data": {
    "klines": [
      "2024-01-15,10.50,11.20,10.30,10.80,123456,133000000,1.50,3.45",
      ...
    ]
  }
}
```

**K线解析索引**
- parts[0]: 日期
- parts[1]: 开盘
- parts[2]: 收盘
- parts[3]: 最高
- parts[4]: 最低
- parts[5]: 成交量
- parts[6]: 成交额
- parts[8]: 涨跌幅

### 5.2 板块代码搜索

**基本信息**
- URL: `https://searchapi.eastmoney.com/api/suggest/get`
- 方法: GET
- 说明: 按概念名称搜索东方财富 BK 代码

**请求参数**
| 参数 | 值 | 说明 |
|------|-----|------|
| `input` | `人工智能` | 搜索关键词 |
| `type` | `14` | 搜索类型(概念板块) |
| `token` | `D43BF722C8E33BDC906FB84D85E329E8` | 固定token |
| `count` | `5` | 返回条数 |

**搜索策略**: 先搜原名 → 如果无结果且名称以"概念"结尾，去掉"概念"再搜
```python
candidates = [name]
if name.endswith('概念'):
    candidates.append(name[:-2])
```

**返回 JSON 解析**
```python
data = resp.json().get('QuotationCodeTable', {}).get('Data', []) or []
for d in data:
    if str(d.get('MktNum')) == '90' and d.get('Code'):
        return d['Code']  # 如 BK0999
```
搜索结果带全局缓存 (`_EM_SEARCH_CACHE`)，线程安全。

### 5.3 财经新闻搜索

**基本信息**
- URL: `https://search-api-web.eastmoney.com/search/jsonp`
- 方法: GET
- 来源文件: `data/news.py`

**请求参数** (JSON序列化后 URL encode)
```json
{
  "uid": "",
  "keyword": "A股",
  "type": ["cmsArticleWebOld"],
  "client": "web",
  "clientType": "web",
  "clientVersion": "curr",
  "param": {
    "cmsArticleWebOld": {
      "searchScope": "default",
      "sort": "default",
      "pageIndex": 1,
      "pageSize": 50,
      "preTag": "",
      "postTag": ""
    }
  }
}
```
实际 URL: `{_SEARCH_API}?cb=&param={urlencode(json)}`

**搜索关键词**: `["A股", "财经"]`

**返回 JSON 解析**
```python
data = resp.json()
if data.get("code") != 0:
    return []
items = data.get("result", {}).get("cmsArticleWebOld", [])
for item in items:
    id    = item.get("code", "")
    title = item.get("title", "")
    summary = item.get("content", "")
    source  = item.get("mediaName", "")
    url     = item.get("url", "")
    published_at = item.get("date", "")
```

**缓存策略**: 30分钟 TTL，内存缓存
```python
_cache: dict = {}
_CACHE_TTL = timedelta(minutes=30)
```

### 5.4 东方财富请求基础设施

**速率控制** (`data/eastmoney.py`):
```python
_MIN_REQUEST_INTERVAL = 4.0   # 比同花顺更保守
_COOLDOWN_AFTER_FAILURE = 8.0 # 失败冷却更久
```

**重试策略**: 指数退避 + 随机抖动
```python
delay = (2 ** attempt) + random.uniform(0.5, 2.0)
```

特殊错误处理: 检测 `remote`/`connection`/`reset` 关键词 → 额外冷却 8 秒

---

## 6. 巨潮资讯 API

来源文件: `analysis/news.py:274-344`

### 6.1 个股公告查询

**基本信息**
- URL: `http://www.cninfo.com.cn/new/hisAnnouncement/query`
- 方法: POST
- Content-Type: `application/x-www-form-urlencoded`
- 说明: 证监会指定信息披露平台，权威性最高

**请求参数** (form data)
| 参数 | 值 | 说明 |
|------|-----|------|
| `pageNum` | `1` | 页码 |
| `pageSize` | `20` | 每页条数 |
| `column` | `sh` / `sz` | 市场 |
| `tabName` | `fulltext` | 全文搜索 |
| `plate` | `sh` / `sz` | 板块 |
| `stock` | `600001,gssh0600001` | 代码和orgId |
| `searchkey` | `` | 空 |
| `secid` | `` | 空 |
| `category` | `` | 空 |
| `trade` | `` | 空 |
| `seDate` | `2024-01-01~2024-02-01` | 日期范围 |

**市场判断规则**
```python
def _get_stock_market(code):
    if code.startswith('6'):
        return 'sh', f'gssh0{code}', 'sh'
    elif code.startswith(('0', '3')):
        return 'sz', f'gssz0{code}', 'sz'
    else:
        return 'sh', f'gssh0{code}', 'sh'
```

**返回 JSON 结构**
```json
{
  "announcements": [
    {
      "announcementId": "1234567890",
      "announcementTitle": "关于XXX的公告",
      "announcementTime": 1705305000000,
      "announcementContent": "...",
      "adjunctUrl": "...",
      "announcementTypeName": "临时公告"
    }
  ]
}
```

**关键字段**
| 字段 | 含义 | 说明 |
|------|------|------|
| `announcementTime` | 毫秒时间戳 | 除以1000后转换日期 |
| `announcementId` | 公告ID | 拼接详情URL: `http://www.cninfo.com.cn/new/disclosure/detail?announcementId={id}` |
| `adjunctUrl` | PDF附件地址 | 原始公告PDF |

---

## 7. yfinance 雅虎财经

来源文件: `data/international.py`, `cli/fetch.py:725-827`

### 7.1 美股数据

**调用方式**
```python
import yfinance as yf

# 单只股票
ticker = yf.download('AAPL', period='3mo', progress=False)

# 批量下载（推荐，速度快）
data = yf.download(['AAPL', 'MSFT', 'GOOGL', ...], period='3mo', 
                   progress=False, group_by='ticker')
```

**下载参数**
| 参数 | 值 | 说明 |
|------|-----|------|
| `period` | `3mo` | 最近3个月 |
| `progress` | `False` | 关闭进度条(非交互模式) |
| `group_by` | `ticker` | 批量下载时按ticker分组 |

**指数代码**
| 代码 | 说明 |
|------|------|
| `^IXIC` | 纳斯达克综合指数 |
| `^KS11` | 韩国 KOSPI 指数 |

**返回 DataFrame 列**: `Date, Open, High, Low, Close, Volume, Dividends, Stock Splits`

**转换为统一格式**:
```python
df = df.rename(columns={
    'Date': '日期', 'Open': '开盘', 'High': '最高',
    'Low': '最低', 'Close': '收盘', 'Volume': '成交量'
})
# 计算: 涨跌额, 涨跌幅, 成交额(估算), 换手率(默认0)
```

**韩国个股**
```python
kr_stocks = {
    '005930.KS': '三星电子',
    '000660.KS': 'SK海力士'
}
```

**美股列表** (来自 `config.json` 的 `data_fetch.us_nasdaq_top50.symbols`)
```json
{
  "AAPL": "Apple Inc.",
  "MSFT": "Microsoft Corporation",
  ...
}
```

### 7.2 文件存储

美股和韩股分别存储到:
- 指数: `data/index_us/{symbol}.csv`, `data/index_kr/{symbol}.csv`
- 个股: `data/stock_us/{symbol}.csv`, `data/stock_kr/{symbol}.csv`
- 韩股代码中的 `.` 替换为 `_` (如 005930.KS → 005930_KS.csv)

---

## 8. OpenAI API

来源文件: `analysis/ai.py`

### 8.1 配置

```python
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
)
```
- 支持自定义 `base_url`（可接入各种兼容 API）
- 无 API key 时自动降级为离线模式

### 8.2 调用方式

```python
response = client.chat.completions.create(
    model=os.getenv("OPENAI_MODEL", "gpt-3.5-turbo"),
    messages=[
        {
            "role": "system",
            "content": "你是一个专业的量化选股分析师，擅长动量趋势、回调买点、风控策略、板块轮动和新闻事件驱动分析。"
        },
        {"role": "user", "content": prompt}
    ],
)
return response.choices[0].message.content
```

### 8.3 Prompt 结构

用户消息包含以下模块（由 `_build_prompt()` 组装）:

1. **角色设定**: "资深的A股短线游资打板和波段交易专家"
2. **信号类型**: 7种策略类型之一（龙头分歧转一致/首板/弱转强/超短线突破/动量回调/动量趋势/基础）
3. **基本信息**: 股票名称、代码、所属板块/概念
4. **近期交易数据**: 最近7个交易日的OHLCV(从 hist_data_summary)
5. **板块趋势背景**: 由 `analysis/sector.py` 分析生成
6. **动量指标快照**: RSI, MACD, 均线 (按信号类型差异化)
7. **风控参数**: ATR, 止损/止盈, 仓位建议
8. **新闻/公告摘要**: 来自 `analysis/news.py` 的分析结果

### 8.4 降级策略

当 `OPENAI_API_KEY` 不存在或调用失败时 → `_offline_mock_report()`:
- 按信号类型给固定基础分
- 按RSI/盈亏比微调分数
- 生成标准化模板报告

### 8.5 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENAI_API_KEY` | - | API密钥(为空则离线模式) |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API端点 |
| `OPENAI_MODEL` | `gpt-3.5-turbo` | 模型名称 |

---

## 9. 飞书开放平台 API

来源文件: `notify/feishu.py`

### 9.1 获取 Tenant Access Token

**基本信息**
- URL: `https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`
- 方法: POST
- Content-Type: JSON

**请求体**
```json
{
  "app_id": "cli_xxxxx",
  "app_secret": "xxxxx"
}
```

**响应**
```json
{
  "code": 0,
  "tenant_access_token": "t-xxxxx",
  "expire": 7200
}
```

**缓存策略**
```python
_token_cache = {"token": None, "expires_at": 0.0}
# Token 过期前 60 秒提前刷新
if token and now < expires_at - 60:
    return token
```

### 9.2 发送消息

**基本信息**
- URL: `https://open.feishu.cn/open-apis/im/v1/messages`
- 方法: POST
- Query: `receive_id_type=chat_id`
- Header: `Authorization: Bearer {token}`

**请求体**
```json
{
  "receive_id": "oc_xxxxx",
  "msg_type": "interactive",
  "content": "{\"config\":{\"wide_screen_mode\":true},...}"
}
```

**消息类型**: `interactive` (飞书卡片消息) 或 `text` (纯文本，当卡片超过 28KB 时降级)

**错误码处理**
| 错误码 | 含义 | 处理 |
|--------|------|------|
| `0` | 成功 | - |
| `99991663` | Token 失效 | 强制刷新 token 后重试 |
| `99991400` | 限流 | 等待 3 秒后重试 |

**重试策略**: 最多 3 次，指数退避 `time.sleep(2 ** attempt)`

### 9.3 环境变量

| 变量 | 说明 |
|------|------|
| `FEISHU_APP_ID` | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret |
| `FEISHU_RECEIVE_ID_TYPE` | 接收者类型(默认 chat_id) |
| `FEISHU_RECEIVE_ID` | 接收者ID(群聊 chat_id) |

---

## 10. 自身对外 API (FastAPI)

来源文件: `api/__init__.py`, `api/server.py`

### 10.1 服务信息

- 框架: FastAPI + uvicorn
- 默认端口: `8000`
- 默认绑定: `0.0.0.0`
- CORS: 允许所有来源

### 10.2 路由表

| 前缀 | 路由模块 | 功能 |
|------|----------|------|
| `/health` | health_router | 健康检查 |
| `/api/v1/scan` | scan_router | 选股扫描 |
| `/api/v1/stock` | stock_router | 个股查询 |
| `/api/v1/data` | data_router | 数据查询 |
| `/api/v1/news` | news_router | 新闻查询 |
| `/api/v1/sector` | sector_router | 板块趋势 |
| `/api/v1/backtest` | backtest_router | 回测 |
| `/api/v1/market` | market_router | 市场概况 |
| `/api/v1/factor` | factor_router | 因子数据 |
| `/api/v1/settings` | settings_router | 配置管理 |
| `/api/v1/scheduler` | scheduler_router | 调度器控制 |
| `/logs` | logs_router | 日志查询 |

### 10.3 调度器集成

FastAPI 启动/关闭时自动管理 APScheduler:
```python
@app.on_event("startup")
async def startup_event():
    scheduler = get_scheduler()
    scheduler.start()

@app.on_event("shutdown")
async def shutdown_event():
    scheduler.stop()
```

### 10.4 调度器任务

| 任务 | Cron | 说明 |
|------|------|------|
| `fetch_data` | 工作日 15:30 | 执行 `stock-fetch` 数据采集 |
| `run_scan` | 工作日 16:00 | 执行 `stock-run` 选股扫描 |

---

## 11. 错误处理与重试机制

### 11.1 通用重试基础设施 (`data/collector.py::_retry_fetch`)

```python
def _retry_fetch(fn, *args, max_retries=3, backoff_sec=[1, 2, 4], **kwargs):
    for attempt in range(effective_retries + 1):
        try:
            result = fn(*args, **kwargs)
            if result is not None and not (isinstance(result, pd.DataFrame) and result.empty):
                return result
            raise ValueError('返回空数据')
        except Exception as e:
            if attempt < effective_retries:
                time.sleep(backoff_sec[attempt])
```

特性:
- 空 DataFrame 视为失败
- 指数退避: 1s → 2s → 4s
- 超过重试次数后返回 None

### 11.2 网络检测 (`data/collector.py::_check_network`)

```python
requests.get('https://money.finance.sina.com.cn', timeout=5)
# 状态码 < 500 视为网络正常
```
在实时拉取数据前调用，网络不可用时直接跳过（降级到本地缓存）。

### 11.3 各数据源速率控制对比

| 数据源 | 最小间隔 | 失败冷却 | 最多重试 | 并发支持 |
|--------|---------|---------|---------|---------|
| 新浪财经(collector) | 1s | 1/2/4s 退避 | 3 | 数据采集3线程 |
| 同花顺 | 0.5s | 3s | 3 | 概念K线4线程, 成分股4线程 |
| 东方财富(K线) | 4s | 8s | 5 | 单线程 |
| 东方财富(新闻) | 0.5s | - | 1 | 单线程 |
| 巨潮资讯 | - | - | 1 | 单线程 |
| 飞书 | - | 1/2/4s | 3 | 单线程 |
| yfinance | - | - | 1 | 批量下载 |

### 11.4 离线/缓存降级策略

| 场景 | 降级策略 |
|------|----------|
| 网络不通 | 跳过网络请求，使用本地 CSV 缓存 |
| `offline_mode=true` | 仅读取本地缓存，不发起网络请求 |
| 新浪 K 线失败 | 尝试 Baostock 兜底 |
| 同花顺 K 线 <10行 | 搜索东方财富 BK 代码 → 拉东方财富 K 线 |
| 新闻 API 无结果 | 尝试多个新闻源 fallback |
| OpenAI 无 key/调用失败 | `_offline_mock_report()` 模板报告 |
| 本地缓存过期 | 同花顺K线>6h, 成分股>24h, 基本面>6h 重新拉取 |
| 飞书 token 过期 | 强制刷新 token 重试 |

---

## 12. 配置依赖

### 12.1 config.json 结构

来源文件: `config.py`

```json
{
  "data_fetch": {
    "history_days": 60,
    "max_workers": 3,
    "max_workers_concept": 4,
    "max_workers_fundamental": 3,
    "max_retries": 3,
    "retry_backoff": [1, 2, 4],
    "offline_mode": false,
    "paths": {
      "stock": "data/stock",
      "stock_main": "data/stock/main",
      "stock_chinext": "data/stock/chinext",
      "stock_star": "data/stock/star",
      "index": "data/index",
      "board": "data/board",
      "info": "data/stock_info.csv"
    },
    "kr_stocks": {
      "symbols": {
        "005930.KS": "三星电子",
        "000660.KS": "SK海力士"
      }
    },
    "us_nasdaq_top50": {
      "symbols": {
        "AAPL": "Apple Inc.",
        "MSFT": "Microsoft"
      }
    }
  },
  "strategy": {},
  "momentum": {},
  "ultra_short": {},
  "dragon": {},
  "risk": {
    "atr_window": 14,
    "stop_loss_multiplier": 2.0,
    "take_profit_multiplier": 4.0,
    "min_reward_risk_ratio": 2.0,
    "max_risk_per_trade": 0.01,
    "total_capital": 100000
  },
  "ai_analysis": {
    "enabled": true
  },
  "sector_trend": {
    "top_n": 15,
    "min_score": 50,
    "max_fetch_boards": 60,
    "history_days": 20,
    "score_weights": {
      "return_5d": 0.40,
      "ma_trend": 0.30,
      "volume_trend": 0.15,
      "consecutive_up": 0.15
    }
  },
  "news": {},
  "factors": {},
  "notify": {},
  "output": {}
}
```

### 12.2 环境变量 (.env)

```env
# OpenAI (可选)
OPENAI_API_KEY=sk-xxxxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-3.5-turbo

# 飞书通知 (必填)
FEISHU_APP_ID=cli_xxxxx
FEISHU_APP_SECRET=xxxxx
FEISHU_RECEIVE_ID_TYPE=chat_id
FEISHU_RECEIVE_ID=oc_xxxxx
```

### 12.3 Python 依赖 (重要第三方包)

```
requests          # HTTP 请求基础库
curl_cffi         # TLS指纹模拟(同花顺反爬)
pandas            # 数据处理
baostock          # A股数据(证券宝)
yfinance          # 美股/韩股数据
openai            # AI分析
fastapi + uvicorn # API服务
apscheduler       # 定时调度
```

---

## 附录A: 数据流完整时序

```
启动 → FastAPI start → APScheduler start

(每个交易日)
15:30 ──> fetch_data
  │
  ├─ 1. fetch_index_data()         → 新浪 K线 API (4个指数)
  ├─ 2. fetch_stock_info()         → 新浪 股票列表 API (沪深A股全量)
  ├─ 3. fetch_and_save_board_data()
  │     ├─ 新浪 行业分类 API
  │     └─ (概念映射使用已有缓存)
  ├─ 4. fetch_concept_board_list() → 同花顺 板块列表
  ├─ 5. fetch_concept_board_kline()→ 同花顺 K线(主) → 东方财富 K线(备)
  ├─ 6. fetch_concept_stocks_data()→ 同花顺 成分股 HTML
  ├─ 7. build_stock_concept_csv()  → 本地文件: stock→concepts 反向映射
  ├─ 8. fetch_fundamental_cache()  → 新浪 实时行情 API (500只, 50只/批×3并发)
  ├─ 9. fetch_all_stocks_hist()    → 新浪 K线(主) → Baostock 补充成交额/换手率
  ├─10. fetch_intl_kr()            → yfinance KOSPI + 三星/SK海力士
  └─11. fetch_intl_us()            → yfinance NASDAQ + 科技前50

16:00 ──> run_scan
  │
  ├─ 板块趋势分析 (从本地缓存读取)
  │     └─ 评分: 5日涨跌幅(40%) + 均线趋势(30%) + 量能(15%) + 连涨(15%)
  ├─ 新闻/公告采集 (每只候选股)
  │     ├─ 新浪 个股新闻 v2 → v1 fallback → feed fallback
  │     ├─ 巨潮资讯 公告
  │     └─ 情感分析: 正面/负面关键词计数 → 评分 -1~1
  ├─ 技术指标计算 (本地计算: RSI/MACD/MA/ATR)
  ├─ 风控评估 (ATR止损止盈+仓位计算)
  ├─ AI分析 (OpenAI, 降级离线模板)
  └─ 飞书通知 (卡片消息推送)
```

---

## 附录B: 重构注意事项

1. **TLS 指纹**: 同花顺 API 需要 TLS 指纹模拟，`curl_cffi` 模拟 Chrome120。Java 中可考虑使用浏览器驱动或支持自定义 TLS 指纹的 HTTP 客户端。

2. **编码问题**: 
   - 新浪行业API: gbk
   - 新浪个股新闻: gb2312
   - 新浪实时行情: gbk
   - 巨潮资讯: utf-8
   - 其他: utf-8
   - Java 重构时必须正确处理多编码。

3. **JSONP 解析**: 同花顺K线返回的是 JSONP (`callback({...})`), 新浪feed也是JSONP，需要正则去壳。

4. **并发控制**: 各数据源有不同的速率限制，需要独立实现令牌桶/漏桶限流。

5. **增量数据**: 个股K线采用增量写入策略，对比本地最后日期只拉取新数据，重构时需保留此逻辑。

6. **双源融合**: 新浪(速度快) + Baostock(数据全) 的组合模式需要合并策略（按日期merge）。

7. **新闻情感分析**: 当前是基于中文关键词词典的简单判定，正面词约40个、负面词约30个，公告负面权重×1.5。如果要改进可接入 NLP 模型。
