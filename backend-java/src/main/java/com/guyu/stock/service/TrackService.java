package com.guyu.stock.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.config.AppProperties;
import com.guyu.stock.dao.TrackRepository;
import com.guyu.stock.model.TrackEvent;
import com.guyu.stock.model.ClickEvent;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 用户行为事件落库编排（对齐 news / rss 服务的分层：Controller 只做参数解包，这里做校验 + 组装）。
 *
 * <p>处理流程：
 * <ol>
 *   <li>校验批量体（非空、不超上限、每条 eventId / eventName 必填）；</li>
 *   <li>按配置截断超长字符串，防止脏数据 / 超大 payload 撑爆字段；</li>
 *   <li>把客户端 {@code props} 序列化为 JSON 字符串（生产库可 {@code ::jsonb} 查询）；</li>
 *   <li>补充服务端 {@code userId}（登录态可选解析，未登录为 null）与 {@code ip}；</li>
 *   <li>批量落库，返回 accepted / duplicated / invalid 统计。</li>
 * </ol>
 */
@Service
public class TrackService {

    private final TrackRepository trackRepository;
    private final AppProperties.Tracking cfg;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public TrackService(TrackRepository trackRepository, AppProperties appProperties) {
        this.trackRepository = trackRepository;
        this.cfg = appProperties.getTracking();
    }

    public Map<String, Object> ingest(List<TrackEvent> events, Long userId, String ip) {
        if (events == null || events.isEmpty()) {
            throw new BizException(ErrCode.INVALID_PARAM, "events 不能为空");
        }
        int maxBatch = Math.max(1, cfg.getMaxBatchSize());
        if (events.size() > maxBatch) {
            throw new BizException(ErrCode.INVALID_PARAM, "单批最多 " + maxBatch + " 条");
        }

        List<ClickEvent> rows = new ArrayList<>();
        int invalid = 0;
        for (TrackEvent e : events) {
            if (!valid(e)) {
                invalid++;
                continue;
            }
            rows.add(toRow(e, userId, ip));
        }
        int accepted = trackRepository.batchInsert(rows);
        // duplicated = 有效但 event_id 已存在（幂等跳过）的条数
        int duplicated = rows.size() - accepted;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("accepted", accepted);
        result.put("duplicated", duplicated);
        result.put("invalid", invalid);
        return result;
    }

    private boolean valid(TrackEvent e) {
        if (e == null) return false;
        if (e.eventId() == null || e.eventId().isBlank()) return false;
        if (e.eventName() == null || e.eventName().isBlank()) return false;
        return true;
    }

    private ClickEvent toRow(TrackEvent e, Long userId, String ip) {
        return new ClickEvent(
                truncate(e.eventId(), 64),
                userId,
                truncate(e.sessionId(), 64),
                truncate(e.eventType(), 32),
                truncate(e.eventName(), 128),
                truncate(e.page(), 128),
                truncate(e.target(), 128),
                serializeProps(e.props()),
                clampInt(e.durationMs()),
                e.clientTs(),
                truncate(ip, 64),
                truncate(e.platform(), 32),
                truncate(e.appVersion(), 32));
    }

    private String serializeProps(Object props) {
        if (props == null) return null;
        try {
            return objectMapper.writeValueAsString(props);
        } catch (JsonProcessingException ex) {
            // 极端情况下 props 无法序列化：降级为 null，不阻塞整批落库
            return null;
        }
    }

    private String truncate(String value, int max) {
        if (value == null) return null;
        return value.length() <= max ? value : value.substring(0, max);
    }

    private Integer clampInt(Integer value) {
        if (value == null) return null;
        // 停留时长上限 24h（毫秒），避免异常值污染统计
        return Math.min(value, 86_400_000);
    }
}
