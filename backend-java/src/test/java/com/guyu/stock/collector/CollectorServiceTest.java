package com.guyu.stock.collector;

import com.guyu.stock.external.sina.SinaInfoClient;
import com.guyu.stock.external.sina.SinaKlineClient;
import com.guyu.stock.external.ths.ThsClient;
import com.guyu.stock.sector.ConceptRepository;
import com.guyu.stock.stock.StockInfoRepository;
import com.guyu.stock.stock.StockKlineRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@SpringBootTest
@ActiveProfiles("test")
class CollectorServiceTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private StockInfoRepository stockInfoRepository;
    @Autowired private StockKlineRepository stockKlineRepository;
    @Autowired private ConceptRepository conceptRepository;

    @MockBean private SinaInfoClient sinaInfoClient;
    @MockBean private SinaKlineClient sinaKlineClient;
    @MockBean private ThsClient thsClient;

    @Test
    void refreshStockInfoUpsertsIntoDb() {
        when(sinaInfoClient.fetchStockList()).thenReturn(List.of(
                new SinaInfoClient.SinaStock("600519", "贵州茅台", "sh", "main")));
        when(sinaInfoClient.fetchIndustryMap()).thenReturn(Map.of("600519", "白酒"));

        CollectorService service = new CollectorService(sinaInfoClient, sinaKlineClient, thsClient,
                stockInfoRepository, stockKlineRepository, conceptRepository);
        service.refreshStockInfo();

        var rows = jdbcTemplate.queryForList("SELECT code, industry FROM stock_info WHERE code='600519'");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("industry")).isEqualTo("白酒");
    }

    @Test
    void runFullWithSampleUpsertsKlines() {
        when(sinaInfoClient.fetchStockList()).thenReturn(List.of(
                new SinaInfoClient.SinaStock("600001", "A", "sh", "main"),
                new SinaInfoClient.SinaStock("000001", "B", "sz", "main")));
        when(sinaInfoClient.fetchIndustryMap()).thenReturn(Map.of());
        when(sinaKlineClient.getKLine(anyString(), anyString(), anyInt())).thenReturn(
                new SinaKlineClient.KLineResult("600001", "240",
                        List.of(new SinaKlineClient.KLine("2026-08-05", 10, 11, 9, 10.5, 1000)), 1));

        CollectorService service = new CollectorService(sinaInfoClient, sinaKlineClient, thsClient,
                stockInfoRepository, stockKlineRepository, conceptRepository);
        int processed = service.runFull(1); // 只处理前 1 只
        assertThat(processed).isEqualTo(1);

        var rows = jdbcTemplate.queryForList("SELECT code FROM stock_kline WHERE code='600001' AND scale='1d'");
        assertThat(rows).hasSize(1);
    }
}
