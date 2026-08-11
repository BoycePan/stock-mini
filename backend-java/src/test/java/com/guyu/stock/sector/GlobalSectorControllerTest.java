package com.guyu.stock.sector;

import com.guyu.stock.model.SectorQuote;
import com.guyu.stock.service.YahooQuoteService;
import com.guyu.stock.service.YahooSectorService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 全球板块接口契约（镜像 SectorControllerTest 的 @SpringBootTest + MockMvc 风格）。 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GlobalSectorControllerTest {

    @Autowired private MockMvc mockMvc;
    @MockBean private YahooQuoteService yahooQuoteService;
    @MockBean private YahooSectorService yahooSectorService;

    @Test
    void listReturnsSectorQuotesGrouped() throws Exception {
        when(yahooQuoteService.listSectorQuotes(null)).thenReturn(List.of(
                new SectorQuote("XLK", "科技", "us", "industry", 200.5, 1.2, null, "21:30-04:00", true),
                new SectorQuote("SMH", "半导体", "us", "theme", 250.0, 0.8, null, "21:30-04:00", true)));

        mockMvc.perform(get("/api/v1/global-sector/list"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].code").value("XLK"))
                .andExpect(jsonPath("$.data[0].market").value("us"))
                .andExpect(jsonPath("$.data[0].board").value("industry"))
                .andExpect(jsonPath("$.data[1].board").value("theme"));
    }

    @Test
    void listFiltersByMarket() throws Exception {
        when(yahooQuoteService.listSectorQuotes("us")).thenReturn(List.of(
                new SectorQuote("GLD", "黄金", "us", "theme", 402.5, 1.0, null, "21:30-04:00", true)));

        mockMvc.perform(get("/api/v1/global-sector/list").param("market", "us"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].code").value("GLD"))
                .andExpect(jsonPath("$.data[0].market").value("us"));
    }

    @Test
    void klinesReturnsShape() throws Exception {
        Map<String, Object> result = new HashMap<>();
        result.put("code", "XLK");
        result.put("range", "1y");
        result.put("scale", "1d");
        result.put("count", 0);
        result.put("klines", List.of());
        result.put("latest", null); // Map.of 不允许 null 值，这里用 HashMap
        when(yahooSectorService.getKlines(eq("XLK"), eq("1y"))).thenReturn(result);

        mockMvc.perform(get("/api/v1/global-sector/XLK/klines"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.code").value("XLK"))
                .andExpect(jsonPath("$.data.scale").value("1d"));
    }

    @Test
    void fetchSectorsReturnsCounts() throws Exception {
        when(yahooSectorService.fetchSectors("1y")).thenReturn(44);

        mockMvc.perform(get("/api/v1/global-sector/fetch-sectors"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.ok").value(44))
                .andExpect(jsonPath("$.data.total").value(44));
    }

    @Test
    void syncInfoReturnsCounts() throws Exception {
        when(yahooSectorService.syncSectorInfo()).thenReturn(44);

        mockMvc.perform(get("/api/v1/global-sector/sync-info"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.synced").value(44));
    }
}
