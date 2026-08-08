package com.guyu.stock.stock;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.JdbcTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@JdbcTest
@ActiveProfiles("test")
class StockKlineRepositoryTest {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private StockKlineRepository repo;

    @BeforeEach
    void setUp() {
        repo = new StockKlineRepository(jdbcTemplate);
        jdbcTemplate.execute("DELETE FROM stock_kline");
        jdbcTemplate.update("INSERT INTO stock_kline (code, scale, trade_date, open, high, low, close, volume, amount) VALUES (?,?,?,?,?,?,?,?,?)",
                "600001", "1d", LocalDate.of(2026, 8, 5), 10.0, 11.0, 9.5, 10.5, 1000L, 10000.0);
        jdbcTemplate.update("INSERT INTO stock_kline (code, scale, trade_date, open, high, low, close, volume, amount) VALUES (?,?,?,?,?,?,?,?,?)",
                "600001", "1d", LocalDate.of(2026, 8, 6), 10.5, 12.0, 10.0, 11.5, 2000L, 20000.0);
    }

    @Test
    void queryByCodeReturnsDescOrder() {
        List<StockKline> rows = repo.queryByCode("600001", "1d", 10);
        assertThat(rows).hasSize(2);
        // repo 查询按 trade_date DESC（最新在前），由 service 反转成升序
        assertThat(rows.get(0).tradeDate()).isEqualTo(LocalDate.of(2026, 8, 6));
    }

    @Test
    void getLatestDateReturnsMostRecent() {
        LocalDate d = repo.getLatestDate("600001", "1d");
        assertThat(d).isEqualTo(LocalDate.of(2026, 8, 6));
    }

    @Test
    void getLatestDateReturnsNullWhenEmpty() {
        assertThat(repo.getLatestDate("000001", "1d")).isNull();
    }
}
