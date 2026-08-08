package com.guyu.stock.collector;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CollectorSchedulerTest {

    @Test
    void autoFullFalseSkipsRunFull() {
        CollectorProperties props = new CollectorProperties();
        props.setAutoFull(false);
        CollectorScheduler.Trigger decision = CollectorScheduler.decideFull(props);
        assertThat(decision).isEqualTo(CollectorScheduler.Trigger.SKIP);
    }

    @Test
    void autoFullTrueRunsFull() {
        CollectorProperties props = new CollectorProperties();
        props.setAutoFull(true);
        assertThat(CollectorScheduler.decideFull(props)).isEqualTo(CollectorScheduler.Trigger.RUN);
    }
}
