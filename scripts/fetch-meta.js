"use strict";
const fs = require("fs");
const path = require("path");
const repo = path.join(__dirname, "..");
const linksPath = path.join(repo, "links.json");
const titlesPath = path.join(repo, "data", "titles.json");
const iconsPath = path.join(repo, "data", "icons.json");

const cfg = JSON.parse(fs.readFileSync(linksPath, "utf8"));
const urls = cfg.categories.flatMap(c => c.links)
  .filter(u => typeof u === "string" && /^https?:/.test(u));

// ---------- 基础工具 ----------
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const fetchT = (url, ms, extra = {}) => fetch(url, {
  headers: { "User-Agent": UA, ...extra },
  signal: AbortSignal.timeout(ms),
  redirect: "follow"
});
const hostOf = url => new URL(url).hostname;

// ---------- 标题校验 ----------
const BAD = new Set(["official site", "official website", "homepage", "home page", "search", "login", "sign in", "登录", "登入", "请登录", "账户登录"]);
const BAD_PAGE = [
  /^lark\b/i, /security verification/i, /sina visitor system/i, /^alibaba cloud/i,
  /x\. it[’']?s what[’']?s happening/i, /just a moment/i, /attention required/i,
  /access denied/i, /^登录/, /登录$/, /^退出中/, /^加载中/, /^首頁/, /^首页/,
  /^i challenge thee/i, /^context$/i, /^哔哩哔哩\s*\(゜/, /^招聘网_/, /^【孔夫子旧书网】网上买书/,
  /^天翼云盘\s/, /^一刻相册：/, /^插画、漫画、小说/, /^书生梦工厂/, /^小云雀AI\s/, /^duck\.ai\s/i, /^portable$/i,
  /significado/i, /中文官网/i, /^动态首页$/, /^知乎专栏$/, /^下载.*(?:App|客户端)/i, /在你所在区域无法使用/i, /电脑版下载/
];
const decodeEntities = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const cleanTitle = s => {
  s = decodeEntities(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const seg = s.split(/[|｜\-–—：:·…，,›]|\.\.\./)[0].trim().slice(0, 60);
  if (!seg || seg.length < 3 || /^error[:\s]/i.test(seg) || BAD.has(seg.toLowerCase())) return "";
  return seg;
};
const isBadTitle = s => BAD_PAGE.some(re => re.test(s));

// ---------- 图标校验与转换 ----------
const ICON_RES = [
  /<link[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*href=["']([^"']+)["']/i,
  /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut\s+)?icon["']/i,
  /<link[^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*href=["']([^"']+)["']/i
];
const parseIcon = (html, url) => {
  for (const re of ICON_RES) {
    const m = html.match(re);
    if (m) {
      const h = m[1].trim();
      if (!h || /^data:/i.test(h)) continue;
      try { return new URL(h, url).href.slice(0, 500); } catch (e) {}
    }
  }
  return "";
};
const isImage = buf => {
  const head = buf.toString("utf8", 0, 200);
  return (buf[0] === 0x89 && buf[1] === 0x50) ||
    (buf[0] === 0xff && buf[1] === 0xd8) ||
    head.slice(0, 4) === "GIF8" ||
    (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP") ||
    (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) ||
    /^\s*<svg/i.test(head);
};
const icoSize = buf => {
  if (buf.length < 22 || buf[0] !== 0 || buf[1] !== 0 || buf[2] !== 1 || buf[3] !== 0) return null;
  const count = buf.readUInt16LE(4);
  if (count < 1) return null;
  return { w: buf[6] || 256, h: buf[7] || 256 };
};
const minimizeIco = buf => {
  if (buf.length < 22 || buf[0] !== 0 || buf[1] !== 0 || buf[2] !== 1 || buf[3] !== 0) return null;
  const count = buf.readUInt16LE(4);
  if (count < 1 || count > 64) return null;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    if (o + 16 > buf.length) return null;
    const w = buf[o] || 256, h = buf[o + 1] || 256;
    const size = buf.readUInt32LE(o + 8), offset = buf.readUInt32LE(o + 12);
    if (offset + size > buf.length) return null;
    entries.push({ w, h, size, offset, dir: buf.subarray(o, o + 16) });
  }
  const score = e => (e.w > 32 || e.h > 32 ? 1e6 : Math.abs(e.w - 32) + Math.abs(e.h - 32));
  const best = entries.reduce((a, e) => (score(e) < score(a) ? e : a), entries[0]);
  const header = Buffer.alloc(22);
  buf.copy(header, 0, 0, 4);
  header.writeUInt16LE(1, 4);
  best.dir.copy(header, 6);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, buf.subarray(best.offset, best.offset + best.size)]);
};
let sharp = null;
try { sharp = require("sharp"); } catch (e) {}
const decodeBmp = buf => {
  const dib = !(buf[0] === 0x42 && buf[1] === 0x4d);
  const base = dib ? 0 : 14;
  const biSize = buf.readUInt32LE(base);
  if (biSize < 40 || biSize > 124 || base + biSize + 16 > buf.length) return null;
  const w = buf.readInt32LE(base + 4), h = buf.readInt32LE(base + 8);
  if (w <= 0 || w > 1024 || Math.abs(h) > 1024) return null;
  const bpp = buf.readUInt16LE(base + 14);
  const comp = buf.readUInt32LE(base + 16);
  if (comp !== 0 || ![8, 24, 32].includes(bpp)) return null;
  let bfOffBits = dib ? biSize : buf.readUInt32LE(10);
  if (dib) {
    let paletteSize = 0;
    if (bpp === 8) paletteSize = (buf.readUInt32LE(base + 32) || 256) * 4;
    bfOffBits = base + biSize + paletteSize;
  }
  const flip = h > 0;
  const rowSize = Math.ceil((w * bpp) / 32) * 4;
  const avail = Math.floor((buf.length - bfOffBits) / rowSize);
  if (avail < 1) return null;
  const H = Math.min(Math.abs(h), avail);
  const palette = base + biSize;
  const rgba = Buffer.alloc(w * H * 4);
  for (let y = 0; y < H; y++) {
    const src = bfOffBits + (flip ? H - 1 - y : y) * rowSize;
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4, s = src + x * (bpp / 8);
      if (bpp === 32) {
        rgba[d] = buf[s + 2]; rgba[d + 1] = buf[s + 1]; rgba[d + 2] = buf[s]; rgba[d + 3] = 255;
      } else if (bpp === 24) {
        rgba[d] = buf[s + 2]; rgba[d + 1] = buf[s + 1]; rgba[d + 2] = buf[s]; rgba[d + 3] = 255;
      } else {
        const idx = buf[s];
        rgba[d] = buf[palette + idx * 4 + 2];
        rgba[d + 1] = buf[palette + idx * 4 + 1];
        rgba[d + 2] = buf[palette + idx * 4];
        rgba[d + 3] = 255;
      }
    }
  }
  return { data: rgba, width: w, height: H };
};
const resize = async buf => {
  if (!sharp) return null;
  try {
    let s;
    const bmp = decodeBmp(buf);
    if (bmp) s = sharp(bmp.data, { raw: { width: bmp.width, height: bmp.height, channels: 4 } });
    else {
      const opts = { density: 300 };
      const head = buf.toString("utf8", 0, 4096);
      if (/<svg/i.test(head)) {
        const vb = /viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/.exec(head);
        if (vb) {
          const max = Math.max(parseFloat(vb[1]), parseFloat(vb[2]));
          if (max > 0) opts.density = Math.min(600, Math.max(1, 72 * 64 / max));
        }
      }
      s = sharp(buf, opts);
    }
    const out = await s.resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
    return out && out.length < 40 * 1024 ? out : null;
  } catch (e) { return null; }
};
const toDataUri = async (buf, ct, hint) => {
  if (/svg/.test(ct) || /\.svg($|\?)/i.test(hint)) {
    if (buf.length > 50 * 1024) return "";
    const png = await resize(buf);
    if (png) return "data:image/png;base64," + png.toString("base64");
    return "data:image/svg+xml," + encodeURIComponent(buf.toString("utf8").replace(/>\s+</g, "><").trim());
  }
  let data = buf, frame = null;
  if (/icon/.test(ct) || (buf.length > 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0)) {
    const mini = minimizeIco(buf);
    if (mini) {
      data = mini;
      frame = mini.subarray(mini.readUInt32LE(18));
    }
  }
  const png = await resize(frame || data);
  if (png && png.length < data.length) return "data:image/png;base64," + png.toString("base64");
  if (data.length <= 40 * 1024) {
    const mime = data[0] === 0 && data[1] === 0 && data[2] === 1 && data[3] === 0 ? "image/x-icon" : ct;
    return "data:" + mime + ";base64," + data.toString("base64");
  }
  return "";
};

// ---------- 标题源（按顺序尝试，非空即用） ----------
const hostMatch = (host, host2) => !!host && (host === host2 || host.endsWith("." + host2));
const resolveHref = raw => {
  const u = decodeEntities(raw);
  try {
    const url = new URL(u, "https://cn.bing.com");
    if (/^(www\.)?bing\.com$/.test(url.hostname)) {
      const p = url.searchParams.get("u") || "";
      if (p.startsWith("a1")) {
        const b64 = p.slice(2).replace(/-/g, "+").replace(/_/g, "/");
        return new URL(Buffer.from(b64, "base64").toString("utf8"));
      }
      const direct = url.searchParams.get("url"); // /ck/a 跳转链接
      if (direct) return new URL(decodeURIComponent(direct));
      return null;
    }
    return url;
  } catch (e) { return null; }
};
const getBingTitle = async ctx => {
  const r = await fetchT("https://cn.bing.com/search?q=" + encodeURIComponent(ctx.host2) + "&mkt=zh-CN", 8000);
  if (!r.ok) return "";
  const html = await r.text();
  const re = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
  let m;
  while ((m = re.exec(html))) {
    const title = cleanTitle(m[2]);
    if (!title || isBadTitle(title) || title.toLowerCase() === ctx.host2) continue;
    const url = resolveHref(m[1]);
    if (url && hostMatch(url.hostname.replace(/^www\./, ""), ctx.host2)) return title;
  }
  return "";
};
const getBaiduTitle = async ctx => {
  const r = await fetchT("https://www.baidu.com/s?wd=" + encodeURIComponent(ctx.host2), 8000);
  if (!r.ok) return "";
  const html = await r.text();
  const re = /<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi;
  let m;
  while ((m = re.exec(html))) {
    const title = cleanTitle(m[1]);
    if (!title || isBadTitle(title) || title.toLowerCase() === ctx.host2) continue;
    const tail = html.slice(re.lastIndex, re.lastIndex + 800);
    const su = tail.match(/class=["'][^"']*c-showurl[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
              tail.match(/class=["'][^"']*c-color-gray[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    if (!su) continue;
    const shown = decodeEntities(su[1].replace(/<[^>]+>/g, "")).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();
    if (hostMatch(shown, ctx.host2)) return title;
  }
  return "";
};
const titleSources = [
  { name: "ddg", run: async ctx => ctx.ddgTitle || "" },
  { name: "page", run: async ctx => (ctx.pageTitle && !isBadTitle(ctx.pageTitle)) ? ctx.pageTitle : "" },
  { name: "bing", run: async ctx => getBingTitle(ctx) },
  { name: "baidu", run: async ctx => getBaiduTitle(ctx) },
];

// ---------- 图标源（按顺序尝试，非空即用） ----------
const iconSources = [
  { name: "ddg-icon", run: async ctx => {
    const r = await fetchT("https://icons.duckduckgo.com/ip3/" + ctx.host + ".ico", 10000);
    if (!r.ok) return "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 1024 * 1024 || !isImage(buf)) return "";
    const size = icoSize(buf);
    if (size && size.w === 48 && size.h === 48) return "";
    return await toDataUri(buf, "image/x-icon", ctx.host + ".ico");
  }},
  { name: "page-icon", run: async ctx => {
    if (!ctx.pageIcon) return "";
    const r = await fetchT(ctx.pageIcon, 10000);
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 1024 * 1024 || !isImage(buf)) return "";
    return await toDataUri(buf, ct, ctx.pageIcon);
  }},
  { name: "direct", run: async ctx => {
    const base = new URL(ctx.url).origin;
    const r = await fetchT(base + "/favicon.ico", 8000);
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "";
    if (!/^image\//.test(ct)) return "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 1024 * 1024 || !isImage(buf)) return "";
    return await toDataUri(buf, ct, base + "/favicon.ico");
  }},
];

// ---------- 单 URL 管道 ----------
async function processUrl(url) {
  const ctx = { url, host: hostOf(url), host2: hostOf(url).replace(/^www\./, "") };
  const pageP = fetchT(url, 15000, { "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" }).then(async r => {
    if (!r.ok) return;
    const html = await r.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    ctx.pageTitle = m ? cleanTitle(m[1]) : "";
    ctx.pageIcon = parseIcon(html, url);
  }).catch(() => {});
  const ddgRun = async () => {
    try {
      const r = await fetchT("https://api.duckduckgo.com/?q=" + encodeURIComponent(ctx.host2) + "&format=json&no_html=1&no_redirect=1&kl=cn-zh", 8000);
      if (!r.ok) return "";
      const j = await r.json();
      for (const res of j.Results || []) {
        let rn = "";
        try { rn = new URL(res.FirstURL).hostname.replace(/^www\./, ""); } catch (e) {}
        if (rn && (rn === ctx.host2 || rn.endsWith("." + ctx.host2))) {
          const t = cleanTitle(res.Text);
          if (t && !isBadTitle(t)) return t;
        }
      }
    } catch (e) {}
    return "";
  };
  const ddgP = ddgRun();
  await Promise.all([pageP, ddgP]);
  ctx.ddgTitle = await ddgP;

  let title = "", icon = "", titleLog = [], iconLog = [], titleSrc = "";
  for (const s of titleSources) {
    try {
      const v = await s.run(ctx);
      if (v) { title = v; titleLog.push(s.name + ":ok"); titleSrc = s.name; break; }
      titleLog.push(s.name + ":empty");
    } catch (e) { titleLog.push(s.name + ":err"); }
  }
  for (const s of iconSources) {
    try {
      const v = await s.run(ctx);
      if (v) { icon = v; iconLog.push(s.name + ":ok"); break; }
      iconLog.push(s.name + ":empty");
    } catch (e) { iconLog.push(s.name + ":err"); }
  }
  return { title, icon, log: titleLog.join(" ") + " | " + iconLog.join(" "), titleSrc };
}

// ---------- 主流程 ----------
let titles = {}, icons = {};
try { titles = JSON.parse(fs.readFileSync(titlesPath, "utf8")); } catch (e) {}
try { icons = JSON.parse(fs.readFileSync(iconsPath, "utf8")); } catch (e) {}

let idx = 0, tChanged = 0, iChanged = 0;
const fails = [];
const conc = Math.min(20, Math.max(1, parseInt(process.argv[2] || "10", 10)));
async function worker() {
  while (idx < urls.length) {
    const url = urls[idx++];
    const { title, icon, log, titleSrc } = await processUrl(url);
    // 搜索兜底（bing/baidu）只补空缺，不覆盖已有标题，避免好标题被 SEO 噪音覆盖
    const canOverwrite = !titles[url] || titleSrc === "ddg" || titleSrc === "page";
    if (title && title !== titles[url] && canOverwrite) { titles[url] = title; tChanged++; }
    if (icon && icon !== icons[url]) { icons[url] = icon; iChanged++; }
    if (!title && !icon) fails.push(url + "  [" + log + "]");
  }
}
(async () => {
  await Promise.all(Array.from({ length: conc }, worker));
  const urlSet = new Set(urls);
  let tStale = 0, iStale = 0;
  for (const k of Object.keys(titles)) if (!urlSet.has(k)) { delete titles[k]; tStale++; }
  for (const k of Object.keys(icons)) if (!urlSet.has(k)) { delete icons[k]; iStale++; }
  fs.writeFileSync(titlesPath, JSON.stringify(titles, null, 1) + "\n");
  fs.writeFileSync(iconsPath, JSON.stringify(icons, null, 1) + "\n");
  console.log(`done: ${tChanged} titles changed, ${iChanged} icons changed, ${tStale} stale titles, ${iStale} stale icons removed (${Object.keys(titles).length}/${Object.keys(icons).length} total)`);
  if (fails.length) {
    console.log("--- no data for " + fails.length + " urls ---");
    fails.forEach(f => console.log("  " + f));
  }
})().catch(e => { console.error(e); process.exit(1); });
