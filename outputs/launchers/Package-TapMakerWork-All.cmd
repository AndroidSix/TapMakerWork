@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "TAPMAKERWORK_ROOT=%%~fI"
cd /d "%TAPMAKERWORK_ROOT%" || goto :root_error

where node >nul 2>nul || goto :node_error
where npm >nul 2>nul || goto :node_error

echo TapMakerWork IDE 一键打包
echo 目标：Windows（macOS 产物请在 Mac 或 desktop-release 流水线生成）
echo 源码：%TAPMAKERWORK_ROOT%
echo.
call npm run package:ide:win
if errorlevel 1 goto :build_error

echo.
echo Windows 安装包已生成：%TAPMAKERWORK_ROOT%\outputs\installers
pause
exit /b 0

:root_error
echo 无法进入 TapMakerWork 源码目录。
goto :failure

:node_error
echo 未找到 Node.js / npm，请先安装 Node.js 22 或更高版本。
goto :failure

:build_error
echo 打包失败，请保留上方日志。

:failure
echo.
pause
exit /b 1
