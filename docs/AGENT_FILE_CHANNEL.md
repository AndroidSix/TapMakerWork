# AI Agent 文件通道 + HTTP（无 Project MCP）

创建于 2026-10-06  
更新于 2026-10-06

TapMakerWork 通过**项目内文件**与可选 **本机 HTTP**，让 Cursor / Trae / WorkBuddy / Codex / Claude 等像控本地软件一样调试 IDE 与运行时。

## 开箱流程

1. 用 TapMakerWork 打开 Maker 游戏项目，并启动预览 / Runtime（推荐）。
2. 用任意 AI IDE **打开同一个游戏项目目录**。
3. Agent **先读**：
   - `.tapmakerwork/ai/STATUS.md`（短状态 + 硬约定）
   - `.tapmakerwork/ai/ui-snapshot.json`
   - `.tapmakerwork/ai/errors.json`
   - `.tapmakerwork/ai/preview.png`（有则看画面）
4. 若项目已有 `AGENTS.md`，会自动插入闭环调试说明。

## 硬约定（闭环）

**每次改动后必须再读** `STATUS.md` + `ui-snapshot.json` + `errors.json`（有截图再看 `preview.png`），再决定下一步。

## 控制方式

### A. 文件 inbox（通用）

写入 `.tapmakerwork/ai/inbox/<id>.json`，约 500ms 内处理，结果在 `outbox/<id>.json`。

### B. HTTP（可选，本机）

Base：`http://127.0.0.1:43121/api/agent`

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/status` | 状态 + 可用 action 列表 |
| GET | `/snapshot` | 当前 UI 快照 |
| GET | `/errors` | 最近错误与日志摘要 |
| POST | `/command` | body 同 inbox JSON |
| POST | `/frame` | `{ "dataUrl": "data:image/png;base64,..." }` 写入 preview.png |

## 支持的 action

| action | 作用 |
|--------|------|
| `ui_apply_patch` | 改控件属性并推运行时 |
| `ui_undo` / `ui_redo` | 撤销 / 重做 |
| `save_ui_sidecar` | 保存视觉旁路 / 回写 Lua |
| `sync_runtime` | 从 Runtime 通道拉活树 |
| `maker_preview_start` / `stop` / `refresh` | 预览生命周期 |
| `maker_preview_status` / `maker_preview_logs` | 预览状态与日志 |
| `maker_build` / `maker_doctor` / `maker_qrcode` | 构建 / doctor / 测试码 |
| `maker_console_open` | 打开本地 Runtime 控制台（`console open`） |
| `open_ui` | 打开 UI 文件（IDE 切到该文件） |
| `open_terminal` | 打开指定终端通道（runtime/build/lua…） |
| `focus_ide` | 把 TapMakerWork 提到前台 |
| `capture_frame` | 请求立刻截 Runtime 画面到 preview.png |
| `project_search` / `read_project_file` / `convert_lua_ui` | 搜代码 / 读文件 / 转换 UI |
| `workflow_set_objective` / `git_status` | 交付目标 / git |
| `publish_now` | 立刻刷新 ai 目录 |

示例：

```json
{
  "id": "patch-title",
  "action": "ui_apply_patch",
  "nodeId": "来自 ui-snapshot.json",
  "props": { "text": "新标题" }
}
```

```bash
curl -s http://127.0.0.1:43121/api/agent/status | jq .
curl -s -X POST http://127.0.0.1:43121/api/agent/command \
  -H 'content-type: application/json' \
  -d '{"id":"1","action":"sync_runtime"}'
```

## 画面截图

Runtime 处于 `live` 时，桌面 Studio 约每 4 秒把窗口采样写入 `.tapmakerwork/ai/preview.png`；也可用 `capture_frame` 立刻请求一帧。

## 前提

- TapMakerWork / Bridge 必须正在运行并绑定该项目。
- 关闭 IDE 后 `runtime-status.json` 会标记 `alive: false`。
