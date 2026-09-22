# Delivery roadmap

创建于 2026-09-18  
更新于 2026-09-22

> 面向用户的摘要见根目录 [README.md](../README.md)「后续开发计划」。  
> 规划里程碑：M5 资源优化 · M6 AI 提效 · **M7 多平台打包** · M8 工程能力参考  
> 官网：[androidsix.github.io/tapmakerwork-site](https://androidsix.github.io/tapmakerwork-site/)  
> 社区配置：仓库根目录 [community.json](../community.json)（IDE 优先读 Gitee，其次 GitHub，最后内置）  
> 社区：TapMakerWork工具交流群 `1124103038` · [一键入群](https://qm.qq.com/q/OCt1HAmHK2)

## M0 - feasibility gates

- [ ] Runtime frame-provider contract and adjustable-FPS demo (UI contract exists; native frames are not connected).
- [x] Remote UI snapshot, command queue and live property patching contract.
- [ ] macOS and Windows filesystem-sandbox escape suite (Shell remains fail-closed).
- [x] Official Maker preview status, log and lifecycle adapters.
- [x] Static/hybrid Lua UI converter with source mapping and dynamic-slot preservation.
- [x] Project MCP resources/tools smoke-tested over stdio.

## M1 - IDE foundation

- project tabs, file tree, Monaco editor and search;
- Git status and diff review;
- official Runtime lifecycle controls;
- categorized terminals and task history.

## M2 - visual editor

- hierarchy, canvas selection, resize and keyboard alternatives;
- property, event, animation, theme and responsive inspectors;
- device presets plus custom resolution, DPR and safe areas;
- undo/redo and transactional saves;
- [x] NanoVG Runtime adapter: auto-detect raw `nvg*` projects, proxy draw calls into virtual nodes, hit-test real bounds, persist overrides to `.ui.json` without rewriting game Lua.

## M3 - Lua migration and hot reload

- page-by-page runtime capture;
- `.ui.json + Controller.lua` generation;
- legacy preservation and rollback;
- subtree replacement without process restart.

## M4 - external agents

- project-scoped MCP resources for selection, logs and diagnostics;
- tools that produce reviewable code/event diffs;
- adapters for Codex, Claude and Cursor.

## M5 - 资源与构建优化（规划）

- [x] 内置图片无损/近无损批量压缩（工具菜单已交付：本地压缩默认可用；Tiny 可选；结果面板展示压缩数/节省体积）
- [ ] 无用资源清理（基于已有引用审计，删除前列清单、可撤销）
- [ ] 代码混淆选项（与官方 Maker 构建流程兼容，可开关）
- [ ] 构建包体报告（资源占比、压缩收益）

## M5.5 - 合规与发布辅助（规划）

- [ ] 自行申请软著教程（材料清单、截图规范、代码鉴别材料整理）

## M6 - 开发经验与 AI 提效（规划）

- [x] IDE 内「实践指南」：常见坑、排错路径、交付检查清单（标题栏「开发技巧」入口；可预览复制内容）
- [x] AI 开发技巧库：提示词、上下文组织、本地预览 Token 优化、grill-me、发布前检查（可一键复制）
- [x] 新手引导：实时编辑两步上手 + 首次弱提示
- [ ] 可导入 Skills / 工程模板，供 Claude、Cursor、Codex 等参考
- [ ] 与项目 MCP 联动：把指南暴露为 resource，方便 Agent 检索

## M7 - 多平台打包能力（规划）

IDE 提供打包向导、目标预设、适配检查与产物管理；**不替代**官方 Maker 构建与各平台审核/资质流程。

- [ ] H5 / Web 导出工作流（预览链接、静态资源目录、分享说明）
- [ ] Android APK 打包向导（签名、包名、图标/启动图、渠道参数）
- [ ] iOS 产物导出引导（Bundle ID、证书/描述文件检查清单、上架前检查）
- [ ] macOS / Windows 桌面游戏包入口（与 IDE 自身桌面打包链路区分）
- [ ] 抖音小游戏目标预设（开放能力/平台约束提示、配置模板）
- [ ] 微信小游戏目标预设（包体、子域/开放数据域提示、配置模板）
- [ ] 其它小游戏平台接入清单（可扩展的平台适配框架，按需增补）
- [ ] 多平台工程预设切换（同一项目多目标配置，减少重复改表）
- [ ] 打包产物归档：版本号、平台、产物路径与校验信息写入交付证据

依赖说明：部分导出能力依赖官方 Maker/平台开放接口；未开放的目标以「检查清单 + 模板 + 跳转官方流程」形式提供。

## M8 - 游戏工程能力参考（规划）

以「工具 + 文档 + 标杆模板」为主，不替代 TapTap 官方服务端能力。

- [ ] UI 安全区域：异形屏 safe area 可视化、布局检查与建议
- [ ] 反作弊参考：客户端检测思路、可选模块与服务端校验配合说明
- [ ] 强更新范式：强制升级、维护公告、灰度/分渠道
- [ ] 游戏数据存档回退：云存档结构、版本兼容与回退策略
- [ ] 排行榜标杆实现与防刷参考
- [ ] 广告接入标杆项目源码模板（供 AI/人工对照）
- [ ] 模板仓库索引：一键从 IDE 打开/复制参考工程

## Pilot acceptance

Open the `HomePage` of the selected Maker project, select a button in the live Runtime view, change layout and appearance, save to `.ui.json`, and observe the result without restarting Runtime or losing the game/network state.

## 发布与社区

- 官网：https://androidsix.github.io/tapmakerwork-site/  
- 主仓：https://gitee.com/AndroidSUP/tap-maker-work  
- 镜像：https://github.com/AndroidSix/TapMakerWork  
- 交流群：`1124103038` · https://qm.qq.com/q/OCt1HAmHK2  
