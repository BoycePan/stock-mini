package com.guyu.stock.sector;

import com.guyu.stock.common.ApiResponse;
import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.external.ths.BoardKLine;
import com.guyu.stock.external.ths.ThsClient;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/sector")
public class SectorController {

    private final ConceptRepository conceptRepo;
    private final ThsClient thsClient;

    public SectorController(ConceptRepository conceptRepo, ThsClient thsClient) {
        this.conceptRepo = conceptRepo;
        this.thsClient = thsClient;
    }

    @GetMapping("/boards")
    public ApiResponse<?> listBoards(@RequestParam(value = "top", required = false) Integer top) {
        List<ConceptRepository.ConceptBoard> boards = conceptRepo.listBoards();
        if (boards != null && !boards.isEmpty()) {
            return ApiResponse.success(boards);
        }
        int topN = (top == null || top <= 0) ? 20 : Math.min(top, 100);
        return ApiResponse.success(thsClient.fetchBoardList(topN));
    }

    @GetMapping("/board/{code}/klines")
    public ApiResponse<Map<String, Object>> boardKlines(@PathVariable("code") String code,
                                                        @RequestParam(value = "count", required = false) Integer count) {
        if (code == null || code.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "板块代码不能为空");
        }
        int n = (count == null || count <= 0) ? 30 : count;
        List<BoardKLine> klines = thsClient.fetchBoardKLine(code, n);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("count", klines.size());
        result.put("klines", klines);
        return ApiResponse.success(result);
    }

    @GetMapping("/members/{cid}")
    public ApiResponse<Map<String, Object>> members(@PathVariable("cid") String cidStr) {
        int cid;
        try {
            cid = Integer.parseInt(cidStr);
        } catch (NumberFormatException e) {
            throw new BizException(ErrCode.INVALID_PARAM, "cid 必须是数字");
        }
        String plateCode = null;
        for (ConceptRepository.ConceptBoard b : conceptRepo.listBoards()) {
            if (b.cid() == cid) { plateCode = b.plateCode(); break; }
        }
        List<String> codes = null;
        if (plateCode != null) {
            codes = conceptRepo.getMembers(plateCode);
            if (codes == null || codes.isEmpty()) codes = null;
        }
        if (codes == null) {
            codes = thsClient.fetchMembers(cid);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("cid", cid);
        result.put("count", codes.size());
        result.put("stocks", codes);
        return ApiResponse.success(result);
    }
}
