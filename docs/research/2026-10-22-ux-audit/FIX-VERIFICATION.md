# QuickLogin UX 修复验收 · 2026-10-22

原审计的 8 组问题已在扩展、Auth 和官网完成修复。首次连接现在保持 **正在连接 Auth → 正在准备学校登录 → 已就绪**；准备、浏览器同步、等待确认通过说明区呈现。失败会显示原因及对应动作，真实关闭仍保留明确的作用范围。

这是本地代码及隔离浏览器验收，不代表生产部署或 Chrome Web Store 发布。原始审计和失败证据见 [README](README.md)。

## 8 组修复

| 组 | 修复后的行为 | 主要回归证据 |
| --- | --- | --- |
| 1. 新登录闪现关闭 | 投影已有连接意图及待确认启用命令；注册完成但启用未完成时保持过程提示；网络失败优先于旧的关闭快照 | `background/ux-transitions.test.ts`；32 状态浏览器检查；真实 PKCE 注册 |
| 2. 标题和开关矛盾 | 无在途操作时开关使用服务端有效设备状态；远程关闭后一次点击即可请求开启；新授权过程优先于旧关闭状态 | `popup/view-model.test.ts`、`background/ux-transitions.test.ts`；浏览器实际点击 |
| 3. 恢复操作锁住界面 | 手动恢复和切换到快捷登录在意图持久化后立即返回；异步同步通过状态刷新展示，等待期间可以关闭 | `popup/recovery.test.ts` 经过真实消息处理入口，延迟网络响应并实际点击关闭；学校延迟导出取消测试 |
| 4. Auth 重连不通 | 精确允许 `/settings` 和 `/settings/cqu`，保留来源、顶层 frame 和 ticket 校验；先发现商店版/Canary 的设备身份，再仅向唯一匹配实例发送 ticket | 扩展 `external.test.ts`；Auth `quicklogin.test.ts` 的渠道、错设备、重复设备和超时用例；Canary 原生浏览器重连 |
| 5. 学校页丢失恢复动作 | 学校提示保留更新密码、重连、切换已有登录、权限和更新插件等具体动作；沿用后台来源校验与显式 Cookie 替换许可 | `background/content-ux.test.ts`、`content/index.test.ts`；10 个学校提示场景及实际按钮点击 |
| 6. 状态文案与层级混乱 | canonical 31 状态都有说明；准备过程共用稳定标题；明确此浏览器/账号范围、手动模式和下一步；等待确认不再催用户重新同步 | 两仓库共享协议测试与 digest 检查；popup 32 状态、popup/Auth 共 16 个布局检查 |
| 7. 安装和授权说明断点 | QuickLogin scope 改为自然语言；安装、绑定成功及管理入口统一到 `/settings/cqu`；学校验证明确留在学校页面手动完成 | Auth OAuthPermissions、绑定向导和设置测试；官网构建检查及浏览器阅读 |
| 8. 异常/手动反馈不准确 | 首次输入立即切换手动提示并废弃迟到回复；内部/存储异常不再伪装成 idle；契约错误明确提示无法读取服务状态 | `background/index.test.ts`、`sync-v3.test.ts`、`content/index.test.ts`；真实学校输入及迟到请求回归 |

没有新增依赖或并行状态机。保留 Cookie 所有权、代际取消、手动接管、精确读回和 ACK 的就绪条件。Auth 设备按钮在浏览器检查中发现高度不足，已统一修为至少 44px 并复验。

## 自动回归

| 范围 | 结果 | 记录 |
| --- | --- | --- |
| 扩展默认测试 | 27 文件 / **224 项通过** | [日志](regression-after.txt) |
| 原审计独立诊断 | 4 文件 / **11 项通过**；修复前为 10 失败、1 通过 | [修复后](diagnostic-after.txt)、[修复前](transition-results.txt) |
| Auth 默认测试 | 108 文件 / **977 项通过** | [日志](auth-regression-after.txt) |
| Auth Workers 测试 | 46 文件 / **456 项通过** | [日志](auth-workers-after.txt) |
| 构建与静态检查 | 扩展 typecheck、typecheck:e2e、build、check:package；官网 typecheck、build、check；Auth typecheck、typecheck:do、check:api、check:boundaries、前端 build/lint/check:design 全通过 | [主要检查日志](build-checks-after.txt) |

canonical 协议来源是 Auth `src/services/quicklogin/protocol-v3.ts`，生成文件已同步到 Auth 前端和扩展。digest：`2ad223ead9bab4b66feaa866e95438e1b4312fad332e2077e9e15bf6785ed4bf`。未手改生成文件，未修改 HTTP API schema。

## 浏览器验证

### 交互和布局

- popup 实际源组件覆盖 [32 个状态](browser-after-states.json)，每个状态均有说明、无横向溢出。
- 重放首次连接时观察到标题序列 `正在连接 Auth → 正在准备学校登录 → 已就绪`，没有关闭/退出状态穿插。重放使用合成时序，不是生产耗时测量。
- 远程关闭时开关未勾选，实际点击发送 `SET_ENABLED { enabled:true }`。
- popup 与 Auth 实际组件分别检查 320、390、768、1440px 的明暗主题，共 16 个布局：无横向溢出、操作目标至少 44px。检查键盘操作和 reduced-motion；Auth 没有显示原始 scope。
- 学校提示检查 [10 个状态](school-browser-states.json)，实际操作更新密码、切换已有登录、手动接管及恢复入口。合成预览表单不会提交。
- 官网 `/download`、`/faq` 浏览器检查确认管理链接、学校验证和手动模式说明一致。

布局记录：[popup](browser-after-layouts.json)、[Auth](auth-browser-layouts.json)。截图：[启用中](after-enabling.png)、[窄屏暗色](after-320-dark.png)、[Auth 窄屏](auth-320-light.png)、[学校手动模式](school-manual-after.png)。明暗主题截图在过渡结束后采集。

交互预览：[popup](verification.html)、[学校提示](school-verification.html)。在仓库根运行 `npx vite --host 127.0.0.1 --port 4175` 后访问本目录相应页面；均使用合成状态，不会操作个人账号。Auth 组件预览保留在 Auth worktree 的 `frontend/ux-preview.html` / `frontend/ux-preview.tsx`，不属于生产入口。

### 真实扩展与隔离 Auth 联调

**11 个相关端到端用例通过**，来自 7 个独立测试运行环境；不是声称全量 E2E 套件通过。它们使用原生 Chromium MV3 扩展、真实本地 Auth Worker/D1/DO、合成账号和隔离学校容器，未连接真实学校账号。

1. PKCE 授权和设备注册。
2. 用户取消授权。
3. 错误 pending state 的回调拒绝。
4. 注册跳转地址之外的授权回调被拒绝。
5. 设备注册被服务端拒绝后不显示已连接。
6. token 丢失/授权实际过期后，从 Auth 显式重连原设备。
7. 外来 Cookie 与所有权不明确的 Cookie 在同步和关闭后保持不变。
8. 学校页真实输入后，迟到的自动流程不得继续写入/跳转。
9. 导出响应延迟期间关闭，取消后续 Cookie 写入和回执。
10. 新会话仍被学校拒绝时，只导航一次后停止，并提供手动/重试入口。
11. 学校会话写入、精确读回、ACK 后才进入业务页；学校续期辅助 Cookie 后，插件保守呈现“正在保留已有学校登录”，不夺取所有权。

全部通过的运行均完成清理，固定相同 Auth 提交和扩展后台构建；脱敏索引见 [e2e-after.json](e2e-after.json)，其中保留原始 `.e2e` 证据路径，没有凭据或账号标识。

回归过程中修正了两处旧测试假设：开关 helper 原来按隐藏的本地意图按空格，现在按可见有效状态操作并等待无待办命令；学校所有权用例最后一个标题断言更新为新文案。此前失败记录保留，没有删除或将错误行为改为正确断言。最后一项重跑已通过；一次受限权限下的构建启动失败也已在获准访问隔离 Auth 缓存后完成重跑。

复跑入口（仓库根目录，需本地浏览器、Docker 及 Auth worktree 写入权限）：

```sh
QUICKLOGIN_E2E_AUTH_PATH=/Users/uu/.codex/worktrees/d97c/auth \
QUICKLOGIN_E2E_AUTH_COMMIT=e54a6f5095fc12a47039945825b69d5ab855820e \
node e2e/run.mjs --grep 'real popup|canceling the real|real callback|callback outside|real device registration|lost token|real binding/container|actual manual typing|foreign cookies and ambiguous|disabling sync while|still rejects the fresh'
```

## 代码与发布边界

- QuickLogin：`/Users/uu/.codex/worktrees/d97c/quicklogin`，分支 `codex/quicklogin-ux-recovery`，基于 `f43d6488bcbe3bd81323f28159617aa84ffd8639` 的未提交修改。
- Auth：`/Users/uu/.codex/worktrees/d97c/auth`，同名独立分支，基于 `ce98d612880fd351285cedf4df0c2c9c244163d7`；修复提交 `7254822be490eab84f93253481524c6be3b5ba65`、`e54a6f5095fc12a47039945825b69d5ab855820e`。为满足 E2E 固定干净 Auth 提交的约束创建本地提交，未 push。
- 11 个 E2E 用例的扩展后台 SHA-256 均为 `5c40eed6a4976c1daf2b871c5ee9c643e908c1b2d79024db82b819383dc5b3c2`。
- 未执行 CI、Worker 部署、版本发布、Canary 上传或商店送审；仍是 0.5.1 基线上的修复工作树，正式发布需按仓库发布约定升补丁版本并同步发布说明和渠道产物。
- 重连发现需要新版扩展的 `GET_DEVICE_INFO`。两端发布需配套安排；旧插件会明确要求更新，不能把 Auth 单独上线当作重连问题已对所有安装用户解决。
- 商店 ID 的唯一匹配、错设备、双实例及超时分支由回归测试覆盖；原生扩展 E2E 使用 Canary ID。未验证商店安装版现场重连、真实学校账号、生产网络或辅助技术实机表现。
