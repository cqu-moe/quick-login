# QuickLogin 0.3.4 授权恢复与开关修复（2026-09-28）

- 扩展源码提交：`62c79f9aedac5a4da632b0bb6c83fae507a35a92`（隔离分支 `codex/quicklogin-auth-recovery`，未推送或合入 main）。
- 安装包：`releases/cqu-quicklogin-0.3.4-canary.zip`，122678 字节，仅含 8 个 dist 文件。
- SHA-256：`993204a2c3ea4daf888b1a07ac3132f8f3ff96198bc9eef64914afd4e5c0877b`。ZIP CRC、文件清单、逐文件内容、manifest 版本与 build-info 源码提交均已核验。
- 根因：Auth QuickLogin refresh 校验钩子使用 `code: INVALID_GRANT`，扩展仅识别 OAuth 标准的 `error: invalid_grant`，误报网络故障。现兼容两种格式，提示前往 Auth 恢复原设备，停止重复刷新失效授权。
- 本地关闭而服务端快照仍开启时，`canEnable=false` 不再锁死重新开启；确实无法开启时保留 Auth 入口。禁用开关不再显示等待鼠标。
- 验证：19 个测试文件 / 88 项测试、typecheck、build、check:package 通过；新增回归在修复前失败，修复后通过，包含真实外部消息到 OAuth、原设备注册、重新开启与同步（仅浏览器 API/HTTP 使用合成数据）。独立代码复核通过。
- 测试存在上游 posthog-js source map 警告，基线亦存在，不影响通过结果。
- Auth 代码未修改或部署。未操作用户 Chrome、未覆盖已加载目录、未重载扩展、未上传或发布 Chrome Web Store。实际浏览器重连与学校登录仍待升级后验证。
- 使用方式：解压并覆盖原加载目录，在 Chrome 扩展管理页重载，随后在弹窗点“前往 Auth”恢复原设备授权；不要卸载重装。
- 本次合成 token 在线格式探测被 Cloudflare 403 挑战拦截；错误格式依据 Auth 源码确认，未声称完成线上授权验收，也未确定用户 token 最初失效的具体原因。

## 历史记录

# QuickLogin 0.2.5 弹窗稳定性修复（2026-09-15）

- 源码 `486b334af778a1bf4f09e7e84d4e37e4cc37e426`；安装包 `releases/cqu-quicklogin-0.2.5-canary.zip`，23290 字节，8 个 dist 文件。
- SHA-256 `db56cb0dc3e88809a65e0a8ad129e3aea2f567a1ddb31907aebca55fa3fdca81`；manifest、源码标识、ZIP CRC 均通过核验，旧包保留。
- 例行 Cookie 续验保留已确认回执状态，不再每次标为 pendingAck；首次同步仍等待 ACK，服务端拒绝匹配回执时清空并重新导出。状态区不再重复淡入或上下移动。
- 81 项测试、typecheck、build、check:package 和独立复核通过。回归在旧实现中复现轮询把 ready 变为 pending_ack；修复后保持 ready，并覆盖首次 pending 和拒绝回执恢复。
- Auth 本次未改动、未部署；协议和存储格式不变。用户 Chrome 未操作，覆盖原目录并重载后生效；原生弹窗视觉验收待该安装更新。未上传 Chrome Web Store。

## 历史记录

# QuickLogin 0.2.4 切换授权修复（2026-09-15）

- 插件源码：`3fbc350e64a9ed6fc8ddbd1a6d363967da880b4e`。
- 最终包：`releases/cqu-quicklogin-0.2.4-canary.zip`，23293 字节，仅含 8 个 dist 文件。
- SHA-256：`30182b9775189890f0e88ed9e0d980c7f16f6e9ddc53cd1f4b41b3ef8fbf5fce`。
- 协议仍为 3，指纹 `0263d6f205e113cdc2da8661f2fdf8c7e5b52b5a41045b90633d8d5989625a38`；本地 schema 2 增加可选切换记录，旧安装不需要重建身份。
- Auth 本次无改动、无再次部署；线上源码读回仍为 `cb4389300e261996551ffac79450c2f66277af5d`。

“已有学校登录”是本地 Cookie 归属保护，不代表账号异常。已复现旧的一次覆盖授权在云端 sessionVersion 更新时失效，以及等待下一轮同步时丢失。现将切换记录保存 15 分钟，绑定设备、授权、学校绑定及用户操作版本；同一绑定的会话更新可以继续。关闭开关、手动模式、改绑、重新授权或到期会取消；写入成功时与 Cookie 所有权记录一起原子消耗，后台重启不会重复使用。

78 项测试、类型检查、构建、包检查和独立复核通过。回归覆盖先失败后通过、跨等待与后台模块重启、取消边界、真实 Cookie writer 的一次消耗，以及后来手动登录不被再次覆盖。ZIP CRC、版本及源码标识已核验。

本次只读线上检查时，两台既有 0.2.3 设备均 cloud ready / Cookie applied / ACK 成功；这是服务端事实，不能据此认定用户原生弹窗切换流程通过。0.2.4 尚待用户覆盖原目录并重载验证，未操作用户 Chrome、未修改学校 Cookie；未上传 Chrome Web Store。

## 历史记录

# QuickLogin 0.2.3 交接

当前修复：Auth `cb4389300e261996551ffac79450c2f66277af5d`，EXT `683081ad9b38b43219d024916b9a4f193f040efc`。包为 `releases/cqu-quicklogin-0.2.3-canary.zip`，SHA-256 `046cfbb810f7379a366f5a6b882374f46230f7758eba1bb00227e909af021770`。

Worker `22014c4d-c283-4f5f-b12d-557ec2d4ee74`（100%）与 Container 68（5 healthy）已上线。Ego 原设备 cloud ready / Cookie applied / ACK 已成功；Chrome 0.2.1 仍需更新至 0.2.3 并重载，无任务恢复尚待该设备读回。详见 [发布记录](quicklogin-release.md)。本次已复现 Cookie 导出缺字段、结果处理异常未结算任务和无任务设备缺失调度。证据与修复范围见 [故障记录](quicklogin-023-preparing-incident.md)。

用户 Chrome 未操作。0.2.1 使用同一 Cookie 后端修复，但无任务恢复需要 0.2.3；更新包时覆盖原加载目录并重载，保留现有设备身份。

## 历史交接

# QuickLogin 0.2.1 最终交接

源代码已合入并推送两个 main；Auth 已完成生产部署；最终安装包为 `releases/cqu-quicklogin-0.2.1-canary.zip`。确切提交、Worker/Container、SHA-256 和验证结果统一见 [发布记录](quicklogin-release.md)。

**尚未通过学校自动登录业务验收。** 实际 Ego 无损升级和服务端状态对账已确认，设备目前“等待验证恢复”，尚无新版 Cookie ACK。不要把部署成功、健康 200 或测试通过表述成学校已自动登录。

后续工作的具体观测和验收条件见 [运行状态交接](quicklogin-021-runtime-status.md)。用户 Chrome 未操作，升级应覆盖原加载目录并重载，保留设备身份；不要卸载重装来绕过问题。

## 历史实施交接

# QuickLogin 实施交接

交接时间：2026-09-11（Asia/Shanghai）

## 2026-09-15 协议 v2 更新

- 根因：网站总开关关闭再开启会令每个启用设备的 generation 前进两次；0.1.3 的
  status 心跳把本地 generation 当作必须相等的写栅栏，409 `STALE_GENERATION` 后又不
  获取服务器当前值，形成永久重试循环。
- 新协议：status 请求字段为 `observedGeneration`。服务端始终返回当前
  `DeviceStatus`；观察值过期时仍更新 lastSeen/IP/browserVersion，但保留服务器已有
  appliedVersion。只有观察值等于当前 generation 时才接受客户端 appliedVersion。
- refresh/export 仍使用精确 generation/sessionVersion fence；OAuth grant、设备 ID、
  Cookie 所有权和验证码租约均未放宽。
- Auth：`b5ebf82`；生产 Worker
  `bdbb2023-62a7-439b-861a-22f0863a73d5`，100% 流量。
- EXT：`974d703`，版本 0.1.4，协议版本 2。
- 安装包：`releases/cqu-quicklogin-0.1.4-canary.zip`；SHA-256
  `68946df7d2c230b8c1f233aa900bc5e277f4205224c9402fc3c33e96e4fcb94c`；只含 7 个
  dist ZIP 条目，完整性检查通过，未上传商店。
- 自动化：Auth 85 files / 741 tests、DO 22 files / 217 tests；EXT 14 files /
  47 tests、typecheck、build、package check 通过。
- 待真实验收：在 Chrome 加载 0.1.4 后，status 应由 409 变 200，服务器返回当前
  generation，插件写回 Cookie 后 Auth 设备列表应恢复 online。该步骤不能用本地测试替代。

## 仓库与提交

Auth 工作树：`/Users/uu/Developer/cqu-moe/auth/.worktrees/quicklogin-implementation`

分支：`codex/quicklogin-implementation`

| 任务 | Auth 提交 |
| --- | --- |
| 01 | `1afcaff`；测试夹具修正 `22c6508` |
| 02 | `46bea1f` |
| 03 | `4e3f6e3` |
| 04 | `032f04b` |
| 05 | `ceae178` |
| 06 | `e17b08a` |
| 07 | `bfde2ca` |
| 08 | `d0638bd` |
| 09 | `cd65938` |
| 15 | `f56164d` |
| 16 | `9a9f555`；canary 配置 `0f0064e`、受控设置 `a2d6473`、mode on `4e25cd8` |
| 17 | `442125e` |
| 生产修复 | OAuth 本地 JWKS 验签 `60e7c8f`；空值 Cookie 占位过滤 `11a2f2b` |

扩展仓库：`/Users/uu/Developer/cqu-moe/quicklogin`

分支：`codex/quicklogin-implementation`

| 任务 | EXT 提交 |
| --- | --- |
| 10 | `5aa9ea7` |
| 11 | `1470f99` |
| 12 | `d77f808` |
| 13 | `939c8b5` |
| 14 | `613cb98` |
| 16 | `1db9532` |
| 17 | `c11378a` |
| 18 | `420cb61`；canary 固定 ID `24403fd`；部署后记录见本文后续提交 |
| 生产修复 | 保存 grant 重试 `b5ca451`；host-only 查询 `4dae89a`；Cookie 精确读回 `855ab9e` |

## 本地验证

EXT：

```text
npm run typecheck       PASS
npm test                PASS — 13 files, 40 tests
npm run build           PASS — background/content/popup/manifest
npm run check:package   PASS — 6 files, 3 manifest references
```

Auth：

```text
npm run typecheck       PASS
npm run typecheck:do    PASS
npm test                PASS — 55 files, 493 tests
npm run test:do         PASS — 12 files, 123 tests (exit 0)
npm run build:frontend  PASS — 206 modules
```

`npm run test:do` 会打印 `CquLoginContainer` 在本地 workerd 未启用的 uncaught exception。单独运行既有 `test/do/cqu-session.do.test.ts` 可复现，同样 62/62 通过且退出 0；它是当前容器测试夹具的已知噪音，不作为真实容器或生产通过证据。

## 发布包

- API v1 本地包：`releases/cqu-quicklogin-0.1.3-v1.zip`
- API v1 版本提交：`39377c0`
- API v1 SHA-256：`683449397ce213858bd01576a0ca91c422b4d2769e08aa9bb21c92dccd30417a`
- API v1 验证：14 files / 46 tests、typecheck、build、package、ZIP integrity 与旧路径静态扫描通过；未上传商店

- 文件：`releases/cqu-quicklogin-0.1.2-canary.zip`
- 内容：仅 `dist/` 的 7 个 zip 条目（6 个文件和 `assets/` 目录）
- 对应扩展提交：`09e0158`
- SHA-256：`498d2c45ee7b24b5f4cf37042aa9ed3e4bc4a1cca896df7489180d620e44fa1f`
- 上传：未执行

## 设计条款覆盖

| 设计条款 | 实现任务 | 自动化/实测状态 |
| --- | --- | --- |
| 独立 SSO、主会话保护、共享 OTP 租约 | 05–07 | DO/unit PASS；A16 NOT RUN |
| grant 隔离与即时撤销 | 02、03、08、09 | provider/DO PASS；A11/A12/A17 NOT RUN |
| 额度、层级开关和降低预览 | 01、02、04、15、16 | unit/DO/UI build PASS；A10/A13/A14 NOT RUN |
| 心跳、可信 IP 和离线策略 | 07、08、11、15 | fake-clock/unit PASS；A18 长期观察 NOT RUN |
| Cookie 完整性、归属与中断恢复 | 01、11、12 | 合成故障测试与 Ego Lite 实际写入 PASS；A04/A08/A09/A15 NOT RUN |
| 学校状态、有限重试与手动模式 | 11、13、14 | unit/UI build 与 A02 Ego Lite PASS；A03/A05/A06/A07 NOT RUN |
| 指定 UI skills 与退出提示 | 13、14、15 | 代码复查与 Ego Lite popup 实测 PASS；完整键盘验收 NOT RUN |
| 升级、协议和明确迁移 | 10、16–18 | package/fixture 与生产迁移 PASS；商店发布 NOT RUN |

## Canary 部署状态

- 生产 D1 迁移 `0009_quicklogin_devices.sql`：已应用。
- 唯一旧 QuickLogin 用户：preview-hash 初始化为 master=true、额度 5，读回 used=0。
- canary OAuth client：`cqu-quicklogin-chrome`，扩展 ID `igfidegfgfoofnoncpmbcokbffjmmook`，固定回调/Origin/PKCE 配置已读回。
- Auth Worker：版本 `0eefd288-6ecd-44db-8bd3-88eb7da9f479`，`QUICKLOGIN_DEVICE_MODE=on`。
- 瞬时失败重试：Auth `d54142b`；前 5 分钟每 1 分钟，5–30 分钟每 3 分钟，30 分钟–2 小时每 5 分钟，之后 10、20、30 分钟并封顶 30 分钟；生产健康端点已由浏览器读回 `status=ok`。
- WAF/JWKS 修复：Auth `60e7c8f`；空值 Cookie 占位过滤：Auth `11a2f2b`；保存 grant 重试注册：EXT `b5ca451`；Cookie 精确读回：EXT `855ab9e`。
- 真实 Chrome 已验证 token 兑换 200、修复前设备注册 401；修复部署并重新加载后复用同一保存 grant 注册成功，未再次弹授权页。
- Auth 权威列表读回 `used=2 / deviceLimit=5`，Google Chrome 与 Ego Lite Chromium 152 两个设备在线、子开关均已启用。
- Ego Lite 独立 TaskSpace 完成真实 OAuth、设备注册、云端 ready 与本地 Cookie 写入；弹窗显示“快捷登录已准备”。
- 同一 Ego Lite 会话访问学校 CAS 后到达 `https://my.cqu.edu.cn/workspace/cas`，页面标题“智慧教务 - 重庆大学”，未出现学校登录表单。

## 仍未通过的发布门禁

- Google Chrome 最终扩展构建复测、跨 tab、外来会话和重启升级：`NOT RUN`；Ego Lite Chromium 152 的加载、授权、Cookie 同步与学校业务落地已通过。
- 1 小时保活、7 小时重登、离线 7 天的真实时长观察：`NOT RUN`。
- Chrome Web Store 上传/发布：未执行。

Canary 后端与 Ego Lite Chromium 实际路径已通过；Google Chrome 最终构建复测、长期观察和商店发布仍未完成。

## 2026-09-16 PostHog 0.3.0 候选

- 实现提交：`bc54201760d3314aa80b6831b5d354133ac47802`
- 构建来源提交：`8bb2cb634729f090af18a118be403abacc2dc7eb`
- 本地包：`releases/cqu-quicklogin-0.3.0-canary.zip`
- SHA-256：`c55434507cab339d18c0e6e23346810d3a920fd1694f34cf2bef8c0962e9910e`
- 包内容：仅 `dist/`，ZIP integrity、manifest 0.3.0 与 build-info commit 已核对
- 自动门禁：typecheck、18 files / 83 tests、build、package 全部通过
- PostHog 配置：已从 US 项目 `608620` 动态读取公共项目 token 构建，采集 host 为 `https://us.i.posthog.com`
- 真实验收：unpacked Reload、连接/同步/Cookie 应用事件与异常回读均 `NOT RUN`
- Chrome Web Store：未上传、未发布

## 2026-09-16 PostHog 0.3.1 CSP 修复

- 修复提交：`9631cf176a085b2b9167a48f24ae45e29ee424bd`
- 本地包：`releases/cqu-quicklogin-0.3.1-canary.zip`
- SHA-256：`0fd1e571c07c4e1bd400dc4e784276b6ebf3ba5e9ae1ac7b4a655cfd865dac92`
- 根因：0.3.0 增加 PostHog CSP 时，`connect-src` 漏掉 `https://auth.cqu.moe`，导致 capabilities、token、registration 和 reconcile 请求被 Chrome 在扩展内部拒绝
- 修复：CSP 精确允许 `self`、`https://auth.cqu.moe`、`https://us.i.posthog.com`；打包门禁新增精确 CSP 断言
- 自动门禁：typecheck、18 files / 83 tests、build、package、ZIP integrity 全部通过
- 真实验收：需要在 `chrome://extensions` 对现有 unpacked 扩展点击“重新加载”后再测试开关；未上传、未发布 Chrome Web Store

## 2026-09-16 PostHog 0.3.2 远程配置修复

- 修复提交：`1c7de1a58e364cd8a128cbbc3b77f715e5fd3c01`
- 本地包：`releases/cqu-quicklogin-0.3.2-canary.zip`
- SHA-256：`b8b16dc4c164dcfbeb0e9ac1ba90476818e3addd86fa6e82ebf8293314ea603a`
- 根因：`advanced_disable_feature_flags` 不会关闭 PostHog `/array/<token>/config` 远程配置请求，因而被精确 CSP 拒绝
- 修复：改用当前 SDK 的 `advanced_disable_flags=true`，扩展不再请求 flags/remote-config；package gate 直接检查源码配置
- 自动门禁：typecheck、18 files / 83 tests、build、package、ZIP integrity 全部通过
- 当前 Chrome unpacked 目录已备份 0.3.1 并原位更新为 0.3.2；仍需点击 Reload 验证实时开关
