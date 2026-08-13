# 我的导航

个人导航站，托管在 GitHub Pages。链接列表维护在 [links.json](links.json)，页面纯静态渲染，站点标题与图标由 CI 自动抓取缓存。

## 目录结构

```
├── index.html                  # 站点入口，纯静态单文件
├── links.json                  # 链接与分类（手动维护，也支持 { "url", "name" } 对象形式）
├── data/
│   ├── titles.json             # 站点标题缓存（CI 自动生成）
│   └── icons.json              # 站点图标缓存，64x64 PNG data URI（CI 自动生成）
├── scripts/fetch-meta.js       # 抓取标题/图标的脚本（Node.js）
└── .github/workflows/fetch-meta.yml   # 每日定时 + 手动触发的抓取工作流
```

## 工作方式

- `links.json` 中只需维护 URL，页面首次渲染时按域名拼音排序，稍后加载数据后自动补全标题与图标。
- [fetch-meta.js](scripts/fetch-meta.js) 依次尝试 DuckDuckGo API、页面 `<title>`、Bing/百度搜索（带域名校验）获取标题，并通过 DDG 图标服务、页面 icon、`/favicon.ico` 获取图标。
- 图标统一经 sharp 缩放为 64x64 PNG（ICO 提取最接近 32px 的帧，支持 BMP 帧解码），以 data URI 存入 `data/icons.json`。
- GitHub Actions 每日定时运行并自动提交 `data/*.json`，也可手动触发。

## 致谢

- [pinyin-pro](https://github.com/zh-lx/pinyin-pro) - 中文/英文混合名称的拼音排序
- [sharp](https://github.com/lovell/sharp) - 图标缩放与格式转换
- [unpkg](https://unpkg.com) - pinyin-pro 的 CDN 分发
- [DuckDuckGo](https://duckduckgo.com) - 标题搜索与图标服务
