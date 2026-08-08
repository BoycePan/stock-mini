package com.guyu.stock.collector;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.collector")
public class CollectorProperties {
    private boolean autoFull = false;
    private int sampleSize = 20;
    private boolean startupCheck = true;
    private boolean runSampleOnStart = false;
    public boolean isAutoFull() { return autoFull; }
    public void setAutoFull(boolean autoFull) { this.autoFull = autoFull; }
    public int getSampleSize() { return sampleSize; }
    public void setSampleSize(int sampleSize) { this.sampleSize = sampleSize; }
    public boolean isStartupCheck() { return startupCheck; }
    public void setStartupCheck(boolean startupCheck) { this.startupCheck = startupCheck; }
    public boolean isRunSampleOnStart() { return runSampleOnStart; }
    public void setRunSampleOnStart(boolean runSampleOnStart) { this.runSampleOnStart = runSampleOnStart; }
}
