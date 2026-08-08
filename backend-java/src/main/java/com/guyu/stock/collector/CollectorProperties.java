package com.guyu.stock.collector;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.collector")
public class CollectorProperties {
    private boolean autoFull = false;
    private int sampleSize = 20;
    public boolean isAutoFull() { return autoFull; }
    public void setAutoFull(boolean autoFull) { this.autoFull = autoFull; }
    public int getSampleSize() { return sampleSize; }
    public void setSampleSize(int sampleSize) { this.sampleSize = sampleSize; }
}
