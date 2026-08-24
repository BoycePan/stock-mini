package com.guyu.stock.service.region;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.annotation.PreDestroy;
import org.lionsoul.ip2region.service.Config;
import org.lionsoul.ip2region.service.Ip2Region;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;

/**
 * 离线 ip2region 区域解析（{@link RegionResolver} 默认实现）。
 *
 * <p>数据文件 {@code ip2region_v4.xdb}（约 11MB）打包在 classpath，启动时经
 * {@code setXdbInputStream} + {@code BufferCache} 全量读入内存（不落临时文件、
 * 查询零磁盘 IO、并发安全）。仅打包 IPv4 数据（v6 文件约 37MB，暂不打包），
 * IPv6 查询返回 null。
 *
 * <p>fail-open：xdb 缺失 / 加载失败时记 ERROR 日志，{@code ip2Region} 置 null，
 * 所有解析返回 null，不影响打点接口主流程。
 *
 * <p>查询结果按 IP 做 Caffeine 缓存（1 万条 / 24h），批量上报同 IP 只查一次。
 */
@Service
public class Ip2RegionResolver implements RegionResolver {

    private static final Logger log = LoggerFactory.getLogger(Ip2RegionResolver.class);

    /** classpath 下的 v4 数据文件 */
    private static final String XDB_RESOURCE = "/ip2region/ip2region_v4.xdb";
    private static final String CN = "中国";
    private static final String ZERO = "0";

    /** 加载失败时为 null（fail-open） */
    private final Ip2Region ip2Region;
    private final Cache<String, String> cache;

    public Ip2RegionResolver() {
        this.ip2Region = load();
        this.cache = Caffeine.newBuilder()
                .maximumSize(10_000)
                .expireAfterWrite(Duration.ofHours(24))
                .build();
    }

    @Override
    public String resolve(String ip) {
        if (ip == null || ip.isBlank() || ip2Region == null) {
            return null;
        }
        return cache.get(ip, this::doResolve);
    }

    /** 原始串形如「中国|0|广东省|深圳市|电信」，解析为「省-市」；国家非中国或省份为 0 → null；城市为 0 时仅返回省份（直辖市/仅省级数据） */
    private String doResolve(String ip) {
        try {
            return toProvinceCity(ip2Region.search(ip));
        } catch (Exception e) {
            // 非法 IP / 查询失败：不抛异常，返回 null
            return null;
        }
    }

    private String toProvinceCity(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String[] parts = raw.split("\\|");
        if (parts.length < 5) return null;
        if (!CN.equals(parts[0])) return null;          // 只统计国内用户区域
        String province = parts[2];
        String city = parts[3];
        if (province == null || province.isBlank() || ZERO.equals(province)) return null;
        if (city == null || city.isBlank() || ZERO.equals(city)) return province;
        return province + "-" + city;
    }

    private Ip2Region load() {
        try (var in = Ip2RegionResolver.class.getResourceAsStream(XDB_RESOURCE)) {
            if (in == null) {
                log.error("[region] xdb 资源缺失: {}", XDB_RESOURCE);
                return null;
            }
            Config v4 = Config.custom()
                    .setCachePolicy(Config.BufferCache)
                    .setXdbInputStream(in)
                    .asV4();
            return Ip2Region.create(v4, null);
        } catch (Exception e) {
            log.error("[region] ip2region 初始化失败，区域解析降级为 null（打点接口不受影响）", e);
            return null;
        }
    }

    @PreDestroy
    public void close() {
        if (ip2Region != null) {
            try {
                ip2Region.close();
            } catch (Exception e) {
                log.warn("[region] ip2region 关闭失败", e);
            }
        }
    }
}
