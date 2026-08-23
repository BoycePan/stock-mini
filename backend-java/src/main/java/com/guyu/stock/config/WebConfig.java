package com.guyu.stock.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;
    private final MgrAuthInterceptor mgrAuthInterceptor;
    private final OptionalAuthInterceptor optionalAuthInterceptor;

    public WebConfig(AuthInterceptor authInterceptor, MgrAuthInterceptor mgrAuthInterceptor,
                     OptionalAuthInterceptor optionalAuthInterceptor) {
        this.authInterceptor = authInterceptor;
        this.mgrAuthInterceptor = mgrAuthInterceptor;
        this.optionalAuthInterceptor = optionalAuthInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {

        registry.addInterceptor(mgrAuthInterceptor)
                .addPathPatterns("/api/mgr/**")
                .excludePathPatterns("/api/mgr/login");

        // 打点上报：可选鉴权（有 token 解析 user_id，无 token 也放行，匿名落库）
        registry.addInterceptor(optionalAuthInterceptor)
                .addPathPatterns("/api/v1/track/**");


        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/v1/user/**")
                .addPathPatterns("/api/v1/**")
                .excludePathPatterns("/api/v1/auth/**");
    }
}
