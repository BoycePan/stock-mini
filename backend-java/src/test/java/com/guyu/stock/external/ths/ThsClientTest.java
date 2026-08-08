package com.guyu.stock.external.ths;

import com.guyu.stock.common.fetcher.DataSource;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ThsClientTest {

    @Test
    void parsesBoardListGnSection() {
        String html = "<input id=\"gnSection\" value='{\"0\":{\"platecode\":\"885333\",\"platename\":\"人工智能\",\"cid\":\"300188\",\"199112\":\"1.5\"}}' />";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return html.getBytes(StandardCharsets.UTF_8); }
        };
        ThsClient client = new ThsClient(stub);
        List<BoardInfo> boards = client.fetchBoardList(60);
        assertThat(boards).hasSize(1);
        assertThat(boards.get(0).plateCode()).isEqualTo("885333");
        assertThat(boards.get(0).cid()).isEqualTo(300188);
    }

    @Test
    void parsesBoardKLineJsonp() {
        String body = "quotebridge_v4_line_bk_885552_01_last({\"data\":\"20140513,100,110,90,105,1000,200000;20140514,105,115,100,112,1200,250000\"})";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return body.getBytes(StandardCharsets.UTF_8); }
        };
        ThsClient client = new ThsClient(stub);
        List<BoardKLine> klines = client.fetchBoardKLine("885552", 30);
        assertThat(klines).hasSize(2);
        assertThat(klines.get(0).date()).isEqualTo("2014-05-13");
        assertThat(klines.get(0).close()).isEqualTo(105.0);
        assertThat(klines.get(1).volume()).isEqualTo(1200);
    }

    @Test
    void parsesMembersOnlyAStocks() {
        String html = "<td><a href=\"/x/\">600519</a></td><td><a>999999</a></td><td><a>000001</a></td>";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public byte[] getBytes(String url) { return html.getBytes(StandardCharsets.UTF_8); }
        };
        ThsClient client = new ThsClient(stub);
        List<String> codes = client.fetchMembers(885552);
        assertThat(codes).containsExactly("600519", "000001");
    }
}
