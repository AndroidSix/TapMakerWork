# TapMakerWork architecture

## Product boundary

TapMakerWork is the IDE. The official `@taptap/maker` CLI remains the authority for Runtime installation, local preview lifecycle, builds, QR codes, and logs. TapMakerWork composes those capabilities instead of reimplementing them.

## Processes

```text
Electron desktop host / Maker console iframe
                 |
          shared Studio UI
                 |
       loopback Editor Bridge
        /        |          \
Maker CLI   UI Dev Bridge   sandbox worker
    |            |               |
Preview      live widgets     project-only PTY
Supervisor       |
    \________ UrhoXRuntime
```

The loopback bridge must validate `Host` and `Origin`, expose no Maker credentials, and bind only to `127.0.0.1`.

## UI source-of-truth migration

The runtime converter observes an instantiated widget tree and emits:

- `*.ui.json`: hierarchy, layout, appearance, animation, theme and responsive rules;
- `*.controller.lua`: named actions, data bindings, conditions and list providers;
- `*.legacy.lua`: the recoverable source used before conversion.

Only executed UI states can be observed. Conditional variants are captured as separate scenarios and merged into conditional or list nodes. After conversion, `.ui.json` owns visual structure and Lua owns behavior.

## Live editing

创建于 2026-09-18
更新于 2026-09-19

The existing `urhox-libs/UI/Core/UIInspector` is the runtime editing kernel. The project dev bridge adds transport and stable node identifiers without changing the official Runtime binary. Layout and appearance patches mutate live widgets. Behavior or custom-widget code changes replace only the affected UI subtree.

IDE 内运行视图（当前里程碑）：
- 中央画布是 IDE 内的运行/设计视图，基于转换 IR 或 `.ui.json` 旁路，不依赖独立 Runtime 窗口。
- 任意模式下点击控件：选中节点并跳转到 Lua 源码 `file:line`（Monaco 居中显示）。
- `live-edit` 模式：属性修改写入内存快照，并防抖同步到同目录 `*.ui.json`（视觉旁路）；**不改写 Lua**。
- 打开界面时若存在 `*.ui.json`，优先加载旁路作为视觉源；Lua 仍负责行为。
- 真机帧与 Runtime 活树同步仍需项目内安装适配器后才能接入同一画布。

### 内嵌预览与 LocalRuntime（参考 KayingCodex）

创建于 2026-09-19

- **内嵌 Maker 预览面板**：Studio 中央「内嵌预览」页。桌面端优先 Electron `WebContentsView`（`persist:tapmakerwork-preview`），Web / 未挂载时降级 `<iframe>`。
- **预览 URL/方向持久化**：写在项目侧 `.tapmakerwork/preview-panel.json`（IDE 状态，不进游戏 git）。无手填 URL 时回退 Maker `test_qrcode.url`。
- **改完自动刷新**：`live-edit` 写入 `.ui.json` 后 Bridge 递增 `reloadToken` 并广播 `preview.panel`；可选触发官方 `maker preview refresh`。
- **预览截图证据**：Electron `capturePage` → Bridge 落盘 `outputs/preview-shots/<project>/`。跨域 iframe 在浏览器模式下无法截帧。
- **LocalRuntime**：`play` 模式将 IR / `.ui.json` 以可交互控件树渲染（Image 走项目资产 API，Button 有点击反馈），不启动官方 Runtime。

The first transport is a Runtime-initiated loopback HTTP channel. Lua polls a bounded command queue from the existing game update loop and applies property changes through `Widget:SetStyle`. This avoids the official `preview refresh` path, which explicitly restarts Runtime and loses memory state. A Runtime snapshot replaces the static converter's dynamic slots once the adapter is installed.

## Runtime view

The editor protocol supports adjustable 1-60 FPS, pause, resolution, orientation, DPR and safe-area metadata. The first spike uses a portable frame-provider interface. Native capture is admitted only after latency, permission and window-identity tests pass on both platforms.

## Terminals

Channels are isolated by purpose: Runtime, Build, Lua diagnostics, Shell, Lua REPL, QR, and Agent. Shell execution fails closed until an OS-level sandbox proves that child processes cannot read or write outside the mounted project root.

## Upstream maintenance

Official Maker changes are kept behind adapters. Any unavoidable upstream modification must include the exact upstream commit, a patch series, a rationale, replay instructions, and compatibility tests. Runtime binary changes are a last resort.

The current milestone modifies neither the official Maker runtime nor the pilot project. See `UPSTREAM.md`.
