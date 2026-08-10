package com.guyu.stock.dao;

import com.guyu.stock.model.ConceptBoard;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

@Repository
public class ConceptRepository {

    private final JdbcTemplate jdbcTemplate;

    public ConceptRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<ConceptBoard> BOARD_MAPPER = (rs, i) -> new ConceptBoard(
            rs.getString("plate_code"), rs.getString("plate_name"), rs.getInt("cid"));

    public void upsertBoard(String plateCode, String plateName, int cid) {
        Timestamp now = Timestamp.valueOf(LocalDateTime.now());
        // 注意：H2(2.2.224/2.3.232) 无法执行 PostgreSQL 的 ON CONFLICT (col) DO UPDATE ... EXCLUDED（已验证），
        // 故用「先 UPDATE 后 INSERT + ON CONFLICT DO NOTHING」实现同样的按主键 upsert 语义（H2 测试库与生产 PG 均兼容）。
        int updated = jdbcTemplate.update(
                "UPDATE concept_board SET plate_name = ?, cid = ?, updated_at = ? WHERE plate_code = ?",
                plateName, cid, now, plateCode);
        if (updated == 0) {
            jdbcTemplate.update(
                    "INSERT INTO concept_board (plate_code, plate_name, cid, updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
                    plateCode, plateName, cid, now);
        }
    }

    public List<ConceptBoard> listBoards() {
        return jdbcTemplate.query("SELECT plate_code, plate_name, cid FROM concept_board ORDER BY plate_code", BOARD_MAPPER);
    }

    /** 全量替换板块成分股。@Transactional 保证 DELETE + INSERT 原子性（Task 7 修复：原手动 BEGIN/COMMIT 在连接池下是伪事务）。 */
    @Transactional
    public void replaceMembers(String plateCode, List<String> stockCodes) {
        if (stockCodes == null || stockCodes.isEmpty()) return;
        jdbcTemplate.update("DELETE FROM concept_stock WHERE plate_code = ?", plateCode);
        for (String code : stockCodes) {
            jdbcTemplate.update("INSERT INTO concept_stock (plate_code, stock_code) VALUES (?,?) ON CONFLICT DO NOTHING",
                    plateCode, code);
        }
    }

    public List<String> getMembers(String plateCode) {
        return jdbcTemplate.query("SELECT stock_code FROM concept_stock WHERE plate_code = ? ORDER BY stock_code",
                (rs, i) -> rs.getString(1), plateCode);
    }

    public int countBoards() {
        Integer n = jdbcTemplate.queryForObject("SELECT count(*) FROM concept_board", Integer.class);
        return n == null ? 0 : n;
    }
}
