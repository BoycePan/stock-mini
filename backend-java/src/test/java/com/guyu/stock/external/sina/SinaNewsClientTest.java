package com.guyu.stock.external.sina;

import com.guyu.stock.common.fetcher.DataSource;
import com.guyu.stock.external.sina.SinaNewsClient.NewsItem;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SinaNewsClientTest {

    @Test
    void parsesStockNewsHtml() {
        String html = "<table>2026-08-05&nbsp;10:30&nbsp;&nbsp;<a href=\"http://x/1\">茅台发布财报</a></table>";
        byte[] gbk = html.getBytes(Charset.forName("GBK"));
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return gbk; }
        };
        SinaNewsClient client = new SinaNewsClient(stub, 0);
        List<NewsItem> items = client.fetchStockNews("600519", 1);
        assertThat(items).hasSize(1);
        assertThat(items.get(0).title()).isEqualTo("茅台发布财报");
        assertThat(items.get(0).time()).isEqualTo("2026-08-05 10:30");
        assertThat(items.get(0).source()).isEqualTo("新浪");
    }

    @Test
    void parsesFeedJsonp() {
        String body = "jsonp({\"result\":{\"data\":[{\"title\":\"标题A\",\"intro\":\"摘要\",\"url\":\"http://u/1\"," +
                "\"ctime\":1723000000,\"media_name\":\"财联社\"}]}})";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return body.getBytes(StandardCharsets.UTF_8); }
        };
        SinaNewsClient client = new SinaNewsClient(stub, 0);
        List<NewsItem> items = client.fetchFeedNews("A股", 20);
        assertThat(items).hasSize(1);
        assertThat(items.get(0).title()).isEqualTo("标题A");
        assertThat(items.get(0).source()).isEqualTo("财联社");
        assertThat(items.get(0).time()).matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}");
    }
}
