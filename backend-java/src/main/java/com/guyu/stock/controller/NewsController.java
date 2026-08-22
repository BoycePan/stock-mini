package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.service.NewsService;
import com.guyu.stock.util.NewsUpdateUtil;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class NewsController {

    private final NewsService newsService;

    public NewsController(NewsService newsService) {
        this.newsService = newsService;
    }

    @GetMapping("/stock/{code}/news")
    public ApiResponse<Map<String, Object>> stockNews(@PathVariable("code") String code,
                                                      @RequestParam(value = "page", required = false) Integer page) {
        return ApiResponse.success(newsService.stockNews(code, page));
    }

    @GetMapping("/news/feed")
    public ApiResponse<Map<String, Object>> feed(@RequestParam(value = "page", required = false) Integer page,
                                                 @RequestParam(value = "size", required = false) Integer size,
                                                 @RequestParam(value = "id", required = false, defaultValue = "0") Long id) {
        return ApiResponse.success(newsService.feed(page, size, id));
    }

    @GetMapping("/news/{id}")
    public ApiResponse<Map<String, Object>> newsDetail(@PathVariable("id") Long id) {
        return ApiResponse.success(newsService.newsDetail(id));
    }

    @GetMapping("/stock/{code}/announcements")
    public ApiResponse<Map<String, Object>> announcements(@PathVariable("code") String code,
                                                          @RequestParam(value = "page", required = false) Integer page,
                                                          @RequestParam(value = "size", required = false) Integer size) {
        return ApiResponse.success(newsService.announcements(code, page, size));
    }

    /**
     * 是否需要去拉取最新的新闻
     */
    @GetMapping("/news/needToPull")
    public ApiResponse<Boolean>  needToPull(@RequestParam(value = "lastPullTime", required = false, defaultValue = "0") long lastPullTime) {
        return ApiResponse.success(NewsUpdateUtil.needToPullNews(lastPullTime));
    }
}
