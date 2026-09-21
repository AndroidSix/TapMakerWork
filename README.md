# TapMakerWork

**TapTap Maker 第三方桌面 IDE · 开源免费 · 欢迎自愿赞助**

> [!IMPORTANT]
> **非 TapTap 官方产品。** 在官方 Maker CLI / Runtime 之上做可视化与交付增强，不修改、不再分发官方安装包。
>
> **协作与 PR 只认 GitHub 主仓**；Gitee 仅作镜像下载。

---

## 官网

**[androidsix.github.io/tapmakerwork-site](https://androidsix.github.io/tapmakerwork-site/)**

产品介绍、下载入口与社区信息以官网为总览页。

## 下载

| 平台 | 安装包 |
|------|--------|
| **官网** | [androidsix.github.io/tapmakerwork-site](https://androidsix.github.io/tapmakerwork-site/) |
| **GitHub Releases（主）** | [github.com/AndroidSix/TapMakerWork/releases](https://github.com/AndroidSix/TapMakerWork/releases) |
| **Gitee 发行版（镜像）** | [gitee.com/AndroidSUP/tap-maker-work/releases](https://gitee.com/AndroidSUP/tap-maker-work/releases) |

- macOS：下载 `TapMakerWork-*-mac-*.dmg`
- Windows：下载 `TapMakerWork-*-windows-*.exe`

版本号与根目录 [`package.json`](./package.json) 一致。

---

## 这是什么

**TapMakerWork** 是面向 [TapTap Maker](https://www.taptap.cn) 项目的 **macOS / Windows** 桌面 IDE。

它组合官方 Maker 能力，并补上日常开发里最费劲的部分：

| 场景 | 你能得到什么 |
|------|----------------|
| 改 UI | 采样 **真 Runtime 画面**，画面内选控件、拖拽、改样式 |
| 看效果 | 内嵌预览 + 真机窗口镜像，减少「改完再盲猜」 |
| 管交付 | 环境 / 项目 / 内容 / Runtime / 验证 / 构建就绪度一条线 |
| 管素材 | 图片、音频、视频、模型、字体引用审计 |
| 接 AI | 项目级 **MCP**，供 Claude / Cursor / Codex 等读项目与控件状态 |

```text
Electron 桌面 / 控制台
        │
   Studio 可视化 IDE
        │
   本地 Editor Bridge (127.0.0.1)
        │
   官方 Maker CLI  ·  可选项目适配器  ·  MCP
```

---

## 仓库

| 角色 | 地址 | 用来做什么 |
|------|------|------------|
| **官网** | [tapmakerwork-site](https://androidsix.github.io/tapmakerwork-site/) | 产品介绍与下载总览 |
| **主仓 · GitHub** | [AndroidSix/TapMakerWork](https://github.com/AndroidSix/TapMakerWork) | 开发、Issue、**全部 PR** |
| **镜像 · Gitee** | [AndroidSUP/tap-maker-work](https://gitee.com/AndroidSUP/tap-maker-work) | 国内访问、Releases 下载 |

- Pull Request、缺陷反馈、功能讨论 → **只提 GitHub**
- Gitee 镜像上的改动 **不会被合并**，详见 [CONTRIBUTING.md](./CONTRIBUTING.md)
- 安装依赖与贡献流程亦见该文档  

## 社区交流

**TapMakerWork 工具交流群**

| 项 | 内容 |
|----|------|
| **群名称** | TapMakerWork工具交流群 |
| **群号** | `1124103038` |
| **一键入群** | [https://qm.qq.com/q/OCt1HAmHK2](https://qm.qq.com/q/OCt1HAmHK2) |

```text
点击链接加入群聊【TapMakerWork工具交流群】：
https://qm.qq.com/q/OCt1HAmHK2
```

桌面版：标题栏「**交流群**」按钮、命令栏「**一键入群**」、设置 →「**社区交流**」均可跳转。

---

## 后续开发计划

> 下列为规划中的能力，**尚未全部实现**；进度以 [docs/ROADMAP.md](./docs/ROADMAP.md) 与发行说明为准。欢迎在 GitHub Issue / 交流群提出优先级建议。

### 资源与构建优化

| 方向 | 说明 |
|------|------|
| **图片无损压缩** | 内置批量压缩工具，针对 Maker 项目图片资源，减小包体、尽量保持画质 |
| **无用资源删除** | 结合源码/配置引用审计，识别未引用图片、音频等并安全清理 |
| **代码混淆** | 对项目脚本提供混淆/加固选项，降低直接抄袭成本（与官方构建链兼容） |

### 开发经验与 AI 提效

| 方向 | 说明 |
|------|------|
| **经验沉淀** | 把常见 Maker 坑位、排错路径、交付清单做成 IDE 内可查的实践指南 |
| **AI 开发技巧** | 常用提示词、工作流与「如何让 AI 正确改 Maker 项目」的方法 |
| **Skills / 模板** | 可导入的技能与工程模板，方便 Claude / Cursor / Codex 等直接参考 |

### 多平台打包（规划）

| 方向 | 说明 |
|------|------|
| **H5 / Web** | 导出可浏览器运行的 H5 包，便于预览分享与渠道落地 |
| **Android APK** | 安卓安装包打包链路与签名/渠道参数引导 |
| **iOS** | iOS 产物导出与上架前检查清单（能力以官方与 Apple 侧要求为准） |
| **macOS / Windows** | 桌面端游戏包打包入口与分发说明 |
| **小游戏平台** | 抖音小游戏、微信小游戏等**各大小游戏平台**的目标配置、适配检查与打包向导 |

说明：

- IDE 侧提供**打包向导、配置模板、产物归档与检查清单**；能否导出某一目标取决于 **TapTap Maker / 官方构建能力与各平台资质**，本工具不替代官方上架与审核流程。  
- 多平台配置会尽量做成可切换的工程预设，避免每换一个渠道就重改一套项目。

### 游戏工程能力（规划）

| 方向 | 说明 |
|------|------|
| **UI 安全区域** | 异形屏/刘海/底部指示条安全区标注与布局检查，统一多机型表现 |
| **反作弊** | 常见客户端篡改检测思路与可选接入模块（与服务端校验配合） |
| **强更新** | 强制拉起新版本、维护公告、灰度/分渠道更新的工程范式 |
| **存档回退** | 游戏进度云存档、版本兼容与回退策略参考 |
| **排行榜** | 排行榜接入与防刷的标杆实现参考 |
| **广告接入模板** | 广告位设计、接入与体验平衡的**标杆项目源码模板**，便于 AI 与人工对照实现 |

### 说明

- **多平台打包**以向导/预设/检查为主；H5、APK、iOS、桌面、抖音/微信等小游戏目标受官方与平台规则约束。  
- 上述规划服务 **TapTap Maker 个人开发者** 的提效与工程化，不替代官方平台能力。  
- 反作弊、强更新、排行榜、广告等以 **模板 + 文档 + 可选工具** 形式提供参考，具体合规与平台规则以 TapTap 官方为准。  
- 优先级可在交流群 `1124103038` 投票讨论。  


---

## 功能一览

<details>
<summary><b>可视化与 Runtime</b></summary>

- 真 Runtime 视图：最终帧 + 控件命中框叠加
- 活编：拖移、八向缩放、键盘微调、属性面板
- `*.ui.json` 视觉草稿；Lua 继续负责行为
- Lua UI 静态/混合转换与源码映射
- 可选适配器安装，入口自动备份
- Cocos 风格变换：`Q/W/E/R/T`、Shift 多选、增量吸附
- 拖拽手势级撤销 / 重做，RGBA 颜色控制

</details>

<details>
<summary><b>项目与交付</b></summary>

- 原创交付工作台（项目阶段、UI 旁路、Runtime 状态与构建就绪度）
- VS Code 风格 Git 管理（暂存、取消暂存、提交、同步、文件右键操作与提交图谱）
- 语义资产审计与全项目 UI 发现
- 官方 Preview 状态 / 日志 / 生命周期适配
- 显式远程构建与测试码流程（就绪度不会自动发布）
- 离线内置 Monaco 编辑器（无 CDN 依赖）

</details>

<details>
<summary><b>桌面与 AI 集成</b></summary>

- Electron 宿主、一键打包 IDE、双平台安装包
- 固定检查 GitHub 主仓发行版，支持安装包自动更新元数据与手动下载回退
- Maker MCP 版本发现与 stable/Beta 切换
- 系统 Node.js 发现（PATH / 登录 shell / Homebrew / Volta）
- macOS Runtime 窗口采集与输入转发（需系统权限）
- 项目 MCP：文件、转换、快照、Runtime、预览与构建工具（无通用 Shell）

</details>

---

## 从源码运行

### 一键启动器

| 系统 | 操作 |
|------|------|
| macOS | 双击 `outputs/launchers/TapMakerWork-macOS.command` |
| Windows | 双击 `outputs/launchers/TapMakerWork-Windows.cmd` |

启动器可记住上次的 Maker 项目，首次运行会安装依赖。说明见 [`outputs/launchers/README.md`](./outputs/launchers/README.md)。

### 命令行

```bash
npm install
npm run dev:web
```

浏览器打开 <http://127.0.0.1:4173>。启动时绑定项目：

```bash
TAPMAKERWORK_PROJECT="/absolute/path/to/project" npm run dev:web
```

桌面宿主（需 Electron 依赖）：

```bash
npm run dev
```

默认 UI 入口：`scripts/ui/HomePage.lua`（可用 `TAPMAKERWORK_UI_ENTRY` 覆盖）。

---

## 桌面打包

```bash
npm run dist:mac    # macOS
npm run dist:win    # Windows
npm run dist:all    # 双平台（视构建链而定）
```

或在桌面应用内按 `Cmd/Ctrl+Shift+B` / 运行 `npm run package:ide`。

产物目录：`outputs/installers`。签名、公证、权限与更新源见 [`docs/DESKTOP_RELEASE.md`](./docs/DESKTOP_RELEASE.md)。

发布时：本地打包 → 上传到 **GitHub Releases（主）**；Gitee 镜像通过「镜像同步」自动拿到同一批安装包。

---

## Project MCP

构建并保持 Bridge 运行后，在任意 stdio MCP 客户端中配置：

```text
node /absolute/path/to/packages/bridge/dist/mcp.js
```

可提供项目文件、UI 转换与补丁、Runtime 状态与日志、预览/构建/测试码等能力；**不提供通用 shell**。详见 [`docs/MCP.md`](./docs/MCP.md)。

---

## 安全与边界

- **Shell 面板**在 macOS / Windows 的 OS 级沙箱逃逸测试通过前有意禁用；仅设置工作目录不算沙箱。
- **Runtime 集成**按项目可选；适配器只写受管 hook，并备份原入口到 `.tapmakerwork/backups`。
- **不修改**官方 Maker 安装；预览/构建/测试码依赖你本机已安装的官方环境。
- 商标归 TapTap 及相关权利人所有。

架构与路线图：[ARCHITECTURE.md](./docs/ARCHITECTURE.md) · [ROADMAP.md](./docs/ROADMAP.md) · [CHANGELOG.md](./docs/CHANGELOG.md)

---

## 赞助（自愿）

本项目 **MIT 开源，可免费使用与下载**，不设付费墙。

赞助 **完全自愿**，**不绑定任何功能或授权**——不赞助也能正常使用全部开源能力。收入用于持续维护、打包与发行。

<table>
  <tr>
    <th align="center">微信</th>
    <th align="center">支付宝</th>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./docs/sponsor/wechat-pay.png" alt="微信赞助收款码" width="220" />
    </td>
    <td align="center" width="50%">
      <img src="./docs/sponsor/alipay.png" alt="支付宝赞助收款码" width="220" />
    </td>
  </tr>
  <tr>
    <td align="center"><sub>微信扫码自愿赞助</sub></td>
    <td align="center"><sub>支付宝扫码自愿赞助</sub></td>
  </tr>
</table>

**说明**

- 请以 **GitHub 主仓** 本 README 中的收款码为准；Gitee 镜像同步可能有延迟。
- 个人收款码可能有单笔/日限额，适合小额支持。
- 请勿将赞助理解为购买许可证或激活码；我们不在 GitHub 通过私聊售卖软件。

---

## 许可证

[MIT License](./LICENSE) © 2026 KayingAI

```text
自由使用、修改、分发；保留版权与许可声明即可。
```

---

<p align="center">
  <sub>
    官网 · <a href="https://androidsix.github.io/tapmakerwork-site/">tapmakerwork-site</a>
    &nbsp;|&nbsp;
    主仓 · <a href="https://github.com/AndroidSix/TapMakerWork">GitHub</a>
    &nbsp;|&nbsp;
    镜像 · <a href="https://gitee.com/AndroidSUP/tap-maker-work">Gitee</a>
    &nbsp;|&nbsp;
    第三方工具 · 非 TapTap 官方
  </sub>
</p>
