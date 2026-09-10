# 公共接口与状态约定

本文件与主计划共同构成实现输入。类型先在 AUTH `src/services/quicklogin/contracts.ts` 实现；EXT `src/shared/contracts.ts` 保存浏览器需要的同名子集。两个仓库不通过相对路径跨仓库 import；任务 17 用同一份合成 JSON fixture 做协议兼容测试。

## C1. 常量和基础类型

```ts
export const PROTOCOL_VERSION = 1 as const;
export const HEARTBEAT_MS = 5 * 60_000;
export const ONLINE_MS = 10 * 60_000;
export const INACTIVE_MS = 7 * 24 * 60 * 60_000;
export const DEVICE_SCOPE = 'cqu:quicklogin:device';
export const DEVICE_LIMIT_KEY = 'cqu.quicklogin_device_limit';
export const MASTER_KEY = 'cqu.quicklogin';
export type EpochMs = number;
export type DeviceId = string; // 服务端 UUID，不能由插件指定
export type GrantId = string;  // 服务端随机 UUID，等于 provider referenceId
export type CloudState = 'disabled' | 'paused' | 'preparing' | 'ready'
  | 'refreshing' | 'needs_reauth' | 'temporary_unavailable' | 'revoked';
export type DisabledReason = 'user' | 'quota_reduced' | null;
export type ErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_REQUEST'
  | 'NO_DEVICE_CAPACITY' | 'DEVICE_LIMIT_REACHED' | 'DEVICE_REVOKED'
  | 'MASTER_DISABLED' | 'DEVICE_DISABLED' | 'PREPARING' | 'NEEDS_REAUTH'
  | 'TEMPORARY_UNAVAILABLE' | 'RATE_LIMITED' | 'PROTOCOL_UNSUPPORTED'
  | 'STALE_GENERATION' | 'PREVIEW_CHANGED';
export interface ApiError {
  error: { code: ErrorCode; message: string; retryAfterMs?: number };
}
export interface DeviceMetadata {
  deviceName: string; browserFamily: 'chrome'; browserVersion: string;
}
export interface DeviceRecord extends DeviceMetadata {
  deviceId: DeviceId; ownerUserId: string; grantId: GrantId;
  enabled: boolean; enabledAt: EpochMs | null;
  lastSeenAt: EpochMs | null; lastIp: string | null;
  revokedAt: EpochMs | null; generation: number;
  disabledReason: DisabledReason;
  appliedVersion: number | null; // 插件确认过的版本，不等于学校已登录
}
export interface GrantRecord {
  grantId: GrantId; ownerUserId: string; clientId: string;
  state: 'pending' | 'active' | 'revoked';
  createdAt: EpochMs; expiresAt: EpochMs | null;
  deviceId: DeviceId | null; revokedAt: EpochMs | null;
}
export interface AccountState {
  schemaVersion: 1; revision: number; masterEnabled: boolean;
  deviceLimit: number; devices: Record<DeviceId, DeviceRecord>;
  grants: Record<GrantId, GrantRecord>;
}
export interface DeviceAuthority {
  ownerUserId: string; deviceId: DeviceId; grantId: GrantId;
  generation: number; masterEnabled: boolean; enabled: boolean;
  allowed: boolean; // live grant + master + enabled + slot；不是 JWT 快照
  reason: ErrorCode | null; lastSeenAt: EpochMs | null;
}
export interface DeviceStatus {
  protocolVersion: 1; deviceId: DeviceId; generation: number;
  masterEnabled: boolean; enabled: boolean; deviceLimit: number; used: number;
  disabledReason: DisabledReason; state: CloudState;
  sessionVersion: number; appliedVersion: number | null;
  loginAt: EpochMs | null; lastKeepAliveAt: EpochMs | null;
  lastSeenAt: EpochMs | null;
}
export type PublicDevice = Omit<DeviceRecord, 'ownerUserId' | 'grantId'> & {
  online: boolean;
};
export interface DeviceList {
  masterEnabled: boolean; deviceLimit: number; used: number;
  revision: number; devices: PublicDevice[];
}
```

所有时间使用 UTC epoch 毫秒；UI 按用户时区格式化。计数和 generation/sessionVersion 为安全整数。不要用 `Infinity`、`null` 表示设备额度无限；其他现有 capability 的 null 语义保持原样。设备名 trim 后 1–80 字符，版本 1–40 字符，控制字符拒绝；请求体未知字段拒绝，尤其 ownerUserId、IP、grantId。

## C2. Cookie 和设备会话

```ts
export interface SsoCookie {
  name: string; value: string; domain: 'sso.cqu.edu.cn' | '.sso.cqu.edu.cn';
  path: string; secure: boolean; httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
  expires: number; // Unix 秒；-1 表示 session cookie
}
export interface CookieEnvelope {
  protocolVersion: 1; deviceId: DeviceId; generation: number;
  sessionVersion: number; createdAt: EpochMs; cookies: SsoCookie[];
}
export interface StoredDeviceSession {
  schemaVersion: 1; ownerUserId: string; deviceId: DeviceId;
  generation: number; bindingEpoch: number; sessionVersion: number;
  state: CloudState; loginAt: EpochMs | null;
  lastKeepAliveAt: EpochMs | null;
  storageState: string | null; // 现有 Playwright storageState JSON；只在 DO 内
  exportDigest: string | null;
  transientFailures: number; fastRetries: number;
  nextAttemptAt: EpochMs | null;
}
export interface DeviceLoginRequest {
  ownerUserId: string; deviceId: DeviceId; generation: number;
}
export type DeviceLoginResult =
  | { kind: 'success'; storageState: string; loginAt: EpochMs; bindingEpoch: number }
  | { kind: 'needs_reauth'; reason: 'unbound' | 'credentials_rejected' | 'interactive_required' }
  | { kind: 'temporary_unavailable'; retryAfterMs: number }
  | { kind: 'cancelled' };
```

SSO 域固定，拒绝父域 `.cqu.edu.cn`、业务域、第三方域、非法 path、非有限 expires、缺失/空 SOURCEID_TGC。只导出没有过期的条目，TGC 已过期则本次不能导出 ready。用 `(domain,path,name)` 去重，重复冲突拒绝。Cookie 数量上限 64，整个导出 JSON UTF-8 上限 256 KiB。不得把原 storageState 原样返回 API。首版不支持 partitioned Cookie，遇到相关元数据返回协议错误而不是悄悄丢弃。

`validateSsoCookies(value: unknown, now: number): SsoCookie[]` 验证；`extractSsoCookies(storageState: string, now: number): SsoCookie[]` 过滤后验证；`digestSsoCookies(cookies: SsoCookie[]): Promise<string>` 按 domain/path/name 稳定排序并对全部导出字段计算 SHA-256。每次成功重登 sessionVersion +1；保活仅导出 digest 改变才 +1。版本不因关开重置到 0；丢弃 Cookie 也保留版本计数。

## C3. 权威 DO 和内部接口

新增 `CQU_QUICKLOGIN_ACCOUNT` / `CquQuickloginAccountDO`，ID 为 `idFromName(userId)`；新增 `CQU_QUICKLOGIN_DEVICE` / `CquQuickloginDeviceDO`，ID 为 `idFromName(userId + ':' + deviceId)`。设备 UUID 不含冒号。外部路由不能让调用方选择另一个 userId。

账号 DO 以 storage 的单一 `account` 对象为权威，内含授权状态与 durable outbox。在一次 storage transaction 中完成检查、修改、revision/generation 增量和 outbox 入队。事务回调不得调用网络/D1/其他 DO；异步投影和通知在提交之后进行。初始化使用 blockConcurrencyWhile，只接受 Worker 内部传入并持久化一次的 ownerUserId，后续不一致拒绝。

以下方法由 `src/services/quicklogin/account-client.ts` 封装内部 DO JSON fetch，方法的 `userId` 均来自可信调用者；不新增公网 `/internal` 通道。方法签名：

```ts
createPendingGrant(userId: string, clientId: string, now: number): Promise<GrantRecord>
activateGrant(userId: string, grantId: string, now: number): Promise<GrantRecord>
registerDevice(userId: string, grantId: string, metadata: DeviceMetadata): Promise<DeviceRecord>
setDeviceEnabled(userId: string, deviceId: string, enabled: boolean): Promise<DeviceAuthority>
setMasterEnabled(userId: string, enabled: boolean): Promise<DeviceList>
revokeDevice(userId: string, deviceId: string, now: number): Promise<void>
getDeviceAuthority(userId: string, deviceId: string): Promise<DeviceAuthority>
assertGrant(userId: string, grantId: string, clientId: string): Promise<GrantRecord>
listDevices(userId: string, now: number): Promise<DeviceList>
heartbeat(userId: string, deviceId: string, input: HeartbeatInput, ip: string | null, now: number): Promise<void>
previewQuota(userId: string, limit: number, now: number): Promise<QuotaPreview>
applyQuota(userId: string, input: QuotaApply, now: number): Promise<DeviceList>
```

```ts
export interface HeartbeatInput {
  protocolVersion: 1; appliedVersion: number | null; generation: number;
  browserVersion: string;
}
export interface QuotaPreview {
  token: string; expiresAt: number; revision: number;
  oldLimit: number; newLimit: number;
  kept: DeviceId[]; disabled: DeviceId[];
}
export interface QuotaApply { token: string; newLimit: number }
```

预览有效期 5 分钟，服务器存储 token 与具体 kept/disabled 列表。应用时重新计算；如果实际受影响集合和保留集合没变，单纯心跳导致 revision 变化可保存；名单变化则 409 PREVIEW_CHANGED，响应另附 `preview: QuotaPreview`，不修改任何额度。新 token 一次消费；同 token 成功后重试返回已存结果，不重复变更。排序无副作用：lastSeenAt desc（null 最后）、enabledAt desc（null 最后）、deviceId asc。主开关变化和设备启停/撤销均递增受影响设备 generation，心跳不递增 generation。

outbox 事件最小结构 `{id, kind:'device-notify'|'projection'|'revoke-oauth-family', revision, deviceId?, generation?, grantId?, attempts, nextAttemptAt}`。按账号 alarm 重试；投影用 revision 条件 upsert，旧事件不能覆盖新状态。保留撤销 grant 墓碑，不用“清理旧数据”删除它从而使旧授权复活。未激活 pending grant 10 分钟过期可清理。

设备 DO 内部客户端文件 `device-client.ts` 提供：

```ts
notifyDevice(authority: DeviceAuthority): Promise<void>
readDeviceSession(userId: string, deviceId: string): Promise<StoredDeviceSession>
requestDeviceRefresh(authority: DeviceAuthority): Promise<void>
exportDeviceCookies(authority: DeviceAuthority): Promise<CookieEnvelope>
```

notify/refresh 只持久化和安排 alarm，不能让启用 HTTP 请求等待学校登录。开始容器操作、保存结果和导出前重新请求 account authority；generation 不一致就丢弃迟到结果。导出由 API 在读取前后各检查 authority，最终仍以当前 generation 为准。已经发送到网络的响应不可追回，插件还必须检查本地 generation。

CQU_SESSION 增加内部 `quickloginLogin(input: DeviceLoginRequest): Promise<DeviceLoginResult>` 和 `getQuickloginBindingEpoch(): Promise<{bound:boolean; epoch:number}>`；只有该 DO 解密学校密码。`bindingEpoch` 在学校账号绑定身份/凭据替换、解绑、撤销时递增并持久化；仅保活不递增。设备会话提交/保活/导出均比较当前 epoch，旧账号 Cookie 永不重新下发。设备导出遇到 epoch 变化返回 NEEDS_REAUTH 并丢弃旧状态；主会话仍可绑定时，下一个有效恢复按新 epoch 登录。学校绑定失效通知账号协调器暂停设备会话并清除存储，但保留插件 grant、子开关与名额；用户重新完成绑定后允许按有效开关恢复。

## C4. HTTP 路由与认证矩阵

所有 JSON 响应有 `Cache-Control: no-store`，含 Cookie/token 的响应不得进入日志。成功响应直接为表中 DTO，不再包一层 data。错误统一 ApiError。

| 完整路径 | 方法/身份 | 请求 | 成功响应 |
| --- | --- | --- | --- |
| `/api/cqu/quicklogin` | GET 网站 session | 无 | `{masterEnabled,deviceLimit,used}` |
| 同上 | PUT 网站 session + CSRF/Origin | `{enabled:boolean}` | 同 GET |
| `/api/cqu/quicklogin/devices` | POST 插件 grant | DeviceMetadata | `200 DeviceStatus`；按 grant 幂等注册，初始 disabled |
| 同上 | GET 网站 session | 无 | DeviceList |
| `/api/cqu/quicklogin/devices/:id` | PUT 插件 grant，仅自己 | `{enabled:boolean}` | DeviceStatus；准备尚未完成不声称 ready |
| 同上 | DELETE 网站 session，仅本人 | 无 | 204；重复退出仍成功 |
| `/api/cqu/quicklogin/devices/:id/status` | POST 插件 grant，仅自己 | HeartbeatInput | DeviceStatus |
| `/api/cqu/quicklogin/devices/:id/refresh` | POST 插件 grant，仅自己 | `{protocolVersion:1,generation:number}` | `202 DeviceStatus`；合并在途任务，尊重 nextAttemptAt |
| `/api/cqu/quicklogin/devices/:id/export` | POST 插件 grant，仅自己 | `{protocolVersion:1,generation:number,sessionVersion:number}` | CookieEnvelope；版本/代次过时 409 STALE_GENERATION，客户端先查状态 |
| `/api/admin/users/:id/quicklogin-quota/preview` | POST 现有 entitlement 管理权限 | `{deviceLimit:number}` | QuotaPreview |
| `/api/admin/users/:id/quicklogin-quota` | PUT 同上 | QuotaApply | DeviceList |

状态码：401 UNAUTHORIZED；403 FORBIDDEN/DEVICE_REVOKED/MASTER_DISABLED/DEVICE_DISABLED/NO_DEVICE_CAPACITY；409 DEVICE_LIMIT_REACHED/PREPARING/STALE_GENERATION/PREVIEW_CHANGED；422 INVALID_REQUEST/NEEDS_REAUTH；429 RATE_LIMITED；503 TEMPORARY_UNAVAILABLE；426 PROTOCOL_UNSUPPORTED。跨用户/跨设备访问统一 403，不透露目标是否存在。设备状态和关闭操作不受 master/额度限制，但必须 live grant 未撤销。

OPTIONS 按已登记的 `chrome-extension://<id>` allowlist 放行，实际响应精确反射匹配 Origin，`Vary: Origin`，不使用 `*`。插件 Bearer 接口 `credentials: omit`，网站管理接口只接受网站 session，并检查既有 Origin/CSRF 机制；如自定义 Hono 路由未继承 Better Auth 的校验，显式添加 same-origin 检查，不假定 provider 已替所有 `/api` 防护。拒绝用网站 session 调插件接口或用插件 token 管理网页总开关。

## C5. OAuth grant 合约

官方客户端配置来自环境绑定 `QUICKLOGIN_CLIENT_ID`、`QUICKLOGIN_EXTENSION_ORIGIN`；开发和正式环境分别登记固定 ID 与 `https://<extension-id>.chromiumapp.org/` 回调。public=true，requirePKCE=true，tokenEndpointAuthMethod=none，grantTypes authorization_code/refresh_token，skipConsent=false。不把新 scope 开放到现有任意 OAuth 客户端授权管理列表。

授权请求携 `state`、S256 code_challenge、`prompt=consent`、`resource=BETTER_AUTH_URL`，scope `openid offline_access cqu:quicklogin:device`。token/refresh 请求延续 resource，不能指望默认 opaque token 可按 JWT 验证。

安装授权身份是 provider `referenceId`，JWT 增加 `ql_grant`。不是 userId、sid、oauthRefreshToken.id 或客户端自行生成的 deviceId。refresh token 轮换行 ID 会改变，referenceId 保持不变。每次交互式 consent 创建新的随机 grant；同一 Auth 网页 session 可为五台设备创建五个不同 grant。撤销目标 referenceId 对应的刷新家族，不能撤销网页 session。

已检视当前安装版 `@better-auth/oauth-provider/dist/index.mjs`：`postLogin.consentReferenceId` 能提供 referenceId，`customAccessTokenClaims` 收到 referenceId/user/scopes/metadata；刷新保留 referenceId。任务 03 必须用真实 provider 流程验证该接入，不只 mock JWT。具体 hook：

```ts
// 合并到现有 oauthProvider 配置；保留原有 custom claims 逻辑。
postLogin: {
  page: '/oauth/authorize',
  shouldRedirect: async () => false,
  consentReferenceId: async ({ user, scopes }) => {
    if (!scopes.includes(DEVICE_SCOPE)) return undefined;
    const grant = await createPendingGrant(user.id, env.QUICKLOGIN_CLIENT_ID, Date.now());
    return grant.grantId;
  },
},
// customAccessTokenClaims 原 caps 结果 + 下列分支，不能删除已有声明。
// new-scope 请求要求官方 client metadata 标志，路由还必须验证实际签名 azp。
// referenceId 缺失/已撤销/过期必须中止签发，不能生成匿名设备 grant。
```

prompt=consent 的正常路径只在接受时建立 referenceId；未带 prompt 的异常路径可能出现未激活 pending grant，按 TTL 回收，不能按用户或 sid 复用它。`activateGrant` 仅接受未过期 pending 或已有 active；revoked 永远拒绝。claim callback 验证 user ownership，返回 `{...existingClaims, ql_grant: grant.grantId}`。验证 Bearer 时检查签名、exp、iss、aud、azp/client_id、scope、ql_grant，再调用 assertGrant；注册时原子 grant→device，只能一次。

即时撤销先在账号 DO 标 revoked，再异步通过 Better Auth adapter 撤销 `oauthRefreshToken` 中 userId/clientId/referenceId 对应家族，处理并发新行；不直接改 node_modules。即使 provider 撤销投影暂时失败，所有设备 API 已实时拒绝；刷新 hook 也拒绝 revoked。保留原 caps、多客户端授权和原 ticket 逻辑的回归测试。

## C6. 插件本地状态与写入事务日志

```ts
export interface LocalState {
  schemaVersion: 1; deviceId: string | null;
  localGeneration: number; serverGeneration: number | null;
  enabledIntent: boolean; manualOverride: boolean;
  appliedVersion: number | null;
  managed: ManagedCookie[]; recovery: RecoveryRound | null;
}
export interface ManagedCookie {
  name: string; domain: string; path: string; storeId: string;
  digest: string; // 对完整回读值及安全属性的 SHA-256，不含明文
}
export interface RecoveryRound {
  id: string; generation: number; sessionVersion: number | null;
  phase: 'downloading' | 'writing' | 'navigated' | 'manual_required' | 'finished';
  downloadRetries: number; writeRetries: number;
  nextAttemptAt: number | null; navigatedTabId: number | null;
}
```

LocalState 放 `chrome.storage.local`；token 与 PKCE pending 也仅 local，access level 限 trusted contexts，不放 sync，不向内容脚本暴露。PKCE pending 10 分钟过期，state 一次消费。token 续期在后台 singleflight，失败时不立刻删除学校 Cookie，只有明确 DEVICE_REVOKED 才按归属清理并退出。

写入前在 local 保存 journal `{id,localGeneration,serverGeneration,sessionVersion,phase,entries:[{key,expectedDigest,previousDigest,completed}]}`，只存摘要；旧明文 Cookie 快照仅放 `chrome.storage.session`（扩展 worker 重启可读，浏览器重启会丢失）。恢复时若快照还在且当前仍匹配本轮 expectedDigest，恢复旧条目；若本轮原本新增则匹配时删除；若快照因浏览器重启丢失则不猜旧值、不删除无法判定条目，标记需要用户重试并重新检测外来会话。journal 记录先于每个 Cookies API 写操作，不能写完才补记录。

Cookie 写入是可回滚的串行操作，不是真正原子事务。写前/写后检查本地 generation、服务器 generation、开关、manualOverride；退出/关闭先持久化 localGeneration+1，随后排队清理。并发轮换导致当前不匹配时不得撤销别人的值。完整回读验证后才更新 appliedVersion/managed，清理 journal。已有外来 TGC 时返回 FOREIGN_SESSION；仅本次用户明确切换产生的一次性许可允许替换，再次恢复不能继承永久覆盖许可。

`sync(reason: 'alarm'|'startup'|'network'|'enable'|'login_form'|'user_retry'): Promise<void>` 是唯一入口，所有调用共享一个队列与持久化 recovery。后台 5 分钟常规轮询在 manual_required 后仍心跳，但不隐式开启新恢复轮次；用户明确 retry/恢复才清理失败预算。后台新版本到达也不覆盖 manualOverride。
