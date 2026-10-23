# Tampermonkey 脚本集

个人自用的几个 Tampermonkey 脚本。安装后由脚本管理器自动检查更新。

| 脚本 | 安装 | 版本 | 适用站点 |
|---|---|---|---|
| 网页悬浮目录 | [安装](https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/toc.user.js) | 4.2.0 | 所有网页 |
| AI Switcher | [安装](https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/ai-switcher.user.js) | 1.4.2 | ChatGPT、Claude、Gemini、DeepSeek、元宝、豆包、Kimi、千问、Qwen、ChatGLM、Grok、讯飞星火、Copilot、秘塔 |
| 最新问题→标签页标题 | [安装](https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/tab-title.user.js) | 1.1.0 | 元宝 `chatMode=temp` 对话页 |

## 功能速览

**网页悬浮目录**：右下角悬浮按钮，点击展开文章层级目录；按钮可拖动或点选放到任意位置，位置自动记忆，双击复位。标题少于 2 个的页面不显示面板。

**AI Switcher**：在 AI 聊天页面显示一条可拖动、可排序的 AI 快捷图标栏。单击切换、Ctrl/Cmd+单击或中键新标签打开。快捷键：`Alt+\`` 收起/展开，`Alt+1~9` 切换，`Alt+[` / `Alt+]` 前后切换。已兼容 Trusted Types 与严格 CSP 站点。

**最新问题→标签页标题**：把当前会话里最后一条用户提问同步到标签页标题，方便在多标签间辨认。

## 从旧版迁移

如果你装过下面任意一个旧版本，请**先卸载再装新链接**，否则页面上可能同时存在两个目录按钮（两者使用同一个根节点 id，先加载的会生效）：

- 旧版「自动顶部目录」（已归档到 [`legacy/`](legacy/)）
- 旧版「网页悬浮目录」（通过旧链接安装的副本）

另外，旧版本没有 `@updateURL`，需要手动重装一次，之后的版本才会自动更新。

## 已知限制

- 目录脚本注入所有站点（`@match *://*/*`）。样式优先使用 constructed stylesheet，浏览器不支持或被拦截时才回退到 `<style>`；两种路径都不依赖 `innerHTML`，因此兼容 Trusted Types。
- 标题脚本目前只适配元宝的 `chatMode=temp` 页面，且依赖站点的用户消息选择器；站点改版后需要更新选择器。
- 标题脚本使用 `@include` 而不是 `@match` 匹配 `chatMode=temp`，因为 Chrome 风格的 match 模式不匹配查询串。
- `raw` 主分支链接意味着每次推送都会立即对所有用户生效。

## 开发

当前是纯单文件脚本，尚未引入构建流程。后续计划：

1. 修复已知问题（CSP / Trusted Types、全文档 MutationObserver、macOS 快捷键）。
2. 引入 `src/` + esbuild，打包输出到 `dist/`。
3. 抽取共享模块（站点适配、拖拽定位、CSP 安全的 DOM/样式工具）。

## 许可

[MIT](LICENSE)
