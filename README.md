# DSH UI Toolbox · 工具箱

[![npm](https://img.shields.io/npm/v/dsh-ui-toolbox.svg)](https://www.npmjs.com/package/dsh-ui-toolbox)

A resident UI toolbox for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It sits at the sidebar foot (bottom-left, above Settings) as a compact tray. Its first tool, the **Element Picker**, captures any element of the live Web UI — React component, CSS selector, box, text, attributes and key computed styles — copies the context to the clipboard, or inserts it straight into the current composer so a change request can follow.

DSH Web 界面左下角的**常驻工具托盘**。托盘位于侧边栏底部、设置上方：每个工具一个图标按钮，鼠标悬浮显示一句短提示；功能细节写在插件说明（`locale/*.json` 的 `meta.description`）里，托盘本身不占地方。当前工具是**选取元素**。

## 安装 · Install

```sh
dsh plugin --profile <your-profile> add dsh-ui-toolbox
```

Or open **Plugins → Add plugin** in DSH and enter `dsh-ui-toolbox`, then restart DSH.

Tested on DSH `0.2.1-rc.2`. The bundle declares `engines.dsh: ">=0.2.1-rc.2 <0.3.0"`.

## 用起来

1. 点托盘里的十字准星图标，进入选取模式；鼠标扫过界面元素会实时高亮。
2. `↑` / `↓` 在父级 / 子级之间切换候选元素；单击采集，`Esc` 或再点一次托盘图标退出。
3. 采集时自动把元素上下文复制到剪贴板，顶部弹出短提示：
   - 有会话输入框时，点提示里的 **插入对话框** 可把上下文直接写进输入框，并带上「修改要求：」前缀；
   - 也可以自己粘贴到对话框；
   - 随后直接写修改要求，例如「把间距调大一点」「按钮换成次要样式」。

## 采集的上下文

```text
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

组件名来自 React fiber，选择器优先用 `id` / `data-*` / `aria-label`，样式取自 `getComputedStyle` 的关键项，结构片段只在元素较小时附带。这段文本对人和模型都可读，粘贴进对话框即可让 Agent 定位到元素并动手改。

## 插件结构 · Structure

| 文件 | 作用 |
| --- | --- |
| `client.js` | 全部浏览器侧实现：常驻托盘、元素选取器、提示/高亮/toast、输入框桥接 |
| `index.js` | Host 半部，无资源（不需要服务端能力） |
| `cordis.patch.yml` | 插入 `toolbox` 插件行 |
| `locale/*.json` | 插件管理页的标题与详细说明（中/英） |
| `icon.svg` | 插件图标（托盘里的工具图标画在 `client.js` 中） |

挂载的槽位：

- `sidebar.footer.action`：左下角常驻托盘；
- `shell.overlay`：高亮框、悬浮提示、选取提示条与 toast（浮层整层点击穿透，只有提示条/toast 自己接收指针）；
- `conversation.composer.dock`：零高度桥接组件，把当前会话的 `InputActions` 暴露给根级 toast，实现「插入对话框」。

## 后续加工具

托盘是数据驱动的：在 `client.js` 的 `ToolboxTray` 里给 `tools` 数组追加一项（`label` / `icon` / `run`）就多一个图标按钮，悬浮提示和布局会自动复用它。需要更多瞬态 UI 时继续往 `ToolboxOverlay` 里挂即可。

## 约束

- 只用 `react` 一个运行时模块，不 import 任何 Harness Client 包；
- 颜色/圆角/阴影全部取自 `--dsw-*` 主题 token（暗色、亮色自动适配）；
- 所有文字走 `toolbox` locale 命名空间（中/英）；
- 文档级监听器、定时器、样式都随 `ctx.effect` / React 卸载清理；采集期间临时挂在 `<html>` 上的 `data-dsh-toolbox-picking`（全屏十字光标）也会在退出时移除。

## License

MIT © 2026 miniluckybull
