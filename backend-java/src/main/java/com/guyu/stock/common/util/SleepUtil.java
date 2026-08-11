package com.guyu.stock.common.util;

/**
 * 统一 sleep + 中断恢复：消除散落在 DataSource/SinaInfoClient/YahooIndexService 的重复 try/catch InterruptedException。
 * 注意：调用方若需区分「被中断」行为（如重试循环里 break / 返回 false），请自行实现，不要用本工具。
 */
public final class SleepUtil {

    private SleepUtil() {}

    /** 睡 ms 毫秒；被中断时恢复中断标记并返回（不抛 InterruptedException） */
    public static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
