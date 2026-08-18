package com.guyu.stock.asset;

import com.guyu.stock.model.AssetQuote;
import com.guyu.stock.service.YahooAssetService;
import com.guyu.stock.service.YahooQuoteService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 全球资产接口契约：list 按 type 过滤、fetch/sync 计数、非法 type 返回 400。 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GlobalAssetControllerTest {

    @Autowired private MockMvc mockMvc;
    @MockBean private YahooQuoteService yahooQuoteService;
    @MockBean private YahooAssetService yahooAssetService;

    @Test
    void listByTypeReturnsAssets() throws Exception {
        when(yahooQuoteService.listAssetQuotes("commodity", null, null)).thenReturn(List.of(
                new AssetQuote("GC=F", "黄金", "commodity", "global", "贵金属", 4401.9, 1.2, null, "06:00-05:00", true)));

        mockMvc.perform(get("/api/v1/asset/list").param("type", "commodity"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].code").value("GC=F"))
                .andExpect(jsonPath("$.data[0].type").value("commodity"))
                .andExpect(jsonPath("$.data[0].market").value("global"));
    }

    @Test
    void listByTypeForwardsTradingParam() throws Exception {
        when(yahooQuoteService.listAssetQuotes("commodity", null, true)).thenReturn(List.of(
                new AssetQuote("GC=F", "黄金", "commodity", "global", "贵金属", 4401.9, 1.2, null, "06:00-05:00", true)));

        mockMvc.perform(get("/api/v1/asset/list").param("type", "commodity").param("trading", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].code").value("GC=F"))
                .andExpect(jsonPath("$.data[0].isTrading").value(true));
    }

    @Test
    void fetchByTypeReturnsCounts() throws Exception {
        when(yahooAssetService.fetchAssets(anyList(), eq("commodity"), eq("1mo"))).thenReturn(15);

        mockMvc.perform(get("/api/v1/asset/fetch").param("type", "commodity").param("range", "1mo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.ok").value(15))
                .andExpect(jsonPath("$.data.total").value(15));
    }

    @Test
    void stockTypeResolves() throws Exception {
        when(yahooAssetService.fetchAssets(anyList(), eq("us-stock"), eq("1y"))).thenReturn(16);

        mockMvc.perform(get("/api/v1/asset/fetch").param("type", "stock"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.ok").value(16))
                .andExpect(jsonPath("$.data.total").value(16));
    }

    @Test
    void syncInfoReturnsCounts() throws Exception {
        when(yahooAssetService.syncAssetInfo(anyList(), eq("forex"))).thenReturn(5);

        mockMvc.perform(get("/api/v1/asset/sync-info").param("type", "forex"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.synced").value(5));
    }

    @Test
    void invalidTypeReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/asset/list").param("type", "equity"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }
}
