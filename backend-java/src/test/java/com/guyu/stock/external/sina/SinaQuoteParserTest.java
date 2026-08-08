package com.guyu.stock.external.sina;

import com.guyu.stock.config.AppProperties;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SinaQuoteParserTest {

    private final SinaClient client = new SinaClient(new AppProperties.Sina());

    // 模拟 hq.sinajs.cn 响应字节：头部/尾部是 ASCII，名称是 GBK 中文
    private byte[] gbkBody(String line) {
        String prefix = "var hq_str_sh600519=\"";
        String suffix = "\";";
        byte[] prefixBytes = prefix.getBytes(StandardCharsets.ISO_8859_1);
        byte[] gbkBytes = line.getBytes(Charset.forName("GBK"));
        byte[] suffixBytes = suffix.getBytes(StandardCharsets.ISO_8859_1);
        byte[] out = new byte[prefixBytes.length + gbkBytes.length + suffixBytes.length];
        System.arraycopy(prefixBytes, 0, out, 0, prefixBytes.length);
        System.arraycopy(gbkBytes, 0, out, prefixBytes.length, gbkBytes.length);
        System.arraycopy(suffixBytes, 0, out, prefixBytes.length + gbkBytes.length, suffixBytes.length);
        return out;
    }

    @Test
    void parsesQuoteFromGbkBody() {
        String[] fields = new String[32];
        fields[0] = "贵州茅台";
        fields[1] = "1700.00"; // open
        fields[2] = "1690.00"; // prev_close
        fields[3] = "1710.00"; // price
        fields[4] = "1730.00"; // high
        fields[5] = "1680.00"; // low
        fields[6] = "0"; fields[7] = "0"; // bid/ask
        fields[8] = "10000";  // volume
        fields[9] = "17000000"; // amount
        for (int i = 10; i <= 29; i++) fields[i] = "0";
        fields[30] = "2026-08-07";
        fields[31] = "15:00:03";

        String line = String.join(",", fields);
        // 模拟 SinaClient 内部：byte[] 按 ISO-8859-1 重编码后传给 parseBody
        String isoBody = new String(gbkBody(line), StandardCharsets.ISO_8859_1);
        List<Quote> quotes = client.parseBody(isoBody);

        assertThat(quotes).hasSize(1);
        Quote q = quotes.get(0);
        assertThat(q.code()).isEqualTo("600519");
        assertThat(q.name()).isEqualTo("贵州茅台");
        assertThat(q.open()).isEqualTo(1700.00);
        assertThat(q.prevClose()).isEqualTo(1690.00);
        assertThat(q.price()).isEqualTo(1710.00);
        assertThat(q.volume()).isEqualTo(10000);
        assertThat(q.amount()).isEqualTo(17000000);
        assertThat(q.date()).isEqualTo("2026-08-07");
        assertThat(q.time()).isEqualTo("15:00:03");
        assertThat(q.pctChange()).isEqualTo((1710.0 - 1690.0) / 1690.0 * 100);
    }

    @Test
    void toSymbolMapsShAndSz() {
        assertThat(client.toSymbol("600001")).isEqualTo("sh600001");
        assertThat(client.toSymbol("900001")).isEqualTo("sh900001");
        assertThat(client.toSymbol("000001")).isEqualTo("sz000001");
        assertThat(client.toSymbol("300750")).isEqualTo("sz300750");
    }
}
