package com.guyu.stock.service;

import com.guyu.stock.dao.StockInfoRepository;
import com.guyu.stock.dao.StockKlineRepository;
import com.guyu.stock.dao.YahooQuoteRepository;
import com.guyu.stock.external.yahoo.YahooKlineClient;
import com.guyu.stock.model.QuoteSnapshot;
import com.guyu.stock.model.StockInfo;
import com.guyu.stock.model.StockKline;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

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

/** 板块服务：K线查询结构、空库空数组、落库 type='sector'、元数据 board 分类。镜像 YahooIndexServiceTest。 */
class YahooSectorServiceTest {

    private final YahooKlineClient client = mock(YahooKlineClient.class);
    private final StockKlineRepository klineRepository = mock(StockKlineRepository.class);
    private final StockInfoRepository infoRepository = mock(StockInfoRepository.class);
    private final YahooQuoteRepository quoteRepository = mock(YahooQuoteRepository.class);

    private final YahooSectorService service =
            new YahooSectorService(client, klineRepository, infoRepository, quoteRepository);

    @Test
    void getKlinesReturnsStructureAndAttachesLatest() {
        StockKline k1 = new StockKline("XLK", "1d", LocalDate.of(2026, 8, 6),
                200, 205, 199, 204, 1000, 0, 0, 0.5, 4, 1.0, "sector");
        when(klineRepository.queryByCodeSince(eq("XLK"), eq("1d"), any())).thenReturn(List.of(k1));
        when(quoteRepository.findByCode("XLK")).thenReturn(
                new QuoteSnapshot("XLK", "科技", 204.5, 0.25, LocalDateTime.of(2026, 8, 11, 10, 0)));

        Map<String, Object> result = service.getKlines("XLK", "5d");

        assertThat(result.get("code")).isEqualTo("XLK");
        assertThat(result.get("range")).isEqualTo("5d");
        assertThat(result.get("scale")).isEqualTo("1d");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> klines = (List<Map<String, Object>>) result.get("klines");
        assertThat(klines).hasSize(1);
        assertThat(klines.get(0).get("time")).isEqualTo("2026-08-06");
        assertThat(result.get("count")).isEqualTo(1);
        @SuppressWarnings("unchecked")
        Map<String, Object> latest = (Map<String, Object>) result.get("latest");
        assertThat(latest.get("price")).isEqualTo(204.5);
        assertThat(latest.get("pctChange")).isEqualTo(0.25);
    }

    @Test
    void emptyDbReturnsEmptyArrayAndNullLatest() {
        when(klineRepository.queryByCodeSince(eq("XLK"), eq("1d"), any())).thenReturn(List.of());
        when(quoteRepository.findByCode("XLK")).thenReturn(null);

        Map<String, Object> result = service.getKlines("XLK", "1y");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> klines = (List<Map<String, Object>>) result.get("klines");
        assertThat(klines).isEmpty();
        assertThat(result.get("count")).isEqualTo(0);
        assertThat(result.get("latest")).isNull();
    }

    @Test
    void fetchSectorPersistsTypeSector() {
        when(client.getKLine("XLK", "1mo", "1d")).thenReturn(List.of(
                new YahooKlineClient.KLine("2026-08-07 00:00", 200, 205, 199, 204, 1000),
                new YahooKlineClient.KLine("2026-08-06 00:00", 198, 201, 197, 200, 900)));

        int n = service.fetchSector("XLK", "1mo");

        assertThat(n).isEqualTo(2);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<StockKline>> captor = ArgumentCaptor.forClass(List.class);
        verify(klineRepository).batchUpsert(captor.capture());
        assertThat(captor.getValue()).hasSize(2);
        assertThat(captor.getValue()).allMatch(k -> k.type().equals("sector"));
        assertThat(captor.getValue()).allMatch(k -> k.code().equals("XLK"));
    }

    @Test
    void syncSectorInfoRegistersWithBoardCategory() {
        int n = service.syncSectorInfo();

        assertThat(n).isEqualTo(45);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<StockInfo>> captor = ArgumentCaptor.forClass(List.class);
        verify(infoRepository).batchUpsert(captor.capture());
        assertThat(captor.getValue()).hasSize(45);
        assertThat(captor.getValue()).allMatch(i -> i.type().equals("sector"));
        assertThat(captor.getValue()).allMatch(i -> i.market().equals("us") || i.market().equals("global"));
        assertThat(captor.getValue()).allMatch(i -> i.board().equals("industry") || i.board().equals("theme"));
    }
}
