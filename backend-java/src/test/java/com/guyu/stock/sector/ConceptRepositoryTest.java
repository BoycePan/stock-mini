package com.guyu.stock.sector;

import com.guyu.stock.dao.ConceptRepository;
import com.guyu.stock.model.ConceptBoard;
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

// 测试库需以 MODE=PostgreSQL 打开：H2 原生模式不认 ON CONFLICT DO NOTHING（replaceMembers/getMembers 使用），
// 且 H2 无法执行 PostgreSQL 的 ON CONFLICT (col) DO UPDATE ... EXCLUDED（upsertBoard 已按 brief 的 H2 兜底改为 UPDATE+INSERT）。
// 使用独立内存库 concept_test，避免与 @SpringBootTest 共享的 health 库互相污染。
@JdbcTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = Replace.NONE)
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:concept_test;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE")
class ConceptRepositoryTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    private ConceptRepository repo;

    @BeforeEach
    void setUp() {
        repo = new ConceptRepository(jdbcTemplate);
        jdbcTemplate.execute("DELETE FROM concept_stock");
        jdbcTemplate.execute("DELETE FROM concept_board");
    }

    @Test
    void upsertAndListBoard() {
        repo.upsertBoard("885333", "人工智能", 300188);
        List<ConceptBoard> boards = repo.listBoards();
        assertThat(boards).hasSize(1);
        assertThat(boards.get(0).plateName()).isEqualTo("人工智能");
        assertThat(repo.countBoards()).isEqualTo(1);
    }

    @Test
    void replaceMembersAndGet() {
        repo.upsertBoard("885333", "人工智能", 300188);
        repo.replaceMembers("885333", List.of("600001", "000001"));
        assertThat(repo.getMembers("885333")).containsExactly("000001", "600001");
    }
}
