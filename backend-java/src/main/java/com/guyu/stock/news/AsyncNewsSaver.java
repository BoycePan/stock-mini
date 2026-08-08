package com.guyu.stock.news;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class AsyncNewsSaver {

    private static final Logger log = LoggerFactory.getLogger(AsyncNewsSaver.class);

    private final NewsRepository newsRepository;

    public AsyncNewsSaver(NewsRepository newsRepository) {
        this.newsRepository = newsRepository;
    }

    @Async
    public void save(List<NewsRepository.NewsRow> rows) {
        try {
            newsRepository.batchSave(rows);
        } catch (Exception e) {
            log.warn("异步存库失败: {}", e.getMessage(), e);
        }
    }
}
