package com.guyu.stock.external.yahoo;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/** 板块清单合法性：16 项、code 唯一非空、category 仅 industry/theme、两类都齐。 */
class YahooSectorsTest {

    @Test
    void listHas45Sectors() {
        assertThat(YahooSectors.SECTORS).hasSize(45);
    }

    @Test
    void coversUsAndGlobalMarkets() {
        assertThat(YahooSectors.SECTORS).anyMatch(s -> s.market().equals("us"));
        assertThat(YahooSectors.SECTORS).anyMatch(s -> s.market().equals("global"));
    }

    @Test
    void codesUniqueAndNonBlank() {
        List<String> codes = YahooSectors.SECTORS.stream().map(YahooSectors.Symbol::code).toList();
        assertThat(codes).doesNotHaveDuplicates();
        assertThat(codes).allMatch(s -> !s.isBlank());
    }

    @Test
    void categoryOnlyIndustryOrTheme() {
        Set<String> categories = YahooSectors.SECTORS.stream()
                .map(YahooSectors.Symbol::category)
                .collect(Collectors.toSet());
        assertThat(categories).isSubsetOf(Set.of("industry", "theme"));
    }

    @Test
    void bothIndustryAndThemePresent() {
        assertThat(YahooSectors.SECTORS).anyMatch(s -> s.category().equals("industry"));
        assertThat(YahooSectors.SECTORS).anyMatch(s -> s.category().equals("theme"));
    }
}
