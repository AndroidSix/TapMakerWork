# 贡献指南

创建于 2026-09-21

感谢关注 TapMakerWork。

## 仓库角色

| 仓库 | 地址 | 用途 |
|------|------|------|
| **主仓（Gitee）** | https://gitee.com/AndroidSUP/tap-maker-work | 开发协作、Issue、**全部 Pull Request** |
| **镜像（GitHub）** | https://github.com/AndroidSix/TapMakerWork | 仅浏览提交、下载发行版 |

## Pull Request

- **所有 PR 只合并 Gitee 主仓。**
- GitHub 上的 Pull Request **不会被合并**，请关闭后到 Gitee 提交。
- Fork 请以 Gitee 主仓为准。

## Issue

- Bug、需求、讨论请在 **Gitee** 提交。
- GitHub Issues 已关闭，避免信息分散。

## 开发与分支

- 默认分支：`main`
- 建议流程：从 `main` 拉出功能分支 → 自测 → 在 Gitee 发起 PR
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
