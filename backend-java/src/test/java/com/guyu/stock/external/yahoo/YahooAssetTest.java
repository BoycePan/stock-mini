package com.guyu.stock.external.yahoo;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/** 全球资产清单合法性：commodity 8 / forex 5 / crypto 2，合并 15，code 唯一，market 全 global，category 非空。 */
class YahooAssetTest {

    @Test
    void commodityHas8() {
        assertThat(YahooAsset.COMMODITIES).hasSize(8);
    }

    @Test
    void forexHas5() {
        assertThat(YahooAsset.FOREX).hasSize(5);
    }

    @Test
    void cryptoHas2() {
        assertThat(YahooAsset.CRYPTO).hasSize(2);
    }

    @Test
    void allMergesTo15() {
        assertThat(YahooAsset.ALL).hasSize(15);
    }

    @Test
    void codesUniqueAndNonBlank() {
        List<String> codes = YahooAsset.ALL.stream().map(YahooAsset.Symbol::code).toList();
        assertThat(codes).doesNotHaveDuplicates();
        assertThat(codes).allMatch(s -> !s.isBlank());
    }

    @Test
    void allMarketGlobalAndCategoryValid() {
        assertThat(YahooAsset.ALL).allMatch(s -> s.market().equals("global"));
        Set<String> categories = YahooAsset.ALL.stream().map(YahooAsset.Symbol::category).collect(java.util.stream.Collectors.toSet());
        assertThat(categories).isNotEmpty();
        assertThat(YahooAsset.ALL).allMatch(s -> s.category() != null && !s.category().isBlank());
    }
}
