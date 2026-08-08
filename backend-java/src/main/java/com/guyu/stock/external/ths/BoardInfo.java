package com.guyu.stock.external.ths;

import com.fasterxml.jackson.annotation.JsonProperty;

public record BoardInfo(int cid,
                        @JsonProperty("plate_code") String plateCode,
                        @JsonProperty("plate_name") String plateName,
                        @JsonProperty("pct_chg") double pctChg) {}
