package com.guyu.stock.rss;

import com.guyu.stock.dao.RssSourceRepository;
import com.guyu.stock.model.RssSource;
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

// 测试库需以 MODE=PostgreSQL 打开：insertIfAbsent 使用 ON CONFLICT DO NOTHING，H2 原生模式不认该语法。
// 使用独立内存库 rss_test，避免与 @SpringBootTest 共享的 health 库互相污染（与 NewsRepositoryTest 一致）。
@JdbcTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = Replace.NONE)
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:rss_test;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE")
class RssSourceRepositoryTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    private RssSourceRepository repo;

    @BeforeEach
    void setUp() {
        repo = new RssSourceRepository(jdbcTemplate);
        jdbcTemplate.execute("DELETE FROM rss_source");
    }

    @Test
    void insertIfAbsentAndFindEnabled() {
        repo.insertIfAbsent("少数派", "https://sspai.com/feed", false);
        repo.insertIfAbsent("Yahoo Finance", "https://finance.yahoo.com/news/rssindex", true);
        // enabled=false 的源应被过滤
        jdbcTemplate.update("UPDATE rss_source SET enabled = FALSE WHERE name = '少数派'");

        List<RssSource> sources = repo.findEnabled();
        assertThat(sources).hasSize(1);
        assertThat(sources.get(0).name()).isEqualTo("Yahoo Finance");
        assertThat(sources.get(0).url()).isEqualTo("https://finance.yahoo.com/news/rssindex");
        assertThat(sources.get(0).viaWorker()).isTrue();
    }

    @Test
    void insertIfAbsentDedupByUrl() {
        // 同 URL 插两次，uk_rss_source_url 冲突 → ON CONFLICT DO NOTHING 只落一条
        repo.insertIfAbsent("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html", false);
        repo.insertIfAbsent("CNBC 重复", "https://www.cnbc.com/id/100003114/device/rss/rss.html", false);
        assertThat(repo.count()).isEqualTo(1);
    }
}
