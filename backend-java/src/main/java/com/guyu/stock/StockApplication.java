package com.guyu.stock;

import com.guyu.stock.config.ConfigLoader;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableAsync
@EnableScheduling
public class StockApplication {
    public static void main(String[] args) {
        // 从 config.yaml 读取数据库/微信/JWT/新浪配置（对齐 Go 版 config.Load()）
        ConfigLoader.load();
        SpringApplication.run(StockApplication.class, args);
    }
}
