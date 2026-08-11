const fs = require("fs");
const path = require("path");
const repo = path.join(__dirname, "..");
const linksPath = path.join(repo, "links.json");
const titlesPath = path.join(repo, "data", "titles.json");
const iconsPath = path.join(repo, "data", "icons.json");

const cfg = JSON.parse(fs.readFileSync(linksPath, "utf8"));
const urls = cfg.categories.flatMap(c => c.links).filter(u => /^https?:/.test(u));

const BAD = new Set(["official site", "official website", "homepage", "home page", "search", "login", "sign in", "登录", "登入", "请登录", "账户登录"]);
const decodeEntities = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");
const clean = s => {
  s = decodeEntities(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const seg = s.split(/[|｜\-–—：:·…]|\.\.\./)[0].trim().slice(0, 60);
  if (!seg || seg.length < 3 || /^error[:\s]/i.test(seg) || BAD.has(seg.toLowerCase())) return "";
  return seg;
};
const ICON_RES = [
  /<link[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*href=["']([^"']+)["']/i,
  /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut\s+)?icon["']/i,
  /<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i
];
const BAD_PAGE_TITLES = [
  /^lark\b/i,
  /security verification/i,
  /sina visitor system/i,
  /^alibaba cloud/i,
  /x\. it[’']?s what[’']?s happening/i,
  /just a moment/i,
  /attention required/i,
  /access denied/i,
  /^登录/,
  /登录$/,
  /^退出中/,
  /^加载中/,
  /^首頁/,
  /^首页/,
  /^i challenge thee/i,
  /^context$/i,
  /^哔哩哔哩\s*\(゜/,
  /^招聘网_/,
  /^【孔夫子旧书网】网上买书/,
  /^天翼云盘\s/,
  /^一刻相册：/,
  /^插画、漫画、小说/,
  /^书生梦工厂/,
  /^小云雀AI\s/,
  /^duck\.ai\s/i,
  /^portable$/i
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

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const isBadTitle = s => BAD_PAGE_TITLES.some(re => re.test(s));

async function ddgFallback(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const r = await fetch("https://api.duckduckgo.com/?q=" + encodeURIComponent(host) + "&format=json&no_html=1&no_redirect=1&kl=cn-zh", {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return { title: "", icon: "" };
    const j = await r.json();
    let title = "";
    for (const res of j.Results || []) {
      let rn = "";
      try { rn = new URL(res.FirstURL).hostname.replace(/^www\./, ""); } catch (e) {}
      if (rn && (rn === host || rn.includes(host) || host.includes(rn))) {
        const t = clean(res.Text);
        if (t && !isBadTitle(t)) { title = t; break; }
      }
    }
    return { title, icon: "" };
  } catch (e) {
    return { title: "", icon: "" };
  }
}

const icoSize = buf => {
  if (buf.length < 22 || buf[0] !== 0 || buf[1] !== 0 || buf[2] !== 1 || buf[3] !== 0) return null;
  const count = buf.readUInt16LE(4);
  if (count < 1) return null;
  return { w: buf[6] || 256, h: buf[7] || 256 };
};
async function toDataUri(iconUrl) {
  try {
    const r = await fetch(iconUrl, {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000), redirect: "follow"
    });
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 1024 * 1024) return "";
    const head = buf.toString("utf8", 0, 200);
    const isImage =
      (buf[0] === 0x89 && buf[1] === 0x50) ||
      (buf[0] === 0xff && buf[1] === 0xd8) ||
      head.slice(0, 4) === "GIF8" ||
      (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP") ||
      (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) ||
      /^\s*<svg/i.test(head);
    if (!isImage) return "";
    if (/svg/.test(ct) || /\.svg($|\?)/i.test(iconUrl)) {
      if (buf.length > 50 * 1024) return "";
      return "data:image/svg+xml," + encodeURIComponent(buf.toString("utf8"));
    }
    if (buf.length <= 40 * 1024) return "data:" + ct + ";base64," + buf.toString("base64");
    return "";
  } catch (e) {
    return "";
  }
}
async function ddgIcon(url) {
  const host = new URL(url).hostname;
  try {
    const r = await fetch("https://icons.duckduckgo.com/ip3/" + host + ".ico", {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000), redirect: "follow"
    });
    if (!r.ok) return "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 1024 * 1024) return "";
    const size = icoSize(buf);
    if (size && size.w === 48 && size.h === 48) return "";
    if (!size) {
      const head = buf.toString("utf8", 0, 200);
      const isImage =
        (buf[0] === 0x89 && buf[1] === 0x50) ||
        (buf[0] === 0xff && buf[1] === 0xd8) ||
        head.slice(0, 4) === "GIF8" ||
        (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP") ||
        /^\s*<svg/i.test(head);
      if (!isImage) return "";
    }
    if (buf.length <= 40 * 1024) return "data:image/x-icon;base64," + buf.toString("base64");
    return "";
  } catch (e) {
    return "";
  }
}
async function directFavicon(url) {
  try {
    const base = new URL(url).origin;
    const r = await fetch(base + "/favicon.ico", {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000), redirect: "follow"
    });
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "";
    if (!/^image\//.test(ct)) return "";
    return base + "/favicon.ico";
  } catch (e) {
    return "";
  }
}

async function fetchPage(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const rP = fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
      signal: c.signal, redirect: "follow"
    });
    const [r, fb] = await Promise.all([rP, ddgFallback(url)]);
    let title = fb.title;
    let icon = await ddgIcon(url);
    if (!r.ok) {
      if (!icon) {
        const direct = await directFavicon(url);
        if (direct) icon = await toDataUri(direct);
      }
      return { title, icon };
    }
    const html = await r.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = m ? clean(m[1]) : "";
    if (!title && pageTitle && !isBadTitle(pageTitle)) title = pageTitle;
    if (!icon) {
      const u = parseIcon(html, url) || await directFavicon(url);
      if (u) icon = await toDataUri(u);
    }
    return { title, icon };
  } catch (e) {
    const fb = await ddgFallback(url);
    let icon = await ddgIcon(url);
    if (!icon) {
      const direct = await directFavicon(url);
      if (direct) icon = await toDataUri(direct);
    }
    return { title: fb.title, icon };
  } finally {
    clearTimeout(t);
  }
}

let titles = {};
let icons = {};
try { titles = JSON.parse(fs.readFileSync(titlesPath, "utf8")); } catch (e) {}
try { icons = JSON.parse(fs.readFileSync(iconsPath, "utf8")); } catch (e) {}

const CONCURRENCY = 10;
let idx = 0, tChanged = 0, iChanged = 0;
async function worker() {
  while (idx < urls.length) {
    const url = urls[idx++];
    const { title, icon } = await fetchPage(url);
    if (title && title !== titles[url]) { titles[url] = title; tChanged++; }
    if (icon && icon !== icons[url]) { icons[url] = icon; iChanged++; }
  }
}
(async () => {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.writeFileSync(titlesPath, JSON.stringify(titles, null, 1) + "\n");
  fs.writeFileSync(iconsPath, JSON.stringify(icons, null, 1) + "\n");
  console.log(`done: ${tChanged} titles changed, ${iChanged} icons changed (${Object.keys(titles).length}/${Object.keys(icons).length} total)`);
})().catch(e => { console.error(e); process.exit(1); });
