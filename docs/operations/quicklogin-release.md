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

2026-09-11 canary 构建为 `releases/cqu-quicklogin-0.1.2-canary.zip`，只包含 `dist/`，对应扩展提交 `09e0158`，SHA-256 为 `498d2c45ee7b24b5f4cf37042aa9ed3e4bc4a1cca896df7489180d620e44fa1f`。该文件未上传到商店；它固定使用 canary 扩展 ID。
