"use strict";
const fs = require("fs");
const path = require("path");
const repo = path.join(__dirname, "..");
const linksPath = path.join(repo, "links.json");
const titlesPath = path.join(repo, "data", "titles.json");
const iconsPath = path.join(repo, "data", "icons.json");

const cfg = JSON.parse(fs.readFileSync(linksPath, "utf8"));
const links = cfg.categories.flatMap(c => c.links).map(l => typeof l === "string" ? { url: l } : { ...l });
const urls = links.map(l => l.url).filter(u => /^https?:/.test(u));

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
  /significado/i, /中文官网/i
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

// ---------- 标题源（按顺序尝试，非空即用） ----------
const hostMatch = (host, host2) => host && (host === host2 || host.includes(host2) || host2.includes(host));
const resolveHref = raw => {
  const u = decodeEntities(raw);
  try {
    let url = new URL(u, "https://cn.bing.com");
    if (/^(www\.)?bing\.com$/.test(url.hostname)) {
      const p = url.searchParams.get("u") || "";
      if (!p.startsWith("a1")) return null;
      const b64 = p.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      url = new URL(Buffer.from(b64, "base64").toString("utf8"));
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
    if (!title || isBadTitle(title)) continue;
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
    if (!title || isBadTitle(title)) continue;
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

// ---------- 图标匹配 ----------
const ALIAS = {
  weibo: "sinaweibo",
  chatgpt: "openai",
  bigmodel: "zhipu",
  aliyun: "alibabacloud",
  alipan: "alibabacloud",
  jianying: "capcut",
  steampowered: "steam",
  steamdb: "steam",
  klingai: "kling",
  minimaxi: "minimax",
  duck: "duckduckgo",
  archlinuxcn: "archlinux",
  onedrive: "microsoft",
};
const GENERIC = new Set([
  "www", "com", "cn", "org", "net", "io", "ai", "app", "web", "mail", "docs", "chat", "labs",
  "cloud", "store", "play", "music", "photo", "video", "news", "share", "open", "game", "drive",
  "home", "wiki", "dash", "console", "platform", "api", "up", "q", "m", "data", "download",
  "learn", "search", "bbs", "forum", "test", "pan", "yun", "account", "my", "static", "assets",
  "catalog", "update", "meta", "story", "www2", "files", "index", "main", "join", "beta", "demo"
]);
const SPECIAL_SUFFIX = [".github.io", ".gitlab.io", ".vercel.app", ".pages.dev", ".netlify.app"];
const getJson = async url => {
  const r = await fetchT(url, 30000, { Accept: "application/json" });
  if (!r.ok) throw new Error(url + " HTTP " + r.status);
  return r.json();
};
const flatCollection = j => {
  const names = new Set(j.uncategorized || []);
  for (const arr of Object.values(j.categories || {})) arr.forEach(n => names.add(n));
  return names;
};
let iconLibs = null;
async function loadIconLibs() {
  if (iconLibs) return iconLibs;
  const [lobeList, logosJ, siJ] = await Promise.all([
    getJson("https://api.github.com/repos/lobehub/lobe-icons/contents/packages/static-svg/icons"),
    getJson("https://api.iconify.design/collection?prefix=logos"),
    getJson("https://api.iconify.design/collection?prefix=simple-icons"),
  ]);
  iconLibs = {
    lobe: new Set(lobeList.map(f => f.name.replace(/\.svg$/, ""))),
    logos: flatCollection(logosJ),
    si: flatCollection(siJ),
  };
  return iconLibs;
}
const candidates = host => {
  const h = host.toLowerCase().replace(/\.+$/, "");
  const labels = h.split(".");
  let cands;
  if (labels.length > 2 && SPECIAL_SUFFIX.some(s => h.endsWith(s))) {
    cands = [labels[0]];
  } else {
    cands = labels.filter(l => !GENERIC.has(l));
    if (labels.length > 1 && !GENERIC.has(labels[0])) cands.push(labels[0] + labels[1]);
  }
  const out = [];
  for (const c of cands) {
    out.push(c);
    if (ALIAS[c]) out.push(ALIAS[c]);
    const flat = c.replace(/-/g, "");
    if (flat !== c) out.push(flat);
  }
  return [...new Set(out)];
};
function resolveIcon(url, manual) {
  if (manual === "none") return "";
  if (manual) return manual;
  const cands = candidates(hostOf(url));
  for (const [prefix, names] of [["lobe", iconLibs.lobe], ["logos", iconLibs.logos], ["si", iconLibs.si]]) {
    for (const c of cands) {
      if (!names.has(c)) continue;
      if (prefix === "lobe") {
        const base = c.replace(/-color$/, "");
        return "lobe:" + (names.has(base + "-color") ? base + "-color" : base);
      }
      return prefix + ":" + c;
    }
  }
  return "";
}

// ---------- 单 URL 标题管道 ----------
async function processTitle(url) {
  const ctx = { url, host: hostOf(url), host2: hostOf(url).replace(/^www\./, "") };
  const pageP = fetchT(url, 15000, { "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" }).then(async r => {
    if (!r.ok) return;
    const html = await r.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    ctx.pageTitle = m ? cleanTitle(m[1]) : "";
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
  for (const s of titleSources) {
    try {
      const v = await s.run(ctx);
      if (v) return { title: v, log: s.name + ":ok" };
    } catch (e) {}
  }
  return { title: "", log: "all:empty" };
}

// ---------- 主流程 ----------
let titles = {};
try { titles = JSON.parse(fs.readFileSync(titlesPath, "utf8")); } catch (e) {}

const skipTitles = process.env.SKIP_TITLES === "1";
const conc = Math.min(20, Math.max(1, parseInt(process.argv[2] || "10", 10)));

(async () => {
  let icons = {};
  try {
    icons = JSON.parse(fs.readFileSync(iconsPath, "utf8"));
    if (typeof Object.values(icons)[0] === "string" && /^data:/.test(Object.values(icons)[0] || "")) icons = {};
  } catch (e) { icons = {}; }

  let idx = 0, tChanged = 0;
  const fails = [];
  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      const { title, log } = await processTitle(url);
      if (title && title !== titles[url]) { titles[url] = title; tChanged++; }
      if (!title) fails.push(url + "  [" + log + "]");
    }
  }

  const titleJob = skipTitles ? Promise.resolve() : Promise.all(Array.from({ length: conc }, worker));
  await Promise.all([titleJob, loadIconLibs()]);
  const manualIcon = Object.fromEntries(links.filter(l => l.icon).map(l => [l.url, l.icon]));
  let covered = 0;
  const nextIcons = {};
  for (const url of urls) {
    const ref = resolveIcon(url, manualIcon[url]);
    if (ref) { nextIcons[url] = ref; covered++; }
  }
  console.log(`icons: ${covered}/${urls.length} covered`);

  const urlSet = new Set(urls);
  let tStale = 0;
  for (const k of Object.keys(titles)) if (!urlSet.has(k)) { delete titles[k]; tStale++; }
  fs.writeFileSync(titlesPath, JSON.stringify(titles, null, 1) + "\n");
  const iconsJson = JSON.stringify(nextIcons, null, 1) + "\n";
  if (fs.readFileSync(iconsPath, "utf8") !== iconsJson) fs.writeFileSync(iconsPath, iconsJson);
  console.log(`done: ${tChanged} titles changed, ${tStale} stale titles removed (${Object.keys(titles).length} total), icons ${covered}/${urls.length}`);
  if (fails.length) {
    console.log("--- no title for " + fails.length + " urls ---");
    fails.forEach(f => console.log("  " + f));
  }
})().catch(e => { console.error(e); process.exit(1); });
