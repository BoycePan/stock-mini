package com.guyu.stock.external.sina;

import com.guyu.stock.common.fetcher.DataSource;
import com.guyu.stock.external.sina.SinaInfoClient.SinaStock;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SinaInfoClientTest {

    /** 分页 stub：第一页返回 1 条（<80 触发结束），第二页空 */
    static class StockListStub extends DataSource {
        int call;
        StockListStub() { super("stub", 0, 0, null, null); }
        @Override public byte[] getBytes(String url) {
            call++;
            if (call == 1) return "[{\"code\":\"600519\",\"name\":\"贵州茅台\"}]".getBytes(StandardCharsets.UTF_8);
            return "[]".getBytes(StandardCharsets.UTF_8);
        }
    }

    @Test
    void fetchStockListPadsCodeAndInfersMarket() {
        SinaInfoClient client = new SinaInfoClient(new StockListStub());
        List<SinaStock> stocks = client.fetchStockList();
        assertThat(stocks).hasSize(1);
        assertThat(stocks.get(0).code()).isEqualTo("600519");
        assertThat(stocks.get(0).market()).isEqualTo("sh");
        assertThat(stocks.get(0).board()).isEqualTo("main");
    }

    @Test
    void fetchIndustryMapParsesGbkHtml() {
        // 构造 "new_hy1":"X,银行,X,X,X,X,X,X,sh600001,贵州茅台,1,2" 的 GBK 字节
        String line = "\"new_hy1\":\"X,银行,X,X,X,X,X,X,sh600001,贵州茅台,1700,1\"";
        byte[] gbk = ("var data={" + line + "}").getBytes(Charset.forName("GBK"));
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return gbk; }
        };
        SinaInfoClient client = new SinaInfoClient(stub);
        Map<String, String> map = client.fetchIndustryMap();
        assertThat(map.get("600001")).isEqualTo("银行");
    }
}
