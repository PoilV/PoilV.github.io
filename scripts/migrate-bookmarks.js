const fs = require("fs");
const path = require("path");
const repo = path.join(__dirname, "..");

const html = fs.readFileSync(path.join(repo, "bookmarks.html"), "utf8");
const titlesPath = path.join(repo, "data", "titles.json");
const iconsPath = path.join(repo, "data", "icons.json");

let titles = {};
let icons = {};
try { titles = JSON.parse(fs.readFileSync(titlesPath, "utf8")); } catch (e) {}
try { icons = JSON.parse(fs.readFileSync(iconsPath, "utf8")); } catch (e) {}

let addedTitle = 0, addedIcon = 0;
for (const line of html.split("\n")) {
  const a = line.match(/<DT><A HREF="([^"]*)"(?:[^>]*?ICON_URI="([^"]*)")?[^>]*>([^<]*)<\/A>/);
  if (!a) continue;
  const url = a[1];
  const iconUri = a[2] && !a[2].startsWith("fake-favicon-uri:") ? a[2] : "";
  const name = a[3].trim();
  if (!/^https?:/.test(url)) continue;
  if (name && name !== url && !(url in titles)) { titles[url] = name; addedTitle++; }
  if (iconUri && !(url in icons)) { icons[url] = iconUri; addedIcon++; }
}

fs.writeFileSync(titlesPath, JSON.stringify(titles, null, 1) + "\n");
fs.writeFileSync(iconsPath, JSON.stringify(icons, null, 1) + "\n");
console.log(`added ${addedTitle} titles, ${addedIcon} icons (titles ${Object.keys(titles).length}, icons ${Object.keys(icons).length})`);
