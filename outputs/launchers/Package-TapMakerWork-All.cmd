@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "TAPMAKERWORK_ROOT=%%~fI"
cd /d "%TAPMAKERWORK_ROOT%" || goto :root_error

where node >nul 2>nul || goto :node_error
where npm >nul 2>nul || goto :node_error

for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :node_version_error
if %NODE_MAJOR% LSS 22 goto :node_version_error

echo TapMakerWork IDE 一键打包
echo 目标：Windows 安装包
echo 提示：macOS 安装包请在 macOS 主机上运行 Package-TapMakerWork-All.command，
echo       或在代码托管页面手动触发 desktop-release 工作流。
echo 源码：%TAPMAKERWORK_ROOT%
echo.

call npm run package:ide:win
set "BUILD_EXITCODE=%errorlevel%"
if not "%BUILD_EXITCODE%"=="0" goto :build_error

echo.
echo Windows 安装包已生成，请查看：%TAPMAKERWORK_ROOT%\outputs\installers
pause
exit /b 0

::root_error
echo TapMakerWork 启动失败：无法定位 IDE 源码目录。
goto :failure

::node_error
echo TapMakerWork 启动失败：未找到 Node.js 或 npm，请先安装 Node.js 22 或更高版本。
goto :failure

::node_version_error
echo TapMakerWork 启动失败：Node.js 版本过低（需要 22 或更高版本）。
node --version
goto :failure

::build_error
echo.
echo 打包失败，npm 退出码：%BUILD_EXITCODE%
echo 常见原因：
echo   1. 未执行 npm install / 依赖缺失
echo   2. 网络拉取 Electron 二进制失败（可设置 ELECTRON_MIRROR 走镜像）
echo   3. electron-builder 配置错误或源码未通过 typecheck
echo 请保留上方日志以便排查。

::failure
echo.
pause
exit /b 1