import { useEffect, type ReactNode } from "react";
import {
  FolderOpen,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  ExternalLink,
  Copy,
  CheckCircle2,
  ScrollText,
  AlertTriangle,
  XCircle,
  X,
  Gamepad2,
  Users,
  Map,
  Package,
  ShieldCheck
} from "lucide-react";
import type { DesktopLegalState, DesktopPermissionState } from "../desktop-api";
import type { RuntimeErrorReport } from "../runtime-error";
import wechatPayImage from "../../../../docs/sponsor/wechat-pay.png";
import alipayImage from "../../../../docs/sponsor/alipay.png";

export function PermissionGuide({ state, busy, confirmed, onAction, onClose }: {
  state: DesktopPermissionState;
  busy: string;
  confirmed: boolean;
  onAction: (permission: "screen" | "accessibility" | "restart" | "refresh" | "confirm") => void;
  onClose: () => void;
}) {
  const permissionRows = [
    { key: "screen" as const, title: "屏幕与系统音频录制", description: "用于把 Maker Runtime 的真实窗口并排显示在工作台中。", value: state.screen },
    { key: "accessibility" as const, title: "辅助功能", description: "用于把你在 Runtime 镜像上的点击准确转发到真实游戏窗口。", value: state.accessibility }
  ];
  return (
    <div className="permission-backdrop" role="presentation">
      <section className="permission-guide" role="dialog" aria-modal="true" aria-labelledby="permission-guide-title">
        <div className="permission-guide-head">
          <div><span className="permission-step">新机器设置 · 1/1</span><h2 id="permission-guide-title">授权 TapMakerWork 完成实时编辑</h2><p>这些权限只用于本机 Runtime 预览和交互，不会自动读取其他窗口内容。</p></div>
          <ShieldAlert size={28} aria-hidden="true" />
        </div>
        {!state.stableIdentity && <div className="permission-warning"><strong>当前为开发模式</strong><span>可以调试权限，但 macOS 会把授权记在 Electron 上。正式签名安装包会使用固定的 TapMakerWork 身份，授权更稳定。</span></div>}
        <div className="permission-list">
          {permissionRows.map((item) => {
            const granted = item.value === "granted";
            return <article key={item.key} className={granted ? "granted" : "needed"}>
              <span className="permission-status-icon">{granted ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}</span>
              <div><strong>{item.title}</strong><p>{item.description}</p><small>{granted ? "已授权" : item.value === "not-determined" ? "尚未询问" : "需要在系统设置中开启"}</small></div>
              <button disabled={granted || Boolean(busy)} onClick={() => onAction(item.key)}>{busy === item.key ? "正在打开…" : granted ? "已完成" : "去授权"}</button>
            </article>;
          })}
        </div>
        <div className="permission-guide-actions">
          <button className="secondary" onClick={onClose}>稍后设置</button>
          <button className="secondary" disabled={Boolean(busy)} onClick={() => onAction("refresh")}><RefreshCw size={14} />重新检测</button>
          <button className={confirmed ? "secondary confirmed" : "secondary"} disabled={Boolean(busy)} onClick={() => onAction("confirm")}><CheckCircle2 size={14} />{confirmed ? "已确认授权" : "我已授权"}</button>
          <button className="primary" disabled={(!state.ready && !confirmed) || Boolean(busy)} onClick={() => onAction("restart")}>重启应用并继续</button>
        </div>
      </section>
    </div>
  );
}

export function LegalConsentDialog({ state, busy, onAccept, onDecline, onClose }: {
  state: DesktopLegalState | undefined;
  busy: "accept" | "decline" | "";
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  const accepted = Boolean(state?.accepted);
  return <div className="legal-backdrop" role="presentation">
    <section className="legal-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-dialog-title">
      <header>
        <div><span>首次启动 · EULA 与隐私政策</span><h2 id="legal-dialog-title">使用 TapMakerWork 前请阅读并确认</h2></div>
        {accepted && <button className="icon-command" aria-label="关闭协议" onClick={onClose}><XCircle size={18} /></button>}
      </header>
      <div className="legal-document" tabIndex={0}>
        <section><h3>最终用户许可协议</h3><p>TapMakerWork 是面向 TapTap Maker 项目可视化编辑与研究验证的本地开发工具。激活、继续使用或点击“同意并激活”即表示你同意本协议与下方隐私政策。</p><p>本项目出于研究与开发辅助目的，不以盗取用户数据、篡改或破坏 TapTap Maker、项目文件及其完整性为目的。工具只会在你主动打开的项目范围内执行编辑、预览、Git 与构建操作。</p></section>
        <section><h3>屏幕录制与辅助功能权限</h3><p><strong>屏幕录制</strong>仅用于捕获本机 TapTap Maker Runtime 游戏窗口，并将真实运行画面显示在 IDE 中。TapMakerWork 不会自行录制整块屏幕，也不会自行上传捕获的画面。</p><p><strong>辅助功能</strong>仅用于把你在 Runtime 镜像上的点击坐标转发到真实游戏窗口。没有你的交互，不会自动控制其他应用。</p></section>
        <section><h3>本地数据与网络</h3><p>应用会在本机保存设置、最近项目路径、协议接受状态、预览配置与必要日志。项目修改只发生在你选择的目录中。只有当你主动使用 Maker 构建、二维码、更新检查、Git 推送或外部链接时，才会连接对应服务；这些服务适用其各自条款。</p></section>
        <section><h3>风险与责任</h3><p>请在编辑和 Git 操作前保留备份。研究工具按现状提供，不承诺适用于所有项目或硬件环境；应用不会在未经确认的情况下执行强制推送、硬重置或删除整个项目。</p></section>
      </div>
      {!state && <p className="legal-loading" role="status">正在读取协议状态…</p>}
      <footer>
        {accepted ? <button className="primary" onClick={onClose}>我已了解</button> : <>
          <button className="secondary danger" disabled={Boolean(busy) || !state} onClick={onDecline}>{busy === "decline" ? "正在关闭…" : "不同意并退出"}</button>
          <button className="primary" autoFocus disabled={Boolean(busy) || !state} onClick={onAccept}>{busy === "accept" ? "正在激活…" : "同意并激活"}</button>
        </>}
      </footer>
    </section>
  </div>;
}

export function RuntimeErrorDialog({ report, copying, onCopy, onOpenLogs, onDismiss }: {
  report: RuntimeErrorReport;
  copying: boolean;
  onCopy: () => void;
  onOpenLogs: () => void;
  onDismiss: () => void;
}) {
  return <div className="runtime-error-backdrop" role="presentation">
    <section className="runtime-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="runtime-error-title" aria-describedby="runtime-error-description">
      <header><span><AlertTriangle size={20} /></span><div><h2 id="runtime-error-title">TapTap Maker 运行时错误</h2><p id="runtime-error-description">请修复游戏中的以下错误。请定位根因并修改代码，完成后验证游戏不再报错。</p></div></header>
      <pre>{report.errorText}</pre>
      <footer><button onClick={onOpenLogs}>查看 Runtime 日志</button><button onClick={onDismiss}>暂时忽略</button><button className="primary" autoFocus disabled={copying} onClick={onCopy}><Copy size={14} />{copying ? "正在复制…" : "复制错误报告"}</button></footer>
    </section>
  </div>;
}

export function ProjectRejectDialog({ path, message, onClose }: { path: string; message: string; onClose: () => void }) {
  return <div className="project-reject-backdrop" role="presentation">
    <section className="project-reject-dialog" role="alertdialog" aria-modal="true" aria-labelledby="project-reject-title">
      <span className="project-reject-icon"><FolderOpen size={24} /></span>
      <div><h2 id="project-reject-title">无法打开此文件夹</h2><p>{message}</p><code title={path}>{path}</code></div>
      <button className="primary" autoFocus onClick={onClose}>重新选择</button>
    </section>
  </div>;
}

export const ROADMAP_SECTIONS: Array<{ title: string; icon: ReactNode; items: string[] }> = [
  {
    title: "资源与构建优化",
    icon: <Package size={15} aria-hidden="true" />,
    items: [
      "无用资源清理：基于引用审计列清单，可撤销",
      "代码混淆选项：与官方构建链兼容，可开关",
      "构建包体报告：资源占比与压缩收益"
    ]
  },
  {
    title: "合规与发布辅助",
    icon: <ScrollText size={15} aria-hidden="true" />,
    items: [
      "自行申请软著教程（材料清单、截图规范、代码鉴别材料整理）"
    ]
  },
  {
    title: "开发经验与 AI 提效",
    icon: <Sparkles size={15} aria-hidden="true" />,
    items: [
      "IDE 内实践指南：常见坑、排错路径、交付检查清单（标题栏「开发技巧」已提供部分）",
      "AI 开发技巧库扩展：更多可导入 Skills / 工程模板",
      "指南写入 .tapmakerwork/ai，便于 Agent 检索"
    ]
  },
  {
    title: "多平台打包",
    icon: <Map size={15} aria-hidden="true" />,
    items: [
      "H5 / Web 导出工作流（预览与分享）",
      "Android APK 打包向导（签名、包名、渠道参数）",
      "iOS 产物导出引导与上架前检查清单",
      "macOS / Windows 桌面游戏包入口",
      "抖音小游戏、微信小游戏等目标预设与适配检查",
      "多平台工程预设切换与打包产物归档"
    ]
  },
  {
    title: "游戏工程能力参考",
    icon: <ShieldCheck size={15} aria-hidden="true" />,
    items: [
      "UI 安全区域：异形屏可视化与布局检查",
      "反作弊参考：客户端检测思路与服务端校验配合",
      "强更新范式：强制升级、维护公告、灰度/分渠道",
      "游戏数据存档回退：云存档与版本兼容策略",
      "排行榜标杆实现与防刷参考",
      "广告接入标杆项目源码模板（供 AI/人工对照）"
    ]
  }
];

export function RoadmapDialog({ onClose, onOpenSite, onJoinGroup }: { onClose: () => void; onOpenSite: () => void; onJoinGroup: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return <div className="sponsor-backdrop roadmap-backdrop" role="presentation">
    <section className="sponsor-dialog roadmap-dialog" role="dialog" aria-modal="true" aria-labelledby="roadmap-dialog-title">
      <header>
        <div>
          <span>规划中 · 尚未全部实现</span>
          <h2 id="roadmap-dialog-title">TapMakerWork 后续开发规划</h2>
          <p>下列能力会按迭代推进；具体上线时间以发行说明为准。欢迎在交流群提出优先级建议。部分导出/上架仍依赖 TapTap 官方与各平台规则。</p>
        </div>
        <button className="icon-command" aria-label="关闭后续规划" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="roadmap-body">
        {ROADMAP_SECTIONS.map((section) => (
          <section key={section.title} className="roadmap-section">
            <h3>{section.icon}{section.title}</h3>
            <ul>
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>
      <footer>
        <button onClick={onJoinGroup}><Users size={15} />加入交流群</button>
        <button onClick={onOpenSite}><ExternalLink size={15} />官网</button>
        <button className="primary" autoFocus onClick={onClose}>知道了</button>
      </footer>
    </section>
  </div>;
}

export function SponsorDialog({ onClose, onOpenWorks }: { onClose: () => void; onOpenWorks: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return <div className="sponsor-backdrop" role="presentation">
    <section className="sponsor-dialog" role="dialog" aria-modal="true" aria-labelledby="sponsor-dialog-title">
      <header>
        <div><span>自愿支持 · 不影响任何功能</span><h2 id="sponsor-dialog-title">赞赏 TapMakerWork 作者</h2><p>感谢支持研究与持续维护。赞赏完全自愿，与软件功能及开源授权无关。</p></div>
        <button className="icon-command" aria-label="关闭赞赏窗口" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="sponsor-codes">
        <figure><div><img src={wechatPayImage} alt="作者微信赞赏收款码" /></div><figcaption>微信赞赏</figcaption></figure>
        <figure><div><img src={alipayImage} alt="作者支付宝赞赏收款码" /></div><figcaption>支付宝赞赏</figcaption></figure>
      </div>
      <footer><button onClick={onOpenWorks}><Gamepad2 size={15} />作者游戏品鉴</button><button className="primary" autoFocus onClick={onClose}>完成</button></footer>
    </section>
  </div>;
}
