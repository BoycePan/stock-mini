package com.guyu.stock.task;

import com.guyu.stock.config.AppProperties;
import com.guyu.stock.dao.TrackRepository;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ClickEventCleanupSchedulerTest {

    private final TrackRepository trackRepository = mock(TrackRepository.class);
    private final AppProperties appProperties = mock(AppProperties.class);
    private final ClickEventCleanupScheduler scheduler =
            new ClickEventCleanupScheduler(trackRepository, appProperties);

    private AppProperties.Tracking tracking(boolean cleanupEnabled, int days) {
        AppProperties.Tracking t = new AppProperties.Tracking();
        t.setCleanupEnabled(cleanupEnabled);
        t.setCleanupDays(days);
        return t;
    }

    @Test
    void cleanupSkippedWhenDisabled() {
        when(appProperties.getTracking()).thenReturn(tracking(false, 5));

        scheduler.cleanup();

        verify(trackRepository, never()).deleteBefore(any());
    }

    @Test
    void cleanupDeletesBeforeNowMinusDays() {
        when(appProperties.getTracking()).thenReturn(tracking(true, 5));
        when(trackRepository.deleteBefore(any())).thenReturn(42);

        scheduler.cleanup();

        LocalDateTime before = LocalDateTime.now().minusDays(5).minusSeconds(5);
        LocalDateTime after = LocalDateTime.now().minusDays(5).plusSeconds(5);
        verify(trackRepository).deleteBefore(argThat(cutoff ->
                cutoff != null && !cutoff.isBefore(before) && !cutoff.isAfter(after)));
    }

    @Test
    void cleanupUsesMinimumOneDay() {
        // 配置非法值（0/负数）时按 1 天兜底，避免误删全部数据
        when(appProperties.getTracking()).thenReturn(tracking(true, 0));

        scheduler.cleanup();

        verify(trackRepository).deleteBefore(argThat(cutoff ->
                cutoff != null && cutoff.isAfter(LocalDateTime.now().minusDays(2))));
    }

    @Test
    void cleanupReentrantRunIsSkipped() throws Exception {
        when(appProperties.getTracking()).thenReturn(tracking(true, 5));
        CountDownLatch inDelete = new CountDownLatch(1);
        CountDownLatch releaseDelete = new CountDownLatch(1);
        // 第一轮删除挂起，模拟删除慢于调度周期
        when(trackRepository.deleteBefore(any())).thenAnswer(inv -> {
            inDelete.countDown();
            assertTrue(releaseDelete.await(5, TimeUnit.SECONDS), "第一轮未及时释放");
            return 100;
        });

        Thread first = new Thread(scheduler::cleanup);
        first.start();
        assertTrue(inDelete.await(5, TimeUnit.SECONDS), "第一轮未进入删除");

        // 第一轮未结束前触发第二轮，应被防重入拦下
        scheduler.cleanup();
        verify(trackRepository, times(1)).deleteBefore(any());

        releaseDelete.countDown();
        first.join(5000);
        assertTrue(!first.isAlive(), "第一轮未正常结束");
    }
}
