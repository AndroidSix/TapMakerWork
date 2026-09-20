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
- 「运行时场景」直接采样官方 Maker Runtime 的最终窗口帧，并把 Runtime 活控件树的绝对命中布局叠到同一画布；不再用 HTML 控件树冒充最终效果。
- 点击最终画面只选择控件；源码跳转是右侧属性栏中的显式动作。
- `live-edit` 模式支持画面内拖动、八向缩放、方向键微调和属性输入，并通过项目内桥立即调用 `Widget:SetStyle`。
- 属性修改同时防抖同步到同目录 `*.ui.json` 作为视觉草稿；**当前不会自动改写 Lua AST**。
- 打开界面时若存在 `*.ui.json`，优先加载旁路作为视觉源；Lua 仍负责行为。
- 未安装适配器时仍可查看最终画面；安装项目适配器并刷新 Runtime 后启用活树选取与编辑。

### 内嵌预览与 LocalRuntime（参考 KayingCodex）

创建于 2026-09-19

- **内嵌 Maker 预览面板**：Studio 中央「内嵌预览」页。桌面端优先 Electron `WebContentsView`（`persist:tapmakerwork-preview`），Web / 未挂载时降级 `<iframe>`。
- **预览 URL/方向持久化**：写在项目侧 `.tapmakerwork/preview-panel.json`（IDE 状态，不进游戏 git）。无手填 URL 时回退 Maker `test_qrcode.url`。
- **改完自动刷新**：`live-edit` 写入 `.ui.json` 后 Bridge 递增 `reloadToken` 并广播 `preview.panel`；可选触发官方 `maker preview refresh`。
- **预览截图证据**：Electron `capturePage` → Bridge 落盘 `outputs/preview-shots/<project>/`。跨域 iframe 在浏览器模式下无法截帧。
- **LocalRuntime**：`play` 模式将 IR / `.ui.json` 以可交互控件树渲染（Image 走项目资产 API，Button 有点击反馈），不启动官方 Runtime。

The adapter first attempts a Runtime-initiated loopback HTTP channel. Maker projects whose URL whitelist blocks localhost automatically use a bounded savedata file channel for status, snapshots and commands. Lua polls from the existing game update loop and applies property changes through `Widget:SetStyle`, avoiding the official `preview refresh` path that restarts Runtime and loses memory state.

## Runtime view

The editor protocol supports adjustable 1-60 FPS, pause, resolution, orientation, DPR and safe-area metadata. The first spike uses a portable frame-provider interface. Native capture is admitted only after latency, permission and window-identity tests pass on both platforms.

## Terminals

Channels are isolated by purpose: Runtime, Build, Lua diagnostics, Shell, Lua REPL, QR, and Agent. Shell execution fails closed until an OS-level sandbox proves that child processes cannot read or write outside the mounted project root.

## Upstream maintenance

Official Maker changes are kept behind adapters. Any unavoidable upstream modification must include the exact upstream commit, a patch series, a rationale, replay instructions, and compatibility tests. Runtime binary changes are a last resort.

The current milestone does not modify the official Maker Runtime. Project integration is isolated to a managed entry hook plus `scripts/tapmakerwork/TapMakerWorkBridge.lua`, with an entry backup under `.tapmakerwork/backups`. See `UPSTREAM.md`.

## Delivery workflow and evidence

创建于 2026-09-20

The Studio delivery cockpit is a projection of Bridge facts, not a second build system. It groups the current project into six reviewable stages: environment, project binding, content, Runtime, evidence and delivery.

- Maker CLI, Git, project binding and project metadata are checked from the local environment.
- Asset entries are classified as image, audio, video, model or font and marked referenced only when a project source/config document contains a matching path or filename.
- Evidence is derived from preview captures, `*.ui.json` sidecars, Runtime snapshots and the official test QR entry.
- The current objective is the only manually persisted workflow field and lives in `.tapmakerwork/workflow.json`.
- Build remains an explicit action. A readiness score never triggers a build, push or publish automatically.
- External agents read the same state through `tapmakerwork://workflow/overview`; they do not maintain a parallel progress database.
