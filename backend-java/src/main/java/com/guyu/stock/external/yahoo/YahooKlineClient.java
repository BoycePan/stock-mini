package com.guyu.stock.external.yahoo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.collect.Lists;
import com.guyu.stock.common.fetcher.FetchException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.List;

/**
 * 雅虎 sidecar 客户端：调用 scripts/fetch_service.py 暴露的 /kline /quote 接口。
 * sidecar 由 FetchSidecarLauncher 拉起（开发/生产容器内均生效），随 Java 同生命周期。
 */
public class YahooKlineClient {

    private static final Logger log = LoggerFactory.getLogger(YahooKlineClient.class);

    public record KLine(String date, double open, double high, double low, double close, long volume) {}
    public record Quote(String symbol, double price, String currency, String exchange) {}
    public record BatchQuote(String symbol, double price, double prevClose, double pctChange) {}

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 批量行情单批上限：控制在 sidecar 单次拉取远低于 30s 读超时（实测约 0.2~0.4s/标的，40 只约 8~15s） */
    private static final int QUOTES_BATCH_SIZE = 40;

    private final RestClient restClient;
    private final String baseUrl;

    public YahooKlineClient(String baseUrl) {
        this.baseUrl = baseUrl;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(30_000);
        this.restClient = RestClient.builder().requestFactory(factory).build();
    }

    /** 拉历史 K 线；sidecar 返回 [{date, open, high, low, close, volume}] */
    public List<KLine> getKLine(String symbol, String range, String interval) {
        String url = baseUrl + "/kline?symbol={symbol}&range={range}&interval={interval}";
        String body = restClient.get().uri(url, symbol, range, interval).retrieve().body(String.class);
        if (body == null || body.isBlank()) return List.of();
        try {
            JsonNode arr = MAPPER.readTree(body);
            List<KLine> klines = new ArrayList<>();
            for (JsonNode n : arr) {
                klines.add(new KLine(
                        n.get("date").asText(),
                        n.get("open").asDouble(),
                        n.get("high").asDouble(),
                        n.get("low").asDouble(),
                        n.get("close").asDouble(),
                        n.get("volume").asLong()));
            }
            return klines;
        } catch (Exception e) {
            throw new FetchException("雅虎K线 JSON 解析失败: " + symbol, e);
        }
    }

    /** 实时行情快照；sidecar 返回 {symbol, price, currency, exchange} */
    public Quote getQuote(String symbol) {
        String url = baseUrl + "/quote?symbol={symbol}";
        String body = restClient.get().uri(url, symbol).retrieve().body(String.class);
        try {
            JsonNode n = MAPPER.readTree(body);
            return new Quote(
                    n.get("symbol").asText(),
                    n.get("price").asDouble(),
                    n.get("currency").asText(""),
                    n.get("exchange").asText(""));
        } catch (Exception e) {
            throw new FetchException("雅虎行情 JSON 解析失败: " + symbol, e);
        }
    }

    /** 批量实时行情（供定时任务刷新快照）；sidecar 返回 [{symbol, price, prev_close, pct_change}]。
     *  拆批拉取：单批 ≤40 只，避免全量一次请求超 30s 读超时/撞雅虎限流；单批失败记日志跳过，不拖垮整轮刷新。 */
    public List<BatchQuote> getQuotes(List<String> symbols) {
        List<BatchQuote> result = new ArrayList<>();
        List<List<String>> batches = Lists.partition(symbols, QUOTES_BATCH_SIZE);
        for (int i = 0; i < batches.size(); i++) {
            try {
                result.addAll(getQuotesOneBatch(batches.get(i)));
            } catch (Exception e) {
                log.warn("[yahoo] 批量行情第 {}/{} 批拉取失败（{} 只），跳过该批: {}",
                        i + 1, batches.size(), batches.get(i).size(), e.getMessage());
            }
        }
        return result;
    }

    private List<BatchQuote> getQuotesOneBatch(List<String> symbols) {
        String url = baseUrl + "/quotes?symbols={symbols}";
        String body = restClient.get().uri(url, String.join(",", symbols)).retrieve().body(String.class);
        try {
            JsonNode arr = MAPPER.readTree(body);
            List<BatchQuote> quotes = new ArrayList<>();
            for (JsonNode n : arr) {
                quotes.add(new BatchQuote(
                        n.get("symbol").asText(),
                        n.get("price").asDouble(),
                        n.get("prev_close").asDouble(),
                        n.get("pct_change").asDouble()));
            }
            return quotes;
        } catch (Exception e) {
            throw new FetchException("雅虎批量行情 JSON 解析失败", e);
        }
    }
}
