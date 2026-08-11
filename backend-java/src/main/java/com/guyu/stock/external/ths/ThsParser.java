package com.guyu.stock.external.ths;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.fetcher.Encoders;
import com.guyu.stock.common.util.NumUtil;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ThsParser {

    private static final Pattern GN_SECTION = Pattern.compile("id=\"gnSection\"[^>]*value='([^']*)'");
    private static final Pattern STOCK_CODE = Pattern.compile("<td[^>]*>\\s*<a[^>]*>\\s*(\\d{6})\\s*</a>\\s*</td>");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ThsParser() {}

    public static List<BoardInfo> parseBoardList(byte[] htmlBytes) {
        String html = new String(htmlBytes, java.nio.charset.StandardCharsets.UTF_8);
        Matcher m = GN_SECTION.matcher(html);
        if (!m.find()) throw new com.guyu.stock.common.fetcher.FetchException("未找到 gnSection 字段");
        try {
            JsonNode root = MAPPER.readTree(m.group(1));
            List<BoardInfo> boards = new ArrayList<>();
            root.fields().forEachRemaining(entry -> {
                JsonNode v = entry.getValue();
                int cid = Integer.parseInt(v.path("cid").asText("0"));
                boards.add(new BoardInfo(cid,
                        v.path("platecode").asText(""),
                        v.path("platename").asText(""),
                        v.path("199112").asDouble(0)));
            });
            return boards;
        } catch (Exception e) {
            throw new com.guyu.stock.common.fetcher.FetchException("板块列表JSON解析失败", e);
        }
    }

    public static List<BoardKLine> parseBoardKLine(byte[] jsonpBytes, int count) {
        byte[] json = Encoders.stripJsonp(jsonpBytes);
        try {
            String data = MAPPER.readTree(json).path("data").asText("");
            if (data.isEmpty()) return new ArrayList<>();
            String[] lines = data.split(";");
            int start = Math.max(0, lines.length - count);
            List<BoardKLine> klines = new ArrayList<>();
            for (int i = start; i < lines.length; i++) {
                String line = lines[i].trim();
                if (line.isEmpty()) continue;
                String[] p = line.split(",");
                if (p.length < 7) continue;
                String date = p[0].length() == 8 ? p[0].substring(0,4) + "-" + p[0].substring(4,6) + "-" + p[0].substring(6,8) : p[0];
                klines.add(new BoardKLine(date, NumUtil.parseDouble(p[1]), NumUtil.parseDouble(p[2]), NumUtil.parseDouble(p[3]),
                        NumUtil.parseDouble(p[4]), NumUtil.parseLong(p[5]), NumUtil.parseDouble(p[6])));
            }
            return klines;
        } catch (Exception e) {
            throw new com.guyu.stock.common.fetcher.FetchException("板块K线JSON解析失败", e);
        }
    }

    public static List<String> parseMembers(byte[] htmlBytes) {
        String html = new String(htmlBytes, java.nio.charset.StandardCharsets.UTF_8);
        List<String> codes = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        Matcher m = STOCK_CODE.matcher(html);
        while (m.find()) {
            String code = m.group(1);
            char first = code.charAt(0);
            if ((first == '0' || first == '3' || first == '6') && seen.add(code)) codes.add(code);
        }
        return codes;
    }
}
