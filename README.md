# Blog Publisher

一个基于 [Obsidian Git](https://github.com/Vinzent03/obsidian-git) 的桌面版 Obsidian 插件，将私有笔记同步与博客发布整合为一个插件。

## 0.3.0 功能

- 简洁入口：同步、预览、检查、发布当前文章、发布状态和改动列表。
- 复用上游 Git 后端、串行操作队列、自动同步、历史、差异和冲突处理。
- 每次推送均核对 GitHub 账号和私有 Vault 仓库；公开内容变更必须通过现有 website 的完整构建。
- 构建失败会停止推送并暂停自动任务，已提交内容保留在本地；修复后点击“同步”恢复。
- 单篇发布展示文章与引用附件，确认后提交；已有待推送提交、暂存修改或冲突时要求先处理。
- Daily / Notes 同步到私有仓库；网站继续通过现有构建流程发布 Blog。
- 自动同步默认关闭，可在设置中指定分钟数；完整选项位于高级 Git 设置。

## 安装与迁移

需要桌面版 Obsidian >= 1.13、Node >= 24、Git 和已登录的 GitHub CLI，以及现有 website 工程及其依赖。

1. 停用原 Obsidian Git 和旧 Blog Publisher。
2. 将发布包内 `main.js`、`manifest.json`、`styles.css` 放入 Vault 的 `.obsidian/plugins/songhai-blog-publisher/`。
3. 启用 Blog Publisher，检查 Website 目录、Node 路径、私有仓库和账号。
4. 先预览或检查文章，再按需要启用自动同步。

旧 Blog Publisher 的五个发布配置字段自动迁移；不会导入原 Obsidian Git 的凭据或自动任务设置。原 Obsidian Git 与本插件不能同时启用；检测到时本插件停止 Git 操作。首次切换如已触发保护，停用原插件后重新启用本插件。

博客模式要求 Vault 根目录是配置的私有仓库，main 跟踪 origin/main。不支持 reset 拉取、子模块同步、独立 gitDir、移动端及绕过检查的任意 Git 命令。构建时需停止 5173 端口上的预览。其他程序仍可能修改仓库；此插件只协调自身队列。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm run all
pnpm run build
```

博客功能位于 `src/blog/`。原项目文档见 [README.upstream.md](README.upstream.md)。

## 来源与许可

Fork 自 Obsidian Git，基线提交 `437f698ab6436f02790bfece9d11ff443742ee92`。保留上游历史、MIT LICENSE 和贡献者署名。本项目独立维护，不代表上游官方版本。
