package com.guyu.stock.sector;

import com.guyu.stock.external.cninfo.CninfoClient;
import com.guyu.stock.external.sina.SinaNewsClient;
import com.guyu.stock.external.ths.BoardInfo;
import com.guyu.stock.external.ths.ThsClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SectorControllerTest {

    @Autowired private MockMvc mockMvc;
    @MockBean private ThsClient thsClient;

    // NewsController 依赖 SinaNewsClient/CninfoClient（Task 9 才会注册为 bean），此处 mock 以满足上下文装配
    @MockBean private SinaNewsClient sinaNewsClient;

    @MockBean private CninfoClient cninfoClient;

    @Test
    void boardsFallsBackToThsWhenDbEmpty() throws Exception {
        when(thsClient.fetchBoardList(20)).thenReturn(List.of(new BoardInfo(300188, "885333", "人工智能", 1.5)));
        mockMvc.perform(get("/api/v1/sector/boards"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].plate_code").value("885333"))
                .andExpect(jsonPath("$.data[0].plate_name").value("人工智能"));
    }

    @Test
    void boardKlinesReturnsShape() throws Exception {
        mockMvc.perform(get("/api/v1/sector/board/885333/klines").param("count", "30"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.code").value("885333"));
    }
}
