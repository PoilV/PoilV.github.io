#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓取链接的标题与图标 → data/titles.json / data/icons.json

标题源（按序，先到先得）:
  ddg   - DuckDuckGo 即时答案 API（域名校验）
  page  - 页面 <title>（curl_cffi 浏览器 TLS 指纹，可过多数反爬）
  jina  - r.jina.ai 渲染回退（能执行 JS，救 SPA 与被反爬的页面，限速 20 次/分）
  bing  - Bing 搜索结果（域名校验，仅补空缺）
  baidu - 百度搜索结果（域名校验，仅补空缺）
  google- Google Custom Search API（可选，需 GOOGLE_API_KEY/GOOGLE_CX，仅补空缺）

图标源（按序）:
  page-icon - 页面 <link rel=icon>（网页 favicon，不含 apple-touch 类 App 图标）
  ddg-icon  - DuckDuckGo 图标服务（镜像站点实际 favicon）
  direct    - 站点根 /favicon.ico
  google    - Google faviconV2 服务（兜底覆盖，自动剔除默认占位图）

策略:
  - bing/baidu 只补空缺、不覆盖已有标题（防止好标题被搜索结果的 SEO 噪音覆盖）
  - 图标统一经 Pillow 转为 64x64 PNG data URI（ICO 帧选择、32bpp alpha、AND 掩码由 Pillow 正确处理）
  - 缓存键不在 links.json 中的条目会被清理
"""
import base64
import hashlib
import io
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse

try:
    from curl_cffi import requests
    IMPERSONATE = "chrome"
except ImportError:
    try:  # 本地无 curl_cffi 时退化，仅用于逻辑调试
        import requests
        IMPERSONATE = None
    except ImportError:
        requests = None
        IMPERSONATE = None

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINKS_PATH = os.path.join(REPO, "links.json")
TITLES_PATH = os.path.join(REPO, "data", "titles.json")
ICONS_PATH = os.path.join(REPO, "data", "icons.json")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


# ---------- 基础工具 ----------
def fetch(url, timeout, binary=False, headers=None):
    h = {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
    if headers:
        h.update(headers)
    kwargs = dict(timeout=timeout, headers=h, allow_redirects=True)
    if IMPERSONATE:
        kwargs["impersonate"] = IMPERSONATE
    try:
        r = requests.get(url, **kwargs)
        return r.status_code, r.url, (r.content if binary else r.text)
    except Exception:
        return None, url, None


def host_of(u):
    try:
        return urlparse(u).hostname or ""
    except Exception:
        return ""


def host_match(host, host2):
    return bool(host) and (host == host2 or host.endswith("." + host2))


# ---------- 标题清洗 ----------
BAD = {"official site", "official website", "homepage", "home page", "search",
       "login", "sign in", "登录", "登入", "请登录", "账户登录", "论坛"}
BAD_PAGE = [
    r"^lark\b", r"security verification", r"sina visitor system", r"^alibaba cloud",
    r"x\. it[’']?s what[’']?s happening", r"just a moment", r"attention required",
    r"access denied", r"^登录", r"登录$", r"^退出中", r"^加载中", r"^首頁", r"^首页",
    r"^i challenge thee", r"^context$", r"^哔哩哔哩\s*\(゜", r"^招聘网_", r"^【孔夫子旧书网】网上买书",
    r"^天翼云盘\s", r"^一刻相册：", r"^插画、漫画、小说", r"^书生梦工厂", r"^小云雀AI\s", r"^duck\.ai\s",
    r"^portable$", r"significado", r"中文官网", r"^动态首页$", r"^知乎专栏$",
    r"^下载.*(?:App|客户端)", r"在你所在区域无法使用", r"电脑版下载", r"免费色情视频", r"安全验证",
]
BAD_PAGE = [re.compile(p, re.I) for p in BAD_PAGE]
_ENT = re.compile(r"&#x([0-9a-f]+);|&#(\d+);", re.I)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_CJK = re.compile(r"[\u4e00-\u9fff]")
_SEP = re.compile(r"[|｜\-–—：:·…，,›]|\.\.\.")


def decode_entities(s):
    def rep(m):
        return chr(int(m.group(1), 16)) if m.group(1) else chr(int(m.group(2)))
    s = _ENT.sub(rep, s or "")
    return (s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
             .replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'"))


_FORMAT_CHARS = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060\ufeff]")


def clean_title(s):
    s = _FORMAT_CHARS.sub("", _WS.sub(" ", _TAG.sub("", decode_entities(s)))).strip()
    seg = _SEP.split(s)[0].strip()[:60]
    # 纯 ASCII 标题至少 3 字符；2 个汉字的品牌名（如"豆包"）允许
    too_short = not seg or (len(seg) < 3 and not (len(seg) == 2 and _CJK.search(seg)))
    if too_short or re.match(r"^error[:\s]", seg, re.I) or seg.lower() in BAD:
        return ""
    return seg


def is_bad_title(s):
    return any(p.search(s) for p in BAD_PAGE)


# ---------- 标题源 ----------
def title_ddg(ctx):
    u = ("https://api.duckduckgo.com/?q=" + quote(ctx["host2"]) +
         "&format=json&no_html=1&no_redirect=1&kl=cn-zh")
    code, _, text = fetch(u, 8)
    if code != 200 or not text:
        return ""
    try:
        j = json.loads(text)
    except Exception:
        return ""
    for res in j.get("Results") or []:
        try:
            rn = host_of(res.get("FirstURL", "")).replace("www.", "")
        except Exception:
            continue
        if rn and (rn == ctx["host2"] or rn.endswith("." + ctx["host2"])):
            t = clean_title(res.get("Text", ""))
            if t and not is_bad_title(t):
                return t
    return ""


def title_page(ctx):
    code, _, text = fetch(ctx["url"], 12)
    if code is None or code >= 400 or not text:
        return ""
    ctx["html"] = text
    m = re.search(r"<title[^>]*>([\s\S]*?)</title>", text, re.I)
    if not m:
        return ""
    t = clean_title(m.group(1))
    return t if (t and not is_bad_title(t)) else ""


_jina_lock = threading.Lock()
_jina_next = 0.0


def title_jina(ctx):
    global _jina_next
    with _jina_lock:  # r.jina.ai 匿名限速约 20 次/分
        wait = _jina_next - time.time()
        if wait > 0:
            time.sleep(wait)
        _jina_next = time.time() + 3.2
    code, _, text = fetch("https://r.jina.ai/" + ctx["url"], 25)
    if code != 200 or not text:
        return ""
    head = "\n".join(text.splitlines()[:3])
    m = re.search(r"^Title:\s*(.+)$", head, re.I | re.M)
    if not m:
        return ""
    t = clean_title(m.group(1))
    return t if (t and not is_bad_title(t)) else ""


def resolve_href(raw):
    u = decode_entities(raw)
    if not re.match(r"^https?://", u, re.I):
        u = "https://cn.bing.com" + (u if u.startswith("/") else "/" + u)
    try:
        parts = urlparse(u)
        if re.match(r"^(www\.)?bing\.com$", parts.netloc, re.I):
            qs = parse_qs(parts.query)
            p = (qs.get("u") or [""])[0]
            if p.startswith("a1"):
                b64 = p[2:].replace("-", "+").replace("_", "/")
                b64 += "=" * (-len(b64) % 4)
                return urlparse(base64.b64decode(b64).decode("utf8", "ignore"))
            direct = (qs.get("url") or [""])[0]  # /ck/a 跳转链接
            if direct:
                return urlparse(unquote(direct))
            return None
        return parts
    except Exception:
        return None


def title_bing(ctx):
    code, _, text = fetch("https://cn.bing.com/search?q=" + quote(ctx["host2"]) + "&mkt=zh-CN", 8)
    if code != 200 or not text:
        return ""
    for m in re.finditer(r'<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>\s*</h2>', text, re.I):
        t = clean_title(m.group(2))
        if not t or is_bad_title(t) or t.lower() == ctx["host2"]:
            continue
        u = resolve_href(m.group(1))
        if u and u.hostname and host_match(u.hostname.replace("www.", ""), ctx["host2"]):
            return t
    return ""


def title_baidu(ctx):
    code, _, text = fetch("https://www.baidu.com/s?wd=" + quote(ctx["host2"]), 8)
    if code != 200 or not text:
        return ""
    for m in re.finditer(r"<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)</a>[\s\S]*?</h3>", text, re.I):
        t = clean_title(m.group(1))
        if not t or is_bad_title(t) or t.lower() == ctx["host2"]:
            continue
        tail = text[m.end():m.end() + 800]
        su = (re.search(r"class=[\"'][^\"']*c-showurl[^\"']*[\"'][^>]*>([\s\S]*?)</span>", tail, re.I)
              or re.search(r"class=[\"'][^\"']*c-color-gray[^\"']*[\"'][^>]*>([\s\S]*?)</span>", tail, re.I))
        if not su:
            continue
        shown = _TAG.sub("", decode_entities(su.group(1)))
        shown = re.sub(r"^https?://", "", shown).replace("www.", "", 1).split("/")[0].strip()
        if host_match(shown, ctx["host2"]):
            return t
    return ""


def title_google(ctx):
    """Google Custom Search JSON API（可选，需 GOOGLE_API_KEY + GOOGLE_CX，免费 100 次/天）。"""
    key, cx = os.environ.get("GOOGLE_API_KEY", ""), os.environ.get("GOOGLE_CX", "")
    if not key or not cx:
        return ""
    u = ("https://www.googleapis.com/customsearch/v1?key=" + quote(key) +
         "&cx=" + quote(cx) + "&q=" + quote(ctx["host2"]) + "&num=5")
    code, _, text = fetch(u, 8)
    if code != 200 or not text:
        return ""
    try:
        j = json.loads(text)
    except Exception:
        return ""
    for item in j.get("items") or []:
        try:
            rn = host_of(item.get("link", "")).replace("www.", "")
        except Exception:
            continue
        if rn and (rn == ctx["host2"] or rn.endswith("." + ctx["host2"])):
            t = clean_title(item.get("title", ""))
            if t and not is_bad_title(t) and t.lower() != ctx["host2"]:
                return t
    return ""


# ---------- 图标源 ----------
_GOOGLE_PH = None


def google_placeholder_hash():
    global _GOOGLE_PH
    if _GOOGLE_PH is None:
        u = ("https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON"
             "&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Finvalid.example.invalid%2F&size=64")
        code, _, data = fetch(u, 10, binary=True)
        _GOOGLE_PH = hashlib.sha1(data).hexdigest() if (code == 200 and data) else ""
    return _GOOGLE_PH


def icon_google(ctx):
    u = ("https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON"
         "&fallback_opts=TYPE,SIZE,URL&url=" + quote(ctx["url"], safe="") + "&size=64")
    code, _, data = fetch(u, 10, binary=True)
    if code != 200 or not data or len(data) > 1024 * 1024:
        return ""
    ph = google_placeholder_hash()
    if ph and hashlib.sha1(data).hexdigest() == ph:  # 默认占位图，视为无图标
        return ""
    return process_image(data, "image/png")


def icon_ddg(ctx):
    code, _, data = fetch("https://icons.duckduckgo.com/ip3/" + ctx["host"] + ".ico", 10, binary=True)
    if code != 200 or not data or len(data) > 1024 * 1024:
        return ""
    if len(data) >= 22 and data[:4] == b"\x00\x00\x01\x00":
        w, h = data[6] or 256, data[7] or 256
        if w == 48 and h == 48:  # DDG 默认占位图
            return ""
    return process_image(data, "image/x-icon")


_ICON_RES = [
    re.compile(r"<link[^>]*rel=[\"'](?:shortcut\s+)?icon[\"'][^>]*href=[\"']([^\"']+)[\"']", re.I),
    re.compile(r"<link[^>]*href=[\"']([^\"']+)[\"'][^>]*rel=[\"'](?:shortcut\s+)?icon[\"']", re.I),
    # 注意：不收录 apple-touch-icon，它通常是 App 图标而非网页 favicon
]


def page_icon_url(html, base):
    for pat in _ICON_RES:
        m = pat.search(html or "")
        if not m:
            continue
        h = m.group(1).strip()
        if not h or h.lower().startswith("data:"):
            continue
        try:
            return h if re.match(r"^https?://", h, re.I) else urljoin(base, h)
        except Exception:
            pass
    return ""


def icon_page(ctx):
    u = page_icon_url(ctx.get("html"), ctx["url"])
    if not u:
        return ""
    code, _, data = fetch(u, 10, binary=True)
    if code != 200 or not data or len(data) > 1024 * 1024:
        return ""
    return process_image(data, "image")


def icon_direct(ctx):
    base = urlparse(ctx["url"])
    u = base.scheme + "://" + base.netloc + "/favicon.ico"
    code, _, data = fetch(u, 8, binary=True)
    if code != 200 or not data or len(data) > 1024 * 1024:
        return ""
    return process_image(data, "image")


# ---------- 图像转换 ----------
_RESAMPLE = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)


def process_image(data, mime):
    head = data[:512].lstrip().lower()
    if b"<svg" in head or "svg" in mime:  # SVG：浏览器可直接渲染，存原始 data URI
        if len(data) > 50 * 1024:
            return ""
        svg = re.sub(r">\s+<", "><", data.decode("utf8", "ignore")).strip()
        return "data:image/svg+xml," + quote(svg, safe="") if svg.startswith("<svg") else ""
    try:
        img = Image.open(io.BytesIO(data))
        if getattr(img, "is_animated", False):
            img.seek(0)
        if img.format == "ICO" and getattr(img, "n_frames", 1) > 1:
            sizes = img.info.get("sizes") or []
            if sizes:  # 选择最接近 64px 的帧
                idx = min(range(len(sizes)), key=lambda i: abs((sizes[i][0] or 256) - 64))
                img.seek(idx)
        img = img.convert("RGBA")
        bbox = img.getchannel("A").getbbox()  # 裁掉透明衬垫
        if bbox:
            img = img.crop(bbox)
        w, h = img.size
        if w > 0 and h > 0:
            scale = min(64 / max(w, h), 4)  # 小图标放大填满画布（最多 4 倍防糊）
            if abs(scale - 1) > 0.01:
                img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), _RESAMPLE)
        canvas = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        canvas.paste(img, ((64 - img.width) // 2, (64 - img.height) // 2))
        buf = io.BytesIO()
        canvas.save(buf, "PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        if len(data) <= 40 * 1024:
            return "data:" + (mime or "image") + ";base64," + base64.b64encode(data).decode()
        return ""


# ---------- 单 URL 管道 ----------
def process_url(url):
    ctx = {"url": url, "host": host_of(url), "host2": host_of(url).replace("www.", ""), "html": None}
    title, title_src, tlog = "", "", []
    for name, fn in (("ddg", title_ddg), ("page", title_page), ("jina", title_jina),
                     ("bing", title_bing), ("baidu", title_baidu), ("google", title_google)):
        try:
            v = fn(ctx) or ""
        except Exception:
            tlog.append(name + ":err")
            continue
        if v:
            title, title_src = v, name
            tlog.append(name + ":ok")
            break
        tlog.append(name + ":empty")
    icon, ilog = "", []
    for name, fn in (("page-icon", icon_page), ("ddg-icon", icon_ddg),
                     ("direct", icon_direct), ("google", icon_google)):
        try:
            v = fn(ctx) or ""
        except Exception:
            ilog.append(name + ":err")
            continue
        if v:
            icon = v
            ilog.append(name + ":ok")
            break
        ilog.append(name + ":empty")
    return title, icon, " ".join(tlog) + " | " + " ".join(ilog), title_src


# ---------- 主流程 ----------
def main():
    with open(LINKS_PATH, encoding="utf8") as f:
        cfg = json.load(f)
    urls = [l for c in cfg.get("categories", []) for l in c.get("links", [])
            if isinstance(l, str) and re.match(r"^https?:", l)]
    titles, icons = {}, {}
    try:
        with open(TITLES_PATH, encoding="utf8") as f:
            titles = json.load(f)
    except Exception:
        pass
    try:
        with open(ICONS_PATH, encoding="utf8") as f:
            icons = json.load(f)
    except Exception:
        pass

    conc = max(1, min(20, int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else 10))
    t_changed = i_changed = 0
    fails = []
    lock = threading.Lock()
    idx = 0
    idx_lock = threading.Lock()

    def worker():
        nonlocal idx, t_changed, i_changed
        while True:
            with idx_lock:
                if idx >= len(urls):
                    return
                url, idx = urls[idx], idx + 1
            title, icon, log, src = process_url(url)
            # 兜底源（jina/bing/baidu）只补空缺，不覆盖已有标题；ddg/page 可覆盖
            can_overwrite = not titles.get(url) or src in ("ddg", "page")
            with lock:
                if title and title != titles.get(url) and can_overwrite:
                    titles[url], t_changed = title, t_changed + 1
                if icon and icon != icons.get(url):
                    icons[url], i_changed = icon, i_changed + 1
                if not title and not icon:
                    fails.append(url + "  [" + log + "]")

    with ThreadPoolExecutor(max_workers=conc) as ex:
        for _ in range(conc):
            ex.submit(worker)

    url_set = set(urls)
    t_stale = i_stale = 0
    for k in list(titles):
        if k not in url_set:
            del titles[k]
            t_stale += 1
    for k in list(icons):
        if k not in url_set:
            del icons[k]
            i_stale += 1
    os.makedirs(os.path.dirname(TITLES_PATH), exist_ok=True)
    with open(TITLES_PATH, "w", encoding="utf8") as f:
        f.write(json.dumps(titles, ensure_ascii=False, indent=1) + "\n")
    with open(ICONS_PATH, "w", encoding="utf8") as f:
        f.write(json.dumps(icons, ensure_ascii=False, indent=1) + "\n")
    print(f"done: {t_changed} titles changed, {i_changed} icons changed, "
          f"{t_stale} stale titles, {i_stale} stale icons removed "
          f"({len(titles)}/{len(icons)} total)")
    if fails:
        print("--- no data for %d urls ---" % len(fails))
        for line in fails:
            print("  " + line)


if __name__ == "__main__":
    main()
