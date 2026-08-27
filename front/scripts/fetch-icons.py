# -*- coding: utf-8 -*-
"""
fetch-icons.py — 抓取 / 生成前端图标素材 PNG。

范围（详见 docs/前端图标清单.md）：
  ① QUOTE_ICONS（front/utils/quote-pages.ts）：板块 / 类型 / 指数等 Emoji 图标
     → 按 Twemoji 15.1 文件名规则从 jsDelivr CDN 下载（72px 正方形原图）
  ② 黄金 / 白银：不采用奖牌 Emoji，脚本生成直观的「金条(AU) / 银条(AG)」PNG
  ③ GOLD_SHOP_BRANDS（front/config/gold-shop.ts，15 家金店）：公司 Logo
     → 优先官网 Logo 直链；官网不可达的生成「品牌名占位图」并标注 placeholder
  ④ QUOTE_ICONS 中的日韩个股（16 家公司）：直接爬取公司 Logo
     → 官网直链 / Wikimedia Commons 512px 缩略图 / 官网 SVG（resvg 转 PNG）三级候选

输出（默认 front/static/icons/，全部为正方形、PNG 压缩保持小体积）：
  emoji/    <twemoji名>.png（72px 正方形原图，不输出放大版）
  metal/    gold-bar.png / silver-bar.png（256×256，脚本生成）
  brand/    <品牌名>.png（256×256 正方形，长宽不足自动透明补边）
  company/  <公司名>.png（256×256 正方形，日韩个股公司 logo）
  manifest.json（全量清单 + code_map：每个行情 code → 最终图片路径）

用法：
  python front/scripts/fetch-icons.py [--out 输出目录] [--size 256]

依赖：requests、Pillow；SVG 转 PNG 需要 resvg-py（pip install resvg-py）。
"""
from __future__ import annotations

import argparse
import datetime as _dt
import io
import json
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

try:
    import urllib3
    urllib3.disable_warnings()   # 部分官网证书校验失败，脚本统一 verify=False，静默告警
except ImportError:
    pass

try:
    import resvg_py
except ImportError:  # SVG 转 PNG 为可选能力
    resvg_py = None

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/{name}.png'
WIKI_FILE = 'https://commons.wikimedia.org/wiki/Special:FilePath/{name}?width=512'

REPO_ROOT = Path(__file__).resolve().parents[1]          # front/
QUOTE_PAGES_TS = REPO_ROOT / 'utils' / 'quote-pages.ts'  # ① QUOTE_ICONS

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,ja;q=0.7,ko;q=0.6'}
TIMEOUT = 30

# ② 黄金 / 白银 → 直观金条/银条图（覆盖 QUOTE_ICONS 中对应的 code）
METAL_OVERRIDE = {
    'gold-bar':   {'emoji': '🥇', 'codes': ['GOLD', 'GC', 'BK0547']},
    'silver-bar': {'emoji': '🥈', 'codes': ['SILVER', 'SI']},
}

# ③ 15 家金店官网 Logo 直链（候选按优先级；空列表 = 无官网 → 占位图）
BRAND_LOGO_CANDIDATES: dict[str, list[str]] = {
    '周大福': ['https://www.ctf.com.cn/template/zh-cn/images/logo.png'],
    '老凤祥': ['https://www.laofengxiang.com/images/logo.png'],
    '周六福': [
        # 路径含中文与全角括号，需 URL 编码（quote 后下载）
        'https://www.zlf.cn' + urllib.parse.quote(
            '/public/profile/img/2026/01/05/LOGO（168×80px)_20260105005445A028.png'),
        'https://www.zlf.cn/_nuxt/logo.fff90187.png',
    ],
    '周生生': ['http://cdn.chowsangsang.com/eshop/hk/newweb/Logo.jpg'],
    '六福珠宝': [
        'https://www.lukfook.com/static/favicon/android-icon-192x192.png?v=20210104',
        'https://www.lukfook.com/assets/static/images/common/logo.svg',
    ],
    '老庙': ['https://www.laomiao.com.cn/images/logo.png?v=1.0.21'],
    '中国黄金': ['https://www.chinagoldgroup.com/zghj/lib/home/picture/logo.jpg'],
    '周大生': ['https://www.chowtaiseng.com/uploads/head_logo_1637756080.png'],
    '明牌珠宝': ['https://www.mingpai.cn/upload/images/2025-05-20/'
              'TD77wGq1CI2vLD7pEzEeRQznjmhTcFJyjfb19znP.png'],
    # 以下官网不可达 / 域名停售，脚本生成占位图（manifest 标 placeholder）
    '菜百': [],
    '潮宏基': [],
    '金至尊': [],
    '梦金园': [],
    '亚一金店': [],
    '水贝黄金': [],
}

# ④ 日韩个股 16 家公司 Logo（候选按优先级：官网直链 / Wikimedia / 官网 SVG 等）
COMPANY_LOGO_CANDIDATES: dict[str, dict] = {
    '005930': {'name': '三星电子', 'urls': [
        WIKI_FILE.format(name='Samsung_Logo.svg'),
        'https://resources.samsung.com/etc.clientlibs/samsung/clientlibs/consumer/global/'
        'clientlib-common/resources/images/Favicon.png',
    ]},
    '000660': {'name': 'SK海力士', 'urls': [
        WIKI_FILE.format(name='SK_Hynix.svg'),
        'https://www.google.com/s2/favicons?domain=skhynix.com&sz=256',
    ]},
    '373220': {'name': 'LG新能源', 'urls': [
        WIKI_FILE.format(name='LG_Energy_Solution_logo_EN.svg'),
        'https://www.lgensol.com/inc/images/img/img_footer_logo.svg',
    ]},
    '066570': {'name': 'LG电子', 'urls': [
        WIKI_FILE.format(name='LG_logo_(2015).svg'),
        'https://media.us.lg.com/m/4f3e261da34f4910/original/lg_logo.svg',
    ]},
    '035420': {'name': 'NAVER', 'urls': [
        WIKI_FILE.format(name='Naver_Logotype.svg'),
        'https://www.google.com/s2/favicons?domain=naver.com&sz=256',
    ]},
    '005380': {'name': '现代汽车', 'urls': [
        WIKI_FILE.format(name='Hyundai_Motor_Company_logo.svg'),
        'https://www.hyundai.com/etc/designs/hyundai/ww/en/images/common/logo.png',
    ]},
    '068270': {'name': '赛尔群', 'urls': [
        WIKI_FILE.format(name='Celltrion_logo.png'),
        'https://www.google.com/s2/favicons?domain=celltrion.com&sz=256',
    ]},
    '051910': {'name': 'LG化学', 'urls': [
        'https://www.lgchem.com/asset/images/en/default/logo_en.png',
        WIKI_FILE.format(name='LG_Chem_logo.svg'),
    ]},
    '8035': {'name': '东京电子', 'urls': [
        WIKI_FILE.format(name='Tokyo_Electron_logo.svg'),
        'https://www.tel.com/irta3a00000001ah-img/irta3a00000001an.svg',
    ]},
    '6954': {'name': '发那科', 'urls': [
        WIKI_FILE.format(name='Fanuc_logo.svg'),
        'https://www.fanuc.co.jp/favicon.ico',
    ]},
    '6861': {'name': '基恩士', 'urls': [
        WIKI_FILE.format(name='Keyence.svg'),
        'https://www.keyence.com/img/core/logo_header_01.svg',
    ]},
    '7203': {'name': '丰田汽车', 'urls': [
        WIKI_FILE.format(name='Toyota_logo.svg'),
        'https://global.toyota/favicon.ico',
    ]},
    '6758': {'name': '索尼', 'urls': [
        WIKI_FILE.format(name='Sony_logo.svg'),
        'https://www.sony.jp/header-footer/assets/img/GlobalHeader/logo.svg',
    ]},
    '4063': {'name': '信越化学', 'urls': [
        'https://www.shinetsu.co.jp/wp-content/themes/shinetsu-renewal/images/common/logo.png',
        WIKI_FILE.format(name='Shin-Etsu_Chemical_logo.svg'),
    ]},
    '6981': {'name': '村田制作所', 'urls': [
        WIKI_FILE.format(name='Murata_Manufacturing_logo.svg'),
        'https://www.murata.com/-/media/siterenewal/business/commons/icons/logo.ashx'
        '?la=en-us&cvid=20220419093335000000',
    ]},
    '7974': {'name': '任天堂', 'urls': [
        WIKI_FILE.format(name='Nintendo.svg'),
        'https://www.google.com/s2/favicons?domain=nintendo.co.jp&sz=256',
    ]},
}

# Windows 中文字体候选（生成占位图 / 金条银条文字用）
CJK_FONTS = [
    'C:/Windows/Fonts/msyhbd.ttc',   # 微软雅黑 Bold
    'C:/Windows/Fonts/msyh.ttc',     # 微软雅黑
    'C:/Windows/Fonts/simhei.ttf',   # 黑体
    'C:/Windows/Fonts/Deng.ttf',     # 等线
]


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------

def http_get(url: str, timeout: int = TIMEOUT, retries: int = 3) -> bytes:
    """下载字节内容；429 / 5xx / 连接错误自动重试（Wikimedia 有频率限制）。"""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=timeout, headers=UA, verify=False)
            if resp.status_code in (429, 500, 502, 503, 504):
                last = RuntimeError(f'HTTP {resp.status_code}')
                time.sleep(2 + attempt * 2)
                continue
            resp.raise_for_status()
            return resp.content
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < retries - 1:
                time.sleep(2 + attempt * 2)
    raise last if last else RuntimeError(f'下载失败: {url}')


def load_cjk_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in CJK_FONTS:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def twemoji_name(emoji: str) -> str:
    """Twemoji 文件名规则：去 FE0F 变化选择符后小写 hex 用 '-' 连接。"""
    return '-'.join(f'{ord(c):x}' for c in emoji if ord(c) != 0xFE0F)


def parse_quote_icons() -> list[dict]:
    """解析 QUOTE_ICONS → [{code, emoji}]。"""
    text = QUOTE_PAGES_TS.read_text(encoding='utf-8')
    m = re.search(r'QUOTE_ICONS: Record<string, string> = \{(.*?)\n\}', text, re.S)
    if not m:
        raise RuntimeError(f'未在 {QUOTE_PAGES_TS} 中找到 QUOTE_ICONS')
    entries = []
    for line in m.group(1).splitlines():
        mm = re.match(r"^\s*'?([\w]+)'?:\s*'([^']+)',?\s*(?://.*)?$", line)
        if mm:
            entries.append({'code': mm.group(1), 'emoji': mm.group(2)})
    return entries


# ---------------------------------------------------------------------------
# 渲染 / 下载
# ---------------------------------------------------------------------------

def download_twemoji(name: str, out_path: Path) -> dict:
    """下载 Twemoji PNG（72px 正方形原图，体积小无需放大）。缺失码点用替代表。"""
    substitutes = {'2713': ['2713', '2713-fe0f', '2714']}  # ✓ → 加粗对勾
    candidates = substitutes.get(name, [name, f'{name}-fe0f'])
    data, used = None, None
    for c in candidates:
        try:
            data = http_get(TWEMOJI_BASE.format(name=c))
            used = c
            break
        except requests.HTTPError:
            continue
    if data is None:
        raise RuntimeError(f'Twemoji 无此字形（尝试过: {", ".join(candidates)}）')
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(data)   # 原图已是 72×72 正方形、体积小，直接保存
    return {'used_source': used}


def make_square(img: Image.Image, target: int) -> Image.Image:
    """等比缩放至长边 = target，再居中放到 target×target 透明正方形画布上（补全高度/宽度）。"""
    img = img.convert('RGBA')
    scale = target / max(img.width, img.height)
    if scale < 1:
        img = img.resize((max(1, round(img.width * scale)),
                          max(1, round(img.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (target, target), (0, 0, 0, 0))
    canvas.paste(img, ((target - img.width) // 2, (target - img.height) // 2), img)
    return canvas


def save_png_small(img: Image.Image, out_path: Path) -> None:
    """保存 PNG 并压缩体积：RGBA optimize/9 级压缩，再尝试 256 色量化取更小者。"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    opts = {'optimize': True, 'compress_level': 9}
    buf = io.BytesIO()
    img.save(buf, 'PNG', **opts)
    best = buf.getvalue()
    try:
        q = img.quantize(colors=256, method=Image.FASTOCTREE)
        buf2 = io.BytesIO()
        q.save(buf2, 'PNG', **opts)
        if len(buf2.getvalue()) < len(best):
            best = buf2.getvalue()
    except Exception:  # noqa: BLE001  量化失败就用 RGBA 版本
        pass
    out_path.write_bytes(best)


def rasterize_svg(svg_text: str, target: int) -> Image.Image:
    """用 resvg 渲染 SVG → RGBA 图（长边约 target）。"""
    if resvg_py is None:
        raise RuntimeError('未安装 resvg-py（pip install resvg-py），无法转换 SVG')
    out = resvg_py.svg_to_bytes(svg_string=svg_text, width=target, height=target,
                                background=None)
    return Image.open(io.BytesIO(out)).convert('RGBA')


def _gradient(size: tuple[int, int], top: tuple, bottom: tuple) -> Image.Image:
    """生成垂直渐变 RGBA 图。"""
    w, h = size
    img = Image.new('RGBA', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(h - 1, 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=color + (255,))
    return img


def _draw_text_center(img: Image.Image, text: str, font: ImageFont.FreeTypeFont,
                      fill: tuple[int, int, int, int], dy: int = 0) -> None:
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (img.width - tw) // 2 - bbox[0]
    y = (img.height - th) // 2 - bbox[1] + dy
    d.text((x, y), text, font=font, fill=fill)


def make_metal_bar(out_path: Path, kind: str) -> None:
    """生成直观金条(AU)/银条(AG) PNG（256×256 透明底）。"""
    size = 256
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if kind == 'gold':
        grad = _gradient((200, 96), (255, 230, 150), (196, 138, 20))
        border, text = (120, 80, 8), (90, 60, 5)
        label = 'AU'
    else:
        grad = _gradient((200, 96), (235, 238, 244), (140, 150, 165))
        border, text = (80, 88, 100), (55, 62, 74)
        label = 'AG'
    bar = Image.new('RGBA', (200, 96), (0, 0, 0, 0))
    d = ImageDraw.Draw(bar)
    d.rounded_rectangle([0, 0, 199, 95], radius=18, fill=(0, 0, 0, 255))
    bar.paste(grad, (0, 0), bar)                       # 用圆角 alpha 裁剪渐变
    d = ImageDraw.Draw(bar)
    d.rounded_rectangle([0, 0, 199, 95], radius=18, outline=border + (255,), width=4)
    _draw_text_center(bar, label, load_cjk_font(44), text + (255,))
    img.paste(bar, ((size - 200) // 2, (size - 96) // 2), bar)
    save_png_small(img, out_path)


def make_placeholder_logo(out_path: Path, name: str, size: int = 256) -> None:
    """无可用 logo 时生成品牌/公司名占位图（size×size 金色正方形卡片）。"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    card = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=max(16, size // 9),
                        fill=(0, 0, 0, 255))
    grad = _gradient((size, size), (250, 232, 190), (214, 172, 88))
    card.paste(grad, (0, 0), card)
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=max(16, size // 9),
                        outline=(150, 110, 40, 255), width=max(3, size // 64))
    _draw_text_center(card, name, load_cjk_font(size // 4), (90, 60, 12, 255))
    img.paste(card, (0, 0), card)
    save_png_small(img, out_path)


def download_logo(name: str, candidates: list[str], out_path: Path,
                  target: int = 256) -> tuple[str, str, str | None]:
    """按候选顺序下载公司/品牌 logo，统一转 256×256 正方形 PNG，返回 (status, 说明, 来源URL)。

    候选可为位图（PNG/JPG/ICO）或 SVG；SVG 用 resvg 转 PNG。全部失败 → 占位图。
    status: ok / placeholder
    """
    for url in candidates:
        try:
            data = http_get(url, timeout=20)
        except Exception:  # noqa: BLE001
            continue
        is_svg = b'<svg' in data[:1024] or url.rsplit('.', 1)[-1].lower() == 'svg'
        try:
            if is_svg:
                img = rasterize_svg(data.decode('utf-8', errors='replace'), target * 2)
                note = '官网 SVG→PNG' if 'svg' in url.split('?')[0].rsplit('.', 1)[-1].lower() \
                    else 'SVG→PNG'
            else:
                img = Image.open(io.BytesIO(data))
                img.load()
                note = '官网 logo'
        except Exception:  # noqa: BLE001
            continue
        save_png_small(make_square(img, target), out_path)
        return 'ok', note, url
    # 全部候选失败 → 占位图
    out_path.parent.mkdir(parents=True, exist_ok=True)
    make_placeholder_logo(out_path, name, target)
    return 'placeholder', '无可用 logo 源，生成占位图', None


def emit_icon_assets_ts(out_root: Path, code_map: dict[str, str]) -> Path:
    """生成 front/config/icon-assets.ts（行情 code / 金店品牌 → 图片路径映射）。

    供业务代码直接引用：QUOTE_ICON_ASSETS（QUOTE_ICONS 全部 code，含金属/公司覆盖）、
    GOLD_SHOP_ICON_ASSETS（15 家金店品牌）。路径为小程序根相对路径（/static/icons/...）。
    """
    rel_root = out_root.relative_to(REPO_ROOT).as_posix()  # 如 static/icons

    def p(f: str) -> str:
        return f'/{rel_root}/{f}'

    lines = [
        '/**',
        ' * 图标素材路径映射 —— 由 front/scripts/fetch-icons.py 自动生成，请勿手改。',
        f' * 重新生成：python front/scripts/fetch-icons.py（输出 {rel_root}/）',
        ' */',
        '',
        '/** 静态图标资源根目录（小程序本地路径） */',
        f"export const ICON_BASE = '/{rel_root}'",
        '',
        '/** 行情 code → 图标图片路径（QUOTE_ICONS 全量，含金条/银条/公司 logo 覆盖） */',
        'export const QUOTE_ICON_ASSETS: Record<string, string> = {',
    ]
    for code in sorted(code_map):
        lines.append(f'  {json.dumps(code, ensure_ascii=False)}: '
                     f'{json.dumps(p(code_map[code]), ensure_ascii=False)},')
    lines.append('}')
    lines.append('')
    lines.append('/** 金店品牌 → 品牌 logo 图片路径（GOLD_SHOP_BRANDS，含占位图） */')
    lines.append('export const GOLD_SHOP_ICON_ASSETS: Record<string, string> = {')
    for brand in BRAND_LOGO_CANDIDATES:
        lines.append(f'  {json.dumps(brand, ensure_ascii=False)}: '
                     f'{json.dumps(p(f"brand/{brand}.png"), ensure_ascii=False)},')
    lines.append('}')
    lines.append('')

    out = REPO_ROOT / 'config' / 'icon-assets.ts'
    out.write_text('\n'.join(lines), encoding='utf-8')
    return out


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description='抓取 / 生成前端图标素材 PNG')
    parser.add_argument('--out', default=str(REPO_ROOT / 'static' / 'icons'),
                        help='输出目录（默认 front/static/icons）')
    parser.add_argument('--size', type=int, default=256,
                        help='正方形画布尺寸（品牌/公司 logo、占位图、金条银条，默认 256）')
    args = parser.parse_args()

    out_root = Path(args.out)
    emoji_dir = out_root / 'emoji'
    metal_dir = out_root / 'metal'
    brand_dir = out_root / 'brand'
    company_dir = out_root / 'company'
    for d in (emoji_dir, metal_dir, brand_dir, company_dir):
        d.mkdir(parents=True, exist_ok=True)

    manifest: list[dict] = []
    failed: list[tuple[str, str]] = []
    code_map: dict[str, str] = {}   # 行情 code → 最终图片路径

    # ---------- ① QUOTE_ICONS → Twemoji ----------
    print('== ① QUOTE_ICONS Emoji（Twemoji CDN）==')
    quote = parse_quote_icons()
    merged: dict[str, dict] = {}
    for it in quote:
        e = it['emoji']
        if e not in merged:
            merged[e] = {'emoji': e, 'name': twemoji_name(e), 'codes': []}
        merged[e]['codes'].append(it['code'])

    for emoji, info in merged.items():
        name = info['name']
        png = emoji_dir / f'{name}.png'
        try:
            src = download_twemoji(name, png)
            files = {'png': f'emoji/{png.name}'}
            src_note = f"（源 {src['used_source']}）" if src['used_source'] != name else ''
            print(f'   ✓ {emoji}  {name}{src_note}  -> {png.relative_to(out_root)}'
                  f'（codes: {", ".join(info["codes"][:4])}{"…" if len(info["codes"]) > 4 else ""}）')
            manifest.append({
                'category': 'emoji', 'key': name, 'emoji': emoji,
                'codes': info['codes'], 'files': files, 'status': 'ok',
                'source': f'Twemoji/{src["used_source"]}',
            })
            for code in info['codes']:
                code_map[code] = files['png']
        except Exception as e:  # noqa: BLE001
            failed.append((f'emoji/{name} ({emoji})', str(e)))
            print(f'   ✗ {emoji}  {name}: {e}')

    # ---------- ② 黄金 / 白银 → 金条 / 银条 ----------
    print('== ② 黄金 / 白银 直观图（生成）==')
    for key, mv in METAL_OVERRIDE.items():
        png = metal_dir / f'{key}.png'
        kind = 'gold' if 'gold' in key else 'silver'
        try:
            make_metal_bar(png, kind)
            rel = f'metal/{png.name}'
            manifest.append({
                'category': 'metal', 'key': key, 'emoji': mv['emoji'],
                'codes': mv['codes'], 'files': {'png': rel},
                'status': 'generated', 'note': '脚本生成金条/银条直观图',
            })
            for code in mv['codes']:
                code_map[code] = rel
            print(f'   ✓ {key}.png（codes: {", ".join(mv["codes"])}）')
        except Exception as e:  # noqa: BLE001
            failed.append((f'metal/{key}', str(e)))
            print(f'   ✗ {key}: {e}')

    # ---------- ③ 金店品牌 Logo ----------
    print('== ③ 金店品牌 Logo（官网直链 / 占位图）==')
    for brand, candidates in BRAND_LOGO_CANDIDATES.items():
        png = brand_dir / f'{brand}.png'
        try:
            status, note, src = download_logo(brand, candidates, png, args.size)
            rel = f'brand/{png.name}'
            manifest.append({
                'category': 'brand', 'key': brand, 'files': {'png': rel},
                'status': status, 'note': note, 'source': src or 'placeholder',
            })
            mark = {'ok': '✓', 'placeholder': '⚠'}[status]
            print(f'   {mark} {brand}: {note}')
        except Exception as e:  # noqa: BLE001
            failed.append((f'brand/{brand}', str(e)))
            print(f'   ✗ {brand}: {e}')

    # ---------- ④ 日韩个股公司 Logo ----------
    print('== ④ 日韩个股公司 Logo（官网 / Wikimedia / SVG 转 PNG）==')
    for code, info in COMPANY_LOGO_CANDIDATES.items():
        name = info['name']
        png = company_dir / f'{name}.png'
        try:
            status, note, src = download_logo(name, info['urls'], png, args.size)
            rel = f'company/{png.name}'
            manifest.append({
                'category': 'company', 'key': code, 'name': name,
                'files': {'png': rel}, 'status': status, 'note': note,
                'source': src or 'placeholder',
            })
            code_map[code] = rel
            mark = {'ok': '✓', 'placeholder': '⚠'}[status]
            print(f'   {mark} {code} {name}: {note}')
        except Exception as e:  # noqa: BLE001
            failed.append((f'company/{code} {name}', str(e)))
            print(f'   ✗ {code} {name}: {e}')

    # ---------- manifest + 汇总 ----------
    summary = {
        'total': len(manifest),
        'ok': sum(1 for m in manifest if m['status'] == 'ok'),
        'generated': sum(1 for m in manifest if m['status'] == 'generated'),
        'placeholder': sum(1 for m in manifest if m['status'] == 'placeholder'),
        'failed': len(failed),
    }
    (out_root / 'manifest.json').write_text(
        json.dumps({
            'generated_at': _dt.datetime.now().isoformat(timespec='seconds'),
            'sources': {'twemoji_base': TWEMOJI_BASE, 'wiki_file': WIKI_FILE,
                        'brand': {b: c for b, c in BRAND_LOGO_CANDIDATES.items()},
                        'company': {c: v['urls'] for c, v in COMPANY_LOGO_CANDIDATES.items()}},
            'icons': manifest,
            'code_map': code_map,
            'summary': summary,
            'failed': [{'key': k, 'reason': r} for k, r in failed],
        }, ensure_ascii=False, indent=2),
        encoding='utf-8')

    print()
    print(f'完成：成功 {summary["ok"]} / 生成 {summary["generated"]} / 占位 '
          f'{summary["placeholder"]} / 失败 {summary["failed"]} / 共 {summary["total"]}')
    print(f'输出目录：{out_root}')
    print(f'清单：{out_root / "manifest.json"}（含 code_map：行情 code → 图片路径）')
    try:
        ts_path = emit_icon_assets_ts(out_root, code_map)
        print(f'TS 映射：{ts_path.relative_to(REPO_ROOT)}（供业务代码引用）')
    except Exception as e:  # noqa: BLE001
        print(f'! TS 映射生成失败（不影响图片产出）: {e}')
    for k, r in failed:
        print(f'  失败 - {k}: {r}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
