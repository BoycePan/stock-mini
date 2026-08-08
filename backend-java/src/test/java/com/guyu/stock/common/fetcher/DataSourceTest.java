package com.guyu.stock.common.fetcher;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DataSourceTest {

    @Test
    void factoriesPresetConfig() {
        assertThat(DataSource.sina().maxRetries()).isEqualTo(3);
        assertThat(DataSource.ths().maxRetries()).isEqualTo(3);
        assertThat(DataSource.cninfo().maxRetries()).isEqualTo(1);
    }

    @Test
    void getStringOnUnreachableHostThrows() {
        DataSource ds = DataSource.sina();
        assertThatThrownBy(() -> ds.getString("http://127.0.0.1:1/nonexistent"))
                .isInstanceOf(FetchException.class);
    }
}
