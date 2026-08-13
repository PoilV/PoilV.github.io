# 我的导航

个人导航站，托管在 GitHub Pages。纯静态：整个项目只有两个文件，无 CI、无抓取管道、无缓存数据。

## 目录结构

```
├── index.html                  # 站点入口，纯静态单文件
├── links.json                  # 链接与分类（手动维护）
└── favicon.svg                 # 站点图标
```

## 工作方式

- **名字**：`links.json` 中每条链接可直接写名字，不写则显示域名：
  ```json
  {"url": "https://www.doubao.com/", "name": "豆包"}
  ```
  想给某个链接单独指定图标，可加 `icon` 字段（图标 URL），否则走下面的默认图标服务。
- **图标**：默认使用 [favicon.im](https://favicon.im) 的 `https://favicon.im/{域名}?larger=true&throw-error-on-404=true`（缺失时返回 404 触发字母回退，而不是显示它的默认占位图）；个别站点图标不对时，给该条链接加 `icon` 字段手动指定（如 B 站那样）。有 `icon` 时两者并行加载、先完成的先显示，手动图标加载成功后自动替换，全部失败显示首字母回退块。
- **排序与搜索**：分类与链接按拼音排序（pinyin-pro），搜索框实时匹配名称与网址。

## 维护

- 加链接：编辑 `links.json`，URL 必填、`name` 选填。
- 个别站点图标不对（例如服务商返回了 App 图标）：给该条加 `"icon": "https://..."` 手动指定。
- 推送到 main 后 GitHub Pages 自动发布。

## 致谢

- [pinyin-pro](https://github.com/zh-lx/pinyin-pro) - 中文/英文混合名称的拼音排序
- [favicon.im](https://favicon.im) - 站点图标服务
- [unpkg](https://unpkg.com) - pinyin-pro 的 CDN 分发
