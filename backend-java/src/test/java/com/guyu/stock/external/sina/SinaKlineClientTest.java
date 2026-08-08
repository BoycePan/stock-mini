package com.guyu.stock.external.sina;

import com.guyu.stock.common.fetcher.DataSource;
import com.guyu.stock.external.sina.SinaKlineClient.KLineResult;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class SinaKlineClientTest {

    static class StubSource extends DataSource {
        final AtomicInteger calls = new AtomicInteger();
        String body = "[{\"day\":\"2026-08-05\",\"open\":\"1700\",\"high\":\"1720\",\"low\":\"1690\",\"close\":\"1710\",\"volume\":\"10000\"}," +
                "{\"day\":\"2026-08-06\",\"open\":\"1710\",\"high\":\"1730\",\"low\":\"1700\",\"close\":\"1725\",\"volume\":\"12000\"}]";
        StubSource() { super("stub", 0, 0, null, null); }
        @Override public byte[] getBytes(String url) { calls.incrementAndGet(); return body.getBytes(StandardCharsets.UTF_8); }
    }

    @Test
    void parsesKlineJsonWithStringFields() {
        StubSource source = new StubSource();
        SinaKlineClient client = new SinaKlineClient(source, 0);

        KLineResult r = client.getKLine("600001", "240", 100);
        assertThat(r.code()).isEqualTo("600001");
        assertThat(r.scale()).isEqualTo("240");
        assertThat(r.klines()).hasSize(2);
        assertThat(r.klines().get(0).time()).isEqualTo("2026-08-05");
        assertThat(r.klines().get(0).open()).isEqualTo(1700.0);
        assertThat(r.klines().get(0).volume()).isEqualTo(10000);
    }

    @Test
    void toSymbolMapsMarkets() {
        SinaKlineClient client = new SinaKlineClient(DataSource.sina(), 0);
        assertThat(client.toSymbol("600001")).isEqualTo("sh600001");
        assertThat(client.toSymbol("000001")).isEqualTo("sz000001");
    }

    @Test
    void minuteScaleCachedAndDailyScaleNotCached() {
        StubSource source = new StubSource();
        SinaKlineClient client = new SinaKlineClient(source, 100);

        client.getKLine("600001", "5", 100);
        client.getKLine("600001", "5", 100);
        assertThat(source.calls.get()).isEqualTo(1); // 分钟线命中缓存，只拉取一次

        client.getKLine("600001", "240", 100);
        client.getKLine("600001", "240", 100);
        assertThat(source.calls.get()).isEqualTo(3); // 日线不缓存，每次都拉取
    }
}
