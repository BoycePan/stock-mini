package com.guyu.stock.config;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RequestLogFilterTest {

    private ListAppender<ILoggingEvent> appender;
    private Logger filterLogger;

    @BeforeEach
    void setUp() {
        filterLogger = (Logger) LoggerFactory.getLogger(RequestLogFilter.class);
        filterLogger.setLevel(Level.INFO);
        appender = new ListAppender<>();
        appender.start();
        filterLogger.addAppender(appender);
    }

    @AfterEach
    void tearDown() {
        filterLogger.detachAppender(appender);
    }

    private static RequestLogFilter filter(boolean enabled, int slowMs) {
        AppProperties props = new AppProperties();
        props.getLogging().setRequestEnabled(enabled);
        props.getLogging().setSlowRequestMs(slowMs);
        return new RequestLogFilter(props);
    }

    @Test
    void normalRequestLoggedAsInfoWithDurationStatusAndUid() throws Exception {
        RequestLogFilter filter = filter(true, 0);

        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/stock/600519/klines");
        req.setQueryString("scale=240&count=100");
        req.setAttribute("user_id", 7L);
        req.addHeader("X-Forwarded-For", "203.0.113.5, 10.0.0.1");
        MockHttpServletResponse resp = new MockHttpServletResponse();
        resp.setStatus(200);

        filter.doFilter(req, resp, new MockFilterChain());

        List<ILoggingEvent> events = appender.list;
        assertThat(events).hasSize(1);
        ILoggingEvent ev = events.get(0);
        assertThat(ev.getLevel()).isEqualTo(Level.INFO);
        assertThat(ev.getFormattedMessage())
                .startsWith("[http] GET /api/v1/stock/600519/klines?scale=240&count=100 status=200 cost=")
                .contains("ms ip=203.0.113.5 uid=7");
    }

    @Test
    void requestWithoutQueryAndUidStillLogged() throws Exception {
        RequestLogFilter filter = filter(true, 0);

        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/health");
        req.setRemoteAddr("10.0.0.8");
        MockHttpServletResponse resp = new MockHttpServletResponse();
        resp.setStatus(200);

        filter.doFilter(req, resp, new MockFilterChain());

        assertThat(appender.list).hasSize(1);
        assertThat(appender.list.get(0).getFormattedMessage())
                .startsWith("[http] GET /api/health status=200 cost=")
                .contains("ip=10.0.0.8 uid=null");
    }

    @Test
    void slowRequestLoggedAsWarn() throws Exception {
        // 阈值 1ms，过滤链内 sleep 5ms 保证必然超过阈值
        RequestLogFilter filter = filter(true, 1);
        FilterChain slowChain = (req, resp) -> {
            try {
                Thread.sleep(5);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        };

        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/stock/000001/klines");
        MockHttpServletResponse resp = new MockHttpServletResponse();
        resp.setStatus(200);

        filter.doFilter(req, resp, slowChain);

        assertThat(appender.list).hasSize(1);
        assertThat(appender.list.get(0).getLevel()).isEqualTo(Level.WARN);
    }

    @Test
    void disabledConfigEmitsNoLog() throws Exception {
        RequestLogFilter filter = filter(false, 0);

        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/stock/000001/klines");
        MockHttpServletResponse resp = new MockHttpServletResponse();
        resp.setStatus(200);

        filter.doFilter(req, resp, new MockFilterChain());

        assertThat(appender.list).isEmpty();
    }

    @Test
    void exceptionInChainLoggedAsErrorAndRethrown() {
        RequestLogFilter filter = filter(true, 0);
        FilterChain broken = (req, resp) -> {
            throw new IllegalStateException("boom");
        };

        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/broken");
        MockHttpServletResponse resp = new MockHttpServletResponse();

        assertThatThrownBy(() -> filter.doFilter(req, resp, broken))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("boom");

        assertThat(appender.list).hasSize(1);
        ILoggingEvent ev = appender.list.get(0);
        assertThat(ev.getLevel()).isEqualTo(Level.ERROR);
        assertThat(ev.getFormattedMessage()).startsWith("[http] GET /api/v1/broken FAILED cost=");
    }
}
