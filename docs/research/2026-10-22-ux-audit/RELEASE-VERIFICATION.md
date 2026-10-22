# QuickLogin 0.5.3 配套上线验收 · 2026-10-22

原 [8 组 UX 修复](FIX-VERIFICATION.md) 已合并并发布。用户标出的开关上方「此浏览器快捷登录」已删除；相同文字仅保留为开关的无障碍名称。下文记录正式包、生产环境与受控回归的不同验收范围。

## 发布来源

| 项目 | 实际结果 |
| --- | --- |
| QuickLogin | [PR #37](https://github.com/cqu-moe/quick-login/pull/37)，检查全绿后合并为 `11cf5d82cab903e24c2e2851def16f16d785989f` |
| Auth | [PR #96](https://github.com/cqu-moe/auth/pull/96)，检查全绿后合并为 `a0ec4651290ef4af74bd419bf7c5e2592ca4559f` |
| Auth Worker | `924cdf57-0edf-43a4-92b8-c769edf25a77`，100% 流量；deployment `c70f09a8-d44a-491a-b534-e96a51a81f51` |
| Auth 构建 | [612b208d-6732-4bcf-a0b2-95cec6016584](https://dash.cloudflare.com/a666c560407022706a52a703923548d5/workers/services/view/cqu-moe-auth/production/builds/612b208d-6732-4bcf-a0b2-95cec6016584)，成功；`RELEASE`、`QUICKLOGIN_SERVER_BUILD` 与公开 capabilities 均读回 Auth 合并提交 |
| 官网 Worker | `a9b8e1be-9bbb-4668-8118-4fd482d60ccf`，100% 流量；deployment `f62d1ad9-55d1-49ec-919e-23c7dc2bc043` |
| 官网构建 | [6df4bb5c-8706-46a3-9591-969d4a7973d7](https://dash.cloudflare.com/a666c560407022706a52a703923548d5/workers/services/view/quick-login-website/production/builds/6df4bb5c-8706-46a3-9591-969d4a7973d7)，成功，来源为 QuickLogin 合并提交 |
| Canary | [发布运行 39782480113](https://github.com/cqu-moe/quick-login/actions/runs/39782480113) 成功，官网元数据为 0.5.3 |

正式文件 `cqu-quicklogin-0.5.3-canary.zip`：**154716 bytes**，SHA-256：

```text
ff79907a2de619ad8c744f569855923e65e6a1884b6a9a857b646ef4fc9eeb2b
```

认证下载为 200，匿名请求为 401；实际点击官网「下载」也取得同一文件。ZIP CRC、14 个运行文件、manifest 0.5.3、build-info 来源、协议 v3 和 digest 均通过，下载包与主分支 CI 包逐字节一致。正式包独立保存在 `releases/published/0.5.3/`，未覆盖旧的本地候选。

官网浏览器实际加载的 `main-VGacn2Ln.js`、`main-CAF5D6_I.css` 和 modulepreload 脚本与 CI 字节一致。下载页展示相同版本、文件名、摘要及 `/settings/cqu` 管理入口。原始 HTTP 客户端被 Cloudflare challenge 拦截的部分，已由正常浏览器完成实际读取。

## 回归与 CI

- 扩展最终修复通过 226 项测试，以及类型、构建、契约、发布工具、包和官网检查。
- QuickLogin [PR 常规检查](https://github.com/cqu-moe/quick-login/actions/runs/39778767037)和[四组、各两轮原生 MV3 E2E](https://github.com/cqu-moe/quick-login/actions/runs/39778767065)全部通过；合并提交的[常规检查](https://github.com/cqu-moe/quick-login/actions/runs/39782480065)和[完整 E2E](https://github.com/cqu-moe/quick-login/actions/runs/39782480069)也全部通过。
- Auth [PR CI](https://github.com/cqu-moe/auth/actions/runs/39773384980)通过，迁移后本地默认测试 984 项、Workers 测试 460 项。合并时包含主分支另一个容器空闲回收修复；[合并提交 CI](https://github.com/cqu-moe/auth/actions/runs/39781515592)的应用、容器、学校、OAuth、注册/会话及最终汇总全部通过。注册/会话组原样受控重跑后完成两轮、失败控制和产物检查。
- 正式下载包通过浅深主题原生工具栏弹窗检查：390×468，无横向或纵向溢出，进程及临时目录清理通过。报告 `.e2e/launcher-smoke-1792673923630/report.json`。
- 正式包与最终 Auth 提交 `a0ec465` 的隔离联调通过新登录和原设备重连 2 个用例，并完成清理；证据 `.e2e/published-main-pair-053/`。它们不代替下方的生产浏览器验证。

## 生产浏览器验证

用户在浏览器目录选择器中加载已核验的正式 Canary 后，确认运行版本为 0.5.3、安装 ID 为 Canary ID。商店版 0.5.1 仍同时安装。

| 场景 | 观察结果 |
| --- | --- |
| 首次连接 | `未连接 Auth → 正在连接 Auth → 正在准备学校登录 → 正在保留已有学校登录`。连接和准备期间没有插入关闭状态；已有 Cookie 未被自动覆盖 |
| 可见文字与键盘 | 开关上方说明已消失；开关仍有无障碍名称，Space 可操作 |
| 关闭与重新开启 | 鼠标关闭后标题为「此浏览器已关闭快捷登录」，开关未勾选；重新开启进入准备状态。关闭时现有学校 Cookie 值保持不变 |
| 生产原设备重连 | 仅移除本次新建 Canary 的本地 token 模拟丢失，经扩展进入 Auth `/settings/cqu` 并点击「重新连接」。最终授权恢复，设备和安装身份不变，没有新增设备；商店版和 Canary 共存时选中了正确实例 |
| 重连反馈 | Auth 显示「已请求重新连接。请在打开的 Auth 授权窗口中完成操作，然后查看插件状态。」没有用请求已接收代替连接成功 |
| 显式切换 | 点击「切换到快捷登录」后，本地和服务端 receipt 均为 `applied`，export 一致、acknowledged 非空、pendingAck 为 false、writeState 为 ready，界面才显示「已就绪」 |
| 真实学校访问 | 用同步后的学校会话访问统一认证，进入 `self.cqu.edu.cn` 个人中心，没有可见密码登录表单 |
| Auth 布局 | 1728px 桌面和 390px 窄屏无横向溢出，设备操作按钮高度至少 44px |
| 官网安装路径 | 生产下载页、正式包版本/摘要、Auth 管理链接及实际点击下载均通过；展开 FAQ 核对学校验证、密码更新、手动模式及就绪说明 |

浏览器里另有一个原先存在的学校登录页，Cookie 会继续变化；出现缺失或指纹变化后，扩展按所有权规则回到「正在保留已有学校登录」，不擅自夺取登录。已保留准确的就绪瞬间回执和实际学校跳转证据，不把「已就绪」描述为之后永远不变。

密码错误、名额不足、账号总开关、首次手动输入、超时和迟到结果等异常分支由原组件浏览器矩阵、单测及隔离真实 MV3/Auth/学校容器回归覆盖。未在生产账号上修改学校密码、解绑账号、关闭其他设备或故意制造验证码/封禁。商店安装版的现场重连未验证；本次真实重连对象是 Canary。

已归档 [就绪回执和标题序列](release-0.5.3-browser.json)、[官网资源比对](release-0.5.3-website-assets.json)与[正式弹窗截图](release-0.5.3-popup-ready.png)。本地完整证据位于 `.e2e/published-053/`。不保存 token、Cookie 值、学校账号、原始个人页面或 HAR。

## 商店状态

[自动商店 CD 39782665499](https://github.com/cqu-moe/quick-login/actions/runs/39782665499) 成功执行，但结果为 **WAITING_REVIEW**：0.5.2 仍在审核，0.5.3 尚未上传、送审或上架。保留原审核和 Unlisted，未手动撤审。

0.5.3 签名候选 CRX 为 156800 bytes，SHA-256 `bf1ff2d012bc0d315a1e5769766337efbcaccd0bf8f040528ed883e0b20a3cc6`；这是准备产物，不是商店已发布证明。

## 首败和验证边界

- 旧候选设备用例缺少账号总开关/设备启用前提，已补齐现有 helper 的准备步骤，保留迟到刷新和代际取消断言；最终 PR 和主分支两轮全通过。另一次旧候选 Chromium 在业务前未建立 CDP，失败证据保留。
- Auth PR 的首次学校组第二轮业务及清理通过，但敏感信息扫描隔离产物（artifact `12425590633`）；未放宽规则，原样受控重跑后业务、清理、扫描和 CI 全通过。
- 本地补充扫描复现的扫描本身通过；移动端某次隔离容器启动失败导致业务/清理失败，记录在 `.worktrees/auth-ux-release/.e2e/school-artifact-repro-053/`，没有将该运行记为通过。
- Auth 合并提交的注册/会话组安装浏览器依赖耗时约 11 分钟，第一轮完成，第二轮在 25 分钟 job 上限被取消；保留原失败，未改变超时或断言，仅原样重跑该组。第二次完成全部检查和 CI 汇总。
- 第一次官网点击下载时页面重新获得焦点并刷新资格，自动化未捕获下载；等待资格恢复后实际点击成功、返回 200，文件与正式包一致。
