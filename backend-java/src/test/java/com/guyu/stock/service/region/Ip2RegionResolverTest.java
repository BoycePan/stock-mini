package com.guyu.stock.service.region;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Ip2RegionResolverTest {

    private final Ip2RegionResolver resolver = new Ip2RegionResolver();

    @Test
    void resolveKnownPublicChinaIpReturnsProvinceCity() {
        // 阿里公共 DNS（浙江杭州）：只断言「省-市」格式，不断言具体城市（数据文件会更新）
        String region = resolver.resolve("223.5.5.5");
        assertNotNull(region, "公网中国 IP 应能解析出区域");
        assertTrue(region.contains("-"), "期望「省-市」格式，实际: " + region);
    }

    @Test
    void resolveCityZeroReturnsProvinceOnly() {
        // 114DNS（江苏南京），原始串「中国|江苏省|南京市|0|CN」：城市字段（第 4 段）为 0 → 仅返回省份字段，不拼「省-市」
        String region = resolver.resolve("114.114.114.114");
        assertNotNull(region, "城市字段为 0 的公网中国 IP 应能解析出省份");
        assertFalse(region.isBlank(), "返回应为非空白省份，实际: " + region);
        assertFalse(region.contains("-"), "城市为 0 时应仅返回省份（不含「-」），实际: " + region);
    }

    @Test
    void resolvePrivateIpReturnsNull() {
        assertNull(resolver.resolve("127.0.0.1"));
        assertNull(resolver.resolve("10.0.0.1"));
        assertNull(resolver.resolve("192.168.1.1"));
    }

    @Test
    void resolveInvalidIpReturnsNull() {
        assertNull(resolver.resolve("not-an-ip"));
        assertNull(resolver.resolve("999.999.1.1"));
    }

    @Test
    void resolveBlankOrNullReturnsNull() {
        assertNull(resolver.resolve(""));
        assertNull(resolver.resolve(null));
    }

    @Test
    void resolveIpv6ReturnsNull() {
        // 未打包 v6 xdb，IPv6 查询返回 null
        assertNull(resolver.resolve("240e:3b7:3272:d8d0:db09:c067:8d59:539e"));
    }
}
