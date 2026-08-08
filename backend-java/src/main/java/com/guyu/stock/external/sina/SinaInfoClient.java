package com.guyu.stock.external.sina;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.fetcher.DataSource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SinaInfoClient {

    public record SinaStock(String code, String name, String market, String board) {}

    private static final String LIST_URL = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";
    private static final String INDUSTRY_URL = "http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php";
    private static final Pattern INDUSTRY_PATTERN = Pattern.compile("\"new_\\w+\":\"([^\"]+)\"");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final DataSource source;

    public SinaInfoClient(DataSource source) {
        this.source = source;
    }

    public List<SinaStock> fetchStockList() {
        List<SinaStock> all = new ArrayList<>();
        for (String node : List.of("sh_a", "sz_a")) {
            for (int page = 1; page < 100; page++) {
                String url = LIST_URL + "?page=" + page + "&num=80&sort=symbol&asc=1&node=" + node + "&symbol=&_s_r_a=auto";
                String body = source.getString(url);
                try {
                    JsonNode arr = MAPPER.readTree(body);
                    for (JsonNode n : arr) {
                        String code = String.format("%06d", n.get("code").asInt());
                        all.add(new SinaStock(code, n.get("name").asText(), marketFromCode(code), boardFromCode(code)));
                    }
                    if (arr.size() < 80) break;
                } catch (Exception e) {
                    throw new com.guyu.stock.common.fetcher.FetchException("解析股票列表 JSON 失败", e);
                }
                sleep(150);
            }
        }
        return all;
    }

    public Map<String, String> fetchIndustryMap() {
        String html = source.getStringDecoded(INDUSTRY_URL, "gbk");
        Map<String, String> result = new LinkedHashMap<>();
        Matcher m = INDUSTRY_PATTERN.matcher(html);
        while (m.find()) {
            String[] parts = m.group(1).split(",");
            if (parts.length < 9) continue;
            String industry = parts[1];
            for (int i = 8; i + 3 < parts.length; i += 4) {
                String code = stripMarketPrefix(parts[i]);
                code = String.format("%06d", safeInt(code));
                if (!code.equals("000000")) result.put(code, industry);
            }
        }
        return result;
    }

    static String marketFromCode(String code) {
        if (code == null || code.isEmpty()) return "";
        return switch (code.charAt(0)) {
            case '6', '9' -> "sh";
            case '0', '3' -> "sz";
            case '4', '8' -> "bj";
            default -> "";
        };
    }

    static String boardFromCode(String code) {
        if (code.length() < 3) return "main";
        if (code.startsWith("300") || code.startsWith("301")) return "chinext";
        if (code.startsWith("688")) return "star";
        return "main";
    }

    private static String stripMarketPrefix(String s) {
        if (s.length() > 2 && (s.startsWith("sh") || s.startsWith("sz") || s.startsWith("bj"))) return s.substring(2);
        return s;
    }

    private static int safeInt(String s) {
        try { return Integer.parseInt(s); } catch (NumberFormatException e) { return 0; }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
