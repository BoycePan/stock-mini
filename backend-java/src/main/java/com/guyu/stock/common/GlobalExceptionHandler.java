package com.guyu.stock.common;

import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.http.ResponseEntity;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ResponseEntity<ApiResponse<Void>> handleBiz(BizException e) {
        // 对齐 Go：HTTP 恒 200，业务码在 body
        return ResponseEntity.ok(ApiResponse.error(e.getCode(), e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnknown(Exception e) {
        // 对齐 Go Recovery 兜底
        return ResponseEntity.ok(ApiResponse.error(ErrCode.SERVER_ERROR, ErrCode.msg(ErrCode.SERVER_ERROR)));
    }
}
