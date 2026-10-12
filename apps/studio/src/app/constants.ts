import type { LogChannel } from "@tapmakerwork/protocol";

export const BUILTIN_QQ_GROUP_ID = "1124103038";
export const BUILTIN_QQ_GROUP_NAME = "TapMakerWork工具交流群";
export const BUILTIN_QQ_GROUP_JOIN_URL = "https://qm.qq.com/q/OCt1HAmHK2";
export const OFFICIAL_SITE_URL = "https://androidsix.github.io/tapmakerwork-site/";
export const PHOTOPEA_URL = "https://www.photopea.com/";
export const AGENT_FRAME_INTERVAL_MS = 10_000;
export const AGENT_FRAME_AFTER_EDIT_MS = 800;

/** Bridge Lua-writeback skip reasons → what the user should do instead. */
export const WRITEBACK_SKIP_REASON_TEXT: Record<string, string> = {
  kit_internal_geometry: "共用组件内部节点没有稳定身份，无法按实例保存",
  opts_passthrough: "该属性由共用组件的 opts 透传，请在调用处修改",
  widget_not_found: "在 Lua 里找不到对应控件",
  layout_expression: "位置由布局表达式计算，无法冻结为字面量",
  measured_geometry: "拖动结果是父级相对测量值，未写入设计值",
  container_forbidden: "布局容器不接受背景，也不接受把整行缩成单卡尺寸",
  font_overflow: "字号会撑爆控件高度",
  call_site_ambiguous: "多个调用处同名，无法确定目标",
  call_site_no_match: "找不到唯一调用处"
};

export const LOG_CHANNELS: Array<{ id: LogChannel; label: string }> = [
  { id: "runtime", label: "Runtime" },
  { id: "build", label: "构建" },
  { id: "lua", label: "Lua 检查" },
  { id: "shell", label: "Shell" },
  { id: "repl", label: "Lua REPL" },
  { id: "qrcode", label: "二维码" },
  { id: "agent", label: "Agent" }
];

export const INITIAL_LOGS: Record<LogChannel, string[]> = {
  runtime: ["等待 Maker 预览或 Runtime 适配器连接…"],
  build: ["暂无构建任务。"],
  lua: ["暂无 Lua 诊断。"],
  shell: ["Shell 已锁定：OS 级项目沙箱尚未通过双平台逃逸测试。"],
  repl: ["Lua REPL 将在 Runtime Dev Bridge 接入后启用。"],
  qrcode: ["暂无二维码任务。"],
  agent: ["AI：读 .tapmakerwork/ai/STATUS.md；inbox 或 POST /api/agent/command 控制；改完再读 snapshot/errors/preview.png。"]
};

export const DEFAULT_DEVICE_HINT = "maker-portrait";
