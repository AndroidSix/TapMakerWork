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

- macOS：下载 `TapMakerWork-*-mac-*.pkg`
- Windows：下载 `TapMakerWork-*-windows-*.exe`

版本号与根目录 [`package.json`](./package.json) 一致。

<a id="macos-install"></a>

### macOS 安装说明（请先读）

受 **Apple / macOS Gatekeeper** 限制：从网上下载的应用若**没有正式 Developer ID 签名并公证**，系统会拦截安装，这与是否开源无关。

| 情况 | 建议 |
|------|------|
| 下载到的是**已签名 + 公证**的正式 Release | 正常双击 `.pkg` 安装即可 |
| 未签名 `.pkg`，提示「无法验证开发者」 | 按下面步骤点 **「仍要打开」** |
| 手里是旧的 `.dmg`，设置里没有「仍要打开」 | 不要拖进「应用程序」。改下 `.pkg`，或自行拉取源码打包 |

#### 未签名 `.pkg`：点「仍要打开」

1. 双击 `TapMakerWork-*-mac-*.pkg`。系统会拦截。
2. 打开 **系统设置 → 隐私与安全性**，在刚被拦截的提示附近点 **「仍要打开」** / **「Open Anyway」**，再确认一次。
3. 安装器把应用写入「应用程序」。装完直接启动，不要再从旧 DMG 里拖一份出来。

请下 `.pkg`，不要下 `.dmg`。macOS 15 及更新系统对网上下载后拖出的未公证 App 不再提供「仍要打开」，安装包则仍然提供。

<a id="macos-build-from-source"></a>

#### 系统设置没有「仍要打开」时：自行拉取源码打包

本机从源码打出的包由你自己构建，Gatekeeper 对「本机用户构建产物」的处理通常比网上下载的未签名包宽松，适合个人使用。

**环境要求**

- macOS（Apple 打包工具链只能在 Mac 上跑）
- [Node.js](https://nodejs.org/) **22+**，且终端里 `node` / `npm` 可用（可用 `node -v` 确认）
- 已安装 Xcode Command Line Tools：`xcode-select --install`（若尚未安装）
- 磁盘空间充足（首次 `npm install` 与 Electron 下载体积较大）

**步骤**

1. **拉取源码**（任选其一）  
   - GitHub：`git clone https://github.com/AndroidSix/TapMakerWork.git`  
   - 国内镜像：`git clone https://gitee.com/AndroidSUP/tap-maker-work.git`
2. 进入仓库目录：`cd TapMakerWork`（或你 clone 后的目录名）。
3. 安装依赖：`npm install`  
   - 若 Electron 下载失败，可先设置国内镜像再装：  
     `export ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/`  
     然后重新 `npm install`。
4. **只打本机可用的 macOS 安装包**（任选其一）：  
   - 命令行：`npm run package:ide:mac` 或 `npm run dist:mac`  
   - 或双击：`outputs/launchers/Package-TapMakerWork-All.command`（会打双端；只要 mac 可只用上面的 mac 命令）
5. 等待构建结束，在 **`outputs/installers/`** 中找到 `TapMakerWork-*-mac-*.pkg`（同目录 ZIP 只给应用内更新用）。
6. 双击本机刚生成的 `.pkg` 安装。本机产物通常没有下载隔离属性，安装器会直接打开。

**说明**

- 未配置 Apple 开发者证书时，打出来的是**本机 QA / 自用包**，不要当作对外正式分发源。
- 若只想先跑起来、不打安装包：可双击 `outputs/launchers/TapMakerWork-macOS.command`，或 `npm install` 后执行 `npm run dev`（开发态）。
- 签名、公证、对外发布与环境变量见 [`docs/DESKTOP_RELEASE.md`](./docs/DESKTOP_RELEASE.md)。

---

## 这是什么

**TapMakerWork** 是面向 [TapTap Maker](https://www.taptap.cn) 项目的 **macOS / Windows** 桌面 IDE。

它组合官方 Maker 能力，并补上日常开发里最费劲的部分——**核心能力**如下：

| 核心能力 | 你能得到什么 |
|----------|----------------|
| **实时编辑** | 采样 **真 Runtime 画面**，画面内选控件、拖拽、改样式，所见即所得 |
| **结构 + 预览** | 结构草图、内嵌预览与真机窗口镜像，减少「改完再盲猜」 |
| **图片压缩工具** | 内置批量压缩（默认本地可用；可选 TinyPNG），结果面板直接看体积收益，缩小包体 |
| **交付工作台** | 环境 / 项目 / 内容 / Runtime / 验证 / 构建就绪度一条线 |
| **素材审计** | 图片、音频、视频、模型、字体引用审计，辅助清理无用资源 |
| **AI / MCP** | 项目级 **MCP**，供 Claude / Cursor / Codex 等读项目与控件状态 |
| **开发技巧** | IDE 内可复制提示（本地预览 Token 优化、grill-me、发布前检查等） |

### 演示视频

创建于 2026-09-22 · 展示实时编辑、Runtime 接入与 IDE 主流程。

<video src="./docs/demo/tapmakerwork-core-demo.mp4" controls width="100%" poster="">
  你的浏览器不支持 video 标签，请直接打开
  <a href="./docs/demo/tapmakerwork-core-demo.mp4">docs/demo/tapmakerwork-core-demo.mp4</a>
</video>

若预览未加载，可下载本地观看：[tapmakerwork-core-demo.mp4](./docs/demo/tapmakerwork-core-demo.mp4)

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
- 新手引导：实时编辑两步上手 + 首次弱提示

</details>

<details>
<summary><b>工具集与资源</b></summary>

- **图片批量压缩**（命令栏「工具」→ 图片压缩）：默认本地压缩（pngquant / jpegoptim / 内置 Jimp），可选开启 TinyPNG 优先
- 压缩结果面板展示扫描数、压缩数、节省体积；可一键复制「分批提交」提示给 AI
- TinyPNG API Key 存本机用户目录，不进游戏项目 git
- 语义资产审计（图片 / 音频 / 视频 / 模型 / 字体引用）
- 开发技巧面板：本地预览 Token 优化、grill-me、发布前检查等可复制提示

</details>

<details>
<summary><b>项目与交付</b></summary>

- 原创交付工作台（项目阶段、UI 旁路、Runtime 状态与构建就绪度）
- VS Code 风格 Git 管理（暂存、取消暂存、提交、同步、文件右键操作与提交图谱）
- 全项目 UI 发现
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

产物目录：`outputs/installers`。

**重要：** 未配置代码签名证书时，打出来的 `.pkg` / `.exe` 只适合内部 QA。普通用户安装会遇到 macOS「无法验证开发者」或 Windows SmartScreen 拦截；这不等于侵权，但**不要当作正式下载源对外分发**。未签名 macOS 包请发 `.pkg`（设置里可以「仍要打开」），不要发 `.dmg`。正式对外请使用已签名（Mac 还需公证）的包。完整说明、自检方式与环境变量见 [`docs/DESKTOP_RELEASE.md`](./docs/DESKTOP_RELEASE.md)。

发布时：本地/CI 打出**已签名**安装包 → 上传到 **GitHub Releases（主）**；Gitee 镜像通过「镜像同步」自动拿到同一批安装包。

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

架构与路线图：[ARCHITECTURE.md](./docs/ARCHITECTURE.md) · [ROADMAP.md](./docs/ROADMAP.md) · [CHANGELOG.md](./docs/CHANGELOG.md) · [ACKNOWLEDGMENTS.md](./docs/ACKNOWLEDGMENTS.md)

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

## 致谢与借鉴

TapMakerWork **版权归属本仓库作者**（见下方许可证），与 **KayingAI** 无隶属、无股权关系。  
产品思路上参考了第三方开源项目 **KayingCodex**（KayingAI 出品），特此鸣谢；完整说明见 [docs/ACKNOWLEDGMENTS.md](./docs/ACKNOWLEDGMENTS.md)。

| 项 | 链接 |
|----|------|
| **KayingCodex 仓库（GitCode）** | [gitcode.com/kayingai/kaying-codex](https://gitcode.com/kayingai/kaying-codex) |
| **参考提交** | [`fbc60cab`](https://gitcode.com/kayingai/kaying-codex/commit/fbc60cab953b85181d15709635b09be20ccfe8de?ref=main) |
| **GitHub 镜像** | [github.com/kaying-studio/kaying-codex](https://github.com/kaying-studio/kaying-codex) |
| **项目主页** | [kayingai.com](https://kayingai.com/) |

KayingCodex / KayingAI 的名称、商标与代码版权仍归其权利人所有。本仓库为面向 TapTap Maker 的独立实现，**不是** KayingCodex 的 fork；借鉴的是工作台组织与交付节奏，未并入其源码。

---

## 许可证

[MIT License](./LICENSE) © 2026 androidsup

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
    致谢 · <a href="./docs/ACKNOWLEDGMENTS.md">ACKNOWLEDGMENTS</a>
    &nbsp;|&nbsp;
    第三方工具 · 非 TapTap 官方
  </sub>
</p>
