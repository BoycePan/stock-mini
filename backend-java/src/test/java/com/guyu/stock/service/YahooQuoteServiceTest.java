package com.guyu.stock.service;

import com.guyu.stock.dao.YahooQuoteRepository;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.model.QuoteSnapshot;
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
}
