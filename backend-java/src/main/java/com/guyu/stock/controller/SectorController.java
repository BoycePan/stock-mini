package com.guyu.stock.controller;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.service.SectorService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/sector")
public class SectorController {

    private final SectorService sectorService;

    public SectorController(SectorService sectorService) {
        this.sectorService = sectorService;
    }

    @GetMapping("/boards")
    public ApiResponse<?> listBoards(@RequestParam(value = "top", required = false) Integer top) {
        return ApiResponse.success(sectorService.listBoards(top));
    }

    @GetMapping("/board/{code}/klines")
    public ApiResponse<Map<String, Object>> boardKlines(@PathVariable("code") String code,
                                                        @RequestParam(value = "count", required = false) Integer count) {
        return ApiResponse.success(sectorService.boardKlines(code, count));
    }

    @GetMapping("/members/{cid}")
    public ApiResponse<Map<String, Object>> members(@PathVariable("cid") String cid) {
        return ApiResponse.success(sectorService.members(cid));
    }
}
