package com.guyu.stock.news;

import com.guyu.stock.dao.NewsRepository;
import com.guyu.stock.model.NewsRow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase.Replace;
import org.springframework.boot.test.autoconfigure.jdbc.JdbcTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

// 测试库需以 MODE=PostgreSQL 打开：batchSave 使用 ON CONFLICT DO NOTHING，H2 原生模式不认该语法。
// 使用独立内存库 news_test，避免与 @SpringBootTest 共享的 health 库互相污染（与 ConceptRepositoryTest 一致）。
@JdbcTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = Replace.NONE)
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:news_test;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE")
class NewsRepositoryTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    private NewsRepository repo;

    @BeforeEach
    void setUp() {
        repo = new NewsRepository(jdbcTemplate);
        jdbcTemplate.execute("DELETE FROM news_feed");
    }

    @Test
    void batchSaveAndQueryByStock() {
        repo.batchSave(List.of(
                new NewsRow("600519", "标题1", "摘要", "http://u/1", "新浪", "2026-08-05 10:30"),
                new NewsRow("600519", "标题2", "", "http://u/2", "新浪", "2026-08-06 09:00")));
        List<NewsRow> rows = repo.queryByStock("600519", 10);
        assertThat(rows).hasSize(2);
        assertThat(rows.get(0).title()).isEqualTo("标题2"); // 倒序
    }

    @Test
    void batchSaveDedupSameStockTitlePublishedAt() {
        // 同 stock_code + title + published_at 插入两次，uk_news_feed_dedup 冲突 → ON CONFLICT DO NOTHING 只落一条
        NewsRow row = new NewsRow("600519", "重复标题", "摘要", "http://u/1", "新浪", "2026-08-05 10:30");
        repo.batchSave(List.of(row, row));
        List<NewsRow> rows = repo.queryByStock("600519", 10);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).title()).isEqualTo("重复标题");
    }
}
