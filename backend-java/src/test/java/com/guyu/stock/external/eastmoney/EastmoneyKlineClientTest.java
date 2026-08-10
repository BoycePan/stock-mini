package com.guyu.stock.external.eastmoney;

import com.guyu.stock.common.fetcher.DataSource;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class EastmoneyKlineClientTest {

    @Test
    void parsesKlinesWithAmountAndTurnover() {
        String body = "{\"data\":{\"klines\":[\"2024-01-15,10.50,10.80,11.20,10.30,123456,133000000,1.50,3.45,0.10,2.30\"]}}";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return body.getBytes(StandardCharsets.UTF_8); }
        };
        EastmoneyKlineClient client = new EastmoneyKlineClient(stub);

        List<EastmoneyKlineClient.KLine> klines = client.getDailyKLine("600519", 1);
        assertThat(klines).hasSize(1);
        EastmoneyKlineClient.KLine k = klines.get(0);
        assertThat(k.date()).isEqualTo("2024-01-15");
        assertThat(k.open()).isEqualTo(10.50);
        assertThat(k.close()).isEqualTo(10.80);
        assertThat(k.high()).isEqualTo(11.20);
        assertThat(k.low()).isEqualTo(10.30);
        assertThat(k.volume()).isEqualTo(123456);
        assertThat(k.amount()).isEqualTo(133000000.0);
        assertThat(k.turnover()).isEqualTo(2.30);
    }

    @Test
    void toSecIdMapsMarkets() {
        assertThat(EastmoneyKlineClient.toSecId("600519")).isEqualTo("1.600519");
        assertThat(EastmoneyKlineClient.toSecId("000001")).isEqualTo("0.000001");
        assertThat(EastmoneyKlineClient.toSecId("")).isEmpty();
    }

    @Test
    void emptyKlinesWhenNoData() {
        String body = "{\"data\":{\"klines\":[]}}";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return body.getBytes(StandardCharsets.UTF_8); }
        };
        EastmoneyKlineClient client = new EastmoneyKlineClient(stub);
        assertThat(client.getDailyKLine("600519", 1)).isEmpty();
    }
}
