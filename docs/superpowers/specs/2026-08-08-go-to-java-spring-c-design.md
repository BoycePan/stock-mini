# Go 后端 → Java Spring Boot 迁移设计（C 阶段）

> 日期：2026-08-08
> 分支：`feat/go-to-java-spring-analysis`
> 前置：B 阶段 spec/plan 已完成并实现（`backend-java/` 7 接口 + 19 测试通过）

## 一、目标与范围

在 B 阶段基础上，把 Go 版剩余能力全部迁移到 `backend-java/`，达成 M3 gate（功能全量覆盖，可删 Go 版）。

**C 阶段四块：**
1. **sector 板块接口**：boards / board:klines / members（库查→空则实时同花顺）
2. **news 新闻/公告接口**：个股新闻 / feed / announcements（异步存库）
3. **K 线完整化**：分钟线 5/15/30/60 + 日线 DB 回退新浪（B 阶段 defer 的）
4. **数据采集 + 定时任务**：RefreshStockInfo / RefreshConceptData / RunFull + @Scheduled + 启动自检

**明确的验证务实化**：采集**完整移植逻辑**，验证用**小样本跑通**（不跑 80 分钟全量）；定时任务默认 `auto-full: false` 不自动全量。

**gate 不变**：`backend/`（Go）在 M3 达成前保留不动、继续线上运行。

## 二、已定决策

| 决策点 | 方案 |
|---|---|
| 采集验证 | 完整移植逻辑，小样本（`sample-size`，默认 20）跑通 |
| 定时任务 | @Scheduled 9:00/9:05/15:30 + 启动自检；默认 `app.collector.auto-full: false` |
| 数据访问 | 延续 JdbcTemplate（与 B 阶段一致） |
| 异步存库 | `@Async` 线程池（对应 Go `go func()`），失败仅记日志 |
| 采集执行模型 | 串行对齐 Go（限流 1s/次是瓶颈，并行无收益） |
| 东财数据源 | Go 版仅 Init 未接线，Java 版暂不移植 |
| HTTP 封装 | 抽通用 `common/fetcher/DataSource`（重试+退避+限流+GBK+JSONP），sina/ths/cninfo 复用 |
| 缓存 | Caffeine，对齐 Go TTL：个股新闻 60s、feed 30s、板块K线 60s、公告 5min、分钟线 30/60/120/180s |
| 包名 | 延续 `com.guyu.stock` |

## 三、工程结构（新增/改造）

```
backend-java/src/main/java/com/guyu/stock/
├── common/fetcher/
│   ├── DataSource.java            # 通用 HTTP：重试+退避+限流+GBK+JSONP（对应 Go pkg/fetcher）
│   ├── RetryConfig.java
│   └── Encoders.java              # GBK/GB2312 解码、JSONP 去壳
├── sector/
│   ├── SectorController.java      # boards / board/:code/klines / members/:cid
│   ├── SectorService.java         # 库查优先 → 空则实时拉取
│   └── ConceptRepository.java     # concept_board / concept_stock 表
├── news/
│   ├── NewsController.java        # stock news / feed / announcements
│   ├── NewsService.java           # 拉取 + 异步存库编排
│   ├── NewsRepository.java        # news_feed 表（BatchSave / QueryByStock）
│   └── AsyncNewsSaver.java        # @Async 线程池写库
├── stock/
│   └── StockController.java       # 【改造】放开分钟线 scale + 日线回退新浪
├── external/sina/
│   ├── SinaKlineClient.java       # 日/分钟 K 线（JSON 字符串字段解析）
│   ├── SinaInfoClient.java        # 股票列表(分页) + 行业分类(GBK HTML 正则)
│   └── SinaNewsClient.java        # 个股新闻(GB2312 HTML 正则) + feed(JSONP)
├── external/ths/
│   ├── ThsClient.java             # 板块列表 / 板块K线 / 成分股
│   └── ThsBoardParser.java        # HTML 正则 + JSONP 解析
├── external/cninfo/
│   └── CninfoClient.java          # 巨潮公告（POST form + JSON）
└── collector/
    ├── CollectorService.java      # RefreshStockInfo / RefreshConceptData / RunFull(小样本可配)
    ├── CollectorScheduler.java    # @Scheduled 9:00/9:05/15:30 + 启动自检
    └── CollectorProperties.java   # app.collector.*（auto-full / sample-size）
```

**配置新增（application.yml）**：
```yaml
app:
  collector:
    auto-full: false
    sample-size: 20
```

## 四、接口数据流

### 1. sector 板块（3 接口，响应结构对齐 Go）

| 接口 | 数据流 | 响应 |
|---|---|---|
| `GET /api/v1/sector/boards?top=N` | 查 `concept_board` → 有数据直接返回；空则 ThsClient.FetchBoardList(topN) | `data:[{plate_code,plate_name,cid}]` 按涨跌幅降序 |
| `GET /api/v1/sector/board/:code/klines?count=N` | 始终实时 ThsClient.FetchBoardKLine（Caffeine 60s，不落库） | `data:{code,count,klines:[{date,open,high,low,close,volume,amount}]}` |
| `GET /api/v1/sector/members/:cid` | cid→plate_code→查 `concept_stock` → 空则 ThsClient.FetchMembers | `data:{cid,count,stocks:[]}` |

- 同花顺限流 0.5s/次，Referer `https://q.10jqka.com.cn/`
- 错误：code 空→400"板块代码不能为空"；cid 非数字→400"cid 必须是数字"

### 2. news 新闻/公告（3 接口）

| 接口 | 数据流 | 响应 |
|---|---|---|
| `GET /api/v1/stock/:code/news?page=N` | SinaNewsClient.FetchStockNews（GB2312 HTML 正则，Caffeine 60s）→ 异步存库 | `data:{code,count,news:[{title,summary,url,time,source}]}` |
| `GET /api/v1/news/feed?q=A股&count=N` | SinaNewsClient.FetchFeedNews（JSONP，Caffeine 30s）→ 异步存库 | `data:{keyword,count,news:[...]}` |
| `GET /api/v1/stock/:code/announcements?page=&size=` | CninfoClient.FetchAnnouncements（POST form，Caffeine 5min）→ 异步存库 | `data:{code,page,count,items:[{id,title,time,url,pdf}]}` |

- `NewsRepository.BatchSave`：`INSERT INTO news_feed ... ON CONFLICT DO NOTHING`
- 异步存库失败仅记日志，不影响响应
- 错误：code 空→400"股票代码不能为空"

### 3. K 线完整化（改造 StockController）

- **日/周线（240/1200）**：DB 查询 → **未命中回退** SinaKlineClient + **异步回填** DB
- **分钟线（5/15/30/60）**：SinaKlineClient 实时拉（Caffeine TTL 30/60/120/180s）
- 返回统一 `{code, scale, klines:[{time,open,high,low,close,volume}], count}`（分钟线 `time` 带时分秒）

## 五、数据采集与定时

| 功能 | 逻辑 | 写库 |
|---|---|---|
| RefreshStockInfo | FetchStockList（沪/深分页 80/页）+ FetchIndustryMap（GBK HTML 正则） | stock_info BatchUpsert |
| RefreshConceptData | FetchBoardList(500) → UpsertBoard + FetchMembers → ReplaceMembers | concept_board / concept_stock |
| RunFull | RefreshStockInfo → 串行拉全市场日K（限流1s/次）→ 计算涨跌幅/额/振幅 | stock_kline BatchUpsert |

**调度**：
- 9:00 `cron="0 0 9 * * MON-FRI"` RefreshStockInfo
- 9:05 `cron="0 5 9 * * MON-FRI"` RefreshConceptData
- 15:30 `cron="0 30 15 * * MON-FRI"` RunFull（`auto-full:false` 时跳过）
- ApplicationRunner 启动自检：stock_info 空→RunFull；concept_board 空→RefreshConceptData

**试运行模式**：`auto-full:false` 时 15:30 与启动自检的 RunFull 跳过（记日志）；手动验证通过管理端点/启动参数触发 `RunFull(sampleSize)`。

**写库影响**：C 阶段验证在现网库写入（news_feed/concept_board/concept_stock/stock_info/stock_kline），均带 ON CONFLICT/去重，不污染 Go 数据；小样本为增量 upsert。

## 六、错误处理

- 延续 `GlobalExceptionHandler`（HTTP 恒 200，业务码在 body）
- 数据源抓取失败 → BizException(SERVER_ERROR)，日志记详情
- 异步存库失败 → @Async 内捕获记日志，不影响响应
- 采集任务失败 → 定时任务内 try-catch 记日志，不中断后续

## 七、测试

1. 单元测试（H2 + 样本，不连网）：DataSource 重试/退避/限流/GBK/JSONP；SinaKline/Info/News 解析；Ths 解析；Cninfo 解析；Concept/NewsRepository 写库；CollectorService 小样本流程
2. 集成验证（需用户，连现网库+外网）：sector/news/K线分钟接口与 Go 对比；小样本采集写库确认；auto-full 默认 false 确认不误触发

## 八、里程碑

```
M2 = C 阶段完成：
  ├─ sector / news / 公告 / K线分钟 / 日线回退 接口全量对齐 Go（对比验证通过）
  ├─ 采集组件 + 调度 + auto-full:false 就绪
  └─ 小样本采集跑通（写库验证）
M3 = 删 Go 版 gate：
  ├─ M2 全部通过
  ├─ 采集验证：auto-full:true 在生产验证（首日自然触发全量或小样本+增量）
  ├─ 删除 backend/（Go 源码）
  ├─ Java 版接管部署（Docker + CI 改构建 backend-java）
  └─ 前端回归（小程序全功能走 Java 后端）
```

**采集验证务实化**：Go 一直在采集、数据齐全，Java 接管后不必立即跑 80 分钟全量；`auto-full:true` 后首个交易日自然触发或手动小样本+增量确认。全量由日常调度逐步补齐。

**删除 Go 版的 gate = M3**。M2 期间 Go 版始终是线上兜底。
