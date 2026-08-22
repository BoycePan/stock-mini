package com.guyu.stock.news;

import com.guyu.stock.dao.NewsRepository;
import com.guyu.stock.external.cninfo.Announcement;
import com.guyu.stock.external.cninfo.CninfoClient;
import com.guyu.stock.external.sina.SinaNewsClient;
import com.guyu.stock.model.NewsRow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class NewsControllerTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private NewsRepository newsRepository;
    @MockBean private SinaNewsClient sinaNewsClient;
    @MockBean private CninfoClient cninfoClient;

    @Test
    void stockNewsReturnsShape() throws Exception {
        when(sinaNewsClient.fetchStockNews(anyString(), anyInt()))
                .thenReturn(List.of(new SinaNewsClient.NewsItem("标题", "摘要", "http://u", "2026-08-05 10:30", "新浪")));
        mockMvc.perform(get("/api/v1/stock/600519/news"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.count").value(1))
                .andExpect(jsonPath("$.data.news[0].title").value("标题"));
    }

    @Test
    void announcementsReturnsShape() throws Exception {
        when(cninfoClient.fetchAnnouncements(anyString(), anyInt(), anyInt()))
                .thenReturn(List.of(new Announcement("a1", "年报", "2026-08-05", "http://u", "http://pdf")));
        mockMvc.perform(get("/api/v1/stock/600519/announcements"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].title").value("年报"));
    }

    @Test
    void feedQueriesDatabaseWithPagination() throws Exception {
        newsRepository.batchSave(List.of(
                new NewsRow(null, "", "旧闻", "", "http://u/1", "新浪", "2026-08-05 10:30"),
                new NewsRow(null, "", "新闻B", "", "http://u/2", "新浪", "2026-08-06 09:00"),
                new NewsRow(null, "", "新闻A", "", "http://u/3", "新浪", "2026-08-06 10:00"),
                // 个股新闻不应混入通用 feed
                new NewsRow(null, "600519", "茅台新闻", "", "http://u/4", "新浪", "2026-08-06 11:00")));

        mockMvc.perform(get("/api/v1/news/feed?page=1&size=2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.page").value(1))
                .andExpect(jsonPath("$.data.size").value(2))
                .andExpect(jsonPath("$.data.count").value(2))
                .andExpect(jsonPath("$.data.hasMore").value(true))
                .andExpect(jsonPath("$.data.news[0].title").value("新闻A"))
                .andExpect(jsonPath("$.data.news[1].title").value("新闻B"))
                .andExpect(jsonPath("$.data.news[0].time").value("2026-08-06 10:00"));

        // 第二页只剩一条旧闻
        mockMvc.perform(get("/api/v1/news/feed?page=2&size=2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.count").value(1))
                .andExpect(jsonPath("$.data.hasMore").value(false))
                .andExpect(jsonPath("$.data.news[0].title").value("旧闻"));
    }

    @Test
    void feedFiltersByIdWhenProvided() throws Exception {
        newsRepository.batchSave(List.of(
                new NewsRow(null, "", "旧闻", "", "http://u/1", "新浪", "2026-08-05 10:30"),
                new NewsRow(null, "", "新闻B", "", "http://u/2", "新浪", "2026-08-06 09:00"),
                new NewsRow(null, "", "新闻A", "", "http://u/3", "新浪", "2026-08-06 10:00")));

        // id <= 2：倒序为 新闻B(2)、旧闻(1)，不含 新闻A(3)
        mockMvc.perform(get("/api/v1/news/feed?page=1&size=10&id=2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.count").value(2))
                .andExpect(jsonPath("$.data.news[0].title").value("新闻B"))
                .andExpect(jsonPath("$.data.news[0].id").isNumber())
                .andExpect(jsonPath("$.data.news[1].title").value("旧闻"));

        // id 缺省/为 0 时不加过滤，仍是全量
        mockMvc.perform(get("/api/v1/news/feed?page=1&size=10"))
                .andExpect(jsonPath("$.data.count").value(3));
    }

    @Test
    void newsDetailReturnsRowById() throws Exception {
        newsRepository.batchSave(List.of(
                new NewsRow(null, "", "旧闻", "摘要X", "http://u/1", "新浪", "2026-08-05 10:30")));
        // id 由 identity 自增，首条为 1
        mockMvc.perform(get("/api/v1/news/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.id").value(1))
                .andExpect(jsonPath("$.data.title").value("旧闻"))
                .andExpect(jsonPath("$.data.summary").value("摘要X"))
                .andExpect(jsonPath("$.data.source").value("新浪"));
    }

    @Test
    void newsDetailNotFoundReturns404() throws Exception {
        mockMvc.perform(get("/api/v1/news/99999"))
                .andExpect(status().isOk()) // HTTP 200，业务 code 404
                .andExpect(jsonPath("$.code").value(404));
    }
}
