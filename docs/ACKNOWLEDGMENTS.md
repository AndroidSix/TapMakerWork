# 致谢与借鉴

创建于 2026-09-22

## 版权归属（请先读）

| 主体 | 关系 |
|------|------|
| **TapMakerWork** | 版权归本仓库作者 **androidsup**（见根目录 [LICENSE](../LICENSE)），独立项目 |
| **KayingAI** | **另一家公司 / 组织**，与 TapMakerWork **无隶属、非同一主体** |
| **KayingCodex** | KayingAI 的开源产品；其名称、商标与代码版权仍归 KayingAI / 其权利人 |

本仓库在 README、发行物与许可证中的 **Copyright 声明仅指 TapMakerWork**，不得理解为 KayingAI 对本仓库享有版权，也不得理解为本仓库代表或隶属于 KayingAI。

---

TapMakerWork 在产品形态与桌面工作台交互上，参考了开源社区中「把交付主线放进同一桌面工作流」的实践。下列项目**不是**本仓库的上游 fork，但对我们理解 Agent / Codex 式桌面工作台、分栏协作与交付节奏有帮助。特此致谢。

## KayingCodex（第三方 · KayingAI）

| 项 | 内容 |
|----|------|
| **项目** | [KayingCodex](https://gitcode.com/kayingai/kaying-codex)（**KayingAI** 出品） |
| **简介** | 面向办公与游戏开发的 AI 桌面工作台 / Agent Harness |
| **主页** | [kayingai.com](https://kayingai.com/) · [kaying.ai](https://kaying.ai/) |
| **代码托管** | [GitCode · kayingai/kaying-codex](https://gitcode.com/kayingai/kaying-codex) · [GitHub · kaying-studio/kaying-codex](https://github.com/kaying-studio/kaying-codex) |
| **参考提交** | [`fbc60cab`](https://gitcode.com/kayingai/kaying-codex/commit/fbc60cab953b85181d15709635b09be20ccfe8de?ref=main) |
| **对本仓库** | 仅作概念与交互层面的**借鉴鸣谢**；**不共享版权、不构成联合署名** |

**借鉴范围（概念与交互，非代码拷贝）：**

- 桌面端「会话 / 项目 / 预览」同一工作台的组织方式  
- Agent 驱动交付时侧栏与主流程并置、减少工具跳转的思路  
- 面向发行目标的本地验证与发布节奏  

TapMakerWork 自身实现面向 **TapTap Maker / UrhoX** 的可视化编辑、Runtime 镜像与 MCP，代码与资源均为本仓库独立维护；**未将 KayingCodex 源码并入本仓库发行物**。KayingCodex 若采用 Apache-2.0 等许可证，其条款仅约束其自身仓库，不改变本仓库的 MIT 版权归属。

## 其他

- **TapTap Maker / UrhoX**：官方运行时、CLI 与文档；本项目为其第三方增强工具，不隶属 TapTap 官方。  
- 依赖库的许可证与版权见各 `package.json` / `node_modules` 及上游声明。

如有遗漏的致谢对象，欢迎在 GitHub Issue 中补充。
