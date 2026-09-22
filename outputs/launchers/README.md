# TapMakerWork 一键启动器

创建于 2026-09-19

## macOS

双击 `TapMakerWork-macOS.command`。

修改 IDE 源码后，双击 `Package-TapMakerWork-All.command` 可一次生成 macOS 与 Windows 安装包。

> 一键打包默认多为**未签名 QA 包**，仅供本机/团队验证。给普通用户下载前请按 `docs/DESKTOP_RELEASE.md` 配置签名与公证；未签名包安装时会触发系统拦截，不要当正式 Release 分发。

首次运行时输入 Maker 项目的绝对路径，或把项目文件夹拖进终端窗口再按回车。启动器会记住该路径。也可以将项目文件夹直接拖到启动器图标上。

如果 macOS 阻止打开，可在 Finder 中右键启动器，选择“打开”。

## Windows

双击 `TapMakerWork-Windows.cmd`。

修改 IDE 源码后，双击 `Package-TapMakerWork-All.cmd` 可生成 Windows 安装包。macOS 安装包受 Apple 工具链限制，请在 Mac 上运行双端脚本，或在代码托管页面手动触发 `desktop-release` 工作流。

> 未配置 `WIN_CSC_*` 时生成的 `.exe` 无 Authenticode 签名，普通用户易被 SmartScreen 拦截，仅作内部测试；对外说明见 `docs/DESKTOP_RELEASE.md`。

首次运行时输入 Maker 项目的绝对路径。启动器会记住该路径。也可以将项目文件夹直接拖到 `.cmd` 文件上。

## 共同规则

- 要求 Node.js 22 或更高版本，并且 `node`、`npm` 已加入 PATH。
- 首次运行会自动执行 `npm install`。
- Electron 二进制默认走 npmmirror（`cdn.npmmirror.com`），避免 GitHub 不可达导致桌面端启动失败；也可用环境变量 `ELECTRON_MIRROR` 覆盖。
- 上次项目路径保存在 TapMakerWork 根目录的 `.tapmakerwork/last-project.txt`（本机状态，不会随 git 同步）。
- 可预先设置环境变量 `TAPMAKERWORK_PROJECT`，或把项目路径作为第一个参数传入。
- 换机器后记忆路径常失效：启动器会区分「记忆路径失效」与「刚输入路径无效」，并列出邻近目录便于重新选择。
- 路径校验只检查目录是否存在；若缺少 `.maker-mcp/config.json` 会提示可能不是 Maker 项目，但仍继续启动。
- 关闭启动终端会同时停止 Bridge、Studio 和桌面 IDE。
