CREATE TABLE IF NOT EXISTS stock_kline (
    code       VARCHAR(10)  NOT NULL,
    scale      VARCHAR(10)  NOT NULL,
    trade_date DATE         NOT NULL,
    open       DOUBLE PRECISION,
    high       DOUBLE PRECISION,
    low        DOUBLE PRECISION,
    close      DOUBLE PRECISION,
    volume     BIGINT,
    amount     DOUBLE PRECISION,
    turnover   DOUBLE PRECISION,
    pct_change DOUBLE PRECISION,
    change_amt DOUBLE PRECISION,
    amplitude  DOUBLE PRECISION,
    created_at TIMESTAMP,
    PRIMARY KEY (code, scale, trade_date)
);

CREATE TABLE IF NOT EXISTS stock_info (
    code       VARCHAR(10)  PRIMARY KEY,
    name       VARCHAR(64),
    type       VARCHAR(10),
    market     VARCHAR(10),
    board      VARCHAR(10),
    industry   VARCHAR(64),
    is_active  BOOLEAN,
    updated_at TIMESTAMP
);
