package com.guyu.stock.collector;

import com.guyu.stock.external.sina.SinaInfoClient;
import com.guyu.stock.external.sina.SinaKlineClient;
import com.guyu.stock.external.ths.ThsClient;
import com.guyu.stock.sector.ConceptRepository;
import com.guyu.stock.stock.StockInfo;
import com.guyu.stock.stock.StockInfoRepository;
import com.guyu.stock.stock.StockKline;
import com.guyu.stock.stock.StockKlineRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class CollectorService {

    private static final Logger log = LoggerFactory.getLogger(CollectorService.class);

    private final SinaInfoClient sinaInfoClient;
    private final SinaKlineClient sinaKlineClient;
    private final ThsClient thsClient;
    private final StockInfoRepository stockInfoRepository;
    private final StockKlineRepository stockKlineRepository;
    private final ConceptRepository conceptRepository;

    public CollectorService(SinaInfoClient sinaInfoClient, SinaKlineClient sinaKlineClient, ThsClient thsClient,
                            StockInfoRepository stockInfoRepository, StockKlineRepository stockKlineRepository,
                            ConceptRepository conceptRepository) {
        this.sinaInfoClient = sinaInfoClient;
        this.sinaKlineClient = sinaKlineClient;
        this.thsClient = thsClient;
        this.stockInfoRepository = stockInfoRepository;
        this.stockKlineRepository = stockKlineRepository;
        this.conceptRepository = conceptRepository;
    }

    /** 对齐 Go RefreshStockInfo：股票列表 + 行业分类 → stock_info；返回已拉取的股票列表供 runFull 复用 */
    public List<SinaInfoClient.SinaStock> refreshStockInfo() {
        log.info("[采集] 开始刷新股票信息");
        List<SinaInfoClient.SinaStock> stocks = sinaInfoClient.fetchStockList();
        Map<String, String> industryMap;
        try {
            industryMap = sinaInfoClient.fetchIndustryMap();
        } catch (Exception e) {
            log.warn("[采集] 行业分类拉取失败（非致命）: {}", e.getMessage());
            industryMap = Map.of();
        }
        List<StockInfo> infos = new ArrayList<>();
        for (SinaInfoClient.SinaStock s : stocks) {
            infos.add(new StockInfo(s.code(), s.name(), "stock", s.market(), s.board(),
                    industryMap.getOrDefault(s.code(), null), true, null));
        }
        stockInfoRepository.batchUpsert(infos);
        log.info("[采集] 股票信息刷新完成，{} 条", infos.size());
        return stocks;
    }

    /** 对齐 Go RefreshConceptData：板块列表 + 成分股 → concept_board/concept_stock */
    public void refreshConceptData() {
        log.info("[采集] 开始刷新概念板块");
        List<com.guyu.stock.external.ths.BoardInfo> boards = thsClient.fetchBoardList(500);
        int savedBoards = 0;
        for (com.guyu.stock.external.ths.BoardInfo b : boards) {
            try {
                conceptRepository.upsertBoard(b.plateCode(), b.plateName(), b.cid());
                savedBoards++;
                if (b.cid() > 0) {
                    List<String> codes = thsClient.fetchMembers(b.cid());
                    if (!codes.isEmpty()) conceptRepository.replaceMembers(b.plateCode(), codes);
                }
            } catch (Exception e) {
                log.warn("[采集] 板块 {} 处理失败: {}", b.plateCode(), e.getMessage());
            }
        }
        log.info("[采集] 概念板块刷新完成：{} 个板块", savedBoards);
    }

    /** 对齐 Go RunFull，sampleSize<=0 处理全部；返回处理股票数 */
    public int runFull(int sampleSize) {
        log.info("[采集] 开始全量采集（含日K线）");
        // 股票列表只拉取一次：refreshStockInfo 内部已拉取并返回，直接复用，避免二次请求
        List<SinaInfoClient.SinaStock> stocks = refreshStockInfo();
        if (stocks == null || stocks.isEmpty()) {
            log.warn("[采集] 股票列表为空，跳过采集");
            return 0;
        }
        int limit = (sampleSize > 0 && sampleSize < stocks.size()) ? sampleSize : stocks.size();
        int saved = 0;
        for (int i = 0; i < limit; i++) {
            SinaInfoClient.SinaStock s = stocks.get(i);
            if (!"sh".equals(s.market()) && !"sz".equals(s.market())) continue;
            try {
                SinaKlineClient.KLineResult r = sinaKlineClient.getKLine(s.code(), "240", 60);
                if (r.klines().isEmpty()) continue;
                stockKlineRepository.batchUpsert(toDbKlines(s.code(), r.klines()));
                saved++;
            } catch (Exception e) {
                log.warn("[采集] {} 拉取失败: {}", s.code(), e.getMessage());
            }
        }
        log.info("[采集] K线写入完成，共保存 {} 只股票", saved);
        return saved;
    }

    private List<StockKline> toDbKlines(String code, List<SinaKlineClient.KLine> klines) {
        List<StockKline> result = new ArrayList<>();
        double prevClose = 0;
        for (SinaKlineClient.KLine k : klines) {
            LocalDate date = LocalDate.parse(k.time().substring(0, 10));
            double amount = round2((k.open() + k.high() + k.low() + k.close()) / 4 * k.volume());
            double changeAmt = 0, pctChange = 0, amplitude = 0;
            if (prevClose != 0) {
                changeAmt = round2(k.close() - prevClose);
                pctChange = round2((k.close() - prevClose) / prevClose * 100);
                amplitude = round2((k.high() - k.low()) / prevClose * 100);
            }
            result.add(new StockKline(code, "1d", date, k.open(), k.high(), k.low(), k.close(), k.volume(),
                    amount, 0, pctChange, changeAmt, amplitude));
            prevClose = k.close();
        }
        return result;
    }

    /** 对齐 Go round2：float64(int(v*100+0.5))/100，向零截断（负值 -1.235 → -1.23，与 Java Math.round 的 half-up 不同） */
    private static double round2(double v) {
        return (long) (v * 100 + 0.5) / 100.0;
    }
}
