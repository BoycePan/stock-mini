package com.guyu.stock.config;

import com.guyu.stock.auth.JwtService;
import com.guyu.stock.external.sina.SinaClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class BeanConfig {

    @Bean
    public JwtService jwtService(AppProperties appProperties) {
        return new JwtService(appProperties.getJwt());
    }

    @Bean
    public SinaClient sinaClient(AppProperties appProperties) {
        return new SinaClient(appProperties.getSina());
    }
}
