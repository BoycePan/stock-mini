package handler

import (
	"strconv"

	"wx-app-stock-backend/pkg/errcode"
	"wx-app-stock-backend/pkg/response"
	"wx-app-stock-backend/pkg/ths"
	"wx-app-stock-backend/repository"

	"github.com/gin-gonic/gin"
)

// SectorHandler 概念板块接口处理器。
type SectorHandler struct {
	conceptRepo *repository.ConceptRepo
}

func NewSectorHandler(conceptRepo *repository.ConceptRepo) *SectorHandler {
	return &SectorHandler{conceptRepo: conceptRepo}
}

// ListBoards GET /api/v1/sector/boards
// 库中已有数据直接返回，否则从同花顺实时拉取。
func (h *SectorHandler) ListBoards(c *gin.Context) {
	// 先查库
	boards, err := h.conceptRepo.ListBoards()
	if err == nil && len(boards) > 0 {
		response.Success(boards).Write(c)
		return
	}

	// 库空 → 实时拉
	topN := 20
	if n, err2 := strconv.Atoi(c.DefaultQuery("top", "20")); err2 == nil && n > 0 && n <= 100 {
		topN = n
	}
	thsBoards, err := ths.FetchBoardList(c.Request.Context(), topN)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}
	response.Success(thsBoards).Write(c)
}

// GetBoardKLine GET /api/v1/sector/board/:code/klines
// 板块K线始终从同花顺实时拉取（不落库，板块K线量小）。
func (h *SectorHandler) GetBoardKLine(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		response.Error(errcode.InvalidParam, "板块代码不能为空").Write(c)
		return
	}
	count := 30
	if n, err := strconv.Atoi(c.DefaultQuery("count", "30")); err == nil && n > 0 {
		count = n
	}
	klines, err := ths.FetchBoardKLine(c.Request.Context(), code, count)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}
	response.Success(gin.H{"code": code, "count": len(klines), "klines": klines}).Write(c)
}

// GetMembers GET /api/v1/sector/members/:cid
// 先查库，库空则实时拉取。
func (h *SectorHandler) GetMembers(c *gin.Context) {
	cidStr := c.Param("cid")
	cid, err := strconv.Atoi(cidStr)
	if err != nil {
		response.Error(errcode.InvalidParam, "cid 必须是数字").Write(c)
		return
	}

	// 先通过 cid 找到 plate_code
	boards, _ := h.conceptRepo.ListBoards()
	var plateCode string
	for _, b := range boards {
		if b.Cid == cid {
			plateCode = b.PlateCode
			break
		}
	}

	if plateCode != "" {
		codes, err := h.conceptRepo.GetMembers(plateCode)
		if err == nil && len(codes) > 0 {
			response.Success(gin.H{"cid": cid, "count": len(codes), "stocks": codes}).Write(c)
			return
		}
	}

	// 库空 → 实时拉
	codes, err := ths.FetchMembers(c.Request.Context(), cid)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}
	response.Success(gin.H{"cid": cid, "count": len(codes), "stocks": codes}).Write(c)
}
