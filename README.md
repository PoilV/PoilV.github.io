# 导航

个人导航站，托管在 GitHub Pages。纯静态：无 CI、无抓取管道、无缓存数据，全部内容手动维护在 [links.json](links.json)。

## 目录结构

```
├── index.html                  # 站点入口，纯静态单文件
├── links.json                  # 链接与分类（唯一需要维护的文件）
├── favicon.svg                 # 站点图标
└── README.md
```

## links.json 格式

```json
{
  "categories": [
    {
      "name": "AI 聊天",
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
| `url` | ✅ | 链接地址 |
| `name` | 选填 | 显示名字，不写则显示域名 |
| `icon` | 选填 | 手动指定图标地址（优先级最高），见下文图标机制 |

- 只写 URL 字符串也合法，等价于 `{"url": "..."}`。
- 分类和链接的显示顺序不用管：页面按拼音自动排序。

## 页面特性

- **搜索**：实时匹配名字、网址、全拼与拼音首字母
- **侧边导航**：可展开/收起；点击分类平滑滚动，滚动时自动高亮当前分类
- **暗色模式**：使用浏览器系统颜色（`Canvas` / `Field` / `CanvasText` / `AccentColor`），自动跟随系统明暗与强调色
- **图标加载链**（逐级兜底）：
  1. `icon` 字段手动指定（有则与 favicon.im 并行加载，先完成的先显示，手动图标到达后自动替换）
  2. [favicon.im](https://favicon.im) 的 `https://favicon.im/{域名}?larger=true&throw-error-on-404=true`（缺失时返回 404 而不是默认占位图）
  3. 首字母回退块
- 图标懒加载：卡片接近视口时才发起请求，候选结果会缓存复用；favicon.im 响应带约 7 天缓存头，重复访问基本零请求

## 维护

- **加链接**：在对应分类的 `links` 数组里加一行，名字看一眼站点标签页标题抄进去即可
- **图标不对**（例如服务商返回了 App 图标）：加 `"icon": "https://..."` 指向正确的图标地址
- **改动后**：推送到 main，GitHub Pages 自动发布；图标若显示旧图，Ctrl+F5 强制刷新（浏览器缓存约 7 天）

## 致谢

- [pinyin-pro](https://github.com/zh-lx/pinyin-pro) - 中文/英文混合名称的拼音排序
- [favicon.im](https://favicon.im) - 站点图标服务
- [unpkg](https://unpkg.com) - pinyin-pro 的 CDN 分发
