package com.guyu.stock;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.util.TimeZone;

@SpringBootApplication
@EnableAsync
@EnableScheduling
public class StockApplication {
    public static void main(String[] args) {
        // 落库时间统一按东8区（Asia/Shanghai）写入/读取。
        // DAO 用 LocalDateTime.now()/Timestamp 依赖 JVM 默认时区，若不在启动时钉死，
        // 在 UTC 等环境下运行会导致 created_at/updated_at 等字段偏移 8 小时。
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
        // 配置来自工作目录 .env（spring-dotenv 启动时加载）或环境变量，键名见 .env.example / README 配置说明
        SpringApplication.run(StockApplication.class, args);
    }
}
