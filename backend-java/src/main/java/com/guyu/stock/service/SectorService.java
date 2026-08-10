package com.guyu.stock.service;

import com.guyu.stock.common.BizException;
import com.guyu.stock.common.ErrCode;
import com.guyu.stock.dao.ConceptRepository;
import com.guyu.stock.external.ths.BoardKLine;
import com.guyu.stock.external.ths.ThsClient;
import com.guyu.stock.model.ConceptBoard;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 概念板块编排（对齐 Go handler.SectorHandler + 吸收原 SectorController 的 DB→同花顺回退逻辑）。
 */
@Service
public class SectorService {

    private final ConceptRepository conceptRepo;
    private final ThsClient thsClient;

    public SectorService(ConceptRepository conceptRepo, ThsClient thsClient) {
        this.conceptRepo = conceptRepo;
        this.thsClient = thsClient;
    }

    /** 板块列表：库内优先，未命中回退同花顺；top 仅回退路径生效（默认 20，最多 100） */
    public List<?> listBoards(Integer top) {
        List<ConceptBoard> boards = conceptRepo.listBoards();
        if (boards != null && !boards.isEmpty()) {
            return boards;
        }
        int topN = (top == null || top <= 0) ? 20 : Math.min(top, 100);
        return thsClient.fetchBoardList(topN);
    }

    public Map<String, Object> boardKlines(String code, Integer count) {
        if (code == null || code.isBlank()) {
            throw new BizException(ErrCode.INVALID_PARAM, "板块代码不能为空");
        }
        int n = (count == null || count <= 0) ? 30 : count;
        List<BoardKLine> klines = thsClient.fetchBoardKLine(code, n);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("count", klines.size());
        result.put("klines", klines);
        return result;
    }

    public Map<String, Object> members(String cidStr) {
        int cid;
        try {
            cid = Integer.parseInt(cidStr);
        } catch (NumberFormatException e) {
            throw new BizException(ErrCode.INVALID_PARAM, "cid 必须是数字");
        }
        String plateCode = null;
        for (ConceptBoard b : conceptRepo.listBoards()) {
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
        return result;
    }
}
