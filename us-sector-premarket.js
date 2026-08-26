#!/usr/bin/env node
/**
 * us-sector-premarket.js — 美股板块盘前行情查看器
 *
 * 运行: node us-sector-premarket.js
 *
 * 板块口径: 同花顺概念板块(代码 BKxxxx / 名称 / 成分代理标的)
 *   板块涨跌幅 = 成分代理标的 盘前涨跌幅 的等权均值(只统计有实时盘前数据的成分)
 *   代理标的前缀: 105=纳斯达克, 106=纽交所, 107=美股ETF
 *
 * 数据源(单一): 新浪 hq.sinajs.cn gb_xxx —— 实时盘前
 *   f[21] 盘前价 / f[22] 盘前涨跌幅% / f[23] 盘前涨跌额 / f[24] 盘前时间
 *
 * 说明:
 *   · 盘前时段: 美东 04:00-09:30(周一至周五); 需要 Node.js >= 18
 */
"use strict";

/* ---------------- 板块定义(同花顺概念板块) ---------------- */
const SECTORS = [
  { code: "BK1134", name: "AI算力", icon: "🧠", aSecid: "90.BK1134", proxies: ["105.NVDA", "105.AMD", "105.AVGO", "105.MRVL", "105.SMCI"] },
  { code: "BK1128", name: "CPO", icon: "💡", aSecid: "90.BK1128", proxies: ["106.COHR", "105.LITE", "105.AAOI", "106.FN", "106.CIEN"] },
  { code: "BK0917", name: "半导体", icon: "🔬", aSecid: "90.BK0917", proxies: ["105.SOXX"] },
  { code: "BK1137", name: "存储", icon: "💾", aSecid: "90.BK1137", proxies: ["105.MU", "105.WDC", "105.STX"] },
  { code: "BK0922", name: "数据中心", icon: "🗄️", aSecid: "90.BK0922", proxies: ["106.DLR", "105.EQIX"] },
  { code: "BK0579", name: "云计算", icon: "☁️", aSecid: "90.BK0579", proxies: ["106.VRT", "106.VST", "105.SMCI", "106.CRM", "106.NOW", "106.SNOW", "106.ORCL"] },
  { code: "BK0963", name: "商业航天", icon: "🚀", aSecid: "90.BK0963", proxies: ["105.RKLB", "105.ASTS", "106.RDW", "105.LUNR"] },
  { code: "BK0921", name: "卫星", icon: "🛰️", aSecid: "90.BK0921", proxies: ["105.ASTS", "105.IRDM", "105.GSAT", "105.VSAT"] },
  { code: "BK1090", name: "机器人", icon: "🤖", aSecid: "90.BK1090", proxies: ["107.ROBO"] },
  { code: "BK0802", name: "自动驾驶", icon: "🚗", aSecid: "90.BK0802", proxies: ["105.DRIV"] },
  { code: "BK0577", name: "核电", icon: "⚛️", aSecid: "90.BK0577", proxies: ["106.OKLO", "106.SMR"] },
  { code: "BK1647", name: "电网", icon: "⚡", aSecid: "90.BK1647", proxies: ["105.CEG", "106.VST", "106.GEV", "106.NEE", "106.PWR", "106.ETN"] },
  { code: "BK0490", name: "军工", icon: "🛡️", aSecid: "90.BK0490", proxies: ["106.LMT", "106.RTX", "106.NOC", "106.GD"] },
  { code: "BK0493", name: "新能源", icon: "🔋", aSecid: "90.BK0493", proxies: ["105.ENPH", "105.FSLR", "105.RIVN", "105.SEDG"] },
  { code: "BK0588", name: "光伏", icon: "☀️", aSecid: "90.BK0588", proxies: ["107.TAN"] },
  { code: "BK0574", name: "锂电池", icon: "🔌", aSecid: "90.BK0574", proxies: ["107.BATT"] },
  { code: "BK0464", name: "石油", icon: "🛢️", aSecid: "90.BK0464", proxies: ["107.XLE"] },
  { code: "BK0843", name: "天然气", icon: "🔥", aSecid: "90.BK0843", proxies: ["107.FCG"] },
  { code: "BK0478", name: "铜 / 有色", icon: "🟠", aSecid: "90.BK0478", proxies: ["106.FCX", "106.SCCO", "106.TECK", "106.AA"] },
  { code: "BK0547", name: "黄金", icon: "🥇", aSecid: "90.BK0547", proxies: ["107.GDX"] },
  { code: "BK0475", name: "银行金融", icon: "🏦", aSecid: "90.BK0475", proxies: ["106.JPM", "106.BAC", "106.WFC", "106.GS"] },
  { code: "BK1216", name: "生物医药", icon: "💊", aSecid: "90.BK1216", proxies: ["106.LLY", "106.PFE", "106.MRK", "106.ABBV"] },
  { code: "BK0438", name: "消费", icon: "🛒", aSecid: "90.BK0438", proxies: ["106.KO", "106.PG", "105.WMT", "105.COST"] },
  { code: "BK1016", name: "稀土", icon: "🧲", aSecid: "90.BK1016", proxies: ["105.MP", "107.REMX", "106.UUUU"] },
];

/* 大盘指数(新浪 gb_ 前缀即为代码小写) */
const INDEXES = [
  { symbol: "SPY", name: "标普500" },
  { symbol: "QQQ", name: "纳指100" },
  { symbol: "DIA", name: "道琼斯" },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const SINA_BASE = "https://hq.sinajs.cn/list=";

const pad2 = (n) => String(n).padStart(2, "0");
const num = (s) => {
  if (s == null || s === "") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const tickerOf = (p) => (p.includes(".") ? p.split(".")[1] : p);

/* ---------------- 美东时间工具 ---------------- */
function etNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  let h = parseInt(m.hour, 10);
  if (h === 24) h = 0;
  return { y: +m.year, mo: +m.month, d: +m.day, h, mi: +m.minute, s: +m.second };
}

function marketPhase() {
  const p = etNow();
  const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  const md = p.h * 60 + p.mi;
  if (dow === 0 || dow === 6) return "周末休市";
  if (md < 4 * 60) return "盘前未开始(美东 04:00 开始)";
  if (md < 9 * 60 + 30) return "盘前交易中";
  if (md < 16 * 60) return "盘中交易中";
  return "已收盘(盘后交易中)";
}

/* 解析新浪时间串 "Aug 26 05:01AM EDT" -> {h,mi,sess,isToday} */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function parseSinaTime(s) {
  const m = s && s.match(/^(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(AM|PM)\s+EDT/i);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1][0].toUpperCase() + m[1].slice(1).toLowerCase());
  if (mo < 0) return null;
  let h = parseInt(m[3], 10);
  const pm = m[5].toUpperCase() === "PM";
  if (pm && h < 12) h += 12;
  if (!pm && h === 12) h = 0;
  const day = parseInt(m[2], 10);
  const mi = parseInt(m[4], 10);
  const now = etNow();
  const isToday = mo + 1 === now.mo && day === now.d;
  const md = h * 60 + mi;
  let sess;
  if (md < 9 * 60 + 30) sess = "PRE";
  else if (md < 16 * 60) sess = "REG";
  else sess = "POST";
  return { h, mi, sess, isToday };
}
const SESS_CN = { PRE: "盘前", REG: "盘中", POST: "盘后" };

/* ---------------- 数据源: 新浪实时盘前(唯一) ---------------- */
async function fetchSina(tickers) {
  const res = await fetch(SINA_BASE + tickers.map((c) => "gb_" + c.toLowerCase()).join(","), {
    headers: { Referer: "https://finance.sina.com.cn", "User-Agent": UA },
    signal: AbortSignal.timeout(10000),
  });
  const text = new TextDecoder("gb18030").decode(await res.arrayBuffer());
  const map = new Map();
  for (const code of tickers) {
    const m = text.match(new RegExp('hq_str_gb_' + code.toLowerCase() + '="([^"]*)"'));
    if (!m || !m[1]) continue;
    const f = m[1].split(",");
    if (f.length < 27) continue;
    const prePrice = num(f[21]);
    const timeInfo = parseSinaTime(f[24]);
    map.set(code, {
      name: f[0],
      prePrice,
      prePct: num(f[22]),
      preChg: num(f[23]),
      preTime: f[24],
      timeInfo,
      isLive: prePrice != null && prePrice !== 0 && timeInfo != null && timeInfo.isToday,
      prevClose: num(f[26]),
    });
  }
  return map;
}

const getQuote = (sina, raw) => sina.get(tickerOf(raw));

/* ---------------- 终端显示 ---------------- */
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const C = {
  reset: useColor ? "\x1b[0m" : "",
  red: useColor ? "\x1b[31m" : "",
  green: useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  bold: useColor ? "\x1b[1m" : "",
  dim: useColor ? "\x1b[2m" : "",
};

function dispWidth(s) {
  let w = 0;
  for (const ch of s) w += ch.codePointAt(0) > 0x2e80 ? 2 : 1; // CJK/emoji 按 2 列宽
  return w;
}
const pad = (s, w) => s + " ".repeat(Math.max(0, w - dispWidth(s)));

const pctText = (v) =>
  v == null ? "--" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}% ${v > 0 ? "↑" : v < 0 ? "↓" : "→"}`;
const pctColor = (v) => (v == null ? null : v > 0 ? C.green : v < 0 ? C.red : C.dim);
const numText = (v) => (v == null ? "--" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);

function renderTable(rows, cols) {
  const widths = cols.map((c) =>
    Math.max(dispWidth(c.label), ...rows.map((r) => dispWidth(c.plain(r))))
  );
  const sep = "  ";
  const build = (cells, colors) =>
    cells
      .map((s, i) => {
        const t = pad(s, widths[i]);
        return colors && colors[i] ? colors[i] + t + C.reset : t;
      })
      .join(sep);

  console.log("");
  console.log(C.bold + build(cols.map((c) => c.label), null) + C.reset);
  console.log(
    "-".repeat(widths.reduce((a, b) => a + b, 0) + sep.length * (widths.length - 1))
  );
  for (const r of rows) {
    const colors = [];
    const cells = cols.map((c, i) => {
      colors[i] = c.color ? c.color(r) : null;
      return c.plain(r);
    });
    console.log(build(cells, colors));
  }
}

/* ---------------- 主流程 ---------------- */
async function main() {
  /* 收集全部标的(去重) */
  const allProxies = [...new Set(SECTORS.flatMap((s) => s.proxies))];
  const allTickers = [
    ...new Set([
      ...allProxies.map(tickerOf),
      ...INDEXES.map((i) => i.symbol),
    ]),
  ];

  /* 一次批量请求新浪盘前 */
  const sina = await fetchSina(allTickers);

  /* 组装板块: 均值只统计有实时盘前数据的成分, 按板块定义顺序展示 */
  const sectors = SECTORS.map((s) => {
    const proxyQuotes = s.proxies
      .map((p) => ({ secid: p, symbol: tickerOf(p), quote: getQuote(sina, p) }))
      .filter((q) => q.quote && q.quote.isLive && q.quote.prePct != null)
      .map((q) => ({
        secid: q.secid,
        symbol: q.symbol,
        changePct: q.quote.prePct,
        prePrice: q.quote.prePrice,
        preChg: q.quote.preChg,
        preTime: q.quote.preTime,
        timeInfo: q.quote.timeInfo,
      }));

    const avg = proxyQuotes.length
      ? proxyQuotes.reduce((a, q) => a + q.changePct, 0) / proxyQuotes.length
      : null;
    let best = null;
    let worst = null;
    if (proxyQuotes.length) {
      best = proxyQuotes.reduce((a, b) => (b.changePct > a.changePct ? b : a));
      worst = proxyQuotes.reduce((a, b) => (b.changePct < a.changePct ? b : a));
    }
    let latest = null;
    for (const q of proxyQuotes) {
      if (q.timeInfo && (latest == null || q.timeInfo.h * 60 + q.timeInfo.mi > latest.timeInfo.h * 60 + latest.timeInfo.mi)) latest = q;
    }
    const sessLabel =
      latest && latest.timeInfo && latest.timeInfo.isToday
        ? `${SESS_CN[latest.timeInfo.sess]} ${pad2(latest.timeInfo.h)}:${pad2(latest.timeInfo.mi)}`
        : "无数据";

    return { ...s, avg, okCount: proxyQuotes.length, best, worst, sessLabel };
  });

  /* 大盘指数(同样走新浪盘前) */
  const indexRows = INDEXES.map((idx) => {
    const q = sina.get(idx.symbol);
    const ok = q && q.isLive && q.prePct != null;
    return { ...idx, price: ok ? q.prePrice : null, changePct: ok ? q.prePct : null };
  });

  /* ---- 输出 ---- */
  const now = etNow();
  const dowNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const dow = dowNames[new Date(Date.UTC(now.y, now.mo - 1, now.d)).getUTCDay()];
  const etStr = `${now.y}-${pad2(now.mo)}-${pad2(now.d)} ${pad2(now.h)}:${pad2(now.mi)} ${dow}`;

  console.log(C.bold + "美股板块盘前行情(同花顺概念板块)" + C.reset);
  console.log(C.dim + `美东时间: ${etStr}  |  ${marketPhase()}` + C.reset);
  console.log(C.dim + "数据: 新浪 hq.sinajs.cn(实时盘前) | 板块涨跌幅 = 成分盘前涨跌幅等权均值" + C.reset);

  renderTable(sectors, [
    { label: "板块", plain: (r) => `${r.icon} ${r.name}` },
    {
      label: "成分",
      plain: (r) => `${r.okCount}/${r.proxies.length}`,
      color: (r) => (r.okCount === 0 ? C.yellow : null),
    },
    { label: "涨跌幅", plain: (r) => pctText(r.avg), color: (r) => pctColor(r.avg) },
    {
      label: "领涨",
      plain: (r) => (r.best ? `${r.best.symbol} ${numText(r.best.changePct)}` : "--"),
      color: (r) => (r.best ? C.green : null),
    },
    {
      label: "领跌",
      plain: (r) => (r.worst ? `${r.worst.symbol} ${numText(r.worst.changePct)}` : "--"),
      color: (r) => (r.worst ? C.red : null),
    },
    { label: "阶段", plain: (r) => r.sessLabel },
  ]);

  console.log("");
  console.log(C.bold + "【大盘指数】" + C.reset);
  for (const r of indexRows) {
    const col = pctColor(r.changePct);
    const price = r.price != null ? Number(r.price).toFixed(2) : "--";
    const tag = r.changePct != null ? "盘前" : "--";
    console.log(
      (col || "") +
      `${r.symbol.padEnd(5)} ${r.name.padEnd(6)} ${price.padStart(9)}  ${pctText(r.changePct)}  ${tag}` +
      C.reset
    );
  }
}

main().catch((e) => {
  console.error("脚本出错:", e.message);
  process.exit(1);
});
