package com.guyu.stock.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;
    private final MgrAuthInterceptor mgrAuthInterceptor;

    public WebConfig(AuthInterceptor authInterceptor, MgrAuthInterceptor mgrAuthInterceptor) {
        this.authInterceptor = authInterceptor;
        this.mgrAuthInterceptor = mgrAuthInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/v1/user/**");

        registry.addInterceptor(mgrAuthInterceptor)
                .addPathPatterns("/api/mgr/**")
                .excludePathPatterns("/api/mgr/login");


//        registry.addInterceptor(authInterceptor)
//                .addPathPatterns("/api/v1/user/**")
//                .addPathPatterns("/api/v1/**")
//                .excludePathPatterns("/api/v1/auth/**");
    }
}
