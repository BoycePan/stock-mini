# 股御信息 — 股票行情 API 文档

> 服务地址: `http://localhost:8080/api/v1`
> 数据源: 新浪财经 / 同花顺 / 巨潮资讯
> 更新时间: 2026-08-05

---

## 通用说明

### 响应格式

```json
{"code": 200, "msg": "success", "data": {...}}
```

`code` 字段使用 HTTP 状态码语义：200=成功, 400=参数错误, 500=服务端错误。HTTP 响应状态码固定 200。

### 错误码

| code | 说明 |
|------|------|
| 200  | 成功 |
| 400  | 参数错误 |
| 500  | 服务端错误 |
| 1001 | Token 无效 |
| 1002 | 缺少 Token |
| 1003 | 微信登录失败 |

### 缓存策略

| 数据类型 | 缓存位置 | TTL |
|----------|----------|-----|
| 分钟K线 | 内存 | 30-180s |
| 日线/周线 | PostgreSQL | 永久 |
| 实时行情 | 内存 | 3s |
| 板块K线 | 内存 | 60s |
| 个股新闻 | 内存 | 60s |
| 通用新闻 | 内存 | 30s |
| 公告 | 内存 | 5min |
| 股票搜索 | PostgreSQL | — |
| 板块列表 | PostgreSQL | — |
| 成分股 | PostgreSQL | — |

---

## 一、股票行情

### 1.1 股票搜索

```
GET /api/v1/stock/search?q={关键词}&limit={条数}
```

按代码或名称前缀搜索，优先级：代码精确匹配 > 名称前缀 > 代码前缀 > 名称包含。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词 |
| limit | int | 否 | 返回条数，默认20，最大100 |

**示例响应：**

```json
{
  "count": 1,
  "keyword": "茅台",
  "stocks": [
    {
      "code": "600519",
      "name": "贵州茅台",
      "type": "stock",
      "market": "sh",
      "board": "main",
      "industry": "",
      "is_active": true
    }
  ]
}
```

---

### 1.2 实时行情

```
GET /api/v1/stock/:code/quote
```

获取单只股票最新行情快照（3秒缓存）。

**示例：** `GET /api/v1/stock/000001/quote`

```json
{
  "code": "000001",
  "name": "平安银行",
  "open": 11.41,
  "prev_close": 11.44,
  "price": 11.25,
  "high": 11.5,
  "low": 11.18,
  "volume": 151150993,
  "amount": 1703942517.43,
  "date": "2026-08-05",
  "time": "16:30:00",
  "turnover": 0,
  "pct_change": -1.6608391608391566
}
```

| 字段 | 说明 |
|------|------|
| code | 6位股票代码 |
| name | 股票名称 |
| open | 今开 |
| prev_close | 昨收 |
| price | 当前价 |
| high | 今日最高 |
| low | 今日最低 |
| volume | 成交量(股) |
| amount | 成交额(元) |
| pct_change | 涨跌幅(%) |

---

### 1.3 批量行情

```
GET /api/v1/stock/quotes?codes={code1,code2,...}
```

一次最多 50 只（3秒缓存，key为排序后的codes）。

**示例：** `GET /api/v1/stock/quotes?codes=000001,600519,000858`

```json
[
  {
    "code": "000001",
    "name": "平安银行",
    "open": 11.41,
    "prev_close": 11.44,
    "price": 11.25,
    "high": 11.5,
    "low": 11.18,
    "volume": 151150993,
    "amount": 1703942517.43,
    "date": "2026-08-05",
    "time": "16:30:00",
    "turnover": 0,
    "pct_change": -1.6608391608391566
  },
  {
    "code": "600519",
    "name": "贵州茅台",
    "open": 1328.36,
    "prev_close": 1328.36,
    "price": 1306.45,
    "high": 1333.8,
    "low": 1303.5,
    "volume": 4268859,
    "amount": 5600615349,
    "date": "2026-08-05",
    "time": "15:34:59",
    "turnover": 0,
    "pct_change": -1.649402270468838
  }
]
// ... 共 3 只
```

---

### 1.4 K线数据

```
GET /api/v1/stock/:code/klines?scale={周期}&count={条数}
```

| scale | 周期 | 存储方式 |
|-------|------|----------|
| 5/15/30/60 | 分钟线 | 内存缓存，不落库 |
| 240 | 日线 | 查库优先，不命中调新浪 |
| 1200 | 周线 | 查库优先，不命中调新浪 |

**示例：** `GET /api/v1/stock/000001/klines?scale=240&count=2`

```json
{
  "code": "000001",
  "scale": "240",
  "klines": [
    {
      "time": "2026-08-04",
      "open": 11.58,
      "high": 11.62,
      "low": 11.42,
      "close": 11.44,
      "volume": 122112984
    },
    {
      "time": "2026-08-05",
      "open": 11.41,
      "high": 11.5,
      "low": 11.18,
      "close": 11.25,
      "volume": 151150993
    }
  ],
  "count": 2
}
```

---

## 二、概念板块

### 2.1 板块列表

```
GET /api/v1/sector/boards?top={数量}
```

返回热门概念板块，从数据库读取（定时任务 9:05 刷新）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| top | int | 否 | 返回条数，默认20，最大100 |

**示例：**

```json
[
  {
    "plate_code": "885343",
    "plate_name": "稀土永磁",
    "cid": 300382
  },
  {
    "plate_code": "885355",
    "plate_name": "石墨烯",
    "cid": 300337
  },
  {
    "plate_code": "885376",
    "plate_name": "苹果概念",
    "cid": 300309
  },
  {
    "plate_code": "885423",
    "plate_name": "安防",
    "cid": 300800
  },
  {
    "plate_code": "885425",
    "plate_name": "特高压",
    "cid": 300353
  },
  {
    "plate_code": "885530",
    "plate_name": "黄金概念",
    "cid": 300248
  },
  {
    "plate_code": "885537",
    "plate_name": "3D打印",
    "cid": 300127
  },
  {
    "plate_code": "885551",
    "plate_name": "氟化工概念",
    "cid": 300085
  },
  {
    "plate_code": "885552",
    "plate_name": "小金属概念",
    "cid": 300809
  },
  {
    "plate_code": "885555",
    "plate_name": "PM2.5",
    "cid": 300134
  },
  {
    "plate_code": "885598",
    "plate_name": "新股与次新股",
    "cid": 300870
  },
  {
    "plate_code": "885650",
    "plate_name": "碳纤维",
    "cid": 300352
  },
  {
    "plate_code": "885652",
    "plate_name": "钛白粉概念",
    "cid": 300351
  },
  {
    "plate_code": "885734",
    "plate_name": "广东自贸区",
    "cid": 301630
  },
  {
    "plate_code": "885738",
    "plate_name": "OLED",
    "cid": 301154
  },
  {
    "plate_code": "885759",
    "plate_name": "人脸识别",
    "cid": 301166
  },
  {
    "plate_code": "885771",
    "plate_name": "智能音箱",
    "cid": 302131
  },
  {
    "plate_code": "885774",
    "plate_name": "无线充电",
    "cid": 300723
  },
  {
    "plate_code": "885786",
    "plate_name": "富士康概念",
    "cid": 307954
  },
  {
    "plate_code": "885809",
    "plate_name": "柔性屏(折叠屏)",
    "cid": 308467
  },
  {
    "plate_code": "885843",
    "plate_name": "华为海思概念股",
    "cid": 308527
  },
  {
    "plate_code": "885863",
    "plate_name": "磷化工",
    "cid": 300098
  },
  {
    "plate_code": "885864",
    "plate_name": "光刻胶",
    "cid": 308582
  },
  {
    "plate_code": "885865",
    "plate_name": "金属钴",
    "cid": 302174
  },
  {
    "plate_code": "885868",
    "plate_name": "无线耳机",
    "cid": 308612
  },
  {
    "plate_code": "885875",
    "plate_name": "MiniLED",
    "cid": 308628
  },
  {
    "plate_code": "885878",
    "plate_name": "HJT电池",
    "cid": 308632
  },
  {
    "plate_code": "885881",
    "plate_name": "云办公",
    "cid": 308634
  },
  {
    "plate_code": "885884",
    "plate_name": "航空发动机",
    "cid": 301470
  },
  {
    "plate_code": "885886",
    "plate_name": "超级电容",
    "cid": 300926
  },
  {
    "plate_code": "885893",
    "plate_name": "国家大基金持股",
    "cid": 307816
  },
  {
    "plate_code": "885897",
    "plate_name": "中芯国际概念",
    "cid": 308690
  },
  {
    "plate_code": "885899",
    "plate_name": "新型烟草(电子烟)",
    "cid": 301362
  },
  {
    "plate_code": "885905",
    "plate_name": "注册制次新股",
    "cid": 308697
  },
  {
    "plate_code": "885907",
    "plate_name": "科创次新股",
    "cid": 308699
  },
  {
    "plate_code": "885908",
    "plate_name": "第三代半导体",
    "cid": 308700
  },
  {
    "plate_code": "885912",
    "plate_name": "有机硅概念",
    "cid": 301279
  },
  {
    "plate_code": "885925",
    "plate_name": "MCU芯片",
    "cid": 308300
  },
  {
    "plate_code": "885926",
    "plate_name": "牙科医疗",
    "cid": 308733
  },
  {
    "plate_code": "885928",
    "plate_name": "钠离子电池",
    "cid": 301096
  },
  {
    "plate_code": "885930",
    "plate_name": "工业母机",
    "cid": 300941
  },
  {
    "plate_code": "885931",
    "plate_name": "PVDF概念",
    "cid": 308742
  },
  {
    "plate_code": "885937",
    "plate_name": "培育钻石",
    "cid": 308774
  },
  {
    "plate_code": "885940",
    "plate_name": "WiFi 6",
    "cid": 308791
  },
  {
    "plate_code": "885943",
    "plate_name": "EDR概念",
    "cid": 308803
  },
  {
    "plate_code": "885945",
    "plate_name": "汽车芯片",
    "cid": 308725
  },
  {
    "plate_code": "885953",
    "plate_name": "电子纸",
    "cid": 301135
  },
  {
    "plate_code": "885958",
    "plate_name": "硅能源",
    "cid": 308829
  },
  {
    "plate_code": "885969",
    "plate_name": "金属镍",
    "cid": 301511
  },
  {
    "plate_code": "885970",
    "plate_name": "金属锌",
    "cid": 301582
  },
  {
    "plate_code": "885971",
    "plate_name": "金属铅",
    "cid": 308864
  },
  {
    "plate_code": "885972",
    "plate_name": "金属回收",
    "cid": 301107
  },
  {
    "plate_code": "885973",
    "plate_name": "金属铜",
    "cid": 301577
  },
  {
    "plate_code": "885980",
    "plate_name": "华为鲲鹏",
    "cid": 308883
  },
  {
    "plate_code": "885982",
    "plate_name": "华为欧拉",
    "cid": 308887
  },
  {
    "plate_code": "885987",
    "plate_name": "MicroLED概念",
    "cid": 308896
  },
  {
    "plate_code": "885998",
    "plate_name": "F5G概念",
    "cid": 308977
  },
  {
    "plate_code": "885999",
    "plate_name": "汽车热管理",
    "cid": 308805
  },
  {
    "plate_code": "886000",
    "plate_name": "一体化压铸",
    "cid": 308984
  },
  {
    "plate_code": "886001",
    "plate_name": "高压快充",
    "cid": 308806
  },
  {
    "plate_code": "886006",
    "plate_name": "钙钛矿电池",
    "cid": 308991
  },
  {
    "plate_code": "886007",
    "plate_name": "TOPCON电池",
    "cid": 308992
  },
  {
    "plate_code": "886020",
    "plate_name": "PET铜箔",
    "cid": 309030
  },
  {
    "plate_code": "886035",
    "plate_name": "毫米波雷达",
    "cid": 309051
  },
  {
    "plate_code": "886037",
    "plate_name": "6G概念",
    "cid": 309055
  },
  {
    "plate_code": "886038",
    "plate_name": "超导概念",
    "cid": 309056
  },
  {
    "plate_code": "886039",
    "plate_name": "ERP概念",
    "cid": 309058
  },
  {
    "plate_code": "886042",
    "plate_name": "存储芯片",
    "cid": 307940
  },
  {
    "plate_code": "886043",
    "plate_name": "太赫兹",
    "cid": 300795
  },
  {
    "plate_code": "886046",
    "plate_name": "MR(混合现实)",
    "cid": 309063
  },
  {
    "plate_code": "886048",
    "plate_name": "英伟达概念",
    "cid": 309065
  },
  {
    "plate_code": "886049",
    "plate_name": "空间计算",
    "cid": 309066
  },
  {
    "plate_code": "886050",
    "plate_name": "算力租赁",
    "cid": 309068
  },
  {
    "plate_code": "886052",
    "plate_name": "核污染防治",
    "cid": 301424
  },
  {
    "plate_code": "886053",
    "plate_name": "BC电池",
    "cid": 309084
  },
  {
    "plate_code": "886054",
    "plate_name": "光刻机",
    "cid": 309085
  },
  {
    "plate_code": "886055",
    "plate_name": "星闪概念",
    "cid": 309086
  },
  {
    "plate_code": "886058",
    "plate_name": "华为昇腾",
    "cid": 309090
  },
  {
    "plate_code": "886059",
    "plate_name": "智能座舱",
    "cid": 309092
  },
  {
    "plate_code": "886063",
    "plate_name": "PEEK材料",
    "cid": 309105
  },
  {
    "plate_code": "886064",
    "plate_name": "小米汽车",
    "cid": 309106
  },
  {
    "plate_code": "886065",
    "plate_name": "可控核聚变",
    "cid": 309108
  },
  {
    "plate_code": "886066",
    "plate_name": "飞行汽车(eVTOL)",
    "cid": 309113
  },
  {
    "plate_code": "886070",
    "plate_name": "AI手机",
    "cid": 309120
  },
  {
    "plate_code": "886071",
    "plate_name": "AI PC",
    "cid": 309121
  },
  {
    "plate_code": "886073",
    "plate_name": "铜缆高速连接",
    "cid": 309125
  },
  {
    "plate_code": "886074",
    "plate_name": "AI语料",
    "cid": 309126
  },
  {
    "plate_code": "886075",
    "plate_name": "同花顺出海50",
    "cid": 309127
  },
  {
    "plate_code": "886080",
    "plate_name": "财税数字化",
    "cid": 309134
  },
  {
    "plate_code": "886082",
    "plate_name": "同花顺果指数",
    "cid": 309136
  },
  {
    "plate_code": "886084",
    "plate_name": "光纤概念",
    "cid": 309151
  },
  {
    "plate_code": "886085",
    "plate_name": "AI眼镜",
    "cid": 309152
  },
  {
    "plate_code": "886091",
    "plate_name": "华为手机",
    "cid": 309167
  },
  {
    "plate_code": "886093",
    "plate_name": "华为数字能源",
    "cid": 309169
  },
  {
    "plate_code": "886094",
    "plate_name": "华为盘古",
    "cid": 309170
  },
  {
    "plate_code": "886096",
    "plate_name": "同花顺新质50",
    "cid": 309177
  },
  {
    "plate_code": "886102",
    "plate_name": "中国AI 50",
    "cid": 309187
  },
  {
    "plate_code": "886109",
    "plate_name": "2026一季报预增",
    "cid": 309265
  },
  {
    "plate_code": "886111",
    "plate_name": "玻璃基板",
    "cid": 309268
  },
  {
    "plate_code": "886112",
    "plate_name": "MLCC概念",
    "cid": 309269
  }
]
```

---

### 2.2 板块K线

```
GET /api/v1/sector/board/:code/klines?count={条数}
```

板块代码从板块列表接口获取（60秒缓存）。

**示例：** `GET /api/v1/sector/board/885333/klines?count=2`

```json
{
  "code": "885333",
  "count": 2,
  "klines": [
    {
      "date": "2026-08-04",
      "open": 2176.445,
      "high": 2204.534,
      "low": 2168.937,
      "close": 2202.177,
      "volume": 1980188600,
      "amount": 33240435000
    },
    {
      "date": "2026-08-05",
      "open": 2197.652,
      "high": 2252.359,
      "low": 2197.652,
      "close": 2238.847,
      "volume": 2137047900,
      "amount": 37059443000
    }
  ]
}
```

---

### 2.3 板块成分股

```
GET /api/v1/sector/members/:cid
```

cid 从板块列表接口获取，返回该板块包含的股票代码列表。

**示例：** `GET /api/v1/sector/members/300188`

```json
{
  "cid": 300188,
  "count": 74,
  "stocks": [
    "300248",
    "002908",
    "002396",
    "002721",
    "301536",
    "002138",
    "300525",
    "301171",
    "300096",
    "300130"
  ]
}
// ... 共 74 只
```

---

## 三、新闻与公告

### 3.1 个股新闻

```
GET /api/v1/stock/:code/news?page={页码}
```

从新浪个股新闻页实时拉取（60秒缓存），同时异步存入 news_feed 表。

**示例：** `GET /api/v1/stock/600519/news`

```json
{
  "code": "600519",
  "count": 39,
  "news": [
    {
      "title": "逼近历史新高，分红超2300亿：这台“水电印钞机”到底有多猛？",
      "summary": "",
      "url": "https://finance.sina.com.cn/jjxw/2026-08-05/doc-inimhpnf4488068.shtml",
      "time": "2026-08-05 20:00",
      "source": "新浪"
    },
    {
      "title": "龙头企业连续提价，白酒行业企稳了吗",
      "summary": "",
      "url": "https://cj.sina.cn/articles/view/1699432410/654b47da02001ugqy",
      "time": "2026-08-05 18:18",
      "source": "新浪"
    },
    {
      "title": "【国金食饮刘宸倩】26Q2基金持仓分析：板块全面转向低配，白酒仓位大幅回落",
      "summary": "",
      "url": "https://finance.sina.com.cn/roll/2026-08-05/doc-inimhiei4550534.shtml",
      "time": "2026-08-05 17:43",
      "source": "新浪"
    }
  ]
}
// ... 共 39 条
```

---

### 3.2 通用财经新闻

```
GET /api/v1/news/feed?q={关键词}&count={条数}
```

默认关键词"A股"，30秒缓存，同时异步存入 news_feed。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 否 | 搜索关键词，默认"A股" |
| count | int | 否 | 返回条数，默认20，最大100 |

**示例：**

```json
{
  "keyword": "A股",
  "count": 2,
  "news": [
    {
      "title": "*ST萃华俩股东被立案调查",
      "summary": "来源：IPO日报 8月4日晚间，*ST萃华（002731.SZ）发布了多份公告。公告显示，公司控股股东、实际控制人陈思伟，持股5%以上股东的一致行动人郭英杰分别收到中国证监会下发的...",
      "url": "https://finance.sina.com.cn/stock/s/2026-08-05/doc-inimhpmz5100157.shtml",
      "time": "2026-08-05 21:00",
      "source": "市场资讯"
    },
    {
      "title": "美国拟禁止进口中国产新型光收发模块，外交部回应",
      "summary": "来源：财联社 财联社8月5日讯，据外交部网站，外交部发言人林剑今日答记者问。 路透社记者：据报道，美国正起草法规，禁止进口中国产新型光收发模块...",
      "url": "https://finance.sina.com.cn/china/2026-08-05/doc-inimhpmx3492343.shtml",
      "time": "2026-08-05 20:54",
      "source": "市场资讯"
    }
  ]
}
```

---

### 3.3 个股公告

```
GET /api/v1/stock/:code/announcements?page={页码}&size={条数}
```

来自巨潮资讯（证监会指定披露平台），5分钟缓存。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | int | 否 | 页码，默认1 |
| size | int | 否 | 每页条数，默认20，最大100 |

**示例：** `GET /api/v1/stock/600519/announcements?size=2`

```json
{
  "code": "600519",
  "count": 2,
  "items": [
    {
      "id": "1225431263",
      "title": "贵州茅台重大事项公告",
      "time": "2026-07-18",
      "url": "http://www.cninfo.com.cn/new/disclosure/detail?announcementId=1225431263",
      "pdf": "https://static.cninfo.com.cn/finalpage/2026-07-18/1225431263.PDF"
    },
    {
      "id": "1225379934",
      "title": "贵州茅台2025年年度权益分派实施公告",
      "time": "2026-06-22",
      "url": "http://www.cninfo.com.cn/new/disclosure/detail?announcementId=1225379934",
      "pdf": "https://static.cninfo.com.cn/finalpage/2026-06-22/1225379934.PDF"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| id | 公告ID |
| title | 公告标题 |
| time | 发布日期 |
| url | 公告详情页URL |
| pdf | PDF附件地址 |

---

## 四、认证

### 4.1 微信登录

```
POST /api/v1/auth/login
Content-Type: application/json
```

**请求体：**

```json
{"code": "微信小程序 wx.login() 返回的 code"}
```

**响应：**

```json
{
  "code": 200,
  "data": {
    "token": "eyJhbG...",
    "expires_in": 86400,
    "user": {"id": 1, "nickname": null}
  }
}
```

### 4.2 用户信息（需认证）

```
GET /api/v1/user/profile
Authorization: Bearer {token}
```

---

## 五、定时任务

| 时间 | 任务 | 耗时 |
|------|------|------|
| 交易日 9:00 | 刷新股票列表+行业分类 | ~2分钟 |
| 交易日 9:05 | 刷新概念板块+成分股 | ~2分钟 |
| 交易日 15:30 | 全量日K线采集 | ~90分钟 |

---

## 六、数据库表

| 表 | 说明 | 数据量 |
|----|------|--------|
| stock_info | 股票基本信息 | 5,203 |
| stock_kline | K线(日/周) | 按需积累 |
| concept_board | 概念板块 | 100 |
| concept_stock | 板块成分股 | 7,641 |
| news_feed | 新闻/公告 | 按需积累 |
| users | 微信用户 | — |
