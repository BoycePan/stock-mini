package com.guyu.stock.service.region;

/**
 * 用户区域解析（打点接口 region 兜底）。
 *
 * <p>当前实现 {@link Ip2RegionResolver} 走离线 ip2region v4 xdb；未来如需切换
 * 在线 IP 归属 API，新增实现替换 Bean 即可，调用方（TrackService）零改动。
 */
public interface RegionResolver {

    /**
     * 按 IP 解析用户区域，返回「省份-城市」格式（如 {@code 广东省-深圳市}）。
     *
     * @param ip 客户端 IP（IPv4 / IPv6 字符串）
     * @return 区域字符串；解析不到（内网/非法 IP、IPv6 未启用、非中国区域、加载失败）返回 null
     */
    String resolve(String ip);
}
