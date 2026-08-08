package com.guyu.stock.common;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void bizExceptionMapsToErrorBody() {
        ResponseEntity<ApiResponse<Void>> resp = handler.handleBiz(new BizException(ErrCode.WX_LOGIN_FAIL, "微信登录失败"));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody().code()).isEqualTo(1003);
        assertThat(resp.getBody().msg()).isEqualTo("微信登录失败");
    }

    @Test
    void unknownExceptionMapsTo500() {
        ResponseEntity<ApiResponse<Void>> resp = handler.handleUnknown(new IllegalStateException("boom"));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody().code()).isEqualTo(500);
        assertThat(resp.getBody().msg()).isEqualTo("server error");
    }
}
