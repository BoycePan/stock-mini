package com.guyu.stock.external.rss;

import com.guyu.stock.common.fetcher.DataSource;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** RssNewsClient 解析单测：内嵌 RSS 2.0 / Atom 样例 XML，不联网。 */
class RssNewsClientTest {

    // 直连/Worker 两个 DataSource 仅为构造用；parse() 不触发网络
    private static final DataSource DIRECT = new DataSource("t", 0, 0, null, null);
    private static final DataSource WORKER = new DataSource("t", 0, 0, null, null);
    private final RssNewsClient client = new RssNewsClient(DIRECT, WORKER);

    private static final String RSS_2_0 = """
            <?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0">
              <channel>
                <title>测试源</title>
                <item>
                  <title>第一条新闻</title>
                  <link>https://example.com/1</link>
                  <description><![CDATA[<p>摘要内容</p>]]></description>
                  <pubDate>Tue, 05 Mar 2024 14:00:12 +0000</pubDate>
                </item>
                <item>
                  <title>无时间条目应被跳过</title>
                  <link>https://example.com/2</link>
                  <description>没有 pubDate</description>
                </item>
                <item>
                  <title>第二条新闻</title>
                  <link>https://example.com/3</link>
                  <description>较新</description>
                  <pubDate>Wed, 06 Mar 2024 01:30:00 GMT</pubDate>
                </item>
              </channel>
            </rss>
            """;

    private static final String ATOM = """
            <?xml version="1.0" encoding="UTF-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <title>测试 Atom</title>
              <entry>
                <title>Atom 新闻</title>
                <link href="https://example.com/a1"/>
                <summary>Atom 摘要</summary>
                <published>2024-03-06T01:30:00Z</published>
              </entry>
            </feed>
            """;

    @Test
    void parseRss20() {
        List<RssNewsClient.RssItem> items = client.parse(RSS_2_0.getBytes(StandardCharsets.UTF_8), 20);
        // 无 pubDate 的条目被跳过 → 只留 2 条；按时间倒序 → 第二条在前
        assertThat(items).hasSize(2);
        assertThat(items.get(0).title()).isEqualTo("第二条新闻");
        assertThat(items.get(0).publishedAt()).isEqualTo("2024-03-06 09:30:00"); // GMT → 东八区
        assertThat(items.get(1).title()).isEqualTo("第一条新闻");
        assertThat(items.get(1).publishedAt()).isEqualTo("2024-03-05 22:00:12"); // +0000 → 东八区
        assertThat(items.get(1).summary()).contains("摘要内容"); // CDATA 内容可读
        assertThat(items.get(1).link()).isEqualTo("https://example.com/1");
    }

    @Test
    void parseAtom() {
        List<RssNewsClient.RssItem> items = client.parse(ATOM.getBytes(StandardCharsets.UTF_8), 20);
        assertThat(items).hasSize(1);
        assertThat(items.get(0).title()).isEqualTo("Atom 新闻");
        assertThat(items.get(0).link()).isEqualTo("https://example.com/a1");
        assertThat(items.get(0).publishedAt()).isEqualTo("2024-03-06 09:30:00"); // ISO8601 Z → 东八区
    }

    @Test
    void parseLimitsToMaxItems() {
        List<RssNewsClient.RssItem> items = client.parse(RSS_2_0.getBytes(StandardCharsets.UTF_8), 1);
        assertThat(items).hasSize(1);
        assertThat(items.get(0).title()).isEqualTo("第二条新闻"); // 保留最新一条
    }
}
