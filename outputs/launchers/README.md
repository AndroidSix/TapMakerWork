# TapMakerWork 一键启动器

## macOS

双击 `TapMakerWork-macOS.command`。

首次运行时输入 Maker 项目的绝对路径，或把项目文件夹拖进终端窗口再按回车。启动器会记住该路径。也可以将项目文件夹直接拖到启动器图标上。

如果 macOS 阻止打开，可在 Finder 中右键启动器，选择“打开”。

## Windows

双击 `TapMakerWork-Windows.cmd`。

首次运行时输入 Maker 项目的绝对路径。启动器会记住该路径。也可以将项目文件夹直接拖到 `.cmd` 文件上。

## 共同规则

- 要求 Node.js 22 或更高版本，并且 `node`、`npm` 已加入 PATH。
- 首次运行会自动执行 `npm install`。
- 上次项目路径保存在 TapMakerWork 根目录的 `.tapmakerwork/last-project.txt`。
- 可预先设置环境变量 `TAPMAKERWORK_PROJECT`，或把项目路径作为第一个参数传入。
- 关闭启动终端会同时停止 Bridge、Studio 和桌面 IDE。
