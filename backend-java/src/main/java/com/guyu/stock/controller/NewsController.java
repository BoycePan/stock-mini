package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.service.NewsService;
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
                                                 @RequestParam(value = "size", required = false) Integer size) {
        return ApiResponse.success(newsService.feed(page, size));
    }

    @GetMapping("/stock/{code}/announcements")
    public ApiResponse<Map<String, Object>> announcements(@PathVariable("code") String code,
                                                          @RequestParam(value = "page", required = false) Integer page,
                                                          @RequestParam(value = "size", required = false) Integer size) {
        return ApiResponse.success(newsService.announcements(code, page, size));
    }
}
