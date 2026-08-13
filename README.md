# 我的导航

个人导航站，托管在 GitHub Pages。链接列表维护在 [links.json](links.json)，页面纯静态渲染，站点标题由 CI 自动抓取缓存，图标使用开源品牌图标库的 CDN 分发。

## 目录结构

```
├── index.html                  # 站点入口，纯静态单文件
├── links.json                  # 链接与分类（手动维护，也支持 { "url", "name", "icon" } 对象形式）
├── data/
│   ├── titles.json             # 站点标题缓存（CI 自动生成）
│   └── icons.json              # 品牌图标引用（CI 自动匹配生成，仅存引用，约 3KB）
├── scripts/fetch-meta.js       # 抓取标题 / 匹配图标的脚本（Node.js，零依赖）
└── .github/workflows/fetch-meta.yml   # 每日定时 + 手动触发的抓取工作流
```

## 工作方式

- `links.json` 中只需维护 URL，页面首次渲染时按域名拼音排序，稍后加载数据后自动补全标题与图标。
- 标题抓取：依次尝试 DuckDuckGo API、页面 `<title>`、Bing/百度搜索（带域名校验），结果缓存到 `data/titles.json`。
- 图标匹配：根据域名在三个开源图标库中精确匹配（带别名表），引用存入 `data/icons.json`：
  - [Lobe Icons](https://github.com/lobehub/lobe-icons) - AI 与中文品牌彩色图标（`@master` 自动最新）
  - [Iconify `logos`](https://iconify.design) - 彩色品牌图标
  - [Simple Icons](https://github.com/simple-icons/simple-icons) - 单色品牌图标（自动填充品牌色）
- 未匹配到的站点回退为域名首字母。可在 `links.json` 中手动指定 `"icon": "lobe:xxx" / "logos:xxx" / "si:xxx" / "none"` 覆盖。
- GitHub Actions 每日定时运行并自动提交 `data/*.json`，也可手动触发。

## 致谢

- [pinyin-pro](https://github.com/zh-lx/pinyin-pro) - 中文/英文混合名称的拼音排序（unpkg CDN 分发）
- [Lobe Icons](https://github.com/lobehub/lobe-icons) - 品牌彩色图标
- [Simple Icons](https://github.com/simple-icons/simple-icons) - 品牌单色图标
- [Iconify](https://github.com/iconify/iconify) - 图标聚合 API
- [DuckDuckGo](https://duckduckgo.com) - 标题搜索
