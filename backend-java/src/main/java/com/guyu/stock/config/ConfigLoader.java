package com.guyu.stock.config;

import org.yaml.snakeyaml.Yaml;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.Map;

/**
 * 从 YAML 配置文件加载配置（对齐 Go 版 config.Load()）。
 *
 * <p>读取路径：默认当前工作目录的 {@code config.yaml}，可用环境变量 {@code CONFIG_PATH} 覆盖。
 * 将配置值映射为 System properties，供 {@code application.yml} 中的 {@code ${DB_HOST}} 等占位符解析
 * （Spring 占位符优先解析 System property，其次环境变量）。
 *
 * <p>在 {@code SpringApplication.run()} 之前调用，仅对 main 启动生效，不影响 {@code @SpringBootTest}。
 */
public final class ConfigLoader {

    private ConfigLoader() {}

    public static String resolvePath() {
        String p = System.getenv("CONFIG_PATH");
        return (p == null || p.isBlank()) ? "config.yaml" : p;
    }

    public static void load() {
        load(resolvePath());
    }

    public static void load(String path) {
        try {
            String content = Files.readString(Path.of(path));
            Map<String, Object> root = yaml(content);
            applyDatabase(map(root, "database"));
            applyJwt(map(root, "jwt"));
            applyWechat(map(root, "wechat"));
            applySina(map(map(root, "stock"), "sina"));
        } catch (Exception e) {
            throw new IllegalStateException("读取配置文件失败: " + path + " (" + e.getMessage() + ")", e);
        }
    }

    // ---------- 映射 ----------

    private static void applyDatabase(Map<String, Object> db) {
        set("DB_HOST", db.get("host"));
        set("DB_PORT", db.get("port"));
        set("DB_NAME", db.get("name"));
        set("DB_USER", db.get("user"));
        set("DB_PASSWORD", db.get("password"));
    }

    private static void applyJwt(Map<String, Object> jwt) {
        set("JWT_SECRET", jwt.get("secret"));
        set("JWT_EXPIRE_HOURS", jwt.get("expire_hours"));
    }

    private static void applyWechat(Map<String, Object> wechat) {
        set("WECHAT_APP_ID", wechat.get("app_id"));
        set("WECHAT_APP_SECRET", wechat.get("app_secret"));
    }

    private static void applySina(Map<String, Object> sina) {
        set("SINA_RATE_LIMIT", sina.get("rate_limit"));
        set("SINA_MAX_RETRIES", sina.get("max_retries"));
        set("SINA_TIMEOUT", sina.get("timeout"));
    }

    // ---------- 工具 ----------

    @SuppressWarnings("unchecked")
    private static Map<String, Object> yaml(String content) {
        Object v = new Yaml().load(content);
        return v instanceof Map ? (Map<String, Object>) v : Collections.emptyMap();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Map<String, Object> parent, String key) {
        Object v = parent.get(key);
        return v instanceof Map ? (Map<String, Object>) v : Collections.emptyMap();
    }

    private static void set(String name, Object value) {
        if (value != null) System.setProperty(name, String.valueOf(value));
    }
}
