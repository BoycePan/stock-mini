package com.guyu.stock.util;

import cn.hutool.core.date.DateUtil;

/**
 * 新闻更新工具包
 */
public class NewsUpdateUtil {
    // volatile：保证跨线程可见性，写线程更新后读线程立即可见（无需加锁）
    private static volatile long UPDATE_TIME = DateUtil.current();

    public static void updateTime() {
        UPDATE_TIME = DateUtil.current();
    }

    public static boolean needToPullNews(long lastPullTime) {
        return UPDATE_TIME >  lastPullTime;
    }
}
