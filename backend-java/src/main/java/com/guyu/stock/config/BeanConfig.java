package com.guyu.stock.config;

import com.guyu.stock.auth.JwtService;
import com.guyu.stock.common.fetcher.DataSource;
import com.guyu.stock.external.cninfo.CninfoClient;
import com.guyu.stock.external.sina.SinaClient;
import com.guyu.stock.external.sina.SinaInfoClient;
import com.guyu.stock.external.sina.SinaKlineClient;
import com.guyu.stock.external.sina.SinaNewsClient;
import com.guyu.stock.external.ths.ThsClient;
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

    // ---------- C 阶段：外部采集数据源与客户端 ----------

    @Bean
    public DataSource sinaSource() {
        return DataSource.sina();
    }

    @Bean
    public DataSource thsSource() {
        return DataSource.ths();
    }

    @Bean
    public DataSource cninfoSource() {
        return DataSource.cninfo();
    }

    @Bean
    public SinaKlineClient sinaKlineClient(DataSource sinaSource) {
        return new SinaKlineClient(sinaSource, 1000);
    }

    @Bean
    public SinaInfoClient sinaInfoClient(DataSource sinaSource) {
        return new SinaInfoClient(sinaSource);
    }

    @Bean
    public SinaNewsClient sinaNewsClient(DataSource sinaSource) {
        return new SinaNewsClient(sinaSource, 1000);
    }

    @Bean
    public ThsClient thsClient(DataSource thsSource) {
        return new ThsClient(thsSource, 1000);
    }

    @Bean
    public CninfoClient cninfoClient(DataSource cninfoSource) {
        return new CninfoClient(cninfoSource, 1000);
    }
}
