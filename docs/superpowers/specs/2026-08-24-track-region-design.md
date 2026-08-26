# 设计：打点接口（/api/v1/track/events）支持用户区域字段

> 日期：2026-08-24
> 状态：已确认（用户批准）
> 范围：后端 `backend-java/`（本轮为后端打点功能的延续，上一轮 `d3002e7` 已实现打点上报接口）

## 一、背景与目标

打点接口 `POST /api/v1/track/events` 目前落 `click_event` 表，字段不含用户区域。
产品分析需要知道「用户来自哪个区域」。目标：

1. 前端可主动上报区域（`region` 字段），后端原样落库；
2. 前端未上报时，后端按客户端 IP 解析归属地（省 + 市）兜底；
3. 兜底方案采用**离线 ip2region xdb**，并通过 `RegionResolver` 抽象预留未来切换在线 API 的扩展位。

## 二、接口契约变更

`events` 数组元素新增**可选字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| region | string | 否 | 用户区域，形如 `广东省-深圳市`；前端传了原样落库（截断 64），空串/不传则后端按 IP 解析 |

- 后端不校验前端 region 的格式，前端说了算（原样存储）。
- 不新增任何 `app.tracking` 配置项（用户明确要求不加配置）。

## 三、后端逻辑（TrackService）

每条事件的区域取值优先级：

```
region = 前端 region 非空 ? 前端值（截断 64） : RegionResolver.resolve(ip)
```

- 前端传了 → 直接用；
- 前端没传 → `RegionResolver.resolve(ip)` 产出 `省-市`（如 `广东省-深圳市`）；
- 解析不到（内网 IP / 127.0.0.1 / 解析失败 / 非中国区域）→ null，不阻塞落库。

`ip` 的取值沿用 `TrackController.clientIp()`（优先 `X-Forwarded-For` 第一个，否则 `RemoteAddr`）。

## 四、RegionResolver 抽象

新接口（`service/region/RegionResolver.java`）：

```java
public interface RegionResolver {
    /** 返回「省份-城市」，如「广东省-深圳市」；无法解析返回 null */
    String resolve(String ip);
}
```

实现 `Ip2RegionResolver`（离线 xdb）：

- 依赖 `org.lionsoul:ip2region`（Maven Central，v3.x，支持 IPv4/IPv6）；
- xdb 数据文件固定 classpath 资源：`src/main/resources/ip2region/ip2region.xdb`（约 11MB），启动时加载；
- xdb 缺失 / 加载失败：记 ERROR 日志，`resolve()` 一律返回 null（fail-open，打点接口不受影响）；
- Caffeine 缓存 IP → 区域（约 1 万条，同 IP 只查一次，单次亚毫秒级）；
- xdb 记录格式为「国家|省|市|ISP|国家码」（如「中国|广东省|广州市|移动|CN」），解析映射取省=第 2 列、市=第 3 列拼 `省-市`；国家非中国或省份为 0 → null；城市为 0 或省=市（直辖市）时仅返回省份。

未来切换在线 API：新增 `OnlineRegionResolver` 实现同一接口，替换 Bean 即可，TrackService 零改动。

## 五、数据落库

- `click_event` 表新增列：`region VARCHAR(64)`；
  - 生产执行（**由用户自行执行**）：

    ```sql
    ALTER TABLE click_event ADD COLUMN IF NOT EXISTS region VARCHAR(64);
    COMMENT ON COLUMN click_event.region IS '用户区域（省-市），前端上报优先，否则按 IP 解析';
    ```

  - 测试库 `src/test/resources/schema.sql` 同步加列；
  - 生产 DDL 脚本 `scripts/click_event.sql` 同步更新（供新环境建表使用）。
- `TrackEvent`（客户端入参）增加 `region` 字段（可选）；
- `ClickEvent`（入库行）增加 `region` 字段；
- `TrackRepository.batchInsert` 的 INSERT 语句与参数同步加 `region`。

## 六、测试

- `RegionResolver` 单测（`Ip2RegionResolverTest`）：
  - 已知公网 IP → 返回 `省-市` 格式；
  - 内网 / 非法 IP → null；
  - IPv6 地址可解析（或安全返回 null，不抛异常）。
- `TrackService` 优先级测试：
  - 前端传 region → 落前端值（不被 IP 解析覆盖）；
  - 前端没传 → 落 IP 解析值；
  - 解析失败 → null。

## 七、文档

- `docs/API.md`「七、用户行为打点」字段表加 `region`；
- `docs/埋点打点方案.md` 契约与 SDK 骨架注明 `region` 可选上报；
- 新建 `docs/每日修改记录/2026-08-24.md` 记录本次接口变更（新增可选字段 + 后端兜底逻辑）；
- 发布提醒：生产库先执行上文的 `ALTER TABLE` 再加列（用户自行执行）。

## 八、非目标（YAGNI）

- 不做前端埋点 SDK（`front/utils/tracker.ts` 由他人实现，本轮只改后端契约 + 文档）；
- 不加 `app.tracking` 配置项（用户明确要求）；
- 不做在线 IP 归属 API 实现（只留 `RegionResolver` 抽象扩展位）。
