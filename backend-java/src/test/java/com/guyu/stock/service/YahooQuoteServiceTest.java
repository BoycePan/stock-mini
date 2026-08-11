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
                new YahooKlineClient.BatchQuote("^GSPC", 4521.3, 4500.0, 0.47),
                new YahooKlineClient.BatchQuote("^DJI", 0.0, 0.0, 0.0)));

        int updated = service.refreshSnapshot();

        assertThat(updated).isEqualTo(1);
        verify(repository).upsert(List.of(
                new QuoteSnapshot("^GSPC", "标普500", 4521.3, 0.47, null)));
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
    void refreshIncludesSectorSymbols() {
        when(client.getQuotes(any())).thenReturn(List.of(
                new YahooKlineClient.BatchQuote("XLK", 200.5, 199.0, 0.75)));

        int updated = service.refreshSnapshot();

        assertThat(updated).isEqualTo(1);
        verify(repository).upsert(List.of(new QuoteSnapshot("XLK", "科技", 200.5, 0.75, null)));
    }
}
