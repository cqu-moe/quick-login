# CQU Quicklogin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户将本计划交给另一个模型执行；不要自行启动并行实现。

**Goal:** 实现每设备独立学校 SSO 会话、云端保活、本地 Cookie 同步，以及 Auth 的设备额度和退出管理。

**Architecture:** Auth 的账号协调 DO 是设备授权、名额和开关的唯一写入入口，设备会话 DO 保存学校会话。现有 CQU_SESSION 继续持有学校凭据并协调邮件验证码，新增设备登录入口但不覆盖课表会话。Chrome MV3 插件通过专用 OAuth grant 访问自己的设备，后台同步 Cookie，让正常学校导航直接出票。

**Tech Stack:** 现有 Auth：TypeScript、Hono、Better Auth / @better-auth/oauth-provider、Cloudflare Workers / Durable Objects / D1 / Containers、React 19、Tailwind 4、Vitest。新插件：TypeScript、Vite、Chrome MV3、Vitest；不另引入扩展框架。

**Spec:** [已确认设计](../specs/2026-09-09-quicklogin-design.md)。本文是实施约定；不把实验材料当正式插件代码。

## Global Constraints

- 仅 Chrome 普通资料，MV3；无痕不支持；不修改 Chrome Cookie 数据库。
- 每安装实例独立 SSO 会话，与课表会话分开；云端与该安装实例共享学校会话。
- 服务端每 1 小时保活；从最后成功 loginAt 起每 7 小时强制重登；离线 7 天暂停维护但不释放名额。
- 插件 5 分钟心跳和版本检查；在线展示阈值 10 分钟；不承诺休眠时准点。
- 网页总开关、插件子开关；名额按 enabled 且未撤销设备计数，包含离线和准备中。
- 额度非负有限整数；降低时保留最近联系设备，超额停用而非撤销。增加额度不自动启用。
- 下载、可恢复写入错误最多分别重试 2 次，等待 1 秒、3 秒；429 遵守 Retry-After；不无限重试。
- 写入成功后学校仍显示登录表单，直接提示手动登录；不再自动下载、重登或刷新。
- 手动模式持久化，继续心跳与云端维护，暂停本地覆盖和自动导航。
- 强制退登实时拒绝旧 grant，不能凭仍有效 JWT 重新注册；不影响其他设备和网页登录。
- 仅导出 sso.cqu.edu.cn / .sso.cqu.edu.cn 的 Cookie，不导出密码、localStorage、业务 Cookie、ST。
- UI 开始前必须读 `emil-ask-emil`，设计、实现、交付前应用 `emil-unslop-design`；每项 UI 任务再次列出路径。
- 不新增后台远程可执行脚本；程序升级通过 Chrome Web Store。
- 不记录令牌、Cookie、学校密码、验证码或含 ticket 的完整 URL；测试使用合成值。
- 此计划授权范围是本地实现与验证。生产额度迁移、部署、商店发布单独执行发布门禁，不因测试通过自动推送 main。

## 从哪里开始

按顺序阅读以下文件，接口约定不得由后续任务自行更名：

1. [接口与状态约定](quicklogin-implementation/contracts.md)：所有任务的公共输入输出、状态、错误和安全边界。
2. [Auth 后端任务 01–09](quicklogin-implementation/backend.md)：额度、授权、设备会话、路由与验证码。
3. [插件与界面任务 10–15](quicklogin-implementation/client.md)：OAuth、后台同步、Cookie、登录页和两端 UI。
4. [迁移与验收任务 16–18](quicklogin-implementation/delivery.md)：切换、完整测试、交接。

依赖顺序固定：01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18。每次只完成一个任务，再检查该任务验收项。不要一次读到任务标题就生成全部代码。

## 当前代码基线与路径

本计划于 2026-09-09 根据 Auth `79026ba` 编写，以下是当前实查结果，不保证未来行号不变。实现开始先比较基线，按符号找代码。

| 简称 | 绝对路径 | 当前状态 |
| --- | --- | --- |
| AUTH | `/Users/uu/Developer/cqu-moe/auth` | 已有 Git 仓库，现有生产系统 |
| EXT | `/Users/uu/Developer/cqu-moe/quicklogin` | 当前不是 Git 仓库；有 docs 与 experiment |

每个任务中的路径以其标明的仓库为根。不要在 EXT 创建 `auth/src` 假实现。若隔离工作区，先用 `superpowers:using-git-worktrees` 为 AUTH 建工作树，再把本表的 AUTH 替换成实际路径。EXT 初始化 Git 时保留文档与实验源码，先排除实验导出、环境变量、构建目录；不得把私密 Cookie 文件提交。

开始执行的只读检查：

```sh
pwd
git -C /Users/uu/Developer/cqu-moe/auth status --short
git -C /Users/uu/Developer/cqu-moe/auth rev-parse --short HEAD
git -C /Users/uu/Developer/cqu-moe/auth config user.name
git -C /Users/uu/Developer/cqu-moe/auth config user.email
```

保留用户已有变更。Git identity 沿用仓库/全局设置，缺失则询问；不要覆盖作者或关闭签名。两个仓库独立提交，不执行宽泛的 `git add .`。每任务末使用明确文件清单提交，提交前检查 staged diff 无秘密。

## 现有集成位置，避免重复造轮子

| 位置（AUTH） | 修改目的 |
| --- | --- |
| `src/index.ts` | 独立挂载设备路由、导出两个新 DO，保留 ASSETS 回退 |
| `src/auth.ts` | 新 scope、专用授权 referenceId 和 JWT claim；保留现有 caps/session 插件 |
| `src/capabilities.ts`, `src/services/entitlements.ts`, `src/routes/admin.ts` | 有限设备额度以及所有管理写路径的协调 |
| `src/routes/cqu-quicklogin.ts` | 网站 session-only 总开关与额度 |
| `src/routes/cqu.ts`, `src/middleware/scope.ts` | 保留原 ticket scope 边界；不把导出权授予 ticket:any |
| `src/durable-objects/cqu-session.ts` | 学校凭据和按账号 OTP 租约，增加独立设备登录入口 |
| `src/services/cqu-browser-routing.ts`, `src/services/cqu-2fa/code-lease.ts` | 设备容器路由复用现有 bootId、验证码队列 |
| `wrangler.jsonc`, `src/types.ts`, `test/do/env.d.ts` | 新绑定及追加 DO 迁移 |
| `frontend/src/pages/Settings.tsx`, `frontend/src/pages/Admin.tsx` | 设置和管理员额度界面 |

不要改写整个 `cqu-session.ts`，不要另建邮件轮询或明文密码表。当前容器上限 5 是运行并发上限，不是用户设备额度，不为了 5 台设备创建 5 个常驻容器。保留 APAC 路由，不恢复已经退役的 node fallback。

## 验证及提交规则

AUTH 工作目录运行：

```sh
npm run typecheck
npm run typecheck:do
npm test -- src/services/quicklogin/policy.test.ts
npm run test:do -- test/do/quicklogin-account.do.test.ts
npm run build:frontend
```

每任务使用文中指定的目标测试；最后任务才跑全量。现有 workerd 测试使用 `vitest.workers.config.mts` 的 `cloudflareTest`，按 `test/do/helpers.ts` 扩展，不照搬旧版 defineWorkersProject。D1 手写迁移，当前最新 `drizzle/migrations/0008_registration_invitation_preset.sql`，若执行时编号已占用则顺延，禁止重写既有迁移或重建数据库基线。

EXT 在任务 10 建立以下脚本：`npm run typecheck`、`npm test -- <path>`、`npm run build`。开发依赖按实际安装版本锁定 lockfile，不在文档里伪造安装后版本。

每个任务都包含先写失败测试、实现、通过测试、提交。失败必须是目标行为未实现，而非导入路径拼错或测试配置坏。代码片段是关键算法与用例，不是允许省略其余分支的成品；所有分支按该任务的输入输出表实现。

## 执行中的停止条件

遇到下列情况，保留当前代码和失败证据，报告具体阻塞；不自行换业务方案：

- 实际 Better Auth 无法通过 referenceId 给同一网页会话的两个插件授权隔离 grant。
- 新验证码任务无法复用现有账号租约，或者设备登录会覆盖课表会话。
- Auth 基线已改为不同身份/容器架构，不能在当前函数上安全接入。
- 生产切换没有管理员明确额度映射；仅暂停发布，继续完成本地可验证工作。
- 完整学校页面登录仍失败；记录实际页面和无秘密诊断，不把 302 出票冒充业务登录验收。

## 完成报告格式

记录两个仓库的分支/提交、各任务是否完成、准确测试命令与结果、未执行的真实环境验证、迁移映射是否已确认、是否部署。不能将“计划写完”“单测通过”“生产完成”混为一谈。交接给新模型时使用：

> 阅读设计文档、本实施计划和 contracts.md，使用 superpowers:executing-plans 从第一个未完成任务开始。每任务按红绿测试执行，保持接口名称与错误码一致，不擅自简化授权、额度协调、验证码租约或 Cookie 所有权检查。当前只实施本地代码与测试，不部署。UI 必须使用计划指定的两个 Emil skills。
