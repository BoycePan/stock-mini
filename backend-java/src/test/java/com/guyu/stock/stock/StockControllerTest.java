package com.guyu.stock.stock;

import com.guyu.stock.external.cninfo.CninfoClient;
import com.guyu.stock.external.sina.SinaNewsClient;
import com.guyu.stock.external.ths.ThsClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class StockControllerTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;

    // SectorController 依赖 ThsClient（Task 9 才会注册为 bean），此处 mock 以满足上下文装配
    @MockBean private ThsClient thsClient;

    // NewsController 依赖 SinaNewsClient/CninfoClient（Task 9 才会注册为 bean），此处 mock 以满足上下文装配
    @MockBean private SinaNewsClient sinaNewsClient;

    @MockBean private CninfoClient cninfoClient;

    @BeforeEach
    void setUp() {
        jdbcTemplate.execute("DELETE FROM stock_kline");
        jdbcTemplate.execute("DELETE FROM stock_info");
        jdbcTemplate.update("INSERT INTO stock_info (code, name, type, market, board, industry, is_active, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                "600519", "贵州茅台", "stock", "sh", "main", "白酒", true, java.sql.Timestamp.valueOf("2026-08-07 10:00:00"));
        jdbcTemplate.update("INSERT INTO stock_kline (code, scale, trade_date, open, high, low, close, volume, amount) VALUES (?,?,?,?,?,?,?,?,?)",
                "600519", "1d", LocalDate.of(2026, 8, 6), 1700.0, 1720.0, 1690.0, 1710.0, 10000L, 17000000.0);
        jdbcTemplate.update("INSERT INTO stock_kline (code, scale, trade_date, open, high, low, close, volume, amount) VALUES (?,?,?,?,?,?,?,?,?)",
                "600519", "1d", LocalDate.of(2026, 8, 7), 1710.0, 1730.0, 1700.0, 1725.0, 12000L, 20000000.0);
    }

    @Test
    void klinesReturnsAscendingAndShapeMatchesGo() throws Exception {
        mockMvc.perform(get("/api/v1/stock/600519/klines").param("scale", "240").param("count", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.code").value("600519"))
                .andExpect(jsonPath("$.data.scale").value("240"))
                .andExpect(jsonPath("$.data.count").value(2))
                .andExpect(jsonPath("$.data.klines[0].time").value("2026-08-06"))
                .andExpect(jsonPath("$.data.klines[1].time").value("2026-08-07"))
                .andExpect(jsonPath("$.data.klines[0].open").value(1700.0))
                .andExpect(jsonPath("$.data.klines[0].volume").value(10000));
    }

    @Test
    void searchReturnsKeywordCountAndStocks() throws Exception {
        mockMvc.perform(get("/api/v1/stock/search").param("q", "茅台"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.keyword").value("茅台"))
                .andExpect(jsonPath("$.data.count").value(1))
                .andExpect(jsonPath("$.data.stocks[0].code").value("600519"))
                .andExpect(jsonPath("$.data.stocks[0].name").value("贵州茅台"))
                .andExpect(jsonPath("$.data.stocks[0].is_active").value(true))
                .andExpect(jsonPath("$.data.stocks[0].updated_at").doesNotExist());
    }

    @Test
    void missingQReturns400WithGoMessage() throws Exception {
        mockMvc.perform(get("/api/v1/stock/search"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.msg").value("q 参数必填"));
    }

    @Test
    void missingScaleReturns400WithGoMessage() throws Exception {
        mockMvc.perform(get("/api/v1/stock/600519/klines"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.msg").value("scale 参数必填，例如 ?scale=240"));
    }

    @Test
    void missingCodesReturns400WithGoMessage() throws Exception {
        mockMvc.perform(get("/api/v1/stock/quotes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.msg").value("codes 参数必填，逗号分隔"));
    }
}
