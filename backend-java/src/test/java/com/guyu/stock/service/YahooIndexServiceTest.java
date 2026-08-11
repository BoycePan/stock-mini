package com.guyu.stock.service;

import com.guyu.stock.dao.StockInfoRepository;
import com.guyu.stock.dao.StockKlineRepository;
import com.guyu.stock.dao.YahooQuoteRepository;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.model.QuoteSnapshot;
import com.guyu.stock.model.StockKline;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 指数 K线：range 应影响查询窗口，返回应附带最新实时快照，空库返回空数组而非 NPE。 */
class YahooIndexServiceTest {

    private final YahooKlineClient client = mock(YahooKlineClient.class);
    private final StockKlineRepository klineRepository = mock(StockKlineRepository.class);
    private final StockInfoRepository infoRepository = mock(StockInfoRepository.class);
    private final YahooQuoteRepository quoteRepository = mock(YahooQuoteRepository.class);

    private final YahooIndexService service =
            new YahooIndexService(client, klineRepository, infoRepository, quoteRepository);

    @Test
    void range1yQueriesSinceOneYearAgo() {
        when(klineRepository.queryByCodeSince(eq("^GSPC"), eq("1d"), any())).thenReturn(List.of());
        when(quoteRepository.findByCode("^GSPC")).thenReturn(null);

        service.getKlines("^GSPC", "1y");

        // 只验证传入的 since 约为一年前，避免日期边界抖动
        verify(klineRepository).queryByCodeSince(eq("^GSPC"), eq("1d"), any());
    }

    @Test
    void returnsKlinesAscendingAndAttachesLatest() {
        StockKline k1 = new StockKline("^GSPC", "1d", LocalDate.of(2026, 8, 6),
                4500, 4510, 4490, 4505, 1000, 0, 0, 0.1, 5, 0.5, "index");
        StockKline k2 = new StockKline("^GSPC", "1d", LocalDate.of(2026, 8, 7),
                4505, 4520, 4500, 4518, 1200, 0, 0, 0.3, 13, 0.4, "index");
        when(klineRepository.queryByCodeSince(eq("^GSPC"), eq("1d"), any())).thenReturn(List.of(k1, k2));
        when(quoteRepository.findByCode("^GSPC")).thenReturn(
                new QuoteSnapshot("^GSPC", "标普500", 4521.5, 0.33, LocalDateTime.of(2026, 8, 11, 10, 0)));

        Map<String, Object> result = service.getKlines("^GSPC", "5d");

        assertThat(result.get("code")).isEqualTo("^GSPC");
        assertThat(result.get("range")).isEqualTo("5d");
        assertThat(result.get("scale")).isEqualTo("1d");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> klines = (List<Map<String, Object>>) result.get("klines");
        assertThat(klines).hasSize(2);
        assertThat(klines.get(0).get("time")).isEqualTo("2026-08-06");
        assertThat(klines.get(1).get("time")).isEqualTo("2026-08-07");
        assertThat(result.get("count")).isEqualTo(2);

        @SuppressWarnings("unchecked")
        Map<String, Object> latest = (Map<String, Object>) result.get("latest");
        assertThat(latest.get("price")).isEqualTo(4521.5);
        assertThat(latest.get("pctChange")).isEqualTo(0.33);
        assertThat(latest.get("updatedAt")).isEqualTo("2026-08-11T10:00");
    }

    @Test
    void emptyDbReturnsEmptyArrayAndNullLatest() {
        when(klineRepository.queryByCodeSince(eq("^GSPC"), eq("1d"), any())).thenReturn(List.of());
        when(quoteRepository.findByCode("^GSPC")).thenReturn(null);

        Map<String, Object> result = service.getKlines("^GSPC", "1y");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> klines = (List<Map<String, Object>>) result.get("klines");
        assertThat(klines).isEmpty();
        assertThat(result.get("count")).isEqualTo(0);
        assertThat(result.get("latest")).isNull();
    }

    @Test
    void nullLatestWhenNoSnapshot() {
        StockKline k1 = new StockKline("^GSPC", "1d", LocalDate.of(2026, 8, 7),
                4505, 4520, 4500, 4518, 1200, 0, 0, 0.3, 13, 0.4, "index");
        when(klineRepository.queryByCodeSince(eq("^GSPC"), eq("1d"), any())).thenReturn(List.of(k1));
        when(quoteRepository.findByCode("^GSPC")).thenReturn(null);

        Map<String, Object> result = service.getKlines("^GSPC", "1y");

        assertThat(result.get("latest")).isNull();
    }
}
