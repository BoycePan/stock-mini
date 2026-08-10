package com.guyu.stock;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableAsync
@EnableScheduling
public class StockApplication {
    public static void main(String[] args) {
        // 配置来自工作目录 .env（spring-dotenv 启动时加载）或环境变量，键名见 .env.example / README 配置说明
        SpringApplication.run(StockApplication.class, args);
    }
}
