# 2026-10-22 弹窗宽度修复与下一版商店素材

基线：`f43d6488bcbe3bd81323f28159617aa84ffd8639`（0.5.1）。本记录为该基线上的 0.5.2 候选；正式发布以合并提交和部署读回为准。

## 原因与修复

0.5.1 将扩展 `body` 的 390px 改为 `min(390px, 100vw)`。Chrome 自动确定工具栏弹窗大小时实际得到 190×468，造成窄长面板。只恢复固定 390px；不改布局、字号、状态色、按钮、开关、授权或 Cookie 行为。官网已有 `body { width: 100%; }` 独立覆盖，继续保持响应式。

## 回归证据

`npm run build && npm run test:popup` 复用独立 Chromium launcher，以 `chrome.action.openPopup()` 打开真正的工具栏弹窗；从同扩展观察页读取 popup Window，不向被测弹窗设置 viewport。此前业务 E2E 在标签页强制 390px，无法覆盖自动定宽。

- 修改前，`.e2e/launcher-smoke-1792663585612/report.json`：明确失败 `light toolbar popup must retain its original width: 190 !== 390`。
- 修改后，`.e2e/launcher-smoke-1792663707225/report.json`：浅色和深色 width/bodyWidth/contentWidth 均为 390，height/contentHeight 均为 468。独立浏览器进程和 profile 已回收。
- CI 的 core/desktop 分片新增该门禁及 JSON 报告上传。远端 CI 本轮未运行。
- 本地 24 个测试文件、203 项应用测试，30 项发布工具测试全部通过；扩展/官网类型检查、构建、包检查与 7 页官网检查通过。
- 本地交互预览用于外观检查，不替代 Auth、学校 SSO 或已安装商店版验收。

## 0.5.2 发布

用户已授权本轮增加补丁版本 0.5.2、提 PR、CI 全绿后合并上线并复验，同时更新并送审 [三项蓝色素材](../../store-assets/README.md)。面板预览截图使用现有官网演示入口及共享扩展样式，不宣称新一次真实学校登录成功。
