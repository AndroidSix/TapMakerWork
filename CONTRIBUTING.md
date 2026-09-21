# 贡献指南

创建于 2026-09-21

感谢关注 TapMakerWork。

## 仓库角色

| 仓库 | 地址 | 用途 |
|------|------|------|
| **主仓（GitHub）** | https://github.com/AndroidSix/TapMakerWork | 开发协作、Issue、**全部 Pull Request** |
| **镜像（Gitee）** | https://gitee.com/AndroidSUP/tap-maker-work | 国内访问 / 下载发行版，代码由 GitHub 自动同步 |

> Gitee 镜像为只读。提交代码、提 Issue、发 PR 都以 GitHub 主仓为准。镜像延迟最多几秒到几十秒，属正常。

## Pull Request

- **所有 PR 只合并 GitHub 主仓。**
- Gitee 镜像上的任何改动 **不会被合并**，请关闭后到 GitHub 提交。
- Fork 请以 GitHub 主仓为准。
- **每个 PR 必须经过至少 1 名审查人 approve，且 typecheck / 单元测试为绿，才能合并。**
  - 审查人指派与目录归属见根目录 `CODEOWNERS`。
  - `main` 分支受保护，详见 [`docs/BRANCH_PROTECTION.md`](./docs/BRANCH_PROTECTION.md)。
  - 自动检查由 `.github/workflows/pr-check.yml` 执行（`npm ci` → `typecheck` → `npm test`）。

## Issue

- Bug、需求、讨论请在 **GitHub** 提交。

## 开发与分支

- 默认分支：`main`
- 建议流程：从 `main` 拉出功能分支 → 自测 → 在 GitHub 发起 PR
- 提交说明请写清动机与影响范围

## 构建与自测

```bash
npm install
npm run dev:web
npm test
npm run typecheck
```

桌面打包说明见 `docs/DESKTOP_RELEASE.md`。

## 许可证

贡献即表示同意以 [MIT License](./LICENSE) 授权你的改动。