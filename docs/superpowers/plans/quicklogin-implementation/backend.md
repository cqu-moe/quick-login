# Auth Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Auth 上实现可独立测试的设备额度、设备 grant 和专用 SSO 生命周期。

**Architecture:** 账号 DO 权威写入，设备 DO 会话维护，CQU_SESSION 复用学校凭据和验证码。HTTP 边界引用 contracts.md，不新增通用代理。

**Tech Stack:** 现有 Hono / Better Auth / D1 / Durable Objects / Containers / Vitest。

**Spec:** `../../specs/2026-09-09-quicklogin-design.md`，公共类型见 `contracts.md`。

## Global Constraints

继承主计划全部约束。本文件所有路径均相对 AUTH；所有 shell 命令在 AUTH 执行。每任务提交仅包含列出的目标文件和相应测试，保留其他任务/用户的改动。用例中的辅助 fixture 必须在对应测试文件实现，禁止让 fixture 代替实际被测 DO。

---

## Task 01：纯额度策略与协议校验

**Files**
- Create: `src/services/quicklogin/contracts.ts`, `policy.ts`, `cookie-envelope.ts`（同目录）。
- Test: `src/services/quicklogin/policy.test.ts`, `cookie-envelope.test.ts`。

**Interfaces**
- Consumes: contracts.md C1、C2。
- Produces: `validateDeviceLimit(value:unknown):number`；`selectQuotaDevices(devices:DeviceRecord[],limit:number):{kept:string[];disabled:string[]}`；C2 的三个 Cookie helper。

- [ ] 写失败用例：负数、小数、字符串、null、Infinity、超过 MAX_SAFE_INTEGER 全部拒绝；0/5 合法。构建 5 个 enabled 设备，验证稳定淘汰、排除 disabled/revoked、不修改输入数组。

```ts
it('keeps recently contacted devices with deterministic ties', () => {
  const base = { ownerUserId:'u', grantId:'g', deviceName:'Chrome',
    browserFamily:'chrome' as const, browserVersion:'1', enabled:true,
    revokedAt:null, generation:1, disabledReason:null, appliedVersion:null, lastIp:null };
  const rows = [
    {...base, deviceId:'c', lastSeenAt:100, enabledAt:20},
    {...base, deviceId:'b', lastSeenAt:100, enabledAt:30},
    {...base, deviceId:'a', lastSeenAt:100, enabledAt:30},
    {...base, deviceId:'d', lastSeenAt:null, enabledAt:99},
  ];
  expect(selectQuotaDevices(rows, 2)).toEqual({kept:['a','b'],disabled:['c','d']});
  expect(rows[0].deviceId).toBe('c');
});
```

- [ ] 运行 `npm test -- src/services/quicklogin/policy.test.ts src/services/quicklogin/cookie-envelope.test.ts`，确认失败指向缺失实现。
- [ ] 实现有限整数校验和稳定排序：

```ts
export function validateDeviceLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('INVALID_REQUEST');
  return value;
}
// 只排序 enabled && revokedAt === null 的副本；null 映射 -Infinity。
// 比较依次 lastSeenAt、enabledAt、deviceId，最后一个使用明确 < / >，不用 localeCompare。
```

- [ ] 实现 Cookie 白名单、TTL、重复键、大小及 partitioned 检查；测试合法 TGC + 业务 Cookie 只导出前者，`.cqu.edu.cn` 不被后缀匹配放行，TGC 为空/已过期拒绝。digest 用稳定字段顺序，数组顺序变化不改变结果、值变化改变结果。
- [ ] 重跑上述用例和 `npm run typecheck`；通过后提交 `feat: define quicklogin protocol and quota policy`。

## Task 02：账号 DO 原子名额与状态

**Files**
- Create: `src/durable-objects/cqu-quicklogin-account.ts`。
- Create: `src/services/quicklogin/account-client.ts`, `account-reducer.ts`, `outbox.ts`。
- Modify: `src/types.ts`, `src/index.ts`, `wrangler.jsonc`, `test/do/env.d.ts`。
- Test: `test/do/quicklogin-account.do.test.ts`, `src/services/quicklogin/account-reducer.test.ts`。

**Interfaces**
- Consumes: C1 AccountState / DeviceAuthority，Task 01 排序。
- Produces: C3 全部账号方法。内部请求 `{operation,ownerUserId,payload}`，operation 是固定枚举，不把任意方法名动态执行。
- Reducer: `reduceAccount(state:AccountState,command:AccountCommand,now:number):{state:AccountState;result:unknown;events:OutboxEvent[]}`；AccountCommand 为 C3 方法参数的 discriminated union，定义在 account-reducer.ts。

- [ ] 写 reducer 用例覆盖：master off 保留 enabled/used；disable 释放；重复 enable 不增加；revoke 增 generation 且 grant revoked；0 配额禁用全部且不改 master；增加额度不复启；pending grant 过期。
- [ ] 写真实 DO 并发测试，helper 使用 `env.CQU_QUICKLOGIN_ACCOUNT.get(idFromName('quota-test-'+crypto.randomUUID()))`，通过 `runInDurableObject` 写入一份完整 AccountState fixture；不要 mock transaction。

```ts
// fixture: master=true, limit=1，两个 active grant 已各注册 disabled 设备。
const results = await Promise.allSettled([
  account.setDeviceEnabled(userId, firstId, true),
  account.setDeviceEnabled(userId, secondId, true),
]);
expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
expect((await account.listDevices(userId, now)).used).toBe(1);
```

这里 `account` 在测试中是 account-client 的真实绑定包装，firstId/secondId 由 `createPendingGrant → activateGrant → registerDevice` 获取；测试完整调用链，不硬写任意设备 ID。

- [ ] 运行 `npm run test:do -- test/do/quicklogin-account.do.test.ts`，确认竞争测试未实现而失败。
- [ ] 使用 storage.transaction 对单个 AccountState 做同步 reducer 更新；一次保存 account 和 outbox，事务内不 await D1 或远程 DO。幂等 grant→device 注册时从 state.grants 查已绑定 deviceId，revoked 在任何分支前拒绝。
- [ ] 实现 preview token 存储、5 分钟 TTL、一次消费和幂等成功回执。使用任务 01 排序重新计算名单，不简单用 revision 不同就无限拒绝心跳。
- [ ] 追加 DO migration `v3` 的 `new_sqlite_classes: ['CquQuickloginAccountDO','CquQuickloginDeviceDO']` 时，**本任务先只追加账号类**；任务 07 在尚未部署的同一 v3 追加设备类。若 v3 已部署，任务 07 用下一 tag，不修改已部署迁移。保留 v1/v2。
- [ ] 先实现 projection/device/revoke outbox 的类型和可注入 dispatcher；没有消费者的事件持久留队而不丢弃，任务 04/07/09 接齐消费者。alarm 失败保存 attempts/nextAttemptAt，使用有限指数退避，不忙循环。
- [ ] 增加预览期间心跳改变淘汰名单→409、名单不变→保存成功、乱序通知不复启、同 token 重放不重复停用的测试。运行 reducer、DO 测试和两项 typecheck，提交 `feat: coordinate quicklogin device capacity per account`。

## Task 03：真实 OAuth grant 接入与隔离证明

**Files**
- Create: `src/services/quicklogin/oauth-grants.ts`, `src/middleware/quicklogin-device-auth.ts`。
- Modify: `src/auth.ts`, `src/types.ts`。
- Test: `test/do/quicklogin-oauth.do.test.ts`。
- Create: `test/do/quicklogin-oauth-fixture.ts`（仅测试使用）。

**Interfaces**
- Consumes: C3 createPendingGrant / activateGrant / assertGrant；C5 provider hooks。
- Produces: `verifyQuickloginBearer(request:Request,env:Env):Promise<{userId:string;clientId:string;grantId:string;deviceId:string|null}>`；`revokeProviderGrantFamily(env:Env,userId:string,clientId:string,grantId:string):Promise<void>`。

- [ ] 先读当前 `src/auth.ts` 和已安装 `@better-auth/oauth-provider` 类型/实现，确认 C5 提到的 hook 参数。不要修改包源码，不把 referenceId 替换为 sid。
- [ ] 建真实 provider fixture：复用 DO 测试 D1 migrations；通过 Better Auth adapter 建两个 public 测试客户端（一个官方一个非官方）、测试 user/session；以真实 HTTP handler 发 authorize 请求，跟随 consent 路径，用已签名测试会话 cookie 提交接受，用真实 S256 verifier 换 token。测试代码不得绕过 tokenEndpoint 直接生成 ql_grant JWT。
- [ ] 写红测试：同一 website session 两次交互授权产生不同 `ql_grant`；各自 refresh 后 grant 不变；缺少 PKCE、wrong verifier、非固定 redirect、非官方 azp 都不能访问设备接口；普通已有 OAuth 客户端流程不新增 ql_grant。

```ts
// authorizeOfficialInstall 在 fixture 中执行完整 authorize/consent/token 请求。
const a = await authorizeOfficialInstall(fixture, { websiteSession: session });
const b = await authorizeOfficialInstall(fixture, { websiteSession: session });
const pa = await verifyQuickloginBearer(a.request(), fixture.env);
const pb = await verifyQuickloginBearer(b.request(), fixture.env);
expect(pa.grantId).not.toBe(pb.grantId);
const refreshedA = await a.refresh();
expect((await verifyQuickloginBearer(refreshedA.request(), fixture.env)).grantId).toBe(pa.grantId);
```

fixture 精确返回 `{env, authHandler, websiteSession}`，授权 helper 返回 `{request():Request,refresh():Promise<同类型>}`；token 仅保存在测试内存，失败输出删去 token/cookie/body。

- [ ] 运行 `npm run test:do -- test/do/quicklogin-oauth.do.test.ts`，先证明目标失败；然后按 C5 增加新 scope、referenceId hook、claim 合并。新 official 标记 metadata 只由受控客户端登记写入；Bearer 仍校验真实 azp 及 live grant。
- [ ] JWT 校验沿用项目 issuer/audience/JWKS 方式，明确 scope 用集合精确匹配。缺 ql_grant、客户端不符、未知 grant 拒绝，不现场补建授权。401 用于无效/过期 token，已知 revoked grant 返回 403 DEVICE_REVOKED。
- [ ] 实现 adapter 家族撤销：以 userId/clientId/referenceId 查询对应 refresh rows 的 revoked 写入 `new Date()`（当前 provider 使用日期，不能写 true）；逐页处理，不仅处理第一条；已有 access rows 若可撤销同步处理，JWT 本身由 API live check 阻断。函数无学校全局退出、无删除网站 session。
- [ ] 补实际撤销测试：A 注册设备后退出，A 原 JWT 注册返回 DEVICE_REVOKED，A refresh 失败；B refresh/导出资格不受影响；website session 仍有效。模拟 revoke 与 refresh 同时发生，资源接口始终拒绝 revoked，即使 provider 新行晚到。
- [ ] 保留现有 customAccessTokenClaims 中 caps 和 customSession 返回结构的回归。运行本测试、两项 typecheck，提交 `feat: bind official extension OAuth grants to devices`。如 hook 无法通过真实流程，停止此任务并报告，不继续插件假集成。

## Task 04：额度持久投影、管理入口与迁移适配层

**Files**
- Create: `drizzle/migrations/0009_quicklogin_devices.sql`（执行时确认编号）、`src/services/quicklogin/projection.ts`, `quota-admin.ts`。
- Modify: `src/db/schema.ts`, `src/capabilities.ts`, `src/services/entitlements.ts`, `src/routes/admin.ts`。
- Test: `src/services/quicklogin/quota-admin.test.ts`, `test/do/quicklogin-projection.do.test.ts`。

**Interfaces**
- Consumes: C3 previewQuota/applyQuota；C1 两个 capability key。
- Produces: `projectAccount(env:Env,userId:string,state:AccountState):Promise<void>`；`routeQuickloginEntitlementWrite(...)`（在 quota-admin.ts 定义具名 input：userId、actorId、items、previewToken；返回需要预览或已应用结果）。

- [ ] 迁移创建 `quicklogin_account_projection(user_id PRIMARY KEY, revision INTEGER NOT NULL, device_limit INTEGER NOT NULL, master_enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL)` 和 `quicklogin_device_projection(device_id PRIMARY KEY,user_id,revision,payload_json)`，索引 user_id。payload_json 只含 PublicDevice 所需元数据，不含 grantId/Cookie/token。D1 不作为 slot 判断来源。
- [ ] 写测试：revision 10 投影后再执行 revision 9，额度/设备不回退；投影失败不回滚已提交 DO 撤销；重试最终一致。使用条件 upsert：

```sql
INSERT INTO quicklogin_account_projection
(user_id, revision, device_limit, master_enabled, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET
 revision=excluded.revision, device_limit=excluded.device_limit,
 master_enabled=excluded.master_enabled, updated_at=excluded.updated_at
WHERE excluded.revision > quicklogin_account_projection.revision;
```

设备投影和 user_entitlement 的批次更新须受同一账户 revision 门禁保护：用 D1 transaction/batch 中带 revision 条件的语句，不让旧事件在 account upsert 被拒绝后仍覆盖子表。具体做法：batch 第一条条件 upsert 账号 revision，后续每一条设备/user_entitlement 写语句带 `WHERE EXISTS (SELECT 1 FROM quicklogin_account_projection WHERE user_id = ? AND revision = ?)`，参数为本次 userId/revision；整个 batch 原子执行。同 revision 重放幂等，低 revision 全部不写。消费者每次可重新读取最新 AccountState，但这不替代 SQL 门禁。

- [ ] 运行 projection/red tests；实现 C4 两条管理员额度接口，沿用现有 entitlement assign/revoke 权限，普通 admin 不自动升级为 superAdmin。管理员预览只返回设备元数据，不返回密钥。
- [ ] 搜索并逐项拦截现有 generic entitlement PUT、删除、批量 preset、注册 preset 中的新 DEVICE_LIMIT_KEY/MASTER_KEY。所有新 quicklogin 政策写经过 coordinator；可能降低额度的写必须带预览 token，不允许通用赋权接口绕过预览。其他 capability 的原子批量语义不被悄悄打破：混合写请求先返回需要专用 quicklogin 预览的 409，前端拆为明确操作，不先写一半。
- [ ] 内部迁移初始化才允许从已批准额度映射导入 coordinator；常规 API 无 force/bypassPreview 参数。旧 quicklogin_access 暂保兼容读到任务 16 切换，禁止自动 true→5。
- [ ] 加用例：null 只对设备额度拒绝，其他 quota null 保持合法；从 preset 降低额度也无法绕过；恶意直接改 request actorId 不改变实际权限。
- [ ] 运行目标测试及 typecheck，提交 `feat: add coordinated quicklogin quota administration`。

## Task 05：验证码与设备容器路由隔离

**Files**
- Modify: `src/services/cqu-browser-routing.ts`, `src/services/cqu-2fa/code-lease.ts`, `src/durable-objects/cqu-session.ts`。
- Test: 新建 `src/services/quicklogin/browser-routing.test.ts`，扩展 `src/services/cqu-2fa/code-lease.test.ts` 和 `src/services/cqu-browser-routing.test.ts`。

**Interfaces**
- Consumes: 已有 BrowserRoute、LoginRouteRecord、CodeLease、fetchBrowser/fetchLoginControl。
- Produces: BrowserRoute 新可选 `containerKey?:string`，LoginKind 加 `'quicklogin'`；`quickloginContainerKey(userId:string,deviceId:string):string` 返回 `quicklogin:${userId}:${deviceId}`。

- [ ] 写路由测试：旧 cas/atrust 无 containerKey 仍按 userId 路由；设备1/2 不同 key；route.userId 仍是真实 Auth userId。过期 lease、wrong ownerToken、wrong bootId、foreign userId 均不能投递验证码。

```ts
expect(quickloginContainerKey('u','d1')).toBe('quicklogin:u:d1');
expect(quickloginContainerKey('u','d1')).not.toBe(quickloginContainerKey('u','d2'));
// fetchBrowser 的 CQU_LOGIN.idFromName 参数应为 route.containerKey ?? route.userId。
```

- [ ] 先跑该文件和既有 lease 测试，新增行为失败后实现字段扩展。containerKey 仅由服务端生成；外部 HTTP schema 禁止提交该字段。保留旧 node route fail-closed 行为。
- [ ] CQU_SESSION 新设备任务把 LoginRouteRecord 存在现有持久路由表中，kind quicklogin；fetchLoginControl 的 ownerUserId 检查仍使用 route.userId。prepare route 新增小 helper 复用 health/bootId/截止时间检查，以回调验证设备任务 lock，别把主会话 loginInFlight 当设备锁。
- [ ] 队列测试用同一账号依次申请 cas、quicklogin A、quicklogin B、atrust，只有 owner 获发码许可；release 后严格交给下一个，旧 owner 到来的 code 丢弃。复用现有 acquire/release/grantVerificationCodePermit，不加独立设备邮箱轮询。
- [ ] 测试现有 schedule cas 与 atrust 路由未改变；运行目标测试和 typecheck，提交 `feat: route device logins through shared verification leases`。

## Task 06：CQU_SESSION 的设备登录 broker

**Files**
- Modify: `src/durable-objects/cqu-session.ts`。
- Create: `src/services/quicklogin/login-broker-client.ts`。
- Test: `test/do/quicklogin-login-broker.do.test.ts`。

**Interfaces**
- Consumes: Task 05 路由与现有账号凭据/OTP；C2 DeviceLoginRequest/Result。
- Produces: C3 `quickloginLogin` 和 `getQuickloginBindingEpoch` 内部入口。

- [ ] 写 fixture：在真实 CQU_SESSION 中放完整主会话 snapshot，fake browser 响应返回另一个 storageState；断言设备登录后主 state、主 loginAt、课表 ticket 状态完全不变，设备返回新会话。fake 仅替换容器边界，不 mock broker 内部租约。
- [ ] 增加账号解绑、请求取消、验证码等待超时、容器 boot 变化测试，全部返回明确 result，lock/lease/route 清理，不能挂死下一个课表任务。
- [ ] 跑 `npm run test:do -- test/do/quicklogin-login-broker.do.test.ts`，确认新入口缺失失败。
- [ ] 实现新 `quicklogin:<deviceId>` task lock，保存 token/generation/expiry；同设备同 generation 合并、不同 generation 拒绝旧任务。从当前账号读取并解密凭据，取得 shared lease，再使用独立 containerKey 执行已有 CAS 登录流程。禁止直接调用会写主 state 的 `relogin()` 来代替。

```ts
// 实际代码使用现有 lease/helper 名称接入；这是生命周期顺序。
// 1 persist device lock + route → 2 acquire shared lease → 3 grant code permit
// 4 await container result → 5 recheck lock, authority, bindingEpoch
// 6 return result → finally release lease and delete only own token's route/lock
```

- [ ] bindingEpoch 旧记录默认 0；凭据/身份变更先持久化 +1，再取消任务并通知设备；成功登录不增加 epoch。设备结果携开始时 epoch，结束再读当前值；不一致返回 cancelled。
- [ ] 所有长请求沿用现有容器 deadline 与 lease TTL，若需要外层业务 deadline，必须小于当前 lease TTL，禁止凭空新增更短超时打断既有邮件认证。失败按 credentials_rejected/interactive_required/unbound 与 temporary_unavailable 区分。
- [ ] 补两个设备和课表竞争的用例，逐个交付不同合成验证码，证明各自只收到属于当前 ownerToken 的 code；不输出 code 值。运行 broker/现有 CQU_SESSION 相关 DO 测试，提交 `feat: broker isolated quicklogin school sessions`。

## Task 07：设备会话 DO、保活与代次防护

**Files**
- Create: `src/durable-objects/cqu-quicklogin-device.ts`, `src/services/quicklogin/device-client.ts`, `maintenance.ts`。
- Modify: `src/types.ts`, `src/index.ts`, `wrangler.jsonc`, `test/do/env.d.ts`。
- Test: `src/services/quicklogin/maintenance.test.ts`, `test/do/quicklogin-device.do.test.ts`。

**Interfaces**
- Consumes: account authority、login broker、C2 StoredDeviceSession、已有 shouldProactiveRelogin / nextKeepaliveDelayMs。
- Produces: C3 四个 device-client 方法；`nextDeviceAction(state,authority,now)` 返回 `'stop'|'pause_inactive'|'login'|'keepalive'|'wait'`，参数类型为 StoredDeviceSession/DeviceAuthority/number。

- [ ] 写时钟测试：age=7h 必须 login，即便 lastKeepAlive 刚成功；age<7h 且保活未到 wait；7天无心跳 pause；重新上线且 allowed 恢复；needs_reauth 不自动每小时重登；transient 不删除 storageState。

```ts
expect(nextDeviceAction({...ready, loginAt: now - 7*60*60_000}, allowed, now)).toBe('login');
expect(nextDeviceAction(ready, {...allowed, lastSeenAt: now - 7*24*60*60_000}, now))
  .toBe('pause_inactive');
```

ready 和 allowed fixture 必须完整符合 C1/C2，now 固定；不要用 `as any` 绕过字段。

- [ ] 写 DO 迟到结果用例：启动登录后关设备，释放 fake 容器结果，assert storageState 未写入、export 拒绝；revoke、更换 bindingEpoch、master off 同样覆盖。
- [ ] 红测试后实现 alarm。开始/提交/export 均检查 authority；对 stored generation 只接受更高或相同，低 generation 通知无效；撤销清空 SSO 状态并 deleteAlarm，保留版本和墓碑。
- [ ] 保活复用现有固定服务探测和三态 alive/expired/unreachable。alive 保存返回状态但不改 loginAt；Cookie digest 变化才增版本；expired 一次 broker 重登；unreachable 使用现有快速重试和指数退避参数；7h 重登失败不能当成功重置 loginAt。
- [ ] 后台探测如真实出票，CQU_SESSION 增加内部 `recordQuickloginKeepaliveMint(input:{deviceId:string;operationId:string;mintedAt:number}):Promise<void>`，复用现有 `recordKeepaliveMint` / stMintLog 的计量字段；operationId 在账号 DO 内幂等去重，防通知重试重复计数。记录设备来源标签和计数、不记录 ST；只有容器确认实际出票才调用，alive 但没有出票不能伪记一条。测试同 operationId 重放只记一次、两个真实 operationId 记两次；不得绕过当前按账号风控计量。
- [ ] 加 CQU_QUICKLOGIN_DEVICE 绑定和尚未发布的 migration 设备类；通知 handler 只安排 alarm 即返回，account outbox 不等待登录结束。设备登录已在途时 refresh 合并、不把用户重复点击当绕过 backoff。
- [ ] 测试导出版本稳定/轮换、过期 TGC 拒绝、闲置暂停保留 slot、master恢复自动维护。运行目标 unit/DO 测试和两项 typecheck，提交 `feat: maintain per-device SSO sessions with generation guards`。

## Task 08：设备 API、心跳与限流

**Files**
- Create: `src/routes/cqu-quicklogin-devices.ts`, `src/services/quicklogin/http.ts`。
- Modify: `src/routes/cqu-quicklogin.ts`, `src/index.ts`。
- Test: `test/do/quicklogin-routes.do.test.ts`。

**Interfaces**
- Consumes: C4 路由表、verifyQuickloginBearer、account/device clients。
- Produces: C4 全部非管理员 HTTP 接口；`getTrustedClientIp(request:Request):string|null` 仅使用运行环境受信任 Cloudflare client IP，开发环境缺失返回 null，不回退任意 X-Forwarded-For。

- [ ] 写认证矩阵表驱动测试：website可列表/总开关/退出、不可凭session导出；device只操作自己；ticket:any不能导出；master关/额度0仍可心跳、关闭和列表；未知 Origin/CSRF拒绝网站写。完整表每行至少成功和拒绝各一次。
- [ ] 写 `src/index.ts` 实际路由集成测试：设备 POST 不被原 `/api/cqu/quicklogin` session-only middleware 拦截。挂载设备 router 在全局 quicklogin router 之前，且避免原 router `use('*')` 意外匹配设备子路径；必要时把全局 middleware 收窄到根路径。
- [ ] 红测试后实现 schema 校验和统一错误映射。注册不占位、不偷偷开启，enable 之后返回 preparing；读取状态把 account flags 和 device cloud state 合并，禁止依赖 D1 投影授权。
- [ ] heartbeat 的 lastSeen/IP 由有效请求更新时间，browserVersion 只作展示；忽略客户端时钟。appliedVersion 仅当 generation 等于当前且不大于当前 sessionVersion 接受，否则不写入并返回最新状态。
- [ ] export 前后 live authority 检查，envelope 当前 generation/version 与客户端声明不符返回 409。所有响应 no-store，CORS origin 精确 allowlist；内部 storageState/debug异常不能出响应。
- [ ] 复用现有 AUTH_LIMITER 的命名空间能力或用账号 DO 时间窗计数：每设备 status 30 次/分钟、export 12 次/分钟、refresh 3 次/分钟；对超限返回 429 + Retry-After。注册按 grant 幂等，不创建不断增长新设备。全局服务现有限流保持。测试预算与正常 5 分钟心跳兼容。
- [ ] 模拟网络错误不返回 DEVICE_REVOKED；mock export await期间 revoke，再完成结果，旧数据不能返回成功。运行路由测试和两项 typecheck，提交 `feat: expose scoped quicklogin device APIs`。

## Task 09：撤销、解绑、总开关全链路及回归

**Files**
- Modify: `src/services/quicklogin/outbox.ts`, `src/durable-objects/cqu-quicklogin-account.ts`, `src/durable-objects/cqu-session.ts`, `src/routes/cqu.ts`。
- Test: `test/do/quicklogin-revocation.do.test.ts`, `test/do/quicklogin-regression.do.test.ts`。

**Interfaces**
- Consumes: Task 03 provider family revoke、Task 04 projection、Task 07 notifyDevice。
- Produces: outbox 三类消费者闭环；CQU_SESSION 绑定变更通知；原 ticket gate 的额度适配调用 `getQuickloginTicketEligibility(userId):Promise<{masterEnabled:boolean;deviceLimit:number}>`（定义在 account-client.ts）。

- [ ] 写真实 DO 联调用例：五个 enabled 设备，master关闭→used仍5、所有export拒绝；恢复master→各自重新维护；退出一个→used4，仅该grant被撤销；旧JWT register/refresh/export都失败。
- [ ] 模拟 device notify 和 D1 projection 都失败，确认新 API 仍立即拒绝撤销设备；修复消费者后 alarm 幂等清掉 outbox，不复启。旧 notification 在新 enable 后抵达不覆盖新 generation。
- [ ] 红测试后接齐 outbox 三类消费者，调用成功才删除相应事件。grant撤销响应的安全完成点是账号权威事务提交，不是等provider清理全部成功。
- [ ] 学校解绑/凭据更换先增 bindingEpoch，再通知全部设备；旧会话不能继续export。原 schedule loginAt/storageState 仍由主流程维护，设备操作不改主会话。浏览器手动登录失败不能触发全账号解绑。
- [ ] 原 `/service-ticket` 的 `cqu.quicklogin_access` gate 在启用新策略后读 deviceLimit>0 + master；保留原有 OAuth scope allowlist/符号key语义，不把独立设备 grant 自动授予任意service-ticket。旧策略兼容分支由任务16切换flag控制。
- [ ] 运行 Task02/03/06/07/08/09 DO 用例及现有 CQU/ticket 相关测试，记录变更范围，提交 `feat: complete quicklogin revocation and account integration`。
