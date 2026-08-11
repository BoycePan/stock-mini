package com.guyu.stock.external.yahoo;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/** 全球资产清单合法性：commodity 17 / forex 5 / crypto 2 / bond 3 / stock 16，合并 43，code 唯一，category 非空。 */
class YahooAssetTest {

    @Test
    void commodityHas17() {
        assertThat(YahooAsset.COMMODITIES).hasSize(17);
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
    void bondsHas3() {
        assertThat(YahooAsset.BONDS).hasSize(3);
    }

    @Test
    void stocksHas16() {
        assertThat(YahooAsset.STOCKS).hasSize(16);
    }

    @Test
    void allMergesTo43() {
        assertThat(YahooAsset.ALL).hasSize(43);
    }

    @Test
    void codesUniqueAndNonBlank() {
        List<String> codes = YahooAsset.ALL.stream().map(YahooAsset.Symbol::code).toList();
        assertThat(codes).doesNotHaveDuplicates();
        assertThat(codes).allMatch(s -> !s.isBlank());
    }

    @Test
    void marketAndCategoryValid() {
        // 商品/外汇/加密 market=global；美债/个股 market=us
        assertThat(YahooAsset.ALL).allMatch(s -> s.market().equals("global") || s.market().equals("us"));
        Set<String> categories = YahooAsset.ALL.stream().map(YahooAsset.Symbol::category).collect(java.util.stream.Collectors.toSet());
        assertThat(categories).isNotEmpty();
        assertThat(YahooAsset.ALL).allMatch(s -> s.category() != null && !s.category().isBlank());
    }
}
