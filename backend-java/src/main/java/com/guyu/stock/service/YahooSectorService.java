package com.guyu.stock.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.guyu.stock.common.util.NumUtil;
import com.guyu.stock.common.util.SleepUtil;
import com.guyu.stock.dao.StockInfoRepository;
import com.guyu.stock.dao.StockKlineRepository;
import com.guyu.stock.dao.YahooQuoteRepository;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.external.yahoo.YahooSectors;
import com.guyu.stock.model.QuoteSnapshot;
import com.guyu.stock.model.StockInfo;
import com.guyu.stock.model.StockKline;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 雅虎板块 ETF 服务：拉取落库 stock_kline（type='sector'）、元数据登记 stock_info（type='sector'，board 存分类）、以及查询接口。
 * 与 YahooIndexService 同构，查询走 Caffeine 缓存（sidecar 侧另有 60s 缓存），避免高频请求触发雅虎限流。
 */
@Service
public class YahooSectorService {

    private static final Logger log = LoggerFactory.getLogger(YahooSectorService.class);

    private final YahooKlineClient yahooKlineClient;
    private final StockKlineRepository klineRepository;
    private final StockInfoRepository infoRepository;
    private final YahooQuoteRepository quoteRepository;

    // 实时行情 10s 缓存（防高频请求触发雅虎限流）
    private final Cache<String, YahooKlineClient.Quote> quoteCache;

    public YahooSectorService(YahooKlineClient yahooKlineClient, StockKlineRepository klineRepository,
                              StockInfoRepository infoRepository, YahooQuoteRepository quoteRepository) {
        this.yahooKlineClient = yahooKlineClient;
        this.klineRepository = klineRepository;
        this.infoRepository = infoRepository;
        this.quoteRepository = quoteRepository;
        this.quoteCache = Caffeine.newBuilder().expireAfterWrite(Duration.ofSeconds(10)).maximumSize(200).build();
    }

    /** 拉全部板块 ETF（串行 + 300ms 间隔），返回成功落库的板块个数 */
    public int fetchSectors(String range) {
        int ok = 0;
        for (YahooSectors.Symbol s : YahooSectors.SECTORS) {
            try {
                int n = fetchSector(s.code(), range);
                if (n > 0) ok++;
                log.info("[yahoo-sector] {} {} 落库 {} 行", s.code(), s.name(), n);
            } catch (Exception e) {
                log.warn("[yahoo-sector] {} {} 拉取失败: {}", s.code(), s.name(), e.getMessage());
            }
            SleepUtil.sleep(300);
        }
        log.info("[yahoo-sector] 完成，成功 {} / {}", ok, YahooSectors.SECTORS.size());
        return ok;
    }

    /** 把板块元数据登记到 stock_info（type='sector'，market 取自清单，board 存 industry/theme 供前端分组） */
    public int syncSectorInfo() {
        List<StockInfo> infos = new ArrayList<>();
        for (YahooSectors.Symbol s : YahooSectors.SECTORS) {
            infos.add(new StockInfo(s.code(), s.name(), "sector", s.market(), s.category(), null, true, null));
        }
        infoRepository.batchUpsert(infos);
        log.info("[yahoo-sector] 板块元数据登记 stock_info 完成，{} 条", infos.size());
        return infos.size();
    }

    /** 板块 K线：按 range 过滤日线历史（DB 有则查库；无则返回空数组），并附带最新实时快照。 */
    public Map<String, Object> getKlines(String code, String range) {
        LocalDate since = rangeToSince(range);
        List<StockKline> dbRows = klineRepository.queryByCodeSince(code, "1d", since);
        List<Map<String, Object>> klines = new ArrayList<>();
        for (StockKline k : dbRows) {
            klines.add(klineItem(k.tradeDate().toString(), k.open(), k.high(), k.low(), k.close(), k.volume()));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("range", range);
        result.put("scale", "1d");
        result.put("klines", klines);
        result.put("count", klines.size());
        // 附带最新实时快照（quote_snapshot 60s 定时刷新）；无记录时为 null
        QuoteSnapshot latest = quoteRepository.findByCode(code);
        if (latest != null) {
            Map<String, Object> latestItem = new LinkedHashMap<>();
            latestItem.put("price", latest.price());
            latestItem.put("pctChange", latest.pctChange());
            latestItem.put("updatedAt", latest.updatedAt() != null ? latest.updatedAt().toString() : null);
            result.put("latest", latestItem);
        } else {
            result.put("latest", null);
        }
        return result;
    }

    /** 板块实时行情（透传 sidecar /quote，10s 缓存防限流） */
    public YahooKlineClient.Quote getQuote(String code) {
        return quoteCache.get(code, yahooKlineClient::getQuote);
    }

    private Map<String, Object> klineItem(String time, double open, double high, double low, double close, long volume) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("time", time);
        item.put("open", open);
        item.put("high", high);
        item.put("low", low);
        item.put("close", close);
        item.put("volume", volume);
        return item;
    }

    /** 拉单只板块 ETF 日线并落库，返回落库行数 */
    public int fetchSector(String symbol, String range) {
        List<YahooKlineClient.KLine> rows = yahooKlineClient.getKLine(symbol, range, "1d");
        if (rows.isEmpty()) return 0;
        List<StockKline> dbRows = toDbKlines(symbol, rows);
        klineRepository.batchUpsert(dbRows);
        return dbRows.size();
    }

    /** sidecar 的 date 形如 "2026-08-07 00:00"，前 10 位即 ISO 日期；板块 ETF 无成交额/换手率概念填 0 */
    private List<StockKline> toDbKlines(String code, List<YahooKlineClient.KLine> rows) {
        List<StockKline> result = new ArrayList<>();
        double prevClose = 0;
        for (int i = 0; i < rows.size(); i++) {
            YahooKlineClient.KLine k = rows.get(i);
            LocalDate tradeDate = LocalDate.parse(k.date().substring(0, 10));
            double changeAmt = 0, pctChange = 0, amplitude = 0;
            if (i > 0 && prevClose != 0) {
                changeAmt = NumUtil.round2(k.close() - prevClose);
                pctChange = NumUtil.round2((k.close() - prevClose) / prevClose * 100);
                amplitude = NumUtil.round2((k.high() - k.low()) / prevClose * 100);
            }
            result.add(new StockKline(code, "1d", tradeDate,
                    k.open(), k.high(), k.low(), k.close(), k.volume(),
                    0, 0, pctChange, changeAmt, amplitude, "sector"));
            prevClose = k.close();
        }
        return result;
    }

    /** 把 yfinance range 映射为起始日期；max 返回 null（查全量），未知 range 兜底 1y。 */
    private LocalDate rangeToSince(String range) {
        LocalDate today = LocalDate.now();
        if (range == null || range.isBlank()) return today.minusYears(1);
        return switch (range) {
            case "1d" -> today.minusDays(1);
            case "5d" -> today.minusDays(7);
            case "1mo" -> today.minusMonths(1);
            case "3mo" -> today.minusMonths(3);
            case "6mo" -> today.minusMonths(6);
            case "ytd" -> LocalDate.of(today.getYear(), 1, 1);
            case "2y" -> today.minusYears(2);
            case "5y" -> today.minusYears(5);
            case "10y" -> today.minusYears(10);
            case "max" -> null;
            default -> today.minusYears(1); // 1y 及未知值
        };
    }
}
