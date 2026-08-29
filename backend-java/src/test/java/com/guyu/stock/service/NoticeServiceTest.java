package com.guyu.stock.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.dao.NoticeRepository;
import com.guyu.stock.model.Notice;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class NoticeServiceTest {

    private final NoticeRepository repository = mock(NoticeRepository.class);
    private final NoticeService service = new NoticeService(repository, new ObjectMapper());

    @BeforeEach
    void setUp() {
        when(repository.findById(anyLong())).thenReturn(java.util.Optional.empty());
    }

    private Notice notice(long id, String type, String target, String position, boolean pinned, int sort, String config) {
        return new Notice(id, type, "标题", target, position, sort, pinned, true,
                null, null, config, null, null);
    }

    @Test
    void createValidInsertsAndReturns() {
        when(repository.insert(anyString(), any(), anyString(), anyString(), anyInt(),
                anyBoolean(), anyBoolean(), any(), any(), anyString())).thenReturn(5L);
        when(repository.findById(5L)).thenReturn(java.util.Optional.of(
                notice(5, "banner", "hangQing-tracker", "home", true, 1, "{\"content\":\"hi\"}")));

        Map<String, Object> result = service.create("banner", "标题", "hangQing-tracker", "home",
                1, true, true, null, null, "{\"content\":\"hi\"}");

        assertEquals(5L, result.get("id"));
        assertEquals("banner", result.get("type"));
        assertEquals("hangQing-tracker", result.get("target"));
        assertEquals("home", result.get("position"));
        verify(repository).insert("banner", "标题", "hangQing-tracker", "home", 1, true, true, null, null, "{\"content\":\"hi\"}");
    }

    @Test
    void createRejectsInvalidConfigJson() {
        BizException ex = assertThrows(BizException.class,
                () -> service.create("notice", "t", "all", "settings", null, null, true, null, null, "not-json"));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
        verify(repository, never()).insert(anyString(), any(), anyString(), anyString(), anyInt(),
                anyBoolean(), anyBoolean(), any(), any(), anyString());
    }

    @Test
    void createRejectsNonObjectConfig() {
        BizException ex = assertThrows(BizException.class,
                () -> service.create("notice", "t", "all", "settings", null, null, true, null, null, "\"plain\""));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
    }

    @Test
    void createRejectsReversedPeriod() {
        BizException ex = assertThrows(BizException.class,
                () -> service.create("notice", "t", "all", "settings", null, null, true,
                        "2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z", "{\"content\":\"x\"}"));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
    }

    @Test
    void listPublicParsesConfigAndFiltersFields() {
        when(repository.findEnabledForDisplay("hangQing-tracker", "settings"))
                .thenReturn(List.of(notice(1, "notice", "all", "settings", false, 0, "{\"content\":\"hello\",\"icon\":\"🚀\"}")));

        List<Map<String, Object>> list = service.listPublic("hangQing-tracker", "settings");

        assertEquals(1, list.size());
        Map<String, Object> row = list.get(0);
        assertEquals(1L, row.get("id"));
        Map<?, ?> config = (Map<?, ?>) row.get("config");
        assertEquals("hello", config.get("content"));
        assertEquals("🚀", config.get("icon"));
        // 公开列表不暴露 enabled/validity 内部字段
        assertNull(row.get("enabled"));
        assertNull(row.get("validFrom"));
    }

    @Test
    void listPublicWithoutPositionReturnsAllPositions() {
        when(repository.findEnabledForTarget("all"))
                .thenReturn(List.of(notice(1, "notice", "all", "settings", false, 0, "{\"content\":\"x\"}")));

        service.listPublic(null, null);

        verify(repository).findEnabledForTarget("all");
    }
}
