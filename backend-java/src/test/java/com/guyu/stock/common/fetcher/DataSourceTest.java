package com.guyu.stock.common.fetcher;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DataSourceTest {

    @Test
    void factoryAppliesSinaPreset() {
        assertThat(DataSource.sina().maxRetries()).isEqualTo(3);
    }

    @Test
    void constructorAppliesMaxRetriesAndTimeout() {
        // 6 参构造：rate-limit/retries/timeout 来自配置；timeout<=0 兜底 30s
        DataSource ds = new DataSource("stub", 0.5, 3, "ua", "ref", 7);
        assertThat(ds.maxRetries()).isEqualTo(3);
        DataSource dsDefaultTimeout = new DataSource("stub", 0.5, 3, "ua", "ref", 0);
        assertThat(dsDefaultTimeout.maxRetries()).isEqualTo(3);
    }

    @Test
    void getStringOnUnreachableHostThrows() {
        DataSource ds = DataSource.sina();
        assertThatThrownBy(() -> ds.getString("http://127.0.0.1:1/nonexistent"))
                .isInstanceOf(FetchException.class);
    }
}
