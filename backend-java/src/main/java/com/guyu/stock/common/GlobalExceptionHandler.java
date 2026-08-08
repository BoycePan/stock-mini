package com.guyu.stock.common;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BizException.class)
    public ResponseEntity<ApiResponse<Void>> handleBiz(BizException e) {
        // 对齐 Go：HTTP 恒 200，业务码在 body
        log.warn("biz error code={} msg={}", e.getCode(), e.getMessage(), e);
        return ResponseEntity.ok(ApiResponse.error(e.getCode(), e.getMessage()));
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<ApiResponse<Void>> handleBadRequest(Exception e) {
        // 对齐 Go：缺参/请求体解析失败按 400 处理
        return ResponseEntity.ok(ApiResponse.error(ErrCode.INVALID_PARAM, ErrCode.msg(ErrCode.INVALID_PARAM)));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiResponse<Void>> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return ResponseEntity.ok(ApiResponse.error(ErrCode.INVALID_PARAM, ErrCode.msg(ErrCode.INVALID_PARAM)));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(NoResourceFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiResponse.error(ErrCode.NOT_FOUND, ErrCode.msg(ErrCode.NOT_FOUND)));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleMethodNotAllowed(HttpRequestMethodNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(ApiResponse.error(ErrCode.NOT_FOUND, ErrCode.msg(ErrCode.NOT_FOUND)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnknown(Exception e) {
        // 对齐 Go Recovery 兜底
        log.error("unhandled exception", e);
        return ResponseEntity.ok(ApiResponse.error(ErrCode.SERVER_ERROR, ErrCode.msg(ErrCode.SERVER_ERROR)));
    }
}
