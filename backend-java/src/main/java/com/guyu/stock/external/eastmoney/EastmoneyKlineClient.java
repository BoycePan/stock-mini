package com.guyu.stock.external.eastmoney;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.fetcher.DataSource;
import com.guyu.stock.common.fetcher.FetchException;

import java.util.ArrayList;
import java.util.List;

/**
 * 东方财富日K线客户端（对齐 Go pkg/eastmoney/kline.go）。
 *
 * 限流严格（默认 4s/次），不建议全量采集，只做按需补充（含成交额 + 换手率）。
 */
public class EastmoneyKlineClient {

    /** 单根日K线，字段对齐 Go eastmoney.KLine：日期、开、收、高、低、成交量、成交额、换手率 */
    public record KLine(String date, double open, double close, double high, double low,
                        long volume, double amount, double turnover) {}

    private static final String KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final DataSource source;

    public EastmoneyKlineClient(DataSource source) {
        this.source = source;
    }

    /** 获取单只股票的日K线（含成交额 + 换手率）。count <= 0 时默认 60。 */
    public List<KLine> getDailyKLine(String code, int count) {
        if (count <= 0) count = 60;
        String url = KLINE_URL
                + "?secid=" + toSecId(code)
                + "&fields1=f1,f2,f3,f4,f5,f6"
                + "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
                + "&klt=101&fqt=1&end=20500101&lmt=" + count;
        String body = source.getString(url);
        return parse(body);
    }

    /**
     * 解析东财 K 线响应。
     *
     * 返回格式：
     * <pre>{"data":{"klines":["2024-01-15,10.50,10.80,11.20,10.30,123456,133000000,1.50,3.45,0.10,2.30",...]}}</pre>
     * 每行逗号分隔：[0]日期 [1]开盘 [2]收盘 [3]最高 [4]最低 [5]成交量 [6]成交额 [7]振幅 [8]涨跌幅 [9]涨跌额 [10]换手率
     */
    static List<KLine> parse(String body) {
        List<KLine> result = new ArrayList<>();
        try {
            JsonNode arr = MAPPER.readTree(body).path("data").path("klines");
            for (JsonNode n : arr) {
                String[] f = n.asText().split(",", -1);
                if (f.length < 11) continue;
                result.add(new KLine(
                        f[0].trim(),
                        parseDouble(f[1]),
                        parseDouble(f[2]),
                        parseDouble(f[3]),
                        parseDouble(f[4]),
                        parseLong(f[5]),
                        parseDouble(f[6]),
                        parseDouble(f[10])));
            }
        } catch (Exception e) {
            throw new FetchException("东财K线JSON解析失败", e);
        }
        return result;
    }

    /**
     * 将 6 位代码转为东财 secid 格式（对齐 Go toSecID）。
     * 6xxxxx → 1.{code}（上海），其他 → 0.{code}（深圳）。
     */
    static String toSecId(String code) {
        if (code == null || code.isEmpty()) return code;
        return code.charAt(0) == '6' ? "1." + code : "0." + code;
    }

    private static double parseDouble(String s) {
        try {
            return Double.parseDouble(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static long parseLong(String s) {
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
