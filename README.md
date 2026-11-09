# DSH UI Toolbox · 工具箱

[![npm](https://img.shields.io/npm/v/dsh-ui-toolbox.svg)](https://www.npmjs.com/package/dsh-ui-toolbox)

A resident UI toolbox for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Its single icon button lives in the sidebar footer, at the right end of the account/Settings row (the host settings row narrows while the sidebar is wide so the two sit side by side). Because it belongs to the sidebar layout it never floats over the session list, the account menu or the Settings dialog. Its first tool, the **Element Picker**, captures any element of the live Web UI — React component, CSS selector, box, text, attributes and key computed styles — and inserts it into the current composer as a compact `@label` reference chip. The conversation shows only that chip; the full captured context still travels with the message for the model.

DSH Web 界面侧边栏底部的**常驻工具按钮**，贴在账号（设置）一行的右端：侧边栏展开时，设置按钮会自动向左收窄，把右侧这一格让给工具按钮；每个工具一个图标按钮，鼠标悬浮显示一句短提示，功能细节写在插件说明（`locale/*.json` 的 `meta.description`）里。按钮跟随侧边栏布局参与排版，不会浮在会话列表或设置窗口之上，因此不会再挡住任务文字和设置弹窗；侧边栏收起为窄条时按钮同样可用。当前工具是**选取元素**。

## 安装 · Install

```sh
dsh plugin --profile <your-profile> add dsh-ui-toolbox
```

Or open **Plugins → Add plugin** in DSH and enter `dsh-ui-toolbox`, then restart DSH.

Tested on DSH `0.2.1-rc.2`. The bundle declares `engines.dsh: ">=0.2.1-rc.2 <0.3.0"`.

## 用起来

1. 点侧边栏底部、账号行右端的十字准星图标，进入选取模式；鼠标扫过界面元素会实时高亮。
2. `↑` / `↓` 在父级 / 子级之间切换候选元素；单击采集，`Esc` 或再点一次图标退出。
3. 采集后，当前会话输入框里会插入一个紧凑的 `@标签` 引用 chip，可以连续采集多个元素：
   - 对话里只显示小 chip，不会把整段元素上下文铺在消息里；
   - 完整上下文仍随消息交给模型，直接接着写要求即可，例如「把这两个元素合并」「把按钮换成次要样式」；
   - 在非会话页面（设置、插件页、欢迎页等）采集时，引用会先暂存；回到任意会话时自动插入为 chip，不需要粘贴。

## 采集的上下文

chip 在提交时展开成下面这段交给模型（对话界面里仍然折叠成 chip）：

```text
[[el:el-abc|设置]]
（以下内容由 DSH 工具箱的元素选取器采集，来自当前 Web 界面）
<selected-element>
元素: <button class="…" aria-label="设置">
组件: SidebarSettingsTrigger ← SidebarRoot
选择器: div.hHd-Xa_footArea > div.hHd-Xa_settingsArea > button
位置: 200 × 36 @ (12, 680)
文本: 设置
属性: type="button"; aria-label="设置"
关键样式: display: flex; padding: 7px 8px; background-color: …; border-radius: 8px; …
结构: <button class="…" aria-label="设置">…</button>
祖先链: div.hHd-Xa_footArea > div.hHd-Xa_settingsArea
</selected-element>
```

第一行的 `[[el:<id>|<label>]]` 是 chip 的定位标记，`</selected-element>` 收尾；对话渲染层把这两者之间的内容折叠成 chip，模型侧则拿到完整文本。在非会话页面采集时不会复制这段长文本，而是先暂存引用，等会话输入框出现时自动插入。采集结果按 id 缓存在浏览器 `localStorage`（`dsh-ui-toolbox.elements.v1`，上限 100 条、保留 7 天），因此同一次会话里可以连续引用多个元素。

## 插件结构 · Structure

| 文件 | 作用 |
| --- | --- |
| `client.js` | 全部浏览器侧实现：侧边栏底部的工具按钮、元素选取器、提示/高亮/toast、输入框桥接、`@` 引用 chip 的输入触发器与对话渲染规则；瞬态提示 UI 通过 body portal 浮在宿主模态之上 |
| `index.js` | Host 半部，无资源（不需要服务端能力） |
| `cordis.patch.yml` | 插入 `toolbox` 插件行 |
| `locale/*.json` | 插件管理页的标题与详细说明（中/英） |
| `icon.svg` | 插件图标（托盘里的工具图标画在 `client.js` 中） |

挂载的槽位与注册：

- `sidebar.footer.action`（id `toolbox`）：唯一的常驻 UI。侧边栏底部的图标按钮，展开时贴在设置行右端（同时给宿主设置区加宽窄让位），收起为窄条时是居中图标；因为参与侧边栏布局，它不会盖住会话列表，也会被设置等宿主模态正常盖住。
- `shell.overlay`：瞬态 UI 宿主。它把一个 body portal 挂到 `document.body`，portal 里包含悬浮提示、高亮框、选取提示条与 toast；这些元素 z-index 在宿主模态（设置窗口 `z-index: 1000`）之上，采集时的反馈不会被模态盖住；portal 里的元素各自 `pointer-events` 自理，不会挡住应用。
- `conversation.composer.dock`：零高度桥接组件，拿到当前会话的 `inputActions` 与 `sessionId`，供托盘把 chip 插进输入框。
- `conversation.user.text.node`（key `elementRef`）：用户消息里的元素引用渲染成小 chip。
- `ctx.inputTriggers.registerSource`：注册 `@` 下的 `element` 引用源；提交时由它的 `codec.serialize` 把 chip 展开成完整上下文。
- `ctx.uiConversation.userText.register`：注册 `elementRef` 文本规则，把 `[[el:…]] … </selected-element>` 折叠回 chip。

## 后续加工具

工具按钮是数据驱动的：在 `client.js` 的 `ToolboxFooter` 里给 `tools` 数组追加一项（`label` / `icon` / `run`）就多一个图标按钮，悬浮提示和布局会自动复用它。需要更多瞬态 UI 时继续往 `ToolboxHost` 里挂即可。

## 位置与层级

工具按钮挂在侧边栏自己的 `sidebar.footer.action` 槽位里，属于正常排版：不会浮在会话列表之上，打开设置窗口时也会被模态层正常盖住。侧边栏展开时，按钮用绝对定位贴在账号行右端，同时插件在 `<html>` 上挂 `data-dsh-toolbox-footer` 标记，并用一条窄作用域的样式把宿主的设置区宽度减去 38px，让设置按钮向左收窄、把右侧空间让给工具按钮；卸载或侧边栏收起时标记和样式一起失效。

采集过程中的高亮框、悬浮提示、提示条与 toast 仍走 body portal（z-index 1100–1105），确保这些反馈浮在设置模态之上；portal 随组件卸载自动移除，不残留 DOM。

## 约束

- 运行时只用 `react` 和 `react-dom`（`createPortal`），不 import 任何 Harness Client 包；输入触发器、会话输入框与对话渲染都走公开的 `ctx.inputTriggers` / `ctx.sessions` / `ctx.uiConversation` 服务；
- 颜色/圆角/阴影全部取自 `--dsw-*` 主题 token（暗色、亮色自动适配）；
- 所有文字走 `toolbox` locale 命名空间（中/英）；
- 文档级监听器、定时器、样式都随 `ctx.effect` / React 卸载清理；采集期间临时挂在 `<html>` 上的 `data-dsh-toolbox-picking`（全屏十字光标）与展开态用于让位的 `data-dsh-toolbox-footer` 都会在退出/卸载时移除；
- 让位样式只匹配宿主侧边栏里类名以 `settingsArea` 结尾的元素（`[class*="settingsArea"]`），不改动宿主组件的任何逻辑。

## License

MIT © 2026 miniluckybull
