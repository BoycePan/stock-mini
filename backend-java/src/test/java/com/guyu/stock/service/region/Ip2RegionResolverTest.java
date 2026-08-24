package com.guyu.stock.service.region;

import org.junit.jupiter.api.Test;

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
