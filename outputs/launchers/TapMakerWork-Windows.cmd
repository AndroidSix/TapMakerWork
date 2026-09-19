@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "TAPMAKERWORK_ROOT=%%~fI"
set "STATE_DIR=%TAPMAKERWORK_ROOT%\.tapmakerwork"
set "PROJECT_FILE=%STATE_DIR%\last-project.txt"

if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/"
if not defined electron_mirror set "electron_mirror=%ELECTRON_MIRROR%"

cd /d "%TAPMAKERWORK_ROOT%" || goto :root_error

where node >nul 2>nul || goto :node_error
where npm >nul 2>nul || goto :npm_error
for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :node_error
if %NODE_MAJOR% LSS 22 goto :node_version_error

set "PROJECT_PATH="
set "PATH_SOURCE=none"

if not "%~1"=="" (
  set "PROJECT_PATH=%~1"
  set "PATH_SOURCE=argument"
) else if defined TAPMAKERWORK_PROJECT (
  set "PROJECT_PATH=%TAPMAKERWORK_PROJECT%"
  set "PATH_SOURCE=env"
) else if exist "%PROJECT_FILE%" (
  set /p PROJECT_PATH=<"%PROJECT_FILE%"
  set "PATH_SOURCE=memory"
)

:project_prompt
if defined PROJECT_PATH if exist "%PROJECT_PATH%\." goto :project_ready
if defined PROJECT_PATH (
  if "%PATH_SOURCE%"=="memory" (
    echo 记忆的 Maker 项目路径已失效（换机器或目录变动后常见）：%PROJECT_PATH%
    echo 状态文件：%PROJECT_FILE%
  ) else (
    echo 路径无效或不存在：%PROJECT_PATH%
  )
  call :list_nearby "%PROJECT_PATH%"
)
echo 请输入 Maker 项目的绝对路径，也可以把项目文件夹拖到此窗口：
set "PROJECT_PATH="
set /p "PROJECT_PATH=> "
set "PROJECT_PATH=%PROJECT_PATH:"=%"
set "PATH_SOURCE=input"
goto :project_prompt

:project_ready
for %%I in ("%PROJECT_PATH%") do set "PROJECT_PATH=%%~fI"
if not exist "%PROJECT_PATH%\.maker-mcp\config.json" (
  echo 提示：%PROJECT_PATH% 未找到 .maker-mcp\config.json，可能不是 Maker 项目，仍将继续启动。
)
if not exist "%STATE_DIR%" mkdir "%STATE_DIR%" || goto :state_error
>"%PROJECT_FILE%" <nul set /p "=%PROJECT_PATH%"
set "TAPMAKERWORK_PROJECT=%PROJECT_PATH%"

echo.
echo TapMakerWork
echo 项目：%TAPMAKERWORK_PROJECT%
for /f "delims=" %%V in ('node --version') do echo Node：%%V
echo.

if not exist "%TAPMAKERWORK_ROOT%\node_modules\.bin\electron.cmd" (
  echo 首次启动：正在安装依赖…
  call npm install || goto :install_error
)

echo 正在启动 IDE…
call npm run dev
if errorlevel 1 goto :run_error
exit /b 0

:list_nearby
set "NEAR=%~1"
for %%I in ("%NEAR%\..") do set "PARENT=%%~fI"
if exist "%PARENT%\." (
  echo 邻近目录（%PARENT%）：
  for /d %%D in ("%PARENT%\*") do echo   %%~fD
) else (
  echo 无法定位上级目录，请确认完整路径，或把项目文件夹直接拖到此窗口。
)
exit /b 0

:root_error
echo TapMakerWork 启动失败：无法进入程序目录。
goto :failure

:node_error
echo TapMakerWork 启动失败：未找到 Node.js。请安装 Node.js 22 或更高版本后重试。
goto :failure

:npm_error
echo TapMakerWork 启动失败：未找到 npm。请重新安装包含 npm 的 Node.js。
goto :failure

:node_version_error
echo TapMakerWork 启动失败：Node.js 版本过低，需要 22 或更高版本。
node --version
goto :failure

:state_error
echo TapMakerWork 启动失败：无法创建启动状态目录。
goto :failure

:install_error
echo TapMakerWork 启动失败：依赖安装失败。
goto :failure

:run_error
echo TapMakerWork 启动失败：IDE 进程异常退出。
goto :failure

:failure
echo.
pause
exit /b 1
