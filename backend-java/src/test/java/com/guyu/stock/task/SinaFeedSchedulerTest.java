package com.guyu.stock.task;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.external.sina.SinaNewsClient;
import com.guyu.stock.external.sina.SinaNewsClient.NewsItem;
import com.guyu.stock.model.NewsRow;
import com.guyu.stock.service.AsyncNewsSaver;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SinaFeedSchedulerTest {

    @Test
    void fetchFeedMapsItemsToNewsRowsAndSaves() {
        AppProperties props = new AppProperties();
        props.getSina().setFeedEnabled(true);
        props.getSina().setFeedKeyword("A股");
        props.getSina().setFeedCount(20);

        SinaNewsClient sinaNewsClient = mock(SinaNewsClient.class);
        when(sinaNewsClient.fetchFeedNews("A股", 20))
                .thenReturn(List.of(new NewsItem("标题", "摘要", "http://u", "2026-08-06 10:30", "财联社")));

        AsyncNewsSaver saver = mock(AsyncNewsSaver.class);
        SinaFeedScheduler scheduler = new SinaFeedScheduler(props, sinaNewsClient, saver);
        scheduler.fetchFeed();

        ArgumentCaptor<List<NewsRow>> captor = ArgumentCaptor.forClass(List.class);
        verify(saver).save(captor.capture());
        List<NewsRow> rows = captor.getValue();
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).stockCode()).isEmpty();
        assertThat(rows.get(0).title()).isEqualTo("标题");
        assertThat(rows.get(0).source()).isEqualTo("财联社");
        assertThat(rows.get(0).publishedAt()).isEqualTo("2026-08-06 10:30");
    }

    @Test
    void disabledSkipsFetch() {
        AppProperties props = new AppProperties();
        props.getSina().setFeedEnabled(false);

        SinaNewsClient sinaNewsClient = mock(SinaNewsClient.class);
        AsyncNewsSaver saver = mock(AsyncNewsSaver.class);
        SinaFeedScheduler scheduler = new SinaFeedScheduler(props, sinaNewsClient, saver);
        scheduler.fetchFeed();

        verify(sinaNewsClient, never()).fetchFeedNews(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyInt());
        verify(saver, never()).save(org.mockito.ArgumentMatchers.anyList());
    }
}
