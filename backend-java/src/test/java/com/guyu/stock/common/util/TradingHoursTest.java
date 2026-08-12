package com.guyu.stock.common.util;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/** 交易时段工具：时段字符串映射、crypto 恒开市、跨天时段按开盘日判断周末（时差修正）。 */
class TradingHoursTest {

    // 2026-08-11 周二；8/14 周五，8/15 周六，8/16 周日，8/17 周一
    @Test
    void cryptoAlwaysOpen() {
        assertThat(TradingHours.isTrading("crypto", "global")).isTrue();
    }

    @Test
    void hoursStringMapping() {
        assertThat(TradingHours.tradingHours("crypto", "global")).isEqualTo("24H");
        assertThat(TradingHours.tradingHours("commodity", "global")).isEqualTo("06:00-05:00");
        assertThat(TradingHours.tradingHours("forex", "global")).isEqualTo("05:00-05:00");
        assertThat(TradingHours.tradingHours("index", "us")).isEqualTo("21:30-04:00");
        assertThat(TradingHours.tradingHours("index", "cn")).isEqualTo("09:30-15:02");
        assertThat(TradingHours.tradingHours("sector", "us")).isEqualTo("21:30-04:00");
    }

    @Test
    void unknownMarketReturnsNullHoursAndDefaultOpen() {
        assertThat(TradingHours.tradingHours("index", "unknown-xx")).isNull();
        assertThat(TradingHours.isTrading("index", "unknown-xx")).isTrue();
    }

    @Test
    void usMarketCrossMidnightHandlesWeekend() {
        // 美股 21:30-04:00 跨天：北京时间周末凌晨实际是美国周五盘
        LocalDateTime fri2200 = LocalDateTime.of(2026, 8, 14, 22, 0);
        LocalDateTime sat0200 = LocalDateTime.of(2026, 8, 15, 2, 0);  // 美国周五下午
        LocalDateTime sat2200 = LocalDateTime.of(2026, 8, 15, 22, 0); // 美国周六
        LocalDateTime mon0200 = LocalDateTime.of(2026, 8, 17, 2, 0);  // 美国周日下午
        LocalDateTime mon2200 = LocalDateTime.of(2026, 8, 17, 22, 0); // 美国周一

        assertThat(TradingHours.isTrading("index", "us", fri2200)).isTrue();
        assertThat(TradingHours.isTrading("index", "us", sat0200)).isTrue();
        assertThat(TradingHours.isTrading("index", "us", sat2200)).isFalse();
        assertThat(TradingHours.isTrading("index", "us", mon0200)).isFalse();
        assertThat(TradingHours.isTrading("index", "us", mon2200)).isTrue();
    }

    @Test
    void nonCrossMidnightMarketUsesLocalWeekend() {
        // A股 09:30-15:02 白天时段，北京时间周末=本地周末
        assertThat(TradingHours.isTrading("index", "cn", LocalDateTime.of(2026, 8, 14, 10, 0))).isTrue();
        assertThat(TradingHours.isTrading("index", "cn", LocalDateTime.of(2026, 8, 15, 10, 0))).isFalse();
        // 欧洲 15:00-23:30 白天时段同理
        assertThat(TradingHours.isTrading("index", "de", LocalDateTime.of(2026, 8, 14, 16, 0))).isTrue();
        assertThat(TradingHours.isTrading("index", "de", LocalDateTime.of(2026, 8, 16, 16, 0))).isFalse();
    }

    @Test
    void cnMarketHasCloseSettleBuffer() {
        // 15:00 收盘后留 2 分钟结算缓冲（半开区间 [09:30, 15:02)）：15:00/15:01 仍算交易时段，让定时任务补刷收盘集合竞价最终价
        assertThat(TradingHours.isTrading("index", "cn", LocalDateTime.of(2026, 8, 14, 15, 0))).isTrue();
        assertThat(TradingHours.isTrading("index", "cn", LocalDateTime.of(2026, 8, 14, 15, 1))).isTrue();
        assertThat(TradingHours.isTrading("index", "cn", LocalDateTime.of(2026, 8, 14, 15, 3))).isFalse();
    }

    @Test
    void commodityWeekendFollowsOpenDay() {
        // 商品 06:00-05:00 跨天：周六凌晨 02:00 是周五盘，周六 10:00 起休市，周一 02:00 仍是周日盘
        assertThat(TradingHours.isTrading("commodity", "global", LocalDateTime.of(2026, 8, 15, 2, 0))).isTrue();
        assertThat(TradingHours.isTrading("commodity", "global", LocalDateTime.of(2026, 8, 15, 10, 0))).isFalse();
        assertThat(TradingHours.isTrading("commodity", "global", LocalDateTime.of(2026, 8, 17, 2, 0))).isFalse();
        assertThat(TradingHours.isTrading("commodity", "global", LocalDateTime.of(2026, 8, 17, 10, 0))).isTrue();
    }

    @Test
    void forexWeekendFollowsOpenDay() {
        // 外汇 05:00-05:00：周六凌晨 02:00 是周五盘，周六 05:00 起休市，周一 02:00 仍休市
        assertThat(TradingHours.isTrading("forex", "global", LocalDateTime.of(2026, 8, 15, 2, 0))).isTrue();
        assertThat(TradingHours.isTrading("forex", "global", LocalDateTime.of(2026, 8, 15, 10, 0))).isFalse();
        assertThat(TradingHours.isTrading("forex", "global", LocalDateTime.of(2026, 8, 17, 2, 0))).isFalse();
        assertThat(TradingHours.isTrading("forex", "global", LocalDateTime.of(2026, 8, 17, 10, 0))).isTrue();
    }
}
