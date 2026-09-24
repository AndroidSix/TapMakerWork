#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
TAPMAKERWORK_ROOT="${SCRIPT_DIR:h:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$TAPMAKERWORK_ROOT" || exit 1

finish() {
  local exit_code="$1"
  print ""
  if [[ "$exit_code" -eq 0 ]]; then
    print "双端安装包已生成：$TAPMAKERWORK_ROOT/outputs/installers"
    print "请安装「文件名版本号最新」的包；一键打包不会自动覆盖本机已安装的 App。"
    print "macOS：双击新的 .pkg。若提示无法验证开发者，到「系统设置 → 隐私与安全性」点「仍要打开」。"
  else
    print -u2 "打包失败，错误码 $exit_code。请保留上方日志。"
  fi
  print "按回车键关闭窗口。"
  read -r
  exit "$exit_code"
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print -u2 "未找到 Node.js / npm，请先安装 Node.js 22 或更高版本。"
  finish 1
fi

print "TapMakerWork IDE 一键打包"
print "目标：macOS + Windows"
print "源码：$TAPMAKERWORK_ROOT"
print ""

if ! node -e "const s=require('./package.json').scripts||{}; if(!s['package:ide']) process.exit(1)"; then
  print -u2 "根目录 package.json 缺少 package:ide 脚本，请检查仓库是否完整。"
  finish 1
fi

npm run package:ide
finish $?
