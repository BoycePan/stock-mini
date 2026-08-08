package com.guyu.stock.common;

import java.util.Map;

public final class ErrCode {
    public static final int SUCCESS = 200;
    public static final int SERVER_ERROR = 500;
    public static final int INVALID_PARAM = 400;
    public static final int UNAUTHORIZED = 401;
    public static final int FORBIDDEN = 403;
    public static final int NOT_FOUND = 404;

    public static final int TOKEN_INVALID = 1001;
    public static final int TOKEN_MISSING = 1002;
    public static final int WX_LOGIN_FAIL = 1003;

    private static final Map<Integer, String> MESSAGES = Map.ofEntries(
            Map.entry(SUCCESS, "success"),
            Map.entry(SERVER_ERROR, "server error"),
            Map.entry(INVALID_PARAM, "param error"),
            Map.entry(UNAUTHORIZED, "unauthorized"),
            Map.entry(FORBIDDEN, "forbidden"),
            Map.entry(NOT_FOUND, "not found"),
            Map.entry(TOKEN_INVALID, "token 无效或已过期"),
            Map.entry(TOKEN_MISSING, "缺少 token"),
            Map.entry(WX_LOGIN_FAIL, "微信登录失败")
    );

    private ErrCode() {}

    public static String msg(int code) {
        return MESSAGES.getOrDefault(code, "unknown error");
    }
}
