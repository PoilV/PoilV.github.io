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
const LOBE_ICONS = {
  "chat.deepseek.com": "deepseek",
  "platform.deepseek.com": "deepseek",
  "www.doubao.com": "doubao",
  "chatgpt.com": "openai",
  "gemini.google.com": "gemini",
  "claude.ai": "claude",
  "civitai.com": "civitai",
  "civitai.red": "civitai",
  "civitai.red": "civitai",
  "huggingface.co": "huggingface",
  "openrouter.ai": "openrouter",
  "www.tavily.com": "tavily",
  "www.vidu.cn": "vidu",
  "docs.sillytavern.app": "sillytavern",
  "bigmodel.cn": "zhipu",
  "minimaxi.com": "minimax",
  "klingai.com": "kling",
  "www.aliyun.com": "alibaba",
  "console.cloud.tencent.com": "tencent",
  "dash.cloudflare.com": "cloudflare",
  "www.cloudflare.com": "cloudflare",
  "github.com": "github",
  "pan.baidu.com": "baidu",
  "photo.baidu.com": "baidu",
  "www.bilibili.com": "bilibili",
  "ppio.com": "ppio"
};
const SVGLOGO_ICONS = {
  "www.feishu.cn": ["social", "feiShu"],
  "weibo.com": ["social", "weiBo"],
  "m.weibo.cn": ["social", "weiBo"],
  "www.xiaohongshu.com": ["social", "xiaoHongShu"],
  "q.qq.com": ["social", "QQ"],
  "mail.qq.com": ["social", "QQ"],
  "www.douyin.com": ["social", "douYin"],
  "fanyi.caiyunapp.com": ["tools", "caiyunapp"],
  "www.aliyun.com": ["tools", "aliyun"],
  "www.alipan.com": ["tools", "alipan"]
};
async function fetchSvg(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000), redirect: "follow"
      });
      if (!r.ok) continue;
      const txt = await r.text();
      if (txt.length > 50 * 1024 || !/<\s*svg[\s>]/i.test(txt)) return "";
      return txt;
    } catch (e) {}
  }
  return "";
}
async function svglogoIcon(url) {
  const hit = SVGLOGO_ICONS[new URL(url).hostname];
  if (!hit) return "";
  const txt = await fetchSvg("https://raw.githubusercontent.com/HeyHuazi/SVGLOGO/main/static/library/" + hit[0] + "/" + hit[1] + ".svg");
  return txt ? "data:image/svg+xml," + encodeURIComponent(txt) : "";
}
const GILBARBARA_ICONS = {
  "x.com": "x",
  "discord.com": "discord",
  "www.reddit.com": "reddit",
  "www.instagram.com": "instagram",
  "www.youtube.com": "youtube",
  "music.youtube.com": "youtube",
  "open.spotify.com": "spotify",
  "www.pinterest.com": "pinterest",
  "www.dropbox.com": "dropbox",
  "www.tiktok.com": "tiktok",
  "store.steampowered.com": "steam",
  "duck.ai": "duckduckgo"
};
async function gilbarbaraIcon(url) {
  const name = GILBARBARA_ICONS[new URL(url).hostname];
  if (!name) return "";
  const txt = await fetchSvg("https://raw.githubusercontent.com/gilbarbara/logos/main/logos/" + name + ".svg");
  return txt ? "data:image/svg+xml," + encodeURIComponent(txt) : "";
}
async function lobeIcon(url) {
  const name = LOBE_ICONS[new URL(url).hostname];
  if (!name) return "";
  const txt = await fetchSvg("https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-svg/icons/" + name + ".svg");
  return txt ? "data:image/svg+xml," + encodeURIComponent(txt) : "";
}
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
        if (t && !isBadTitle(t)) { title = t; break; }
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
let sharp = null;
try { sharp = require("sharp"); } catch (e) {}
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
    if (sharp) {
      try {
        const webp = await sharp(buf, { density: 96 })
          .resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp()
          .toBuffer();
        if (webp.length < 40 * 1024) return "data:image/webp;base64," + webp.toString("base64");
      } catch (e) {}
    }
    if (buf.length <= 40 * 1024) return "data:" + ct + ";base64," + buf.toString("base64");
    return "";
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
    let icon = await lobeIcon(url) || await svglogoIcon(url) || await gilbarbaraIcon(url);
    if (!icon) {
      const u = parseIcon(html, url) || await directFavicon(url);
      if (u) icon = await toDataUri(u);
    }
    return { title, icon };
  } catch (e) {
    const fb = await ddgFallback(url);
    let icon = await lobeIcon(url) || await svglogoIcon(url) || await gilbarbaraIcon(url);
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
    if (icon) {
      if (icon !== icons[url]) { icons[url] = icon; iChanged++; }
    } else if (icons[url] && !icons[url].startsWith("data:image/")) {
      delete icons[url];
      iChanged++;
    }
  }
}
(async () => {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.writeFileSync(titlesPath, JSON.stringify(titles, null, 1) + "\n");
  fs.writeFileSync(iconsPath, JSON.stringify(icons, null, 1) + "\n");
  console.log(`done: ${tChanged} titles changed, ${iChanged} icons changed (${Object.keys(titles).length}/${Object.keys(icons).length} total)`);
})().catch(e => { console.error(e); process.exit(1); });
