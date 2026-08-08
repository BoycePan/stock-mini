package com.guyu.stock.news;

import com.guyu.stock.external.cninfo.Announcement;
import com.guyu.stock.external.cninfo.CninfoClient;
import com.guyu.stock.external.sina.SinaNewsClient;
import com.guyu.stock.external.ths.ThsClient;
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
    @MockBean private SinaNewsClient sinaNewsClient;
    @MockBean private CninfoClient cninfoClient;
    // SectorController 依赖 ThsClient（Task 9 才会注册为 bean），此处 mock 以满足上下文装配
    @MockBean private ThsClient thsClient;

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
}
