package com.guyu.stock.common;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(int code, String msg, T data) {

    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(ErrCode.SUCCESS, ErrCode.msg(ErrCode.SUCCESS), data);
    }

    public static ApiResponse<Void> ok() {
        return new ApiResponse<>(ErrCode.SUCCESS, ErrCode.msg(ErrCode.SUCCESS), null);
    }

    public static <T> ApiResponse<T> error(int code, String msg) {
        String m = (msg == null || msg.isBlank()) ? ErrCode.msg(code) : msg;
        return new ApiResponse<>(code, m, null);
    }
}
