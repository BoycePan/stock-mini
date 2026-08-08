package com.guyu.stock.common.fetcher;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

public final class Encoders {

    private Encoders() {}

    /** 与 Go DecodeBytes(raw,"gbk") 等效：ISO-8859-1 桥接保留字节，再按 GBK 解码 */
    public static String gbkToUtf8(byte[] raw) {
        return new String(raw, Charset.forName("GBK"));
    }

    public static String decode(byte[] raw, String charset) {
        return new String(raw, Charset.forName(charset));
    }

    /** 与 Go StripJSONP 等效：已是 JSON 则原样返回；否则从第一个 { 括号计数提取 */
    public static byte[] stripJsonp(byte[] raw) {
        String s = new String(raw, StandardCharsets.UTF_8).trim();
        if (s.startsWith("{") || s.startsWith("[")) {
            return s.getBytes(StandardCharsets.UTF_8);
        }
        s = s.replaceFirst("^try\\{", "");
        int start = s.indexOf('{');
        if (start < 0) {
            throw new FetchException("无法解析 JSONP 格式: " + s.substring(0, Math.min(s.length(), 80)));
        }
        int depth = 0;
        for (int i = start; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '{') depth++;
            else if (ch == '}') {
                depth--;
                if (depth == 0) {
                    return s.substring(start, i + 1).getBytes(StandardCharsets.UTF_8);
                }
            }
        }
        throw new FetchException("JSONP 括号不匹配");
    }
}
