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
