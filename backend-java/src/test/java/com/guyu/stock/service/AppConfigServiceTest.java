package com.guyu.stock.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.dao.AppConfigRepository;
import com.guyu.stock.model.AppConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AppConfigServiceTest {

    private final AppConfigRepository repository = mock(AppConfigRepository.class);
    private final AppConfigService service = new AppConfigService(repository, new ObjectMapper());

    @BeforeEach
    void setUp() {
        when(repository.findById(anyLong())).thenReturn(java.util.Optional.empty());
    }

    private AppConfig item(long id, Long parentId, String nodeType, String cfgType, String cfgKey,
                           String cfgValue, String target, boolean enabled) {
        return new AppConfig(id, parentId, nodeType, cfgType, cfgKey, cfgValue, null, target, 0, enabled, null);
    }

    // ---------------- deliveryMap（树形摊平 + all/source 深合并） ----------------

    @Test
    void deliveryMapFlattensStandaloneItems() {
        when(repository.findEnabledByTypeAndTarget("display", "shiChang-tracker"))
                .thenReturn(List.of(
                        item(1, null, "item", "display", "home.show_gold", "true", "all", true),
                        item(2, null, "item", "display", "home.banner_text", "\"hi\"", "all", true)));

        Map<String, Object> map = service.deliveryMap("shiChang-tracker", "display");

        assertEquals(Boolean.TRUE, map.get("home.show_gold"));
        assertEquals("hi", map.get("home.banner_text"));
    }

    @Test
    void deliveryMapNestsGroupChildren() {
        when(repository.findEnabledByTypeAndTarget("display", "all"))
                .thenReturn(List.of(
                        item(10, null, "group", "display", "home", null, "all", true),
                        item(11, 10L, "item", "display", "show_gold", "true", "all", true),
                        item(12, 10L, "item", "display", "banner_text", "\"hi\"", "all", true)));

        Map<String, Object> map = service.deliveryMap("all", "display");

        Map<?, ?> home = (Map<?, ?>) map.get("home");
        assertEquals(Boolean.TRUE, home.get("show_gold"));
        assertEquals("hi", home.get("banner_text"));
    }

    @Test
    void deliveryMapSourceOverridesAllWithDeepMerge() {
        when(repository.findEnabledByTypeAndTarget("display", "hangQing-tracker"))
                .thenReturn(List.of(
                        // all 兜底：home 分组带两个子项
                        item(10, null, "group", "display", "home", null, "all", true),
                        item(11, 10L, "item", "display", "show_gold", "true", "all", true),
                        item(12, 10L, "item", "display", "banner_text", "\"默认\"", "all", true),
                        // 指定端覆盖：只改 show_gold，banner_text 保留 all 的值
                        item(20, null, "group", "display", "home", null, "hangQing-tracker", true),
                        item(21, 20L, "item", "display", "show_gold", "false", "hangQing-tracker", true)));

        Map<String, Object> map = service.deliveryMap("hangQing-tracker", "display");

        Map<?, ?> home = (Map<?, ?>) map.get("home");
        assertEquals(Boolean.FALSE, home.get("show_gold"));
        assertEquals("默认", home.get("banner_text"));
    }

    @Test
    void deliveryMapEmptyWhenNoEnabledRows() {
        // enabled 过滤发生在 SQL 层（findEnabledByTypeAndTarget 已 WHERE enabled=TRUE）
        when(repository.findEnabledByTypeAndTarget("login", "all")).thenReturn(List.of());

        Map<String, Object> map = service.deliveryMap("all", "login");

        assertTrue(map.isEmpty());
    }

    // ---------------- create 校验 ----------------

    @Test
    void createRejectsUnknownCfgType() {
        BizException ex = assertThrows(BizException.class,
                () -> service.create(null, "item", "bogus", "k", "true", null, "all", null, null));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
    }

    @Test
    void createRejectsInvalidJson() {
        BizException ex = assertThrows(BizException.class,
                () -> service.create(null, "item", "display", "k", "not-json", null, "all", null, null));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
    }

    @Test
    void createRejectsDuplicateKey() {
        when(repository.keyExistsInScope(anyString(), isNull(), anyString(), eq(0L))).thenReturn(true);

        BizException ex = assertThrows(BizException.class,
                () -> service.create(null, "item", "display", "dup", "true", null, "all", null, null));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
        verify(repository, never()).insert(anyLong(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyInt(), anyBoolean());
    }

    @Test
    void createGroupRejectsCfgValue() {
        BizException ex = assertThrows(BizException.class,
                () -> service.create(null, "group", "display", "g", "{\"a\":1}", null, "all", null, null));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
    }

    @Test
    void createChildRejectsCfgTypeMismatchWithParent() {
        // 父分组 cfg_type=display，子项传 login → 拒绝
        when(repository.findById(10L)).thenReturn(java.util.Optional.of(
                item(10, null, "group", "display", "home", null, "all", true)));

        BizException ex = assertThrows(BizException.class,
                () -> service.create(10L, "item", "login", "flag", "true", null, "all", null, null));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
        verify(repository, never()).insert(anyLong(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyInt(), anyBoolean());
    }

    // ---------------- delete ----------------

    @Test
    void deleteRejectsGroupWithChildren() {
        when(repository.findById(10L)).thenReturn(java.util.Optional.of(
                item(10, null, "group", "display", "home", null, "all", true)));
        when(repository.hasChildren(10L)).thenReturn(true);

        BizException ex = assertThrows(BizException.class, () -> service.delete(10L));
        assertEquals(ErrCode.INVALID_PARAM, ex.getCode());
        verify(repository, never()).delete(10L);
    }

    @Test
    void deleteAllowsEmptyGroup() {
        when(repository.findById(10L)).thenReturn(java.util.Optional.of(
                item(10, null, "group", "display", "home", null, "all", true)));
        when(repository.hasChildren(10L)).thenReturn(false);

        service.delete(10L);

        verify(repository).delete(10L);
    }
}
