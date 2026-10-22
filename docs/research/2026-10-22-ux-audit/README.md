> 以下为修复前审计记录。修复后的实现、测试与浏览器证据见 [修复验收](FIX-VERIFICATION.md)。原始失败日志和截图保留；诊断断言已随最终文案同步。

# QuickLogin UX 审计 · 2026-10-22

结论：当前 UX 需要先修状态连贯性和恢复入口。首次登录会把“后台仍在启用”展示成“此设备已关闭”；标题与开关分别采用不同事实，用户无法据此判断是否需要操作。

本轮是审计，未修改生产实现、版本或发布流程。新增文件仅在本目录。诊断用例故意断言应有行为，因此会在当前实现上失败；它们通过独立配置运行，不进入默认 `npm test`。

## 范围与证据

- 扩展基线：`0.5.1`，提交 `f43d6488bcbe3bd81323f28159617aa84ffd8639`。
- Auth 对照基线：本机 `ce98d612880fd351285cedf4df0c2c9c244163d7`。相关读取文件没有未提交修改；未验证这些代码与线上部署完全一致。
- 覆盖：官网安装指引 → OAuth 授权 → 注册/启用 → 学校登录准备 → 浏览器同步/确认 → 关闭、手动模式、外来登录、错误和重连。
- 基线测试：24 个文件、203 项通过，见 [baseline-tests.txt](baseline-tests.txt)。
- 独立诊断：11 个用例中 10 个按预期失败，1 个旧设置路径兼容性对照通过；失败原因均是本报告描述的可见行为或恢复入口，不是测试环境启动失败。
- 运行真实后台入口、真实 popup 和内容页渲染代码，以合成服务端响应控制时序。未向真实 Auth 或学校账号发出登录、写 Cookie 或设备操作。
- 隔离浏览器检查了 10 个典型 popup 状态，见 [browser-states.json](browser-states.json)。390px 弹窗没有发现横向溢出；已查看新登录、准备中和待确认截图。
- [交互演示源码](preview.html)直接加载当前 popup 实现。消息和状态为合成；点击只记录命令。重放的 3/6/8 秒是演示节奏，不是生产耗时测量。

## 1. P1：首次登录展示了未完成操作之前的“关闭”状态

**已通过真实登录入口合成复现。**

| 时点 | 后台事实 | 用户看到 |
| --- | --- | --- |
| OAuth 成功并注册设备 | 新设备默认关闭，注册成功 | 授权已完成，下一步将自动启用 |
| 自动启用请求在途 | `enabledIntent=true`、`pendingCommand.enabled=true`，服务端快照仍为 `device_off` | **此设备已关闭；开关却打开** |
| 启用请求成功 | 新快照为 `logging_in` | **正在准备学校登录** |
| 启用请求网络失败 | 已记录 `observation=unreachable`，旧快照仍为 `device_off` | **仍然“此设备已关闭”**，不说明失败 |

代码链：Auth `src/services/quicklogin/account-reducer.ts:254–283` 新注册设备 `enabled:false`；扩展 `src/background/auth.ts:190–198` 发布注册快照；`src/background/connection.ts:32–34` 随后调用 `setEnabled(true,id)`；`src/background/sync.ts:368–381` 保存启用意图及待办命令。

缺口在 `src/background/messages.ts:45–51`：popup 输入未包含连接意图和待确认开关操作。`src/shared/protocol-v3.generated.ts:212` 优先展示旧快照的 `device_off`，且排在第 218 行网络错误之前。界面不是随机闪烁；它稳定展示了一个不适合当作当前结论的中间状态。

**最小修复方向：**把已有 `connectIntentId`/`pendingCommand` 的安全摘要传给视图，明确展示“正在开启”。在途操作失败时展示失败及重试责任；完成后才采用稳定的开/关状态。保留关闭、撤销、代际栅栏和配额检查。不要靠延迟几秒或防抖掩盖真实结果，也不要改成注册时无条件启用。

## 2. P1：标题说关闭，开关却打开；重连过程又被关闭状态盖住

**开关矛盾已通过后台投影及浏览器点击验证；重连显示已通过合成用例复现。**

`src/popup/view-model.ts:38–52` 使用本地 `enabledIntent` 决定开关，但标题可能来自服务端 `deviceEnabled=false`。无待办命令时，这种组合仍会显示“此设备已关闭 + 开关开”。在浏览器中点击该开关，发送的是 `SET_ENABLED { enabled:false }`，用户无法一次点击完成启用。

另一个方向：旧设备本地已关闭时发起重连，`authorization=authorizing` 已写入，`src/shared/protocol-v3.generated.ts:204–205` 却先返回“已关闭”。此时 popup 还提供“前往 Auth”，而不是说明授权窗口正在等待用户。

**最小修复方向：**明确区分“用户正在请求开启”“已确认开启”“账号总开关暂停”。没有在途命令时，开关与当前设备的有效开关事实保持一致；有在途命令时展示处理状态，保留停止入口。有效的新授权过程不能被旧的本地关闭意图覆盖；新的关闭操作仍须立即取消旧流程。

## 3. P1：两种恢复操作会锁住界面，10 秒后产生不必要的“不确定”提示

**真实 popup → `handleMessage` → 同步入口，慢响应合成复现。**

`src/background/messages.ts:157–160` 的 `RESUME`、`SWITCH_TO_MANAGED` 等待整个同步完成才回复。`src/popup/main.ts:95–97,134–154` 在等待期间拒绝状态刷新并锁住操作，关闭开关也不可用。`src/shared/ui-message.ts:13–16` 在 10 秒时使界面显示“操作暂未确认”，即使后台已经收到命令并仍在工作。

`actions.test.ts` 的手动恢复和外来登录切换均观察到：`正在同步 + stopDisabled:true → 操作暂未确认`。

**最小修复方向：**复用现有 `launch()`/accepted 处理方式，持久化意图后快速回复，通过状态通知呈现后续进展。接受命令与完成任务应分开；不得把“点击已接受”冒充“登录成功”。

## 4. P1：Auth 重连通路有路径和发行渠道两个不匹配

**代码核对；路径由独立诊断用例验证。生产 Chrome 联调未执行。**

1. 扩展 `src/background/messages.ts:163–165` 打开 `/settings?...&quickloginReconnect=1`。Auth `frontend/src/pages/Settings.tsx:459–460` 转到 `/settings/cqu?...`。扩展 `src/background/external.ts:7` 只允许 pathname 恰好为 `/settings`，因此来自新页面的合法重连消息会被拒绝。
2. Auth `frontend/src/lib/api/quicklogin.ts:30` 只向 Canary ID `igfidegfgfoofnoncpmbcokbffjmmook` 发消息。商店 ID 为 `ainapeknaclcpoioimonkodmoakhacjd`（本仓库 `scripts/webstore.py:18`、`README.md:41`）。只装商店版的用户无法由这段代码找到正确接收方。

用户会被提示检查插件启用情况或更新插件，而真正的问题在恢复通路。反复更新不能修复路径校验和硬编码目标。

**最小修复方向：**兼容旧设置入口并允许明确的当前设置路径，保持精确 Auth origin、顶层 frame、限时 ticket 校验。明确区分商店/Canary 接收方，绑定到发起恢复的安装实例；不要把消息无差别广播给两个插件，避免双授权。

## 5. P2：学校登录页保留了错误标题，却丢失对应恢复动作

**真实 `handleContentMessage` 与 `renderStatusBanner` 合成验证。**

`src/background/messages.ts:91–93` 把 popup 视图压成 `{kind:"recovering",message}`，丢掉主动作。`src/content/status-banner.ts:65–67` 只提供“手动登录”，仅 `manual_required` 时再给“重试快捷登录”。

结果包括：

- 学校密码被明确拒绝：显示“学校密码需要更新”，没有更新密码入口或去哪里更新的说明。
- Auth 授权失效：显示“需要重新连接 Auth”，没有重连入口。
- 检测到外来 Cookie 且学校仍显示登录表单：提示“已有学校登录”，没有“切换到快捷登录”。Cookie 的存在也不能证明当前页面确实登录成功。

**最小修复方向：**为这些状态携带受限的动作码，或至少明确提示打开 QuickLogin 执行具体动作。沿用后台来源校验；不能允许页面传入任意 URL 或绕过外来 Cookie 的显式切换许可。

## 6. P2：过程信息、用户状态和操作标签混在同一层

**代码及 10 个浏览器状态检查。属于 UX 设计判断。**

共享契约定义 31 个状态，popup 基本直接把标题作为唯一解释。所检查的 10 个场景 `description` 都为空，包括准备中、总开关关闭、手动模式和外来登录。`cloud.stage` 已有阶段事实，但未用于等待说明。

具体冲突：

- “浏览器已同步，正在确认”旁边是“重新同步”，看起来既说已完成又要求重做。底层是补对账/确认，不应给出需要重新登录的印象。
- 绑定账号、更新密码、管理名额、恢复授权都被折成“前往 Auth”，抹掉了用户要完成的任务。
- “手动登录中”来自持久 manual 模式，不代表用户此刻正在登录；用户完成手动登录后仍可能看到它。
- “已关闭”“此设备已关闭”“快捷登录已暂停”没有同时说明作用范围。开关仅有读屏名称“开启 QuickLogin”，视觉上缺少“此浏览器”的范围标注。

**最小修复方向：**保留机器状态的精细度，用户界面采用稳定主状态、简短步骤说明和具体动作。无需重写配色、布局或增加复杂设置页。

## 7. P2：首次安装到授权、管理之间存在说明断点

**当前两仓库代码核对。**

- Auth `frontend/src/components/OAuthPermissions.tsx:9–22` 未映射 `cqu:quicklogin:device`，首次授权会显示原始 scope 和“授予 cqu:quicklogin:device 权限”，没有说明授权的是当前浏览器的 QuickLogin 设备。
- 官网 `website/download/index.html:148–155` 要求连接 Auth、完成绑定/验证，然后提供 `/settings` 的“前往 Auth 管理”。这个无参数入口如今落在“账户”，QuickLogin 管理实际在 `/settings/cqu`。
- 官网让用户在 Auth 完成验证；popup 的 `complete_verification` 则在 `src/popup/view-model.ts:32` 映射为学校页面“手动登录”。设备专属挑战与账号凭据验证应说明各自目的地，避免用户在两处来回试。

**最小修复方向：**补 QuickLogin scope 的自然语言说明；安装和管理链接指向实际 CQU 集成页面；按验证所属对象给出对应入口。

## 8. P2：部分异常反馈仍然不准确

**源码检查，未做现场复现；优先级低于前面的确定性问题。**

- 手动输入：`src/content/index.ts:107–118` 立即停止本地自动检查，但旧 banner 直到后台回复/10 秒超时才更新。慢 Worker 下，用户已接管却仍看到恢复中。应先即时呈现“已改为手动登录”，再确认后台意图。
- 状态损坏/新版存储：`src/background/storage.ts:52–57` 抛错后，`src/background/index.ts:61` 对 content 统一返回 `idle`，会让 banner 消失。应区分“无需提示”和“无法读取/需要升级”。
- 响应契约错误：`src/background/sync.ts:55–64` 把非本地错误广泛归为 `unreachable`，使 `CONTRACT_INVALID` 等变成连接失败。应保留“状态无法识别/需要检查更新”等可采取行动的区别。

## 建议的用户状态与验收标准

| 用户主状态 | 次要说明 | 用户动作 |
| --- | --- | --- |
| 未连接 | 连接 Auth 后，为此浏览器准备学校登录 | 连接 Auth |
| 正在连接 Auth | 请在授权窗口完成授权 | 等待；允许取消已有流程 |
| 正在准备学校登录 | 已连接 Auth；按事实显示准备、应用到浏览器、等待确认的步骤 | 通常无需操作；保留关闭此浏览器的能力 |
| 已就绪 | 当前会话准备证据已满足 | 可关闭此浏览器的快捷登录 |
| 此浏览器的快捷登录已关闭 | 仍保留 Auth 授权 | 开启 |
| 账号快捷登录已暂停 | Auth 总开关关闭，影响全部设备 | 查看账号总开关 |
| 已改为手动登录 | 自动写入/跳转已停止 | 恢复快捷登录 |
| 需要处理 / 暂时无法连接 | 具体原因、谁负责恢复、是否会自动重试 | 更新密码 / 重新连接 / 检查状态等具体动作 |

首次连接应稳定经过：**正在连接 Auth → 正在准备学校登录 → 已就绪**。同步和确认作为准备阶段的说明；不得提前展示 ready。只有用户明确关闭或服务端确认稳定关闭时，才展示关闭结论。

修复验收必须覆盖：启用慢响应、启用失败、点击后关闭、授权取消、旧回复到达、远程关闭、总开关暂停、手动接管、已有外来 Cookie、ACK 延迟、学校登录表单再次出现。商店版和 Canary 的 Auth 重连分别实测。

“已就绪”仍需当前授权、当前会话、Cookie 精确读回及 ACK；学校页面出现登录表单时须撤销旧就绪结论。改善文案不能削弱这些证据要求。

## 最小修改范围

| 范围 | 需同步触及的位置 |
| --- | --- |
| 当前操作状态投影 | `background/messages.ts`、`popup/view-model.ts`、连接/开关时序测试；复用现有持久字段 |
| 快速接受恢复命令 | `background/messages.ts`、popup 操作测试；保留现有同步和取消机制 |
| 学校页面处理入口 | `shared/messages.ts`、`background/messages.ts`、`content/index.ts`/`status-banner.ts`、内容页测试 |
| 重连通路 | 扩展 `background/external.ts` 及测试；Auth 设置页面/消息目标及对应测试 |
| 文案与首次指引 | popup 标签、Auth scope 文案、官网安装/FAQ；共享文案若改需从 Auth canonical 源重新生成 |
| 行为修复正式发布 | 三份版本、发布说明、构建/包检查、Canary；发布证据与实机验收分别记录 |

不需要引入依赖、并行状态机、百分比进度条或人为等待时间。共享生成文件有 digest 检查，不能只手工改扩展副本。

## 复现与边界

在仓库根目录执行：

```sh
npm test
npx tsc --noEmit -p docs/research/2026-10-22-ux-audit/tsconfig.json
npx vitest run --config docs/research/2026-10-22-ux-audit/vitest.config.ts --reporter=verbose
npx vite --host 127.0.0.1 --port 4175
```

预览地址：`http://127.0.0.1:4175/docs/research/2026-10-22-ux-audit/preview.html`。

诊断日志见 [transition-results.txt](transition-results.txt)。这些红灯对应待修行为，不应改为断言错误现状来制造通过。完成修复后应把有效回归迁入对应正常测试，并更新此审计记录。

未验证生产部署版本、用户已安装的 Chrome 扩展版本、真实 OAuth/学校登录、真实外来 Cookie、长期网络恢复、商店发布及辅助技术实机表现。未执行产品构建/发布，因为本轮未修改生产实现。默认测试通过与真实流程可用是不同证据。

排除项：没有发现所检查 popup 状态的横向溢出；已有 focus 保留、旧响应 fence、reduced-motion 和 Cookie 所有权保护应继续保留。未采纳“已撤销设备可被其他浏览器直接接管”的推测：Auth overview 过滤已撤销设备，resume ticket 也有撤销及 installationId 检查。
