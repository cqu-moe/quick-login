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

# QuickLogin 0.2.3 Cookie 导出与任务恢复修复（2026-09-15）

- 插件源码：`683081ad9b38b43219d024916b9a4f193f040efc`。
- Auth 源码：`cb4389300e261996551ffac79450c2f66277af5d`。
- [生产 CI](https://github.com/cqu-moe/auth/actions/runs/34976675384)：成功。
- Worker：`22014c4d-c283-4f5f-b12d-557ec2d4ee74`，100% 流量。Container 68 / `22014c4d`，5 healthy、0 failed，无活动 rollout 或 health.errors。
- 安装包：`releases/cqu-quicklogin-0.2.3-canary.zip`，23022 字节，8 个 dist 文件。
- SHA-256：`046cfbb810f7379a366f5a6b882374f46230f7758eba1bb00227e909af021770`。
- 契约指纹：`0263d6f205e113cdc2da8661f2fdf8c7e5b52b5a41045b90633d8d5989625a38`，协议仍为 3。
- ZIP CRC、manifest 0.2.3 和源码标识已核验。旧包均保留；未上传或发布 Chrome Web Store。

容器现在导出完整会话 Cookie；Auth 对登录结果处理异常及时结束任务，并恢复符合条件但缺失的调度。插件补齐 queued 且无 operationId 时的 ensure_session 请求；已有任务、未来冷却时间或 canEnsure=false 均不会触发。已安装的 0.2.1 使用同一 Cookie 服务修复，但无任务恢复需要更新至 0.2.3。无需卸载或新建设备。

本地验证：Auth 850 单元测试、284 DO 测试、两套类型检查；Container 368 测试及 13 subtests；插件 69 测试、typecheck、build、check:package 全部通过。生产者与消费者共享 Cookie fixture，独立复核无阻塞发现。

实际读回：22:01，Ego 原设备在新容器上完成登录，cloud=ready、Cookie=applied、ACK 成功；未更换设备身份。用户 Chrome 仍为 0.2.1、queued 且无任务，需更新 0.2.3 并重载后验证客户端恢复分支。尚未证明两台设备均通过实际学校业务页面验收。

详细证据见 [准备登录故障记录](quicklogin-023-preparing-incident.md)。

## 历史发布记录

# QuickLogin 0.2.1 发布与验收（2026-09-15）

## 已交付

- 插件源码：`6a4be4289d380c12b92f27c388cdbe41deab5a4c`，已推送 `quick-login/main`。
- Auth 源码：`0f640b52d78ff9425dd978a238cc1e1fbc390ab8`，已推送 `auth/main`。
- [生产 CI](https://github.com/cqu-moe/auth/actions/runs/34964465904)：成功；检查、迁移、部署均完成。
- Worker：`d6bd0feb-bc91-4dff-b074-e1b57c8e12f5`，100% 流量。
- Container：版本 67，当前镜像标签 `d6bd0feb`，5 healthy / 0 failed，health.errors 为空。
- 健康、capabilities、overview 均 HTTP 200；protocolVersion=3，serverBuild 与上述 Auth 提交一致。
- 安装包：`releases/cqu-quicklogin-0.2.1-canary.zip`，22986 字节，仅含 dist 的 8 个文件。
- SHA-256：`e811fe778471c99f40fdf1cff2d2cbcc5b230d109765f2f82e44003e60cc9258`。
- 契约指纹：`0263d6f205e113cdc2da8661f2fdf8c7e5b52b5a41045b90633d8d5989625a38`。
- ZIP 内容、CRC、manifest 版本和 build-info 源码提交均已核验。旧 0.2.0 包保留，未覆盖。
- Chrome Web Store：未上传、未发布。

## 验证结果及实际边界

| 项目 | 结果 |
| --- | --- |
| 插件 | 65 测试、typecheck、build、check:package 通过 |
| Auth | 849 单元测试、281 DO 测试、两套 typecheck、API/边界检查、API lint、前端 lint/build 通过 |
| Container | 365 个测试通过；13 种实际 raw-CDP 失败格式贯穿生产响应与 Worker 消费测试 |
| 独立审查 | 协议、跨仓库整合及所有具体修正复审通过 |
| 既有 Ego 安装升级 | 实际运行 0.2.1/sourceCommit 与包一致；deviceId、授权及 schema 2 保留，设备数仍为 2 |
| 真实学校自动登录 | **未通过**：交付读回为 `retry_wait / VERIFICATION_COOLDOWN`（等待验证恢复），尚无当前 Cookie 的成功 ACK，不能据此声称已进入学校业务页面 |
| 用户 Chrome | 未控制、未自动重载；需用户从最终包更新原安装目录 |

Ego 的普通扩展标签页不等于原生 action popup；该测试环境无 active browser window，不能用其调试标签页标题证明真实 Chrome 弹窗。此次以实际后台存储、服务器快照和包 provenance 核验升级；UI 有自动化与实际组件预览证据。学校登录成功与 Cookie 回执仍是独立业务门禁。

当前实现已把上游返回的验证码、凭据、人工验证和超时错误分类，并保留正确的等待/人工处理状态；这不等于校方登录已经恢复。后续排查入口见 [运行状态交接](quicklogin-021-runtime-status.md)。

## 安装

已有插件无需卸载：把新包内容解压覆盖原加载目录，然后在扩展管理页点击“重新加载”。根目录应直接包含 manifest.json。不要并行加载另一份副本。

原始主目录 dist 在用户更新前保持旧安装内容，避免运行中的旧后台与新弹窗混用；交付文件以上述版本化 ZIP 为准。

## 本次主要行为

- 共用协议、状态及错误定义；Auth 主学校会话、设备会话、浏览器应用回执分开表达。
- generation/绑定/凭据/会话版本完整校验，网络错误不再冒充未绑定。
- 作业与验证码租约持久化，旧任务、旧保活和旧回执不能覆盖新意图。
- 实际容器错误被规范化；设备 CAPTCHA 不污染其他设备或全局凭据，手动登录先停止自动写入。
- 设备行仅保留名称、一个状态、一行版本/联系信息；退出后果仅在确认时显示。

## 历史发布记录（不代表当前状态）

# QuickLogin 发布门禁

本文只描述发布顺序，不授权部署、生产写入或 Chrome Web Store 上传。所有命令先在测试环境执行；任何一步读回不一致都停止，不继续切换 mode。

## 发布前资料

- 保存脱敏的旧资格与总开关清单，只含用户 ID、旧 access/master 值和更新时间。
- 管理员逐用户确认设备额度映射。`0` 是有效决定；缺项不是 `0`，必须阻止 apply。
- 确认正式扩展 ID、公开 `clientId`、固定 `https://<extension-id>.chromiumapp.org/` 回调和 `chrome-extension://<extension-id>` Origin。
- 备份当前 Worker 配置和 D1 元数据；不导出密码、Cookie、OTP、token 或 ticket URL。

额度映射格式：

```json
{
  "schemaVersion": 1,
  "migrationId": "quicklogin-devices-2026-09-09",
  "users": [
    { "userId": "synthetic-user-a", "deviceLimit": 3 },
    { "userId": "synthetic-user-b", "deviceLimit": 0 }
  ]
}
```

示例用户是合成值，不代表生产决定。

## 固定顺序

1. 部署兼容后端，保持 `QUICKLOGIN_DEVICE_MODE=off`。此时设备 API 返回 `503 TEMPORARY_UNAVAILABLE`，旧网页开关和广路径 ticket 仍读旧策略，设备维护 alarm 会停止。
2. 通过 Better Auth 管理模型登记官方 public OAuth client；核对 `requirePKCE=true`、`skipConsent=false`、`tokenEndpointAuthMethod=none`、授权码与 refresh grant、固定回调、`cqu:quicklogin:device` scope 和 official metadata。相同配置重跑只读回，不新增 client。
3. 运行迁移 dry-run，核对总人数、缺失映射、冲突用户、每位用户旧 master 与新额度。保存 preview hash。
4. 由管理员明确确认完整映射。存在 `missingMapping` 时不得 apply。
5. 使用受控 Auth 内部 runner 调用 `initializeQuickloginPolicy`，逐用户读回；同一 `migrationId` 和输入可重跑，不同输入必须走常规 quota preview/apply。
6. 部署新版 Auth UI 和未打包发布的扩展内测构建，仍保持 mode off，检查旧登录、课表、验证码租约和网站会话。
7. 仅在前述读回一致后把 `QUICKLOGIN_DEVICE_MODE` 切为 `on`。从此账号协调器是授权、额度与总开关唯一权威；DO 读取失败不得回退旧布尔值。
8. 执行 `docs/acceptance/quicklogin.md` 的新旧业务回归。失败则停止商店发布。
9. 经过单独发布批准后才上传 Chrome Web Store 包。不得从本仓库步骤自动上传。

## 回退

把 mode 关闭会停止新设备 API 与云端维护，旧策略重新服务旧 ticket/开关路径。回退不自动撤销学校 Cookie，也不保证清除浏览器本地会话；需要单独说明用户影响。保留已迁移的账号 DO 状态、grant 墓碑和设备记录，不删除或重置；再次开启 mode 后，仍有效的开关和设备可以在下一次心跳恢复维护。

回退是生产配置变更，必须另行获得发布授权。本地测试通过不构成回退或上线授权。

## 当前门禁状态

- canary 额度映射：`PASS`（唯一旧 QuickLogin 用户，显式额度 5，保留旧 master=true；preview 无缺失/冲突）
- canary OAuth client 登记：`PASS`（固定 public clientId、PKCE、精确回调与 Origin 已读回）
- Auth 部署与 mode 切换：`PASS`（Worker 版本 `0eefd288-6ecd-44db-8bd3-88eb7da9f479`，mode=on）
- Chrome Web Store 发布：`NOT RUN`

## 本地候选包

2026-09-15 generation reconciliation 协议 v2 构建为
`releases/cqu-quicklogin-0.1.4-canary.zip`，只包含 `dist/`，对应扩展提交
`974d703`，SHA-256 为
`68946df7d2c230b8c1f233aa900bc5e277f4205224c9402fc3c33e96e4fcb94c`。
配套 Auth 提交为 `b5ebf82`，生产 Worker
`bdbb2023-62a7-439b-861a-22f0863a73d5` 已接管 100%。status 心跳改用
`observedGeneration`：旧观察值仍返回当前状态并更新在线信息，但不会接受旧
`appliedVersion`。refresh/export 继续要求当前 generation。协议 v1 不兼容，使用前必须
更新到扩展 0.1.4；未上传 Chrome Web Store。

2026-09-13 API v1 构建为 `releases/cqu-quicklogin-0.1.3-v1.zip`，只包含
`dist/`，对应扩展提交 `39377c0`，SHA-256 为
`683449397ce213858bd01576a0ca91c422b4d2769e08aa9bb21c92dccd30417a`。
它固定使用 `/api/v1` OAuth/device 路径和稳定 issuer audience；未上传商店。

2026-09-11 canary 构建为 `releases/cqu-quicklogin-0.1.2-canary.zip`，只包含 `dist/`，对应扩展提交 `09e0158`，SHA-256 为 `498d2c45ee7b24b5f4cf37042aa9ed3e4bc4a1cca896df7489180d620e44fa1f`。该文件未上传到商店；它固定使用 canary 扩展 ID。

2026-09-16 PostHog 本地候选构建为
`releases/cqu-quicklogin-0.3.0-canary.zip`，只包含 `dist/`，对应扩展提交
`8bb2cb634729f090af18a118be403abacc2dc7eb`，SHA-256 为
`c55434507cab339d18c0e6e23346810d3a920fd1694f34cf2bef8c0962e9910e`。
ZIP 完整性、manifest 0.3.0、build-info 提交、typecheck、83 tests、build 和
package gate 均通过。该构建从已验证的 PostHog US 项目 `608620` 动态读取公共项目
token，采集 host 为 `https://us.i.posthog.com`。仍需完成 unpacked extension Reload
和真实操作采集验收；未上传 Chrome Web Store。
