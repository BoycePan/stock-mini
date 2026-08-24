package com.guyu.stock.service.region;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class Ip2RegionResolverTest {

    private final Ip2RegionResolver resolver = new Ip2RegionResolver();

    @Test
    void resolveKnownPublicChinaIpReturnsProvinceCity() {
        // 阿里公共 DNS：中国|浙江省|杭州市|阿里|CN → 浙江省-杭州市
        assertEquals("浙江省-杭州市", resolver.resolve("223.5.5.5"));
    }

    @Test
    void resolveCityZeroReturnsProvinceOnly() {
        // 中国|台湾省|0|中华电信|CN：城市字段为 0，仅返回省份
        assertEquals("台湾省", resolver.resolve("210.241.0.1"));
    }

    @Test
    void resolveMunicipalityReturnsProvinceOnly() {
        // 中国|北京市|北京市|腾讯|CN：直辖市省=市，仅返回省份
        assertEquals("北京市", resolver.resolve("119.29.29.29"));
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
