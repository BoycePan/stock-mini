package com.guyu.stock.health;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class HealthController {

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/api/health")
    public Map<String, String> health() {
        try {
            jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            return Map.of("status", "ok", "database", "connected");
        } catch (Exception e) {
            return Map.of("status", "degraded", "database", "disconnected: " + e.getMessage());
        }
    }
}
