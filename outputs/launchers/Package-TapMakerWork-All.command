#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
TAPMAKERWORK_ROOT="${SCRIPT_DIR:h:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$TAPMAKERWORK_ROOT" || exit 1

finish() {
  local status="$1"
  print ""
  if [[ "$status" -eq 0 ]]; then
    print "双端安装包已生成：$TAPMAKERWORK_ROOT/outputs/installers"
  else
    print -u2 "打包失败，错误码 $status。请保留上方日志。"
  fi
  print "按回车键关闭窗口。"
  read -r
  exit "$status"
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print -u2 "未找到 Node.js / npm，请先安装 Node.js 22 或更高版本。"
  finish 1
fi

print "TapMakerWork IDE 一键打包"
print "目标：macOS + Windows"
print "源码：$TAPMAKERWORK_ROOT"
print ""
npm run package:ide
finish $?
