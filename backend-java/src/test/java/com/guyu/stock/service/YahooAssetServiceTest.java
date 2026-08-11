package com.guyu.stock.service;

import com.guyu.stock.dao.StockInfoRepository;
import com.guyu.stock.dao.StockKlineRepository;
import com.guyu.stock.dao.YahooQuoteRepository;
import com.guyu.stock.external.yahoo.YahooAsset;
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

/** 全球资产服务：K线查询结构、空库空数组、落库 type 正确、元数据 market/board 正确。 */
class YahooAssetServiceTest {

    private final YahooKlineClient client = mock(YahooKlineClient.class);
    private final StockKlineRepository klineRepository = mock(StockKlineRepository.class);
    private final StockInfoRepository infoRepository = mock(StockInfoRepository.class);
    private final YahooQuoteRepository quoteRepository = mock(YahooQuoteRepository.class);

    private final YahooAssetService service =
            new YahooAssetService(client, klineRepository, infoRepository, quoteRepository);

    @Test
    void getKlinesReturnsStructureAndAttachesLatest() {
        StockKline k1 = new StockKline("GC=F", "1d", LocalDate.of(2026, 8, 6),
                4400, 4420, 4390, 4410, 1000, 0, 0, 0.3, 10, 0.4, "commodity");
        when(klineRepository.queryByCodeSince(eq("GC=F"), eq("1d"), any())).thenReturn(List.of(k1));
        when(quoteRepository.findByCode("GC=F")).thenReturn(
                new QuoteSnapshot("GC=F", "黄金", 4415.0, 0.2, LocalDateTime.of(2026, 8, 11, 10, 0)));

        Map<String, Object> result = service.getKlines("GC=F", "5d");

        assertThat(result.get("code")).isEqualTo("GC=F");
        assertThat(result.get("scale")).isEqualTo("1d");
        assertThat(result.get("count")).isEqualTo(1);
        @SuppressWarnings("unchecked")
        Map<String, Object> latest = (Map<String, Object>) result.get("latest");
        assertThat(latest.get("price")).isEqualTo(4415.0);
    }

    @Test
    void emptyDbReturnsEmptyArrayAndNullLatest() {
        when(klineRepository.queryByCodeSince(eq("GC=F"), eq("1d"), any())).thenReturn(List.of());
        when(quoteRepository.findByCode("GC=F")).thenReturn(null);

        Map<String, Object> result = service.getKlines("GC=F", "1y");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> klines = (List<Map<String, Object>>) result.get("klines");
        assertThat(klines).isEmpty();
        assertThat(result.get("latest")).isNull();
    }

    @Test
    void fetchAssetPersistsGivenType() {
        when(client.getKLine("GC=F", "1mo", "1d")).thenReturn(List.of(
                new YahooKlineClient.KLine("2026-08-07 00:00", 4400, 4420, 4390, 4410, 1000),
                new YahooKlineClient.KLine("2026-08-06 00:00", 4380, 4400, 4370, 4390, 900)));

        int n = service.fetchAsset("GC=F", "commodity", "1mo");

        assertThat(n).isEqualTo(2);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<StockKline>> captor = ArgumentCaptor.forClass(List.class);
        verify(klineRepository).batchUpsert(captor.capture());
        assertThat(captor.getValue()).allMatch(k -> k.type().equals("commodity"));
        assertThat(captor.getValue()).allMatch(k -> k.code().equals("GC=F"));
    }

    @Test
    void syncAssetInfoRegistersTypeAndMarket() {
        int n = service.syncAssetInfo(YahooAsset.COMMODITIES, "commodity");

        assertThat(n).isEqualTo(17);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<StockInfo>> captor = ArgumentCaptor.forClass(List.class);
        verify(infoRepository).batchUpsert(captor.capture());
        assertThat(captor.getValue()).hasSize(17);
        assertThat(captor.getValue()).allMatch(i -> i.type().equals("commodity"));
        assertThat(captor.getValue()).allMatch(i -> i.market().equals("global"));
        assertThat(captor.getValue()).allMatch(i -> i.board() != null && !i.board().isBlank());
    }
}
