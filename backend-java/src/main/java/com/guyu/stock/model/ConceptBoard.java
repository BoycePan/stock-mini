package com.guyu.stock.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/** 概念板块（concept_board 表行映射 + API 响应项）。从 ConceptRepository 抽出。 */
public record ConceptBoard(
        @JsonProperty("plate_code") String plateCode,
        @JsonProperty("plate_name") String plateName,
        int cid) {}
