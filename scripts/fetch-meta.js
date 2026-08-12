"use strict";
const fs = require("fs");
const path = require("path");
const repo = path.join(__dirname, "..");
const linksPath = path.join(repo, "links.json");
const titlesPath = path.join(repo, "data", "titles.json");
const iconsPath = path.join(repo, "data", "icons.json");

const cfg = JSON.parse(fs.readFileSync(linksPath, "utf8"));
const urls = cfg.categories.flatMap(c => c.links).filter(u => /^https?:/.test(u));

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
  /^天翼云盘\s/, /^一刻相册：/, /^插画、漫画、小说/, /^书生梦工厂/, /^小云雀AI\s/, /^duck\.ai\s/i, /^portable$/i
];
const decodeEntities = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const cleanTitle = s => {
  s = decodeEntities(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const seg = s.split(/[|｜\-–—：:·…]|\.\.\./)[0].trim().slice(0, 60);
  if (!seg || seg.length < 3 || /^error[:\s]/i.test(seg) || BAD.has(seg.toLowerCase())) return "";
  return seg;
};
const isBadTitle = s => BAD_PAGE.some(re => re.test(s));

// ---------- 图标校验与转换 ----------
const ICON_RES = [
  /<link[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*href=["']([^"']+)["']/i,
  /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut\s+)?icon["']/i,
  /<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i
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
const toDataUri = (buf, ct, hint) => {
  if (/svg/.test(ct) || /\.svg($|\?)/i.test(hint)) {
    if (buf.length > 50 * 1024) return "";
    return "data:image/svg+xml," + encodeURIComponent(buf.toString("utf8"));
  }
  if (buf.length <= 40 * 1024) return "data:" + ct + ";base64," + buf.toString("base64");
  return "";
};

// ---------- 标题源（按顺序尝试，非空即用） ----------
const titleSources = [
  { name: "ddg", run: async ctx => ctx.ddgTitle || "" },
  { name: "page", run: async ctx => (ctx.pageTitle && !isBadTitle(ctx.pageTitle)) ? ctx.pageTitle : "" },
  { name: "bing", run: async ctx => {
    const r = await fetchT("https://cn.bing.com/search?q=" + encodeURIComponent(ctx.host2) + "&mkt=zh-CN", 8000);
    if (!r.ok) return "";
    const m = (await r.text()).match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
    const t = m ? cleanTitle(m[1]) : "";
    return t && !isBadTitle(t) ? t : "";
  }},
  { name: "baidu", run: async ctx => {
    const r = await fetchT("https://www.baidu.com/s?wd=" + encodeURIComponent(ctx.host2), 8000);
    if (!r.ok) return "";
    const m = (await r.text()).match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i);
    const t = m ? cleanTitle(m[1]) : "";
    return t && !isBadTitle(t) ? t : "";
  }},
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
    return toDataUri(buf, "image/x-icon", ctx.host + ".ico");
  }},
  { name: "page-icon", run: async ctx => {
    if (!ctx.pageIcon) return "";
    const r = await fetchT(ctx.pageIcon, 10000);
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 1024 * 1024 || !isImage(buf)) return "";
    return toDataUri(buf, ct, ctx.pageIcon);
  }},
  { name: "direct", run: async ctx => {
    const base = new URL(ctx.url).origin;
    const r = await fetchT(base + "/favicon.ico", 8000);
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "";
    if (!/^image\//.test(ct)) return "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 1024 * 1024 || !isImage(buf)) return "";
    return toDataUri(buf, ct, base + "/favicon.ico");
  }},
];

// ---------- 单 URL 管道 ----------
async function processUrl(url) {
  const ctx = { url, host: hostOf(url), host2: hostOf(url).replace(/^www\./, "") };
  const pageP = fetchT(url, 15000, { "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" }).then(async r => {
    if (!r.ok) return;
    const html = await r.text();
    ctx.html = html;
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
        if (rn && (rn === ctx.host2 || rn.includes(ctx.host2) || ctx.host2.includes(rn))) {
          const t = cleanTitle(res.Text);
          if (t && !isBadTitle(t)) return t;
        }
      }
    } catch (e) {}
    return "";
  };
  const ddgP = ddgRun();
  await Promise.all([pageP, ddgP]);
  ctx.ddgTitle = ddgP;

  let title = "", icon = "", titleLog = [], iconLog = [];
  for (const s of titleSources) {
    try {
      const v = await s.run(ctx);
      if (v) { title = v; titleLog.push(s.name + ":ok"); break; }
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
  return { title, icon, log: titleLog.join(" ") + " | " + iconLog.join(" ") };
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
    const { title, icon, log } = await processUrl(url);
    if (title && title !== titles[url]) { titles[url] = title; tChanged++; }
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
