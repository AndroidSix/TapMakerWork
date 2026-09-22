/** 开发技巧内容：分类、可一键复制的 AI 提示。 */

export interface DevTipItem {
  id: string;
  title: string;
  summary: string;
  copyText: string;
  copyLabel?: string;
  links?: Array<{ label: string; url: string }>;
}

export interface DevTipCategory {
  id: string;
  title: string;
  description: string;
  items: DevTipItem[];
}

export const DEV_TIP_CATEGORIES: DevTipCategory[] = [
  {
    id: "local-token",
    title: "本地开发 · Token 优化",
    description: "少走远端构建，优先本机预览，节省 Maker / AI 额度。",
    items: [
      {
        id: "maker-local-preview-rule",
        title: "本地预览优先（全局规则摘要）",
        summary: "日常改完用本机预览看效果；只有明确要提交/推送/真机构建时才远端构建。",
        copyLabel: "复制给 AI（Cursor 规则）",
        copyText: `请把以下约定写入当前项目的 Cursor / Claude 全局或项目规则（TapTap Maker / UrhoX 项目生效）：

# TapTap Maker MCP 本地开发 Token 优化

仅当工作区是 TapTap Maker / UrhoX 项目时生效：存在 Maker 托管的 AGENTS.md，或同时有 .project/settings.json、engine-docs/、scripts/。否则整份忽略。

1. 日常修改不要自动提交远程、不要自动远端构建。改完用 maker-lua-lsp 确认无 Error 即可。
2. 看效果默认走本机预览（beta CLI，不提交、不上传）：聊天输入 /maker-preview 或选择技能 maker-local-preview 即可一键预览。
3. 只走官方 Maker CLI（taptap-maker preview / console open 或本机 mcp-runtime 的 maker.js），不要辅助脚本。
4. 流程：status → 必要时 install → 存活则 refresh 否则 start；预览起来后立刻 console open --target-dir <项目> --json 打开本机控制台。停止预览用 preview stop。
5. 只有明确说提交、推送、构建、构建一下、后台网页预览或真机看时，才调用 maker_build_current_directory；构建成功后不用打开网址。
6. 含糊的「预览/跑一下」优先本地预览，不要默默远端构建。

分析项目时忽略 engine-docs/、examples/、templates/、urhox-libs/；先复用 scripts/ 现有模块。`
      }
    ]
  },
  {
    id: "ai-skills",
    title: "AI 协作技能",
    description: "安装与使用可复用的 Agent Skill，提升方案讨论质量。",
    items: [
      {
        id: "grill-me",
        title: "/grill-me 深度追问",
        summary: "在动手前让 AI 逐层追问方案，把决策树问清楚再写代码。",
        copyLabel: "复制安装与用法给 AI",
        links: [{ label: "上游 skills 仓库", url: "https://github.com/mattpocock/skills" }],
        copyText: `请帮我安装并配置 Cursor 的 grill-me 技能，然后按用法执行。

## 安装（Cursor）
1. 创建目录：~/.cursor/skills/grill-me/
2. 写入 SKILL.md，内容如下（YAML frontmatter + 正文）：

---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

# Grill Me

Interview the user relentlessly about every aspect of their plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

For each question:
1. Provide your recommended answer before asking
2. Ask the question
3. Wait for the user's response before moving to the next question

If a question can be answered by exploring the codebase, use Read/Grep to answer it yourself — don't ask the user.

How to structure the session:
1. Start by listing the top-level decision branches you see in the plan (3–6 items)
2. Pick the most foundational branch first
3. Walk each branch to completion before moving to the next
4. Within a branch, resolve sub-decisions in dependency order

When to stop: all branches resolved and no open "it depends" answers remain. Close with a one-paragraph summary of key decisions.

## 使用方法
- 在 Cursor 聊天输入：/grill-me
- 或说：「grill me」「用 grill-me 追问我这个方案」
- 适用：架构选型、玩法设计、大改前把决策问清楚

请确认技能已就绪，然后对我接下来贴的方案执行 grill-me。`
      }
    ]
  },
  {
    id: "release-check",
    title: "发布前检查",
    description: "缩小包体、清理无用资源、避免一次提交过大。",
    items: [
      {
        id: "unused-assets",
        title: "清理未使用资源",
        summary: "发布前让 AI 审计并删除未被引用的素材，减小包体。",
        copyLabel: "复制检查指令给 AI",
        copyText: "检查一下有没有多余没有使用的资源，删掉他们"
      },
      {
        id: "batch-commit-after-compress",
        title: "压缩后分批提交",
        summary: "图片批量压缩后，避免一次性超大 diff 被拦截。",
        copyLabel: "复制提交说明给 AI",
        copyText: "我将游戏内图片压缩了一遍，你分批次多次的提交上去吧，我怕一次性提交太多太大被拦截了"
      }
    ]
  }
];
