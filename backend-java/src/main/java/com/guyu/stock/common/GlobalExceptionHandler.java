package com.guyu.stock.common;

import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ResponseEntity<ApiResponse<Void>> handleBiz(BizException e) {
        // 对齐 Go：HTTP 恒 200，业务码在 body
        return ResponseEntity.ok(ApiResponse.error(e.getCode(), e.getMessage()));
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<ApiResponse<Void>> handleBadRequest(Exception e) {
        // 对齐 Go：缺参/请求体解析失败按 400 处理
        return ResponseEntity.ok(ApiResponse.error(ErrCode.INVALID_PARAM, ErrCode.msg(ErrCode.INVALID_PARAM)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnknown(Exception e) {
        // 对齐 Go Recovery 兜底
        return ResponseEntity.ok(ApiResponse.error(ErrCode.SERVER_ERROR, ErrCode.msg(ErrCode.SERVER_ERROR)));
    }
}
