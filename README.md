# 导航

个人导航站，托管在 GitHub Pages。纯静态：无 CI、无抓取管道、无缓存数据，全部内容维护在 [links.json](links.json)，可通过 [admin.html](admin.html) 在线编辑并一键部署。

## 目录结构

```
├── index.html                  # 站点入口，纯静态单文件
├── admin.html                  # 在线管理页（无入口链接，直接访问）
├── links.json                  # 链接与分类（唯一需要维护的数据文件）
├── favicon.svg                 # 站点图标（lucide compass）
└── README.md
```

## links.json 格式

```json
{
  "categories": [
    {
      "name": "AI 聊天",
      "icon": "brain-circuit",
      "links": [
        {"url": "https://chat.deepseek.com/", "name": "DeepSeek"},
        {"url": "https://www.bilibili.com/", "name": "哔哩哔哩", "icon": "https://www.bilibili.com/favicon.ico"},
        "https://example.com/"
      ]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `icon`（分类） | 选填 | [lucide](https://lucide.dev/icons) 图标名（kebab-case），显示在分类标题前 |
| `hidden`（分类） | 选填 | 设为 `true` 时该分类默认不显示，点击左侧导航后才展开 |
| `url` | ✅ | 链接地址 |
| `name` | 选填 | 显示名字，不写则显示域名 |
| `icon`（链接） | 选填 | 手动指定图标地址（优先级最高）；也可直接写 simple-icons 的 slug（如 `bilibili`），见下文图标机制 |

- 只写 URL 字符串也合法，等价于 `{"url": "..."}`。
- 分类和链接的显示顺序不用管：页面按拼音自动排序。

## 页面特性

- **搜索**：实时匹配名字、网址、全拼与拼音首字母
- **侧边导航**：可展开/收起；点击分类平滑滚动，滚动时自动高亮当前分类
- **分类图标**：每个分类可配一个 [lucide](https://lucide.dev/icons) 图标（`icon` 字段），跟随文字颜色；站点 favicon 是静态文件 [favicon.svg](favicon.svg)（lucide compass 图标，描边用浏览器系统色 CanvasText，随系统明暗自动切换）
- **暗色模式**：使用浏览器系统颜色（`Canvas` / `Field` / `CanvasText` / `AccentColor`），自动跟随系统明暗与强调色
- **图标加载链**（逐级兜底）：
  1. `icon` 字段手动指定（有则优先尝试，失败再走 favicon.im）；不是 URL 的值视为 simple-icons 的 slug，自动展开为 `https://cdn.simpleicons.org/{slug}`（官方 CDN，自带品牌色）
  2. [favicon.im](https://favicon.im) 的 `https://favicon.im/{域名}?larger=true&throw-error-on-404=true`（缺失时返回 404 而不是默认占位图）
  3. 首字母回退块
- 图标懒加载：卡片接近视口时才发起请求，候选结果会缓存复用；favicon.im 响应带约 7 天缓存头，重复访问基本零请求

## 维护

- **在线管理（推荐）**：打开 `https://poilv.github.io/admin.html`，首次粘贴一个细粒度 PAT（只授权本仓库 Contents 读写），即可在页面上增删改分类和链接并一键部署，无需本地 git
- **加链接**：在对应分类的 `links` 数组里加一行，名字看一眼站点标签页标题抄进去即可
- **换分类图标**：改分类的 `icon` 字段为任意 [lucide 图标名](https://lucide.dev/icons)（kebab-case），如 `"gamepad-2"`
- **图标不对**（例如服务商返回了 App 图标）：加 `"icon": "https://..."` 指向正确的图标地址
- **手动改动后**：推送到 main，GitHub Pages 自动发布；图标若显示旧图，Ctrl+F5 强制刷新（浏览器缓存约 7 天）

## 致谢

- [pinyin-pro](https://github.com/zh-lx/pinyin-pro) - 中文/英文混合名称的拼音排序
- [lucide](https://github.com/lucide-icons/lucide) - 分类图标与站点 favicon（ISC）
- [favicon.im](https://favicon.im) - 站点图标服务
- [unpkg](https://unpkg.com) - pinyin-pro 与 lucide 的 CDN 分发
