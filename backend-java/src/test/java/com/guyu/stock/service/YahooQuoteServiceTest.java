package com.guyu.stock.service;

import com.guyu.stock.dao.YahooQuoteRepository;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.model.AssetQuote;
import com.guyu.stock.model.IndexQuote;
import com.guyu.stock.model.QuoteSnapshot;
import com.guyu.stock.model.SectorQuote;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 快照刷新对 sidecar 无效点位（price<=0）应跳过，避免 0 值覆盖有效快照。 */
class YahooQuoteServiceTest {

    private final YahooKlineClient client = mock(YahooKlineClient.class);
    private final YahooQuoteRepository repository = mock(YahooQuoteRepository.class);
    private final YahooQuoteService service = new YahooQuoteService(client, repository);

    @Test
    void skipsZeroPriceQuote() {
        when(client.getQuotes(any())).thenReturn(List.of(
                new YahooKlineClient.BatchQuote("BTC-USD", 64198.5, 63910.5, 0.45),
                new YahooKlineClient.BatchQuote("ETH-USD", 0.0, 0.0, 0.0)));

        int updated = service.refreshSnapshot();

        assertThat(updated).isEqualTo(1);
        verify(repository).upsert(List.of(
                new QuoteSnapshot("BTC-USD", "比特币", 64198.5, 0.45, null)));
    }

    @Test
    void skipsNegativePriceQuote() {
        when(client.getQuotes(any())).thenReturn(List.of(
                new YahooKlineClient.BatchQuote("^GSPC", -1.0, 0.0, 0.0)));

        int updated = service.refreshSnapshot();

        assertThat(updated).isZero();
        verify(repository, never()).upsert(any());
    }

    @Test
    void skipsAllInvalidQuotesAndKeepsOldSnapshot() {
        when(client.getQuotes(any())).thenReturn(List.of(
                new YahooKlineClient.BatchQuote("^GSPC", 0.0, 0.0, 0.0),
                new YahooKlineClient.BatchQuote("^DJI", 0.0, 0.0, 0.0)));

        int updated = service.refreshSnapshot();

        assertThat(updated).isZero();
        verify(repository, never()).upsert(any());
    }

    @Test
    void refreshIncludesCryptoSymbols() {
        // crypto 7×24 恒开市，names 映射一定存在，验证非指数 symbol 也能带中文名进快照
        when(client.getQuotes(any())).thenReturn(List.of(
                new YahooKlineClient.BatchQuote("BTC-USD", 64198.5, 63910.5, 0.45)));

        int updated = service.refreshSnapshot();

        assertThat(updated).isEqualTo(1);
        verify(repository).upsert(List.of(new QuoteSnapshot("BTC-USD", "比特币", 64198.5, 0.45, null)));
    }

    @Test
    void listIndexQuotesFiltersByTrading() {
        when(repository.queryIndexList()).thenReturn(List.of(
                new IndexQuote("^GDAXI", "德国DAX", "de", 26501.49, 0.42, null, "15:00-23:30", true),
                new IndexQuote("^GSPC", "标普500", "us", 5000.0, 0.0, null, "21:30-04:00", false)));

        assertThat(service.listIndexQuotes(true)).extracting(IndexQuote::code).containsExactly("^GDAXI");
        assertThat(service.listIndexQuotes(false)).extracting(IndexQuote::code).containsExactly("^GSPC");
        assertThat(service.listIndexQuotes(null)).hasSize(2);
    }

    @Test
    void listSectorQuotesFiltersByTrading() {
        when(repository.querySectorList(null)).thenReturn(List.of(
                new SectorQuote("XLK", "科技", "us", "industry", 200.5, 1.2, null, "21:30-04:00", true),
                new SectorQuote("SMH", "半导体", "us", "theme", 250.0, 0.8, null, "21:30-04:00", false)));

        assertThat(service.listSectorQuotes(null, true)).extracting(SectorQuote::code).containsExactly("XLK");
        assertThat(service.listSectorQuotes(null, false)).extracting(SectorQuote::code).containsExactly("SMH");
    }

    @Test
    void listAssetQuotesFiltersByTrading() {
        when(repository.queryAssetList("commodity", null)).thenReturn(List.of(
                new AssetQuote("GC=F", "黄金", "commodity", "global", "贵金属", 4401.9, 1.2, null, "06:00-05:00", true),
                new AssetQuote("SI=F", "白银", "commodity", "global", "贵金属", 66.55, 2.7, null, "06:00-05:00", false)));

        assertThat(service.listAssetQuotes("commodity", null, true)).extracting(AssetQuote::code).containsExactly("GC=F");
        assertThat(service.listAssetQuotes("commodity", null, false)).extracting(AssetQuote::code).containsExactly("SI=F");
    }
}
