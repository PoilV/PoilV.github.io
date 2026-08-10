const fs = require("fs");
const path = require("path");
const repo = path.join(__dirname, "..");
const linksPath = path.join(repo, "links.js");
const outPath = path.join(repo, "titles.json");

const src = fs.readFileSync(linksPath, "utf8");
const urls = [...src.matchAll(/url:\s*"([^"]*)"/g)].map(m => m[1]).filter(u => /^https?:/.test(u));

const BAD = new Set(["official site", "official website", "homepage", "home page", "search", "login", "sign in"]);
const clean = s => {
  s = (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!s || s.length < 3 || /^error[:\s]/i.test(s) || BAD.has(s.toLowerCase())) return "";
  return s.split(/[|｜]/)[0].split(/[-–—]/)[0].trim().slice(0, 60);
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function fetchTitle(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
      signal: c.signal,
      redirect: "follow"
    });
    if (!r.ok) return "";
    const m = (await r.text()).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? clean(m[1]) : "";
  } catch (e) {
    return "";
  } finally {
    clearTimeout(t);
  }
}

let out = {};
try { out = JSON.parse(fs.readFileSync(outPath, "utf8")); } catch (e) { out = {}; }

const CONCURRENCY = 10;
let idx = 0, ok = 0, fail = 0;
async function worker() {
  while (idx < urls.length) {
    const url = urls[idx++];
    const t = await fetchTitle(url);
    if (t) { out[url] = t; ok++; }
    else fail++;
  }
}
(async () => {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
  console.log(`done: ${ok} ok, ${fail} failed, ${Object.keys(out).length} total in titles.json`);
})().catch(e => { console.error(e); process.exit(1); });
