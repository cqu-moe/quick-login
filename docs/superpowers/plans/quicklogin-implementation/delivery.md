# Migration and Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供可预览、可重跑的权限迁移，验证实际用户路径，并给下一位执行者留下准确交付记录。

**Architecture:** 先准备兼容版本和明确额度映射，再开设备模式；授权权威始终在账号协调器。程序和学校会话更新分别验收。

**Tech Stack:** 现有 Auth 管理 API、D1 migrations、Chrome unpacked内测和Web Store发布包。

**Spec:** `../../specs/2026-09-09-quicklogin-design.md` 与 `contracts.md`。

## Global Constraints

继承主计划全部约束。真实账号测试不在此文保存密码、Cookie、OTP或token。五会话已有短测可复用，不为了计划再跑一次。当前计划不授权自动部署或公开发布；发布门禁缺资料时完成所有本地工作，再报告剩余项。

---

## Task 16：旧权限迁移与正式客户端登记

**Files（AUTH）**
- Create: `scripts/quicklogin-migration.ts`, `scripts/quicklogin-client.ts`, `src/services/quicklogin/migration.ts`。
- Modify: `src/types.ts`, `wrangler.jsonc`（仅本地模板变量）、`src/services/quicklogin/account-client.ts`, `src/routes/cqu-quicklogin.ts`, `src/routes/cqu.ts`。
- Test: `src/services/quicklogin/migration.test.ts`, `test/do/quicklogin-migration.do.test.ts`。
- Create（EXT）: `docs/operations/quicklogin-release.md`。

**Interfaces**
- Consumes: 既有 boolean资格、MASTER_KEY、新DEVICE_LIMIT_KEY、C3账号方法。
- Produces: 受控一次性 `initializeQuickloginPolicy(userId:string,input:{migrationId:string;deviceLimit:number;masterEnabled:boolean}):Promise<void>`；已初始化账户重复相同migrationId幂等，不同输入拒绝。此入口仅内部管理服务使用，不向普通网页/插件公开。
- 环境变量 `QUICKLOGIN_DEVICE_MODE: 'off'|'on'`、`QUICKLOGIN_CLIENT_ID`、`QUICKLOGIN_EXTENSION_ORIGIN`。未配置mode默认off；off时设备API返回503 TEMPORARY_UNAVAILABLE，旧ticket/开关行为维持原策略。on时新coordinator权威，不能运行时回退读旧布尔值。

- [ ] 写迁移红测试：输入 `{userId:'u1',oldAccess:true,deviceLimit:undefined}` 预览报告missing_mapping，apply拒绝；显式0合法；显式3保留原master意图；重复apply相同mapping不重置已注册设备；第二次不同额度要求常规preview/apply而非覆盖初始化。
- [ ] 实现 mapping JSON 格式和纯校验：

```json
{
  "schemaVersion": 1,
  "migrationId": "quicklogin-devices-2026-09-09",
  "users": [
    {"userId": "test-user-a", "deviceLimit": 3},
    {"userId": "test-user-b", "deviceLimit": 0}
  ]
}
```

示例仅合成用户，不是实际用户额度决定。每位旧有access或总开关用户都必须被预览列出，漏配不自动赋5也不直接清零。新用户默认quota0/masterfalse。初始化从当前权威旧master读取，mapping不允许客户端修改master。保存预览快照hash并apply时校验来源旧权限未变化。

- [ ] CLI支持 `--dry-run --mapping <path>` 和 `--apply --mapping <path> --preview-hash <hash>`，默认dry-run；dry-run输出数量、缺失/冲突用户、旧/新额度，不输出凭据。通过现有管理身份/受控内部脚本调用协调器，不执行大批SQL直写覆盖权威DO；权限校验沿用entitlement管理权限。
- [ ] 客户端登记脚本也默认dry-run，通过 Better Auth adminCreateOAuthClient/adapter 管理模型，不手拼现有OAuth数据库行。检查 clientId、public、requirePKCE、skipConsent、fixedredirect、scope、metadata，与C5一致；再次运行相同配置只readback，不新增一堆client。开发/正式extension ID不同则用不同配置和allowlist。
- [ ] 旧布尔capability在off阶段保留；on发布后UI隐藏旧项、ticket资格读取新额度，迁移观察完成才另一次迁移清旧行。首次实现不直接drop旧字段/整表。所有policy读取通过清晰mode分支，生产on后不因单个DOfetch错误回落旧权威。
- [ ] 写release.md具体顺序：备份脱敏元数据/保留旧配置 → compatible backend且modeoff →登记官方client → dry-run额度映射 →管理员确认映射 →初始化policy并readback →部署新版UI/扩展内测配置 →modeon →检查新旧业务回归 →批准后发布商店。modeon前已有grant/任务不能实际导出或维护。
- [ ] 记录回退：关闭设备mode会停新API/新维护，需要同时在维护入口检查flag；不自动撤销学校Cookie，也不承诺回退撤销本地会话。保护已迁移DO状态不删除，下次on恢复有效开关。回退执行需要明确发布授权，不自动操作。
- [ ] 跑migration unit/DO测试和typecheck，提交AUTH `feat: prepare explicit quicklogin entitlement migration`；EXT单独提交发布手册。实际mapping未提供不是代码实现失败，标记生产门禁未通过。

## Task 17：跨仓库协议、故障和完整浏览器验收

**Files（EXT）**
- Create: `tests/fixtures/protocol-v1.json`, `src/shared/contracts.test.ts`, `scripts/check-package.mjs`, `docs/acceptance/quicklogin.md`。
- Modify: `package.json`（加入 `check:package`）、必要的既有测试。
**Files（AUTH）**
- Create: `src/services/quicklogin/protocol-fixture.test.ts` 与同内容 `src/services/quicklogin/fixtures/protocol-v1.json`。

**Interfaces**
- Consumes: 全部已实现公开接口；fixture只包含合成status/envelope/error。
- Produces: 可重复验证命令、验收矩阵实际结果，禁止用单元测试推断实测已通过。

- [ ] fixture固定使用普通有效测试时间和合成Cookie `SOURCEID_TGC=synthetic-test-session`；有generation=4/sessionVersion=7，包含session和persistentCookie。前后端验证器都接受合法fixture并拒绝protocolVersion=2、父域Cookie、空TGC、错误类型、过大响应。
- [ ] 包检查脚本扫描dist manifest引用、content无远程代码、权限只有批准列表、没有.env/experiment/源码map秘密、没有privatekey/token导出。明确检查不存在client_secret；已列允许公开的clientId不误报。

```sh
# EXT
npm run typecheck
npm test
npm run build
npm run check:package
# AUTH：切换工作目录后分别执行，不在EXT运行。
npm run typecheck
npm run typecheck:do
npm test
npm run test:do
npm run build:frontend
```

- [ ] 跑全量一次并修本次回归；若有已有失败，记录基线复现命令与输出，不能直接忽略或把整套测试标PASS。不要为了绿色删撤销/竞争/验证码测试。
- [ ] 使用干净普通Chrome资料加载**正式dist**。浏览器操作使用当时可用的Chrome/computer-use skill，先读其边界；如果工具限制了加载扩展的某步，只请求用户完成那个必要步骤，不要求重复手动导Cookie。不得绕过工具限制。
- [ ] 在已批准测试环境/账号验证下表。保留截图/状态/时间，不保留Cookie值、token或ticketURL。完整业务登录必须检查学校业务实际页面；若返回412只记录失败，不宣称通过。

| ID | 操作 | 必须观察到 |
| --- | --- | --- |
| A01 | 登录插件，网页master开，插件子开关开 | 无激活/import步骤；一个设备、一个slot，准备后本地回读完成 |
| A02 | 无已有业务Cookie时访问学校门户 | 经SSO正常回调后到真实门户已登录页面；不只有302 |
| A03 | 开新tab访问同系统 | 有效本地Cookie直接走学校；不每次调用Auth导出 |
| A04 | 只删除插件管理的SSOCookie，再访问登录页 | 同版本最多恢复一次，不无限跳转 |
| A05 | 导出/写入暂时失败 | 最多各两次重试；原Cookie受保护；用尽可手动 |
| A06 | 成功写入但学校仍真实显示登录表单 | 直接提示手动；没有新一轮容器重登/刷新 |
| A07 | 选手动登录并输入学校信息 | 后台心跳继续，自动写入停止，不打断输入 |
| A08 | 本地有外来TGC | 默认保留；只有显式切换才替换 |
| A09 | 关闭子开关时下载/写入在途 | 旧结果不重新生效，只清理仍归属的SSOCookie |
| A10 | 关闭网页master再开启 | 名额和子开关保留；关时停维护/导出，开后恢复 |
| A11 | 网页退出目标设备 | 目标立即无新导出权；旧JWT无法重注册；其他设备不受影响 |
| A12 | 离线设备被退出后重连 | 清目标授权/可确认Cookie；网络错误不冒充撤销 |
| A13 | 5→3额度预览后排序改变 | 返回新预览需确认；最终稳定保留3台、另外2台停用非退登 |
| A14 | 额度3→0→5 | 0停全部；加回5不自动复启；列表仍可管理 |
| A15 | worker停止、浏览器重启、插件升级 | deviceId/manual/预算保留，alarm重建，不重复注册 |
| A16 | 同时设备重登和现有课表认证 | 验证码租约串行正确，主课表会话不被设备覆盖 |
| A17 | 同一网页Auth会话授权两插件再退出一个 | 独立grant，另一个刷新仍成功，网页session不退出 |
| A18 | 一小时保活/七小时重登/离线七天 | unit fakeclock先通过；真实运行观测另记录时间，不拿fakeclock替实测 |

- [ ] 五会话已完成短测引用`docs/five-session-verification.md`，不重复付费/登录压测。A18真实7小时观察需后续已授权测试窗口；没有窗口就明确未执行，不为通过而把线上间隔改短。假时钟可验证状态机，无法证明学校长期并存。
- [ ] 验收文档每行写 PASS/FAIL/NOT RUN、执行时间、环境、证据路径、失败原因；绝不预填PASS。UI截图执行两项指定Emil skill复查，含keyboard、小屏、quota0、撤销等状态。
- [ ] 提交协议fixture、包检查、真实记录：`test: verify quicklogin protocol and user flows`。不要提交学校登录导出的任何临时文件。

## Task 18：交接与发布包

**Files（EXT）**
- Create: `README.md`, `docs/operations/quicklogin-handoff.md`, `docs/operations/store-checklist.md`。
- Modify: `docs/operations/quicklogin-release.md`。

**Interfaces**
- Consumes: Task17实际结果、Task16发布门禁。
- Produces: 下一位维护者能够按命令复现build、部署预览、验收；商店包不包含远程可执行更新器。

- [ ] README写明本地构建/加载路径dist、Auth公开client配置、已实现开关层级、当前协议版本、测试命令。不能把experiment/extension指向正式插件加载路径。
- [ ] store-checklist写权限用途：cookies仅SSO同步，identity用于Auth授权，storage保存设备/令牌/摘要，alarms用于状态检查；说明只收最近IP/设备信息、如何用户退出。不新增统计SDK，不杜撰隐私政策URL或已获商店批准。
- [ ] 用本地build产物创建发布zip并记录文件名/sha256；仅打包dist，不自动上传。更新后onInstalled迁移/启动流程已有Task10/17测试，确保不重新注册会话。
- [ ] handoff填写两个repo提交、完成任务、失败/未跑项、映射是否批准、client是否登记、mode实际状态、是否部署。检查下表覆盖后再宣告实现完成：

| 设计条款 | 实现任务 | 验证 |
| --- | --- | --- |
| 独立SSO及主会话保护 | 05–07 | broker/lease DO测试，A16 |
| grant隔离/即时撤销 | 02、03、08、09 | 真实provider测试，A11/A12/A17 |
| 额度/层级开关/降低预览 | 01、02、04、15、16 | 并发DO测试，A10/A13/A14 |
| 心跳/最近IP/离线策略 | 07、08、11、15 | fakeclock及A18分开 |
| Cookie完整性/归属/中断恢复 | 01、11、12 | 失败注入及A04/A08/A09/A15 |
| 学校状态/技术重试/手动模式 | 11、13、14 | A02/A03/A05/A06/A07 |
| 指定UI skills与退出提示 | 13、14、15 | 视觉和键盘验收 |
| 升级/协议/明确迁移 | 10、16–18 | 包检查与A15 |

- [ ] 复查git diff没有秘密、未授权生产配置更改或顺手重构；本任务文档不要求重新跑全部业务测试。提交 `docs: hand off quicklogin implementation and release gates`。
- [ ] 向用户报告代码/测试/实际浏览器/真实调度/部署各自状态。若门禁未满足，明确“本地实现完成，尚未发布”，不要请求重复批准已完成的普通文件编辑。
