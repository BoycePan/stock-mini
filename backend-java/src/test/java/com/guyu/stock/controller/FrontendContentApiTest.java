package com.guyu.stock.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guyu.stock.service.JwtService;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 前端配置与公告（app_config + notice）全栈接口测试：
 * 管理端 /api/mgr/configs、/api/mgr/notices（CRUD + 校验）
 * 公开端 /api/v1/configs、/api/v1/notices（鉴权 + 树形摊平 + 有效期过滤）
 * 登录接口 config 下发由 AuthServiceTest 覆盖（mock 层），此处覆盖真实 HTTP 层。
 *
 * <p>H2 内存库（MODE=PostgreSQL），schema 见 src/test/resources/schema.sql（已含两张新表）。
 * 测试方法间数据隔离：{@code @Transactional} 每个用例回滚。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
@TestMethodOrder(MethodOrderer.MethodName.class)
class FrontendContentApiTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JwtService jwtService;

    private static final String ADMIN_TOKEN = "cm9vdEBRd2VyMTIzNEBA"; // root@Qwer1234@@ 的 base64

    // ---------------- 管理端鉴权 ----------------

    @Test
    void mgrLoginWrongPasswordRejects() throws Exception {
        mockMvc.perform(post("/api/mgr/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"root\",\"password\":\"wrong\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void mgrLoginOk() throws Exception {
        mockMvc.perform(post("/api/mgr/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"root\",\"password\":\"Qwer1234@@\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data").isNotEmpty());
    }

    @Test
    void mgrEndpointsRejectWithoutAdminToken() throws Exception {
        mockMvc.perform(get("/api/mgr/configs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1002)); // 缺少 token
    }

    // ---------------- 配置管理 + 公开读取 ----------------

    @Test
    void configTreeCrudAndPublicDelivery() throws Exception {
        // 建分组 home（target=all）→ 子项 showGold=true、bannerText=今日金价
        long groupAll = createConfig(Map.of(
                "nodeType", "group", "cfgType", "display", "cfgKey", "home",
                "remark", "首页配置", "target", "all"), ADMIN_TOKEN);
        createConfig(Map.of(
                "parentId", groupAll, "nodeType", "item", "cfgType", "display",
                "cfgKey", "showGold", "cfgValue", "true", "target", "all"), ADMIN_TOKEN);
        createConfig(Map.of(
                "parentId", groupAll, "nodeType", "item", "cfgType", "display",
                "cfgKey", "bannerText", "cfgValue", "\"今日金价\"", "target", "all"), ADMIN_TOKEN);
        // 同 key 分组（target=hangQing-tracker）→ 只覆盖子项 showGold=false（深合并）
        long groupHq = createConfig(Map.of(
                "nodeType", "group", "cfgType", "display", "cfgKey", "home",
                "target", "hangQing-tracker"), ADMIN_TOKEN);
        createConfig(Map.of(
                "parentId", groupHq, "nodeType", "item", "cfgType", "display",
                "cfgKey", "showGold", "cfgValue", "false", "target", "hangQing-tracker"), ADMIN_TOKEN);

        // 管理端列表：平铺 5 条，含 parentId
        MvcResult list = mockMvc.perform(get("/api/mgr/configs")
                        .header("Authorization", "Bearer " + ADMIN_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.length()").value(5))
                .andReturn();
        JsonNode listData = objectMapper.readTree(list.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)).path("data");
        boolean groupHasChildren = false;
        for (JsonNode n : listData) {
            if ("group".equals(n.path("nodeType").asText()) && n.path("id").asLong() == groupAll) {
                groupHasChildren = true;
            }
        }
        assertTrue(groupHasChildren, "管理端列表应包含分组行");

        // 公开端：hangQing-tracker 读取 → home 嵌套对象，showGold 被深合并覆盖为 false，bannerText 保留 all 值
        MvcResult delivery = mockMvc.perform(get("/api/v1/configs")
                        .param("source", "hangQing-tracker")
                        .param("cfgType", "display")
                        .header("Authorization", "Bearer " + userToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andReturn();
        JsonNode home = objectMapper.readTree(delivery.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))
                .path("data").path("home");
        assertEquals(false, home.path("showGold").asBoolean());
        assertEquals("今日金价", home.path("bannerText").asText());

        // 更新：改分组 remark + sort
        mockMvc.perform(put("/api/mgr/configs/" + groupAll)
                        .header("Authorization", "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "remark", "首页配置(改)", "sort", 5))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.remark").value("首页配置(改)"))
                .andExpect(jsonPath("$.data.sort").value(5));

        // 删除分组（还有子项）→ 拒绝
        mockMvc.perform(delete("/api/mgr/configs/" + groupAll)
                        .header("Authorization", "Bearer " + ADMIN_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void configValidationRejects() throws Exception {
        // 非法 cfgType
        mockMvc.perform(post("/api/mgr/configs")
                        .header("Authorization", "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nodeType\":\"item\",\"cfgType\":\"bogus\",\"cfgKey\":\"k\",\"cfgValue\":\"true\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));

        // 非法 JSON 值
        mockMvc.perform(post("/api/mgr/configs")
                        .header("Authorization", "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nodeType\":\"item\",\"cfgType\":\"display\",\"cfgKey\":\"k2\",\"cfgValue\":\"not-json\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));

        // cfgKey 重复（同父级 + 同端）
        createConfig(Map.of("nodeType", "item", "cfgType", "display", "cfgKey", "dupKey",
                "cfgValue", "true", "target", "all"), ADMIN_TOKEN);
        mockMvc.perform(post("/api/mgr/configs")
                        .header("Authorization", "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nodeType\":\"item\",\"cfgType\":\"display\",\"cfgKey\":\"dupKey\",\"cfgValue\":\"false\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void publicConfigsRequireUserToken() throws Exception {
        mockMvc.perform(get("/api/v1/configs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1002)); // 缺少用户 token
    }

    // ---------------- 公告管理 + 公开读取 ----------------

    @Test
    void noticeCrudAndPublicList() throws Exception {
        // 建一条 banner（含有效期），置顶
        MvcResult created = mockMvc.perform(post("/api/mgr/notices")
                        .header("Authorization", "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "type", "banner", "title", "小程序全新上线",
                                "target", "all", "position", "settings",
                                "sort", 0, "pinned", true, "enabled", true,
                                "validFrom", "2026-01-01T00:00:00Z", "validTo", "2030-01-01T00:00:00Z",
                                "config", "{\"icon\":\"🚀\",\"content\":\"更多模块持续更新中\"}"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andReturn();
        long id = objectMapper.readTree(created.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))
                .path("data").path("id").asLong();

        // 公开列表（当前在有效期内）→ 返回且 config 解析为对象
        mockMvc.perform(get("/api/v1/notices")
                        .param("source", "all")
                        .param("position", "settings")
                        .header("Authorization", "Bearer " + userToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].id").value(id))
                .andExpect(jsonPath("$.data[0].type").value("banner"))
                .andExpect(jsonPath("$.data[0].pinned").value(true))
                .andExpect(jsonPath("$.data[0].config.icon").value("🚀"))
                .andExpect(jsonPath("$.data[0].config.content").value("更多模块持续更新中"));

        // 更新：改 title + 清除 validTo（长期有效）
        mockMvc.perform(put("/api/mgr/notices/" + id)
                        .header("Authorization", "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("title", "改后标题", "validTo", ""))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.title").value("改后标题"));

        // 删除
        mockMvc.perform(delete("/api/mgr/notices/" + id)
                        .header("Authorization", "Bearer " + ADMIN_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));
    }

    @Test
    void noticeValidationRejects() throws Exception {
        // config 不是 JSON
        mockMvc.perform(post("/api/mgr/notices")
                        .header("Authorization", "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"notice\",\"config\":\"not-json\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));

        // config 不是对象
        mockMvc.perform(post("/api/mgr/notices")
                        .header("Authorization", "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"notice\",\"config\":\"\\\"plain\\\"\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));

        // 有效期倒置
        mockMvc.perform(post("/api/mgr/notices")
                        .header("Authorization", "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"notice\",\"validFrom\":\"2026-02-01T00:00:00Z\",\"validTo\":\"2026-01-01T00:00:00Z\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));

        // 非法 type
        mockMvc.perform(post("/api/mgr/notices")
                        .header("Authorization", "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"bogus\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    // ---------------- helpers ----------------

    private long createConfig(Map<String, Object> body, String token) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/mgr/configs")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))
                .path("data").path("id").asLong();
    }

    private String userToken() {
        return jwtService.generateToken(1L, "test-openid");
    }
}
