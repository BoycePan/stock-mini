package com.guyu.stock.common.fetcher;

import org.junit.jupiter.api.Test;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import static org.assertj.core.api.Assertions.assertThat;

class EncodersTest {

    @Test
    void gbkToUtf8DecodesChinese() {
        byte[] gbk = "贵州茅台".getBytes(Charset.forName("GBK"));
        assertThat(Encoders.gbkToUtf8(gbk)).isEqualTo("贵州茅台");
    }

    @Test
    void stripJsonpExtractsObject() {
        byte[] jsonp = "callback({\"a\":1,\"b\":{\"c\":2}})".getBytes(StandardCharsets.UTF_8);
        assertThat(Encoders.stripJsonp(jsonp)).isEqualTo("{\"a\":1,\"b\":{\"c\":2}}".getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void stripJsonpPassesThroughPlainJson() {
        byte[] json = "{\"a\":1}".getBytes(StandardCharsets.UTF_8);
        assertThat(Encoders.stripJsonp(json)).isEqualTo(json);
    }
}
