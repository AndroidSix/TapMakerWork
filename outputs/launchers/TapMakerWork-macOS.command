#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
TAPMAKERWORK_ROOT="${SCRIPT_DIR:h:h}"
STATE_DIR="$TAPMAKERWORK_ROOT/.tapmakerwork"
PROJECT_FILE="$STATE_DIR/last-project.txt"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$TAPMAKERWORK_ROOT" || exit 1

fail() {
  print -u2 ""
  print -u2 "TapMakerWork 启动失败：$1"
  print -u2 "按回车键关闭窗口。"
  read -r
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  fail "未找到 Node.js。请安装 Node.js 22 或更高版本后重试。"
fi

if ! command -v npm >/dev/null 2>&1; then
  fail "未找到 npm。请重新安装包含 npm 的 Node.js。"
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)"
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  fail "Node.js 版本过低，需要 22 或更高版本；当前版本为 $(node --version 2>/dev/null)."
fi

PROJECT_PATH="${1:-${TAPMAKERWORK_PROJECT:-}}"
if [[ -z "$PROJECT_PATH" && -f "$PROJECT_FILE" ]]; then
  IFS= read -r PROJECT_PATH < "$PROJECT_FILE"
fi

while [[ -z "$PROJECT_PATH" || ! -d "$PROJECT_PATH" ]]; do
  if [[ -n "$PROJECT_PATH" ]]; then
    print "上次的 Maker 项目目录已失效：$PROJECT_PATH"
  fi
  print "请输入 Maker 项目的绝对路径，也可以把项目文件夹拖到此窗口："
  IFS= read -r PROJECT_PATH
  PROJECT_PATH="${PROJECT_PATH#\"}"
  PROJECT_PATH="${PROJECT_PATH%\"}"
  PROJECT_PATH="${PROJECT_PATH#\'}"
  PROJECT_PATH="${PROJECT_PATH%\'}"
done

PROJECT_PATH="$(cd "$PROJECT_PATH" 2>/dev/null && pwd -P)" || fail "无法解析 Maker 项目目录。"
mkdir -p "$STATE_DIR" || fail "无法创建启动状态目录。"
print -r -- "$PROJECT_PATH" > "$PROJECT_FILE" || fail "无法保存项目目录。"

export TAPMAKERWORK_PROJECT="$PROJECT_PATH"

print ""
print "TapMakerWork"
print "项目：$TAPMAKERWORK_PROJECT"
print "Node：$(node --version)"
print ""

if [[ ! -d "$TAPMAKERWORK_ROOT/node_modules" || ! -x "$TAPMAKERWORK_ROOT/node_modules/.bin/electron" ]]; then
  print "首次启动：正在安装依赖…"
  npm install || fail "依赖安装失败。"
fi

print "正在启动 IDE…"
npm run dev
STATUS=$?

if [[ $STATUS -ne 0 ]]; then
  fail "IDE 进程异常退出，错误码 $STATUS。"
fi
