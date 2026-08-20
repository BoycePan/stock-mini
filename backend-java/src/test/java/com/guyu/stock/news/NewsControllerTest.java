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
                new NewsRow("", "旧闻", "", "http://u/1", "新浪", "2026-08-05 10:30"),
                new NewsRow("", "新闻B", "", "http://u/2", "新浪", "2026-08-06 09:00"),
                new NewsRow("", "新闻A", "", "http://u/3", "新浪", "2026-08-06 10:00"),
                // 个股新闻不应混入通用 feed
                new NewsRow("600519", "茅台新闻", "", "http://u/4", "新浪", "2026-08-06 11:00")));

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
}
