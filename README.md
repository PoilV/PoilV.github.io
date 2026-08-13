# 我的导航

个人导航站，托管在 GitHub Pages。链接列表维护在 [links.json](links.json)，页面纯静态渲染，站点标题与图标由 CI 自动抓取缓存。

## 目录结构

```
├── index.html                  # 站点入口，纯静态单文件
├── links.json                  # 链接与分类（手动维护，只存 URL 字符串）
├── data/
│   ├── titles.json             # 站点标题缓存（CI 自动生成）
│   └── icons.json              # 站点图标缓存，64x64 PNG data URI（CI 自动生成）
├── scripts/fetch-meta.py       # 抓取标题/图标的脚本（Python）
└── .github/workflows/fetch-meta.yml   # 每日定时 + 手动触发的抓取工作流
```

## 工作方式

- `links.json` 中只需维护 URL，页面首次渲染时按拼音排序，加载数据后自动补全标题与图标。
- [fetch-meta.py](scripts/fetch-meta.py) 依次尝试 DuckDuckGo API、页面 `<title>`（curl_cffi 浏览器指纹，可过多数反爬）、Jina 渲染回退（r.jina.ai，能执行 JS，救 SPA 与被反爬页面）、Bing/百度搜索（带域名校验）获取标题；兜底源（jina/Bing/百度）仅用于补缺，不覆盖已有标题，防止好标题被搜索结果的 SEO 噪音覆盖。可选配置 Google Custom Search API（仓库 Secrets 里设 `GOOGLE_API_KEY` 与 `GOOGLE_CX`，免费 100 次/天）作为最后的补缺源。
- 图标依次尝试 Google favicon 服务（不访问目标站点，覆盖面最大，自动剔除默认占位图）、DDG 图标服务、页面 icon、`/favicon.ico`，经 Pillow 统一转 64x64 PNG（ICO 帧选择与 alpha 掩码由 Pillow 正确处理），以 data URI 存入 `data/icons.json`。
- GitHub Actions 每日定时运行并自动提交 `data/*.json`，也可手动触发。

## 致谢

- [pinyin-pro](https://github.com/zh-lx/pinyin-pro) - 中文/英文混合名称的拼音排序
- [curl_cffi](https://github.com/lexiforest/curl_cffi) - 浏览器 TLS 指纹伪装，提高页面抓取成功率
- [Pillow](https://python-pillow.org) - 图标缩放与格式转换
- [Jina Reader](https://jina.ai/reader) - 渲染回退，抓取 SPA 与被反爬页面的标题
- [Google favicon 服务](https://www.google.com/s2/favicons) - 不依赖目标站点的图标源
- [unpkg](https://unpkg.com) - pinyin-pro 的 CDN 分发
- [DuckDuckGo](https://duckduckgo.com) - 标题搜索与图标服务
