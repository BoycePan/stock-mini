package com.guyu.stock.stock;

import com.guyu.stock.dao.StockKlineRepository;
import com.guyu.stock.model.StockKline;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase.Replace;
import org.springframework.boot.test.autoconfigure.jdbc.JdbcTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

// 测试库需以 MODE=PostgreSQL 打开：batchUpsert 使用 ON CONFLICT DO NOTHING（H2 原生模式不认该语法，
// 且 H2 无法执行 PostgreSQL 的 ON CONFLICT (col) DO UPDATE ... EXCLUDED，batchUpsert 已按 H2 兜底改为 UPDATE+INSERT）。
// 使用独立内存库 kline_test，避免与 @SpringBootTest 共享的 health 库互相污染（与 ConceptRepositoryTest 一致）。
@JdbcTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = Replace.NONE)
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:kline_test;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE")
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

    @Test
    void batchUpsertInsertsNewRows() {
        repo.batchUpsert(List.of(
                new StockKline("600001", "1d", LocalDate.of(2026, 8, 7), 11.5, 12.5, 11.0, 12.0, 3000L,
                        36000.0, 0, 0, 0, 0, "stock")));
        List<StockKline> rows = repo.queryByCode("600001", "1d", 10);
        assertThat(rows).hasSize(3);
        assertThat(rows.get(0).tradeDate()).isEqualTo(LocalDate.of(2026, 8, 7)); // DESC 最新在前
    }

    @Test
    void batchUpsertUpdatesExistingRowOnConflict() {
        repo.batchUpsert(List.of(
                new StockKline("600001", "1d", LocalDate.of(2026, 8, 6), 99.0, 100.0, 98.0, 99.5, 5000L,
                        50000.0, 0, 0, 0, 0, "stock")));
        List<StockKline> rows = repo.queryByCode("600001", "1d", 10);
        assertThat(rows).hasSize(2); // 冲突行被更新，不新增
        StockKline updated = rows.stream()
                .filter(k -> k.tradeDate().equals(LocalDate.of(2026, 8, 6)))
                .findFirst().orElseThrow();
        assertThat(updated.open()).isEqualTo(99.0);
        assertThat(updated.close()).isEqualTo(99.5);
        assertThat(updated.volume()).isEqualTo(5000L);
    }
}
