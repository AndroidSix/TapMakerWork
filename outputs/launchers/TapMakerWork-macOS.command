#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
TAPMAKERWORK_ROOT="${SCRIPT_DIR:h:h}"
STATE_DIR="$TAPMAKERWORK_ROOT/.tapmakerwork"
PROJECT_FILE="$STATE_DIR/last-project.txt"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://cdn.npmmirror.com/binaries/electron/}"
export electron_mirror="${electron_mirror:-$ELECTRON_MIRROR}"
cd "$TAPMAKERWORK_ROOT" || exit 1

fail() {
  print -u2 ""
  print -u2 "TapMakerWork 启动失败：$1"
  print -u2 "按回车键关闭窗口。"
  read -r
  exit 1
}

trim_path() {
  local value="$1"
  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  print -r -- "$value"
}

strip_quotes() {
  local value="$1"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  print -r -- "$value"
}

list_nearby_dirs() {
  local target="$1"
  local dir="$target"
  while [[ -n "$dir" && "$dir" != "/" && ! -d "$dir" ]]; do
    dir="${dir:h}"
  done
  if [[ -z "$dir" || ! -d "$dir" ]]; then
    print "无法定位上级目录，请确认完整路径，或把项目文件夹直接拖到此窗口。"
    return
  fi
  print -r -- "附近的目录（$dir）："
  local entry
  local count=0
  for entry in "$dir"/*(N/); do
    print -r -- "  $entry"
    count=$((count + 1))
    if (( count >= 12 )); then
      print -r -- "  …（仅显示前 12 个）"
      break
    fi
  done
  if (( count == 0 )); then
    print -r -- "  （该目录下没有子目录）"
  fi
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

PROJECT_PATH=""
PATH_SOURCE="none"

if [[ -n "${1:-}" ]]; then
  PROJECT_PATH="$(trim_path "$1")"
  PATH_SOURCE="argument"
elif [[ -n "${TAPMAKERWORK_PROJECT:-}" ]]; then
  PROJECT_PATH="$(trim_path "$TAPMAKERWORK_PROJECT")"
  PATH_SOURCE="env"
elif [[ -f "$PROJECT_FILE" ]]; then
  IFS= read -r PROJECT_PATH < "$PROJECT_FILE" || true
  PROJECT_PATH="$(trim_path "$PROJECT_PATH")"
  PATH_SOURCE="memory"
fi

while [[ -z "$PROJECT_PATH" || ! -d "$PROJECT_PATH" ]]; do
  if [[ -n "$PROJECT_PATH" ]]; then
    if [[ "$PATH_SOURCE" == "memory" ]]; then
      print "记忆的 Maker 项目路径已失效（换机器或目录变动后常见）：$PROJECT_PATH"
      print "状态文件：$PROJECT_FILE"
    else
      print "路径无效或不存在：$PROJECT_PATH"
    fi
    list_nearby_dirs "$PROJECT_PATH"
    if [[ -d "$PROJECT_PATH" && ! -f "$PROJECT_PATH/.maker-mcp/config.json" ]]; then
      print "提示：目录存在，但未找到 .maker-mcp/config.json，可能不是 Maker 项目。"
    fi
  fi
  print "请输入 Maker 项目的绝对路径，也可以把项目文件夹拖到此窗口："
  IFS= read -r PROJECT_PATH || fail "未读取到项目路径。"
  PROJECT_PATH="$(strip_quotes "$(trim_path "$PROJECT_PATH")")"
  PATH_SOURCE="input"
done

PROJECT_PATH="$(cd "$PROJECT_PATH" 2>/dev/null && pwd -P)" || fail "无法解析 Maker 项目目录。"
mkdir -p "$STATE_DIR" || fail "无法创建启动状态目录。"
print -r -- "$PROJECT_PATH" > "$PROJECT_FILE" || fail "无法保存项目目录。"

if [[ ! -f "$PROJECT_PATH/.maker-mcp/config.json" ]]; then
  print "提示：$PROJECT_PATH 不是已绑定的 Maker 项目（缺少 .maker-mcp/config.json），仍将继续启动。"
fi

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
