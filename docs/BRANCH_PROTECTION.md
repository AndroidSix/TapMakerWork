# 分支保护与 PR 审查流程

创建于 2026-09-21

TapMakerWork 的主仓在 **GitHub**，Gitee 是只读镜像。所有合并都在 GitHub 端完成，`main` 必须受保护，确保外部贡献者只能通过 PR 提交改动，且必须经过审查与 CI。

---

## 1. 目标

- 外部 Fork 出来的贡献者 **不能** 直接 push 到 `main`。
- 所有合并必须通过 **Pull Request**。
- 每个 PR 必须 **至少 1 个审查人 approve** 后才能合并。
- 必须：**CI / typecheck 必须为绿** 才能合并（防止破坏性改动被绕过）。

---

## 2. GitHub 主仓

> 路径：`https://github.com/AndroidSix/TapMakerWork/settings/branches`

### 2.1 添加分支保护规则

1. 打开仓库 → 顶部 **Settings** → 左侧 **Branches**
2. **Branch protection rules** → **Add rule**（或 Edit 现有规则）
3. **Branch name pattern**: `main`

### 2.2 推荐配置

| 项 | 推荐值 | 说明 |
|---|---|---|
| Require a pull request before merging | ✅ | 所有改动必须走 PR |
| Required approving reviews | **1** | 个人项目够用；多人协作可设 2 |
| Dismiss stale pull request approvals when new commits are pushed | ✅ | 新提交自动撤销旧 approve |
| Require status checks to pass before merging | ✅ | 选 `verify`（见 §4） |
| Require linear history | ✅ | 禁止 merge commit，强制 squash / rebase |
| Include administrators | ✅ | 包括你自己也不能绕过 |

### 2.3 CODEOWNERS 自动审查

根目录 `CODEOWNERS` 已被 GitHub 识别。提 PR 时自动按目录指派审查人：

```
/electron-builder.yml  /scripts/  /apps/desktop/  /outputs/launchers/  → @AndroidSUP @AndroidSix
/docs/  /CONTRIBUTING.md                                                → @AndroidSUP @AndroidSix
/.github/workflows/  /CODEOWNERS                                       → @AndroidSUP @AndroidSix
```

> 单人项目 GitHub 不会自动请求你自己的审查，**主审查人需手动点「Reviewers」加 `AndroidSix` 自己**（GitHub 设计如此，避免绕过）。`AndroidSUP` 是 Gitee 用户，可不填。

---

## 3. Gitee 镜像

> 路径：仓库主页 → 管理 → 仓库管理

Gitee 端**不需要**分支保护——因为：

1. Gitee 仓为只读镜像，外部贡献者不会来提 PR。
2. 代码改动只从 GitHub 同步过来，本地分支保护不生效。

只需要在 Gitee 配置「**镜像同步**」：

1. 进入 Gitee 仓库主页 → 「管理」/「···」→ **仓库管理**
2. 左侧找「**镜像同步**」 / 「**GitHub 仓库镜像**」
3. 源仓库：`https://github.com/AndroidSix/TapMakerWork`
4. **方向**：Gitee ← GitHub（**单向**，Gitee 不允许推回 GitHub）
5. 触发方式：**Push 触发**（GitHub 有 push 自动同步）+ 每天兜底一次定时同步
6. 启用同步

> 同步成功会在仓库主页显示「本仓库为镜像仓库，源仓库地址：…」。以后你在 GitHub 上合并的所有 commit 都会在几分钟内同步到 Gitee。

---

## 4. CI 状态检查

仓库已有：

- `.github/workflows/desktop-release.yml` —— **发布流水线**（打安装包，仅 tag push 触发，**不做 PR 检查**）
- `.github/workflows/pr-check.yml` —— **PR 检查**（typecheck + test，每次 PR 触发）

公开仓库 GitHub Actions **永久免费**，无需担心配额。

### 4.1 启用方法

PR 检查 workflow 已经在仓库里，**只需要 GitHub 端允许 Actions 运行**：

1. 仓库主页 → 顶部 **Actions** 标签
2. 如果首次访问会有提示「Workflows aren't being run on this repository」→ 点「**I understand my workflows, go ahead and enable them**」

之后每次 PR 打开/更新都会自动跑 `pr-check.yml` 的 `verify` job。

### 4.2 把 verify 接入分支保护

回到 §2.2，在「Require status checks to pass before merging」下拉里搜索 `verify`，勾上即可。

---

## 5. 验证

完成配置后，按下述顺序自检：

1. **外部推 push 必失败**：让一位非协作者 `git clone → 修改 → git push origin main` → 应被拒绝（403 / protected branch）
2. **走 PR 必须审查**：从 fork 提 PR → 「Merge」按钮灰色，提示「Required approving reviews」
3. **CI 红则禁合**：故意制造一个 typecheck 失败 → 「Merge」保持灰色，显示 ✗ verify
4. **撤销一次审查后再次审批**：先 approve → 再 push 新提交 → 之前的 approve 应被撤销（依赖 §2.2 的 Dismiss stale 开关）
5. **Gitee 同步**：在 GitHub 合并一个 commit → 几分钟后 Gitee 镜像出现同一 commit

---

## 6. 协作者管理

- 需要给某人 **直接 push 权限** 时：GitHub 仓库 → Settings → Collaborators → Add people → 角色 Write
  - 即便如此，受保护分支仍要求他们走 PR（除非在保护规则里把他们加 Bypass list）
- 不再合作时 **立刻移除**，避免遗留写权限