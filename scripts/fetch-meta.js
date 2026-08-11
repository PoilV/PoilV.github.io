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
  const seg = s.split(/[|｜]/)[0].split(/[-–—]/)[0].trim().slice(0, 60);
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
  /x\. it'?s what'?s happening/i,
  /just a moment/i,
  /attention required/i,
  /access denied/i
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
async function bingSearch(host) {
  try {
    const r = await fetch("https://cn.bing.com/search?q=" + encodeURIComponent(host) + "&mkt=zh-CN", {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return "";
    const html = await r.text();
    const m = html.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
    const t = m ? clean(m[1]) : "";
    return t && !isBadTitle(t) ? t : "";
  } catch (e) {
    return "";
  }
}
async function baiduSearch(host) {
  try {
    const r = await fetch("https://www.baidu.com/s?wd=" + encodeURIComponent(host), {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return "";
    const html = await r.text();
    const m = html.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i);
    const t = m ? clean(m[1]) : "";
    return t && !isBadTitle(t) ? t : "";
  } catch (e) {
    return "";
  }
}
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
        if (t) { title = t; break; }
      }
    }
    return { title, icon: "" };
  } catch (e) {
    return { title: "", icon: "" };
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
  const t = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
      signal: c.signal,
      redirect: "follow"
    });
    if (!r.ok) return { title: "", icon: "" };
    const html = await r.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = m ? clean(m[1]) : "";
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const fb = await ddgFallback(url);
    let title = fb.title;
    if (!title && pageTitle && !isBadTitle(pageTitle)) title = pageTitle;
    if (!title) title = await bingSearch(hostname);
    if (!title) title = await baiduSearch(hostname);
    let icon = parseIcon(html, url);
    if (!icon) icon = await directFavicon(url);
    return { title, icon };
  } catch (e) {
    const fb = await ddgFallback(url);
    const icon = await directFavicon(url);
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
