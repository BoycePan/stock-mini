package com.guyu.stock.stock;

import com.guyu.stock.external.sina.SinaKlineClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class KlineFallbackTest {

    @Autowired private MockMvc mockMvc;
    @MockBean private SinaKlineClient sinaKlineClient;

    @Test
    void minuteScaleFetchesFromSina() throws Exception {
        when(sinaKlineClient.getKLine(anyString(), anyString(), anyInt()))
                .thenReturn(new SinaKlineClient.KLineResult("600519", "60",
                        List.of(new SinaKlineClient.KLine("2026-08-05 14:55:00", 1700, 1720, 1690, 1710, 10000)), 1));
        mockMvc.perform(get("/api/v1/stock/600519/klines").param("scale", "60").param("count", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.scale").value("60"))
                .andExpect(jsonPath("$.data.klines[0].time").value("2026-08-05 14:55:00"));
    }
}
