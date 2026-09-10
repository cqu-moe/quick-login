# Browser Extension and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出能后台同步且不干扰手动登录的正式 Chrome 插件，以及 Auth 设备设置界面。

**Architecture:** 唯一 background 同步入口持有授权和 Cookie 状态；popup/content script 只发有限消息。网站设置使用网站 session，插件使用本设备 grant。

**Tech Stack:** TypeScript、Vite、Chrome MV3、Vitest；Auth 界面沿用 React/Tailwind。

**Spec:** `../../specs/2026-09-09-quicklogin-design.md` 与 `contracts.md`。

## Global Constraints

继承主计划全部约束。任务 10–14 路径相对 EXT，任务 15 相对 AUTH。不从实验扩展直接加功能，`experiment/` 保留为测试证据。接口类型与 C6 状态名称固定。所有 UI 任务的两个指定 skills 是必需项，不是可选美化。

---

## Task 10：可加载 MV3 包、设备 OAuth 与持久状态

**Files（EXT）**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`。
- Create: `public/manifest.json`, `src/background/index.ts`, `src/background/auth.ts`, `src/background/storage.ts`, `src/shared/contracts.ts`, `src/shared/config.ts`。
- Test: `src/background/auth.test.ts`, `src/background/storage.test.ts`, `src/test/chrome-fake.ts`。

**Interfaces**
- Consumes: C4/C5 HTTP、C6 LocalState。
- Produces: `loginInteractive():Promise<void>`、`authorizedFetch(path:string,init:RequestInit):Promise<Response>`、`clearDeviceAuthorization():Promise<void>`；`readLocalState():Promise<LocalState>`、`updateLocalState(reducer:(s:LocalState)=>LocalState):Promise<LocalState>`。
- test chrome-fake 提供 storage local/session、alarms、identity、runtime、cookies 的状态型 fake；Cookies API 的 domain/path/store 行为不能简单全部返回成功。

- [ ] 建 package scripts：typecheck=`tsc --noEmit`、test=`vitest run`、build=`vite build`。依赖仅开发所需 typescript/vite/vitest/@types/chrome；用安装生成的 lockfile。Vite background 输出固定 `background.js`，content 输出单文件 `content.js`，popup多页入口在任务14加入；不让 content bundle 残留普通脚本不支持的 ESM imports。
- [ ] 建 minimal manifest，扩展 ID 与 Auth 环境登记对应，开发 key 只使用公开扩展公钥，私钥不提交：

```json
{
  "manifest_version": 3,
  "name": "CQU 快捷登录",
  "version": "0.1.0",
  "permissions": ["cookies", "storage", "alarms", "identity"],
  "host_permissions": ["https://auth.cqu.moe/*", "https://sso.cqu.edu.cn/*"],
  "background": {"service_worker": "background.js", "type": "module"},
  "incognito": "not_allowed"
}
```

不要在这一任务声明尚未构建的 popup/content 文件；任务13/14分别补 manifest。不得加 `<all_urls>`、任意代理或远程 script。学校业务域不在 host_permissions。

- [ ] 写 auth 红测试：state 不匹配、PKCE pending 过期、callback重放拒绝；刷新singleflight（10请求仅1次token刷新）；刷新后最多重放原API一次；DEVICE_REVOKED不刷新、不自动register；临时503不清令牌/Cookie。
- [ ] 实现 PKCE：crypto.getRandomValues 生成32字节 verifier/state，base64url无padding；SHA256 challenge；`chrome.identity.getRedirectURL()` 必须匹配配置的固定回调；launchWebAuthFlow interactive=true 仅用户点击登录时调用。URL固定Auth origin，使用URLSearchParams构造，不把密码或旧token拼URL。

```ts
// 令牌请求 application/x-www-form-urlencoded；不发送 client_secret。
const body = new URLSearchParams({
  grant_type:'authorization_code', client_id: config.clientId,
  code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri,
  resource: config.authOrigin,
});
```

`config` 在 shared/config.ts 定义 `{authOrigin,clientId,protocolVersion:1}`，只含公开配置；code/pending 来自通过state校验的本次callback。登录成功先保存token，再 POST devices；幂等重试同一grant，不能因注册网络失败重新OAuth申请更多设备。

- [ ] tokens 放 local 并设置 trusted-context access，content脚本拿不到它；清理auth只清授权字段而非整个LocalState，以便执行可确认Cookie归属清理。storage 读写通过同一后台队列，popup不能直接改local。
- [ ] startup/onInstalled 读状态并幂等确保5分钟alarm；旧schema迁移保留deviceId、manualOverride、enabledIntent、managed。未知更高schema进入“请更新插件”，不能重置注册。
- [ ] 跑 `npm test -- src/background/auth.test.ts src/background/storage.test.ts`、typecheck/build，确认dist manifest引用都存在，提交 `feat: add MV3 device authorization and state persistence`。

## Task 11：唯一同步入口、限额重试与代次取消

**Files（EXT）**
- Create: `src/background/api.ts`, `src/background/sync.ts`, `src/background/retry.ts`, `src/background/messages.ts`。
- Modify: `src/background/index.ts`, `src/background/storage.ts`。
- Test: `src/background/sync.test.ts`, `src/background/retry.test.ts`。

**Interfaces**
- Consumes: Task10 authorizedFetch/LocalState；DeviceStatus/CookieEnvelope。
- Produces: C6 `sync(reason)`；`setEnabled(enabled:boolean):Promise<void>`；`enterManualMode():Promise<void>`；`resumeAutomaticMode():Promise<void>`。
- `api.ts` 提供 `register(metadata)`, `status(heartbeat)`, `setDeviceEnabled(enabled)`, `refresh(generation)`, `exportCookies(generation,sessionVersion)`，deviceId从LocalState读，不接受content script传入另一个id。
- cookie writer 接口先由依赖注入传入：`applyEnvelope(envelope:CookieEnvelope,options:{localGeneration:number;allowForeignOnce:boolean}):Promise<'applied'|'foreign_session'|'cancelled'>`，Task12实现；本任务测试注入fake writer。

- [ ] 用fake timers写红测试：两个tab同时login_form只一次恢复；10个alarm调用合并；download503→共3次请求，间隔1s/3s；429 Retry-After未到无请求；write独立最多3次；401只一次续期再重放，不占网络重试预算。

```ts
await sync('login_form'); // mock第一次download 503；调度而非永久阻塞worker
expect(exportCalls).toBe(1);
await advanceClock(999);
expect(exportCalls).toBe(1);
await advanceClock(1);
expect(exportCalls).toBe(2);
```

`advanceClock(ms)` 在本测试定义：推进 Vitest timer 并触发 fake alarm；生产不靠测试用 setTimeout 活过 worker 重启。

- [ ] 实现 persisted RecoveryRound。短等待活跃worker可用timer，但nextAttemptAt写入storage并安排一个合法最早的Chrome alarm作为重启后兜底；不宣称Chrome能保证1秒alarm。唤醒时now<nextAttemptAt则不请求，实际晚于目标允许。下载超时用AbortController 15s；取消/关闭不当重试失败。
- [ ] 定义同步顺序，照此实现，不在popup再复制一套：

```text
读取state → 若无授权只返回未登录 → 心跳查服务器状态
→ revoked：退出及归属清理
→ master关/子开关关：取消本地工作，清理归属Cookie，保留服务器子开关意图
→ manualOverride/恢复轮次manual_required：只更新状态，不写Cookie
→ preparing/refreshing：等待下一次检查，面板打开时最多每3秒查状态至60秒
→ ready且版本更新：导出、校验、交给Cookie writer
→ 同版本：默认不写；仅login_form且管理Cookie确实缺失、无外来TGC时允许一次恢复
```

面板短轮询是后台同一singleflight队列的额外触发，不叠加多个interval；60秒后继续正常5分钟alarm，保留“正在准备”。refresh接口仅explicit enable/恢复且服务端状态允许时调用，既有refreshing不重复叫容器重登。

- [ ] `setEnabled(false)` 先localGeneration+1并持久化暂停，取消可取消请求，发服务器关闭请求；网络失败明确“本机已暂停，云端关闭待同步”，持久化待发送操作，重连先完成关闭再同步。不能因为请求失败恢复本地开关。开启则等待服务端成功占位，失败展示MASTER_DISABLED/额度原因；不伪造enabled。
- [ ] 手动模式先持久化manualOverride=true/localGeneration+1，保留heartbeat；resume只清该标记并重新检测外来TGC，不直接授权覆盖。明确设备revoke先停止任务、按Task12清理，再清token，旧请求晚到不能register。
- [ ] 加 worker重启后预算不重置、关闭时下载晚到不写、同版本不覆盖、不同generation先刷新状态等用例，跑sync/retry测试和typecheck，提交 `feat: coordinate background synchronization and bounded retries`。

## Task 12：Cookie 校验、归属保护和中断恢复

**Files（EXT）**
- Create: `src/background/cookie-store.ts`, `src/background/cookie-journal.ts`, `src/shared/cookie-validation.ts`。
- Test: `src/background/cookie-store.test.ts`, `src/background/cookie-journal.test.ts`。
- Modify: `src/background/index.ts`（启动恢复journal）、`src/background/sync.ts`（接真实writer）。

**Interfaces**
- Consumes: C2 CookieEnvelope、C6 ManagedCookie/journal；Task11 applyEnvelope签名。
- Produces: `applyEnvelope(...)`；`clearOwnedCookies():Promise<void>`；`recoverInterruptedWrite():Promise<void>`；`inspectLocalTgc():Promise<'missing'|'managed'|'foreign'>`。

- [ ] 建合成Cookie fixture覆盖 host-only/domain、path、secure/httpOnly、sameSite、expires=-1。Chrome写入时host-only不传domain；domain Cookie传点前缀；session不传expirationDate；SameSite映射 Strict→strict/Lax→lax/None→no_restriction，URL固定https SSO域和Cookie path。
- [ ] 写失败测试：第2个set抛暂时错误，回滚第1个；第1个写后被学校轮换则不回滚它；外来TGC拒绝默认覆盖；同名不同path/store不能误删；写入回读不一致不更新appliedVersion；无权限错误直接不重试。

```ts
await expect(applyEnvelope(envelope, {localGeneration:1,allowForeignOnce:false}))
  .rejects.toMatchObject({code:'COOKIE_WRITE_TRANSIENT'});
expect((await readLocalState()).appliedVersion).toBeNull();
expect(await fakeCookies.getValue('SOURCEID_TGC','/')).toBe('previous-test-value');
```

fakeCookies.getValue 属test/chrome-fake.ts测试helper，必须从真实fake store读；fixture和响应不包含用户Cookie。

- [ ] 实现整包预校验，再捕获current Cookie与摘要。选择普通profile的storeId：从extension tab所在Cookie store/当前普通profile上下文确定，发现incognito/store不一致拒绝，不硬编码截图里的0；所有get/set/remove使用同一storeId。
- [ ] 写journal先于每个set，旧Cookie明文只留storage.session；摘要含name/domain/path/storeId/value和安全属性。写前复查当前值与快照一致，否则本轮终止并保护外来变化。写后检查generation再回读核对；server/local generation变化走回滚，不应用旧版本。
- [ ] 回滚规则逐entry执行：当前==本轮expectedDigest且旧快照存在→恢复旧值；原本新增且当前匹配→删新增；当前变了→保留；快照丢失且不知道旧值→保留并提示重试。恢复journal绝不把未完成应用标ready。成功写后managed更新、appliedVersion更新与journal完成标志同一storage set，然后清session快照。
- [ ] 清理采用managed摘要匹配，不按Cookie名字一律删除。导出新包不再包含的旧managed条目，仅仍匹配时删；未管理Cookie不删。明确allowForeignOnce由用户切换按钮触发，仅消费一次，不能存永久true。
- [ ] 加10个中断点的表驱动测试：journal存前/后、每个set前/后、全部set后未commit、commit后未删journal；重新构造worker实例恢复。测试权限撤销、secure/samesite拒绝、session过期不重试，transient最多由Task11预算重试两次。
- [ ] 跑cookie两文件、sync回归及typecheck/build，提交 `feat: safely apply and recover managed SSO cookies`。

## Task 13：学校登录表单检测与一次恢复

**Files（EXT）**
- Create: `src/content/login-page.ts`, `src/content/status-banner.ts`, `src/shared/messages.ts`。
- Modify: `src/background/messages.ts`, `public/manifest.json`, `vite.config.ts`。
- Test: `src/content/login-page.test.ts`, `src/background/login-recovery.test.ts`。

**UI skills（必须先读）**
- `/Users/uu/.codex/skills/emil-ask-emil/SKILL.md`：路由到 forms-and-inputs / touch-and-accessibility 中本阶段最相关项。
- `/Users/uu/.codex/skills/emil-unslop-design/SKILL.md`：内联提示简短，不能遮挡学校表单；交付前复查。

**Interfaces**
- Consumes: Task11 sync/recovery、C6持久轮次。
- Produces: `detectLoginForm(document:Document,url:URL):boolean`；消息 union `{type:'LOGIN_FORM_VISIBLE'}`、`{type:'ENTER_MANUAL'}`、`{type:'RETRY_AUTOMATIC'}`、`{type:'GET_UI_STATE'}`。content不可提交URL作为任意代理目标、不可索取token/Cookie。

- [ ] 用脱敏实际学校HTML或手工结构fixture写红测试：正确SSO host/path且可交互username+password+submit表单才true；HTTP200普通页、412挑战、验证码单页、隐藏模板、业务域含login均false。URL路径以现有实际SSO `/login` 及确认过的等价路径白名单为准，未知路径false，不使用substring。
- [ ] manifest content_scripts仅`https://sso.cqu.edu.cn/*`，run_at document_idle；脚本先hostname/path guard，再MutationObserver检查可见表单。观察使用去抖，不读/传密码或人工验证码字段值。测试只读取元素结构和可见性。
- [ ] background校验sender.id、sender.tab、sender.url来自SSO；popup消息另验extension origin。拒绝页面任意postMessage或external message控制后台。后台从sender取得原tab和URL，解析允许的SSO原地址，不接收content自报任意URL。
- [ ] 成功恢复最多重新导航原SSO URL一次；记录recovery.phase=navigated及tabId先于导航，避免worker重启重复。保留原service参数，不抽取、不缓存、不消费ticket，不额外fetch出票作本地探测。

```ts
// 跨tab共同的本轮状态优先于页面刷新次数。
if (round?.phase === 'navigated' && sameGeneration) {
  await markManualRequired(); // 在background内更新持久round
  return {kind:'manual_required', message:'快捷登录未成功，请在学校页面手动登录。'};
}
```

`markManualRequired():Promise<void>` 定义在background/sync.ts：将recovery.phase置manual_required并暂停自动Cookie应用，直到用户主动重试/恢复。它不改变云端enabled、不给服务端发送session失效断言。

- [ ] 测试第二个tab首见表单与导航后确认的关系：只有完成写入后再次观测到当前表单（新document或导航完成后的检测）才判失败；写入前排队的旧通知不得当“写后仍登录”。消息处理记录documentId（浏览器提供时）或后台分配的导航序号，旧序号丢弃。
- [ ] 内联提示用textContent、role=status和“手动登录/重试”原生button，手动选择继续用原表单；未知/风控页保留学校提示，不当密码错误。用户开始输入后避免在输入过程中强制导航：本轮尚未操作完成则提示可切换，默认让用户继续手动输入并设置manualOverride。
- [ ] 跑content/recovery测试、typecheck/build，手动检查可键盘关闭提示且不挡表单，提交 `feat: recover school login once and preserve manual login`。

## Task 14：插件弹窗与用户状态

**Files（EXT）**
- Create: `popup.html`, `src/popup/main.ts`, `src/popup/view-model.ts`, `src/popup/style.css`。
- Modify: `src/background/messages.ts`, `src/shared/messages.ts`, `public/manifest.json`, `vite.config.ts`。
- Test: `src/popup/view-model.test.ts`。

**UI skills（必须先读）**
- `/Users/uu/.codex/skills/emil-ask-emil/SKILL.md`：先路由design-foundations，再forms-and-inputs；沿用Auth视觉，不另选营销风格。
- `/Users/uu/.codex/skills/emil-unslop-design/SKILL.md`：设计和交付复查，删除无信息卡片/徽章/装饰。

**Interfaces**
- Consumes: DeviceStatus/LocalState/ErrorCode。
- Produces: `derivePopupView(input:PopupInput):PopupView`，类型在view-model.ts：input含authorized、status|null、manualOverride、localWriteState、lastError|null；view含heading、description、switchEnabled、switchChecked、actions。消息新增 LOGIN、SET_ENABLED(enabled)、RESUME、SWITCH_TO_MANAGED、OPEN_SETTINGS；只允许popup sender使用。

- [ ] 写状态表红测试：未登录→登录Auth；未绑定→设置入口；master关→“请先在 Auth 开启快捷登录”；quota满→可管理设备；preparing→“正在准备”；cloud ready/local未写→不显示已完成；local已写→“快捷登录已准备”；manual→“已切换手动登录”；revoked→“此设备已退出快捷登录”。
- [ ] 实现固定宽度约360px、一个当前设备开关、实际状态行和必要操作。未完成服务器enable时禁用重复提交；失败保留原因，不乐观冒充成功。quota0也保留登录状态/设备管理，不隐藏退出操作。
- [ ] Auth设置链接固定origin，带本deviceId作为展示hint；网页必须验证它属于当前用户后才能标“当前插件”。hint不是授权，不允许凭query跨用户访问。弹窗不展示Cookie/学校密码。
- [ ] 外来会话状态显示“已有学校登录，继续使用当前会话”，显式“切换为快捷登录”才调用一次性allowForeignOnce；手动模式恢复与外来切换分开，不把恢复按钮变为无条件覆盖。
- [ ] 消息处理返回有限UI DTO，不把LocalState原对象带token/journal返回。CSS继承Auth主色/字号与按钮形态，避免无用动画。补 manifest action.default_popup，构建检查引用。
- [ ] 完成键盘focus、开关label、loading/error/disabled对比度检查；截图只含合成账号信息。运行view-model及既有client测试、build，提交 `feat: add a focused quicklogin popup`。

## Task 15：Auth 用户设备列表、总开关与管理员额度

**Files（AUTH）**
- Create: `frontend/src/components/quicklogin/QuickloginSettings.tsx`, `DeviceList.tsx`, `QuotaEditor.tsx`, `api.ts`。
- Modify: `frontend/src/pages/Settings.tsx`, `frontend/src/pages/Admin.tsx`。
- Test: `frontend/src/components/quicklogin/QuickloginSettings.test.tsx`, `QuotaEditor.test.tsx`。

**UI skills（必须先读）**
- `/Users/uu/.codex/skills/emil-ask-emil/SKILL.md`：设置页布局→design-foundations，表单操作→forms-and-inputs。
- `/Users/uu/.codex/skills/emil-unslop-design/SKILL.md`：全程应用，提交前视觉检查。复用SettingsCard、现有字体颜色图标，不做新设计系统。

**Interfaces**
- Consumes: C4 session-only用户接口/管理员preview和apply。
- Produces: `QuickloginSettings({currentDeviceHint?:string})`；`DeviceList({data:DeviceList,onRevoke:(id:string)=>Promise<void>})`；`QuotaEditor({userId:string,onSaved:()=>void})`。为避免组件与DTO同名，import DTO为DeviceListData。

- [ ] 先用现有前端测试运行方式写红测试，必要时仅为该组件配置jsdom与现有testing-library，不改整个后端测试环境。覆盖总开关、空列表、0额度仍可管理/退出、在线临界10分钟、网络失败保留旧列表。
- [ ] 从Settings现有quicklogin卡提取组件，替换eligible门禁为masterEnabled/deviceLimit/used；文字“已启用 2 / 5 台”。每条显示名称、Chrome版本、启停原因、最后联系、最近IP、当前插件hint和退出按钮；移动端信息换行，不横向挤压全部列。
- [ ] 完整时间用可聚焦的展开详情或原生time+清晰完整文本，不只鼠标title。IP缺失显示“暂无”，不伪造0.0.0.0或地理位置。“在线状态根据最近联系时间估计”在列表说明中出现一次。
- [ ] 退出确认及列表常驻文案必须为：

```text
退出后将停止此设备的快捷登录；已登录的学校系统可能仍保持登录。
```

按钮只调用目标DELETE并重新读列表，不清网页session、不调用学校logout。master切换完成后重读列表，子开关仍显示原意图。用户网页不新增未批准的跨设备开启权限，保留列表/退出/总开关；子开关在插件操作。

- [ ] 管理员QuotaEditor用非负整数输入；保存前POST preview并显示保留/停用名单，确认后PUT token。409 PREVIEW_CHANGED显示最新名单并要求再次点击确认，不能自动重放新token。名单不变的服务器允许保存不再打扰。

```ts
// 组件测试的关键用户路径
await setQuotaInput('3');
await clickPreview();
expect(screen.getByText('将停用 2 台设备')).toBeVisible();
await clickConfirm(); // mock server 409 + 最新preview
expect(applyRequests).toHaveLength(1);
expect(screen.getByText('设备状态已变化，请确认最新名单')).toBeVisible();
```

上述helper在QuotaEditor.test.tsx用用户事件实现；不得直接调用组件内部setState。generic entitlement UI中新增额度项引导专用编辑器，避免重复路径绕过预览。普通admin无权限不显示编辑且后端仍拒绝。

- [ ] 测试preview过期/并发心跳、额度5→3→0→5不会自动复启、服务器错误不显示保存成功。运行两前端测试、typecheck与`npm run build:frontend`；截图检查桌面/小屏和键盘，提交 `feat: manage quicklogin devices and quota in Auth`。
