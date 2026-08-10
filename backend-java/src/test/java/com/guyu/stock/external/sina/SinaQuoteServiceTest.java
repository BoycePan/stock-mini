package com.guyu.stock.external.sina;

import com.guyu.stock.service.SinaQuoteService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class SinaQuoteServiceTest {

    static class StubClient extends SinaClient {
        final AtomicInteger calls = new AtomicInteger();
        StubClient() { super(new com.guyu.stock.config.AppProperties.Sina()); }
        @Override
        public List<Quote> fetchQuotes(List<String> codes) {
            calls.incrementAndGet();
            return codes.stream().map(c -> new Quote(c, "名称", 1, 1, 1, 1, 1, 0, 0, "2026-08-07", "15:00:00", 0, 0)).toList();
        }
    }

    @Test
    void getQuoteCachesWithinTtl() {
        StubClient client = new StubClient();
        SinaQuoteService service = new SinaQuoteService(client);
        service.getQuote("600001");
        service.getQuote("600001");
        assertThat(client.calls.get()).isEqualTo(1); // 命中缓存，只调一次
    }

    @Test
    void getQuoteReturnsQuote() {
        StubClient client = new StubClient();
        SinaQuoteService service = new SinaQuoteService(client);
        Quote q = service.getQuote("600001");
        assertThat(q.code()).isEqualTo("600001");
    }
}
