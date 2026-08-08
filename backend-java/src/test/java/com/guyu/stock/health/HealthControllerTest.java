package com.guyu.stock.health;

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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HealthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    // SectorController 依赖 ThsClient（Task 9 才会注册为 bean），此处 mock 以满足上下文装配
    @MockBean
    private ThsClient thsClient;

    // NewsController 依赖 SinaNewsClient/CninfoClient（Task 9 才会注册为 bean），此处 mock 以满足上下文装配
    @MockBean
    private SinaNewsClient sinaNewsClient;

    @MockBean
    private CninfoClient cninfoClient;

    @Test
    void healthReturnsOkAndConnected() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.database").value("connected"));
    }
}
