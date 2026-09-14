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
