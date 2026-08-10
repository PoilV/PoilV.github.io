const fs = require("fs");
const path = require("path");
const repo = path.join(__dirname, "..");
const linksPath = path.join(repo, "links.js");
const titlesPath = path.join(repo, "titles.json");
const iconsPath = path.join(repo, "icons.json");

const src = fs.readFileSync(linksPath, "utf8");
const urls = [...src.matchAll(/url:\s*"([^"]*)"/g)].map(m => m[1]).filter(u => /^https?:/.test(u));

const BAD = new Set(["official site", "official website", "homepage", "home page", "search", "login", "sign in"]);
const clean = s => {
  s = (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!s || s.length < 3 || /^error[:\s]/i.test(s) || BAD.has(s.toLowerCase())) return "";
  return s.split(/[|｜]/)[0].split(/[-–—]/)[0].trim().slice(0, 60);
};
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

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
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
    return { title: m ? clean(m[1]) : "", icon: parseIcon(html, url) };
  } catch (e) {
    return { title: "", icon: "" };
  } finally {
    clearTimeout(t);
  }
}

let titles = {};
let icons = {};
try { titles = JSON.parse(fs.readFileSync(titlesPath, "utf8")); } catch (e) {}
try { icons = JSON.parse(fs.readFileSync(iconsPath, "utf8")); } catch (e) {}

const CONCURRENCY = 10;
let idx = 0, okTitle = 0, okIcon = 0;
async function worker() {
  while (idx < urls.length) {
    const url = urls[idx++];
    const { title, icon } = await fetchPage(url);
    if (title) { titles[url] = title; okTitle++; }
    if (icon) { icons[url] = icon; okIcon++; }
  }
}
(async () => {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.writeFileSync(titlesPath, JSON.stringify(titles, null, 1) + "\n");
  fs.writeFileSync(iconsPath, JSON.stringify(icons, null, 1) + "\n");
  console.log(`done: ${okTitle} titles, ${okIcon} icons (${Object.keys(titles).length}/${Object.keys(icons).length} total)`);
})().catch(e => { console.error(e); process.exit(1); });
