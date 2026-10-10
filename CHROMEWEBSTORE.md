# CQU 快捷登录 · Chrome Web Store 提交材料

更新日期：2026-10-10（Asia/Shanghai）。状态：准备中，未上传、未提交审核、未发布。

本文件集中维护商店文案、权限说明、数据申报和待办；版本更新说明仍以 `docs/releases/X.Y.Z.md` 为准。以下内容依据当前 0.4.3 候选源码和官方文档整理，待确认项不能当作已满足的承诺。

## 当前判断

0.4.3 候选已补齐品牌图标、manifest 简介及 440×280 小宣传图。当前为 Manifest V3，权限限定为四项浏览器权限和三个站点，没有 `<all_urls>`。官网隐私页已于本次通过网页读取确认可公开访问。截图、商店条目及正式扩展 ID 对应的 OAuth 验收仍待完成。

现有官网 canary 发布记录见 `docs/operations/quicklogin-release.md` 的“0.4.2 官网 canary 正式发布”：源码 `6c9cdc2d2ae83f9a127e38cd743556a07dbb6064`；包 `cqu-quicklogin-0.4.2-canary.zip`，122983 bytes；SHA-256 `ecfa184b81466f53ddad72a1c51e5051f98450f04819a6769118af4949624cec`。这些是仓库既有发布证据，本次未重新下载核验该包。该版本缺少商店图标，不能直接视为商店就绪包。

本次本地验证：在 `f4f2ce8` worktree 恢复锁定依赖后，typecheck、21 个文件 / 111 项测试、build、check:package 全部通过，包检查确认 8 个文件。测试有上游 PostHog source map 警告。未主动注入 CI 诊断 token，未生成或核验送审 ZIP；本地检查不代表商店审批或当前版本真实学校页面验收。本次仅修改上架文档和检查清单。

## 商店文案（可复制草稿）

名称：CQU 快捷登录

简短描述（132 字符以内）：为重庆大学统一认证同步登录状态，减少重复登录；支持设备管理、手动登录和授权恢复。需要 CQU.MOE Auth 账号及 QuickLogin 使用资格。

分类建议：Productivity（以 Dashboard 当前分类为准）。主要语言：简体中文。

单一用途：为有使用资格的重庆大学用户在当前浏览器维护统一认证登录状态，减少访问学校服务时的重复登录。

详细描述：

```text
CQU 快捷登录为重庆大学统一认证同步登录状态，减少打开学校服务时的重复登录。

你可以查看当前浏览器的准备和同步状态，暂停快捷登录，在已有学校登录与快捷登录之间明确选择，并在授权失效时重新连接当前设备。需要时也可以继续手动登录。

使用前需要 CQU.MOE Auth 账号、已绑定的重庆大学账号和 QuickLogin 使用资格。当前仍为内测服务；安装扩展不会自动获得资格。

安装后点击工具栏中的扩展图标，前往 Auth 完成设备授权，再等待扩展显示已就绪，然后打开需要统一认证的学校服务。服务故障或学校要求额外验证时，请按界面提示处理或手动登录。

扩展仅访问 Auth、重庆大学统一认证站点及 CQU.MOE 诊断服务。扩展自身不读取或保存学校密码；Auth 在学校账号绑定和会话流程中处理必要凭据。扩展处理授权令牌和统一认证 Cookie，并在启用诊断时发送操作结果、错误信息及随机安装标识。详细数据用途见隐私说明。

关闭或撤销快捷登录授权不等于退出所有学校网页已经建立的业务会话；如需退出，请使用对应网站的退出功能。当前不支持无痕模式。

本项目由 CQU.MOE 提供，不代表重庆大学官方产品。

支持邮箱：uu@401.moe
官网：https://quicklogin.cqu.moe/
隐私说明：https://quicklogin.cqu.moe/privacy/
```

复用商店账号的发布者名称 401doubleu 和已验证的公开联系邮箱 uu@401.moe；不以学校官方身份发布。

## 图片与资源

官方图片要求优先于技能模板中的旧提示：**440×280 小宣传图是必需项**。

| 素材 | 规格 | 当前状态 |
| --- | --- | --- |
| 扩展及商店图标 | 128×128 PNG，放入 ZIP 并在 manifest 的 icons 中引用 | 已生成 public/icons/icon-128.png，manifest 已引用 |
| 工具栏等尺寸图标 | 建议另提供 16、32、48 像素 PNG | 已分别生成 16、32、48 PNG |
| 截图 | 至少 1 张、最多 5 张，1280×800 或 640×400 | 未准备当前版本合格截图 |
| 小宣传图 | 440×280 PNG/JPEG | 已生成 store-assets/promo-small.png，尺寸已核验 |
| 大宣传图 | 1400×560 PNG/JPEG | 可选 |

截图建议：真实已就绪弹窗与学校服务入口；设备连接/授权步骤；已有学校登录时的明确切换提示。只能使用实际功能画面，去除个人信息、凭据与令牌；`docs/acceptance/quicklogin-home.png` 不能直接当作当前商店截图。使用 CQU.MOE 自有标识；学校校徽或其他授权状态不明的标识不作为默认素材。

0.4.3 manifest 已设置 description，与上面的简短描述一致。

## 权限说明（审核字段草稿）

| 权限或站点 | 用途 |
| --- | --- |
| cookies | Read, write and verify the user's authorized Chongqing University SSO session cookies on sso.cqu.edu.cn. This enables quick sign-in and detects whether an existing SSO cookie belongs to the extension before replacing or removing it. The extension does not request access to cookies on unrelated sites. |
| storage | Store this installation's device identity, authorization tokens, preferences and synchronization state. Store cookie ownership digests and recovery records to avoid overwriting another login. Previous-cookie rollback snapshots are held in session storage. Content scripts cannot access the stored authorization tokens. |
| alarms | Schedule SSO synchronization and bounded retries, including after the extension background worker restarts. Ready devices normally check every five minutes; preparing or refreshing states use shorter checks. |
| identity | Open the CQU.MOE Auth authorization flow and receive the extension-specific callback so the user can authorize this installation. It uses authorization code with PKCE; no client secret is included in the extension. |
| https://auth.cqu.moe/* | Authorize and reconnect this installation, register the device, reconcile its allowed state, retrieve the authorized SSO cookie snapshot and acknowledge application. |
| https://sso.cqu.edu.cn/* | Apply and verify only university SSO cookies. A content script detects the SSO login form and displays quick-login or manual-login guidance without reading input values. |
| https://p.cqu.moe/* | Send diagnostic operation outcomes and errors through the CQU.MOE analytics proxy when diagnostics are enabled in the build. This helps diagnose failures of the quick-login functionality. It does not load executable code from this host. |

`externally_connectable` 仅允许 `https://auth.cqu.moe/*`：用于 Auth 设置页发起当前设备的重新连接。审核说明中一起解释，不能扩大至其他站点。

远程代码字段草稿：No. All executable JavaScript, including the analytics library, is bundled in the extension package. Remote requests exchange authorization/session data and diagnostics, not executable scripts. Remote dependency loading, surveys, session recording and remote feature flags are disabled in the analytics configuration.

最终 ZIP 仍须检查，不能只依据源码申报“无远程代码”。

## 隐私与数据申报

必须申报数据处理。官方明确：仅在本地处理的数据也要披露。以下是源码支持的草稿分类，提交前按正式包配置和实际 Auth/诊断服务核对。

| Dashboard 数据类型 | 草稿选择 | 实际范围与用途 |
| --- | --- | --- |
| Personally identifiable information | 是 | 账号关联的设备/安装标识、设备名称与浏览器元数据；Auth 账号流程处理账号信息。随机标识不能作为“不收集”的理由。 |
| Authentication information | 是 | OAuth 授权令牌、统一认证 Cookie；Auth 还处理学校账号绑定凭据。扩展本地 Cookie 回滚快照不会作为诊断上传。 |
| User activity | 是（诊断启用时） | connect/sync/cookie_apply/enable/disable/resume/switch_managed 的结果和异常，含版本、错误码及随机安装标识。正式 canary 的 CI 可注入诊断配置。 |
| Website content | 是，限定本地 DOM 检测 | 仅检测统一认证登录页表单结构以展示提示；不读取输入值、不上传页面内容。 |
| Web history | 提交前核对限定访问是否应勾选 | 内容脚本检查当前 SSO URL 和登录表单是否可见，不读取浏览历史列表、不记录其他站点浏览轨迹；需按 Dashboard 定义如实披露限定的站点交互。 |
| Location | 待服务核对 | 服务端请求处理涉及来源 IP；诊断 SDK 配置 ip:false。不能据此推断代理访问日志或服务端地理解析完全不存在。 |
| Health information | 否 | 当前功能不处理该类数据。 |
| Financial information | 否 | 当前功能不处理该类数据。 |
| Personal communications | 否 | 当前功能不读取个人通信内容。 |

隐私页：[https://quicklogin.cqu.moe/privacy/](https://quicklogin.cqu.moe/privacy/)，本次读取成功。现有说明覆盖权限、Auth 与诊断边界，仍需补充：

- 实际运营主体和隐私联系邮箱/支持路径。
- 诊断代理实际转发至 PostHog 的处理关系；Cloudflare 等实际服务商、数据处理地点和用途按服务配置核对。
- 授权、设备记录、诊断和访问日志各自的保存期限、删除方式；撤销设备授权不能表述为所有历史数据立刻删除。
- 错误诊断可能含清理后的异常信息/堆栈及 SDK 附带的环境信息，不能只列出手写事件属性。

数据使用声明的三项认证（不出售数据、不用于无关目的、不用于信用或借贷评估）必须由实际运营者确认。源码中的脱敏和开关只能证明部分技术行为，不能替代运营事实确认。

## 账号与分发

发布者名称：401doubleu。联系与支持邮箱：uu@401.moe（Dashboard 已验证）。主页：`https://quicklogin.cqu.moe/`。

在 [Developer Dashboard](https://chrome.google.com/webstore/devconsole/) 注册，支付一次性注册费（金额以后台为准），启用 Google 账号两步验证，填写并验证发布者联系邮箱。交易者身份、地址等字段按后台实际要求和运营事实填写。

分发建议：先 Unlisted，供有使用资格的人通过直链安装；准备全面开放后再选 Public。Unlisted 仍允许知道链接的人安装，使用资格继续由 Auth 控制；如需限定 Google 账号安装，用 Private / trusted testers。所有模式都需要审核。地区选择由运营者确认。

## 扩展 ID 与 Auth 门禁

当前 manifest.key 对应 canary ID `igfidegfgfoofnoncpmbcokbffjmmook`，公开 clientId 为 `cqu-quicklogin-chrome`。**不能假定商店 ID 与 canary ID 相同。**

1. 获得明确上传授权后创建商店草稿条目，记录实际 Item ID；上传不等于发布。
2. 在 Package → View public key 读取商店公钥。按官方方法用于开发构建，比较本地扩展 ID 和 Dashboard Item ID。manifest.key 是公钥，不应索取或提交私钥。
3. 若 ID 不同，先规划正式客户端与 canary 共存，避免替换配置导致旧安装失效。核对或登记精确回调 `https://<store-id>.chromiumapp.org/`、Origin `chrome-extension://<store-id>`、public client、PKCE S256 和 `openid offline_access cqu:quicklogin:device` scopes；不要用通配 Origin 绕过问题。
4. Auth 登记或部署属于后端工作，需要任务明确包括后端后再执行。当前文档没有修改 Auth。
5. 用匹配商店 ID 的 Chrome 构建完成授权、同步、真实学校服务页面、暂停、撤销和重连验收。不能直接承诺从 unpacked 迁移到商店安装保留设备授权；应验证是否产生新安装及额度影响。

## 审核测试说明（需补齐账号后提交）

审核员通常不具备学校账号、CQU.MOE 内测资格或实时验证码。若无法验证核心功能，只有演示视频和截图不能保证审核通过。

已按用户要求创建普通 Auth 专用审核账号，设置两台设备额度，密码登录验证成功；没有学校绑定，也不具备管理权限。审核员可体验 Auth 与 QuickLogin 界面，但验证实际学校 SSO 仍需要其自己的合法学校账号及绑定。审核说明必须披露这个限制，不能声称已提供全功能学校测试账号。禁止把个人日常账号、Cookie 或长期令牌写进仓库。凭据仅填 Dashboard 的 Test instructions，说明有效期和必要的验证步骤。

```text
This extension is intended for Chongqing University users and requires a CQU.MOE Auth account with QuickLogin access and an authorized university account binding.

Test account and any required verification steps: [enter the dedicated test details in the Dashboard only].

1. Install the extension and open its toolbar popup.
2. Follow the prompt to CQU.MOE Auth and sign in using the dedicated test account. Authorize this installation.
3. Return to the popup and wait for the ready state. The test account must have QuickLogin enabled and an available device slot.
4. Open the supplied university service entry: [insert a tested service URL]. Verify that the SSO flow reaches the actual service page.
5. Pause quick login and verify the popup state. If an existing SSO login is detected, confirm that replacement requires an explicit user choice.
6. In Auth settings, revoke this test device and verify that further synchronization stops. Existing university service sessions may remain valid until the service logs them out.

Support contact for review: [insert confirmed contact].
```

## 打包与提交流程

1. 补图标、manifest 文案及隐私政策；涉及用户可见的扩展或服务变更时按项目规则升版本。仅本上架文档不升版本。
2. 在提交对应源码运行 `npm run typecheck`、`npm test`、`npm run build`、`npm run check:package`；官网变更也运行官网门禁。构建诊断配置必须与实际申报一致，无 token 的本地构建不会代表 CI 启用诊断的包。
3. 版本变更检查通过并合入 main 后，让现有发布工作流完成官网 canary；构建 `releases/cqu-quicklogin-<version>-canary.zip`，仅含 dist 的内容，根目录直接放 manifest.json，禁止覆盖旧包。
4. 核验 ZIP 清单、CRC、manifest 版本、build-info 和 SHA-256；记录扩展提交、包名、摘要和必要的 Auth 提交/Worker 版本。正式商店最终 ZIP 若不同，单独记录摘要，不能套用 canary 摘要。
5. 获得明确商店上传授权后，Dashboard → Add new item → 上传 ZIP。填 Store Listing、Privacy practices、Distribution、Test instructions；核对商店 ID 后完成上面的 Auth 与 Chrome 验收。
6. 获得明确提交/发布授权后 Submit for Review。建议选择审核通过后手动发布；官方说明通过后有 30 天可发布，超时回草稿需要重新送审。
7. 审核通过后按授权发布，记录条目 ID、商店 URL、版本、日期与审核反馈；官网安装入口再指向真实商店地址。

初审通常数日，也可能数周；官方建议超过三周联系开发者支持。本站构建/部署、canary 下载、商店上传、提交审核、审核通过和商店发布分别记录。

## 提交门禁

- [ ] 发布者账号、注册费、两步验证、联系邮箱验证完成。
- [ ] 128 PNG 图标入包，manifest 引用正确；截图与 440×280 小宣传图齐全。
- [ ] 商店文案准确表达内测资格及非学校官方身份，支持联系方式已确认。
- [ ] 隐私页补齐运营者、实际服务商、保存期限与删除路径；申报与正式包一致。
- [ ] 审核测试账号、权限与验证步骤实际可用。
- [ ] 商店 Item ID、公钥与 Auth callback/Origin/clientId 完成核对。
- [ ] 最终包通过本地门禁、ZIP 核验及真实 Google Chrome 授权/学校页面验收。
- [ ] 涉及版本变更时官网 canary 已发布，提交与包摘要已记录。
- [ ] 上传、提交审核及发布各动作具备明确授权。

## 商店版本记录

| 版本 | 日期 | 商店状态 | 说明 |
| --- | --- | --- | --- |
| 0.4.3 | 2026-10-10 | 准备中，未上传 | 候选版已补图标及隐私说明；更新说明见 `docs/releases/0.4.3.md` |

审核反馈：尚无；没有提交记录。

## 官方依据

- [注册开发者账号](https://developer.chrome.com/docs/webstore/register)
- [设置发布者信息及验证邮箱](https://developer.chrome.com/docs/webstore/set-up-account)
- [两步验证要求](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)
- [首次上传、提交及延迟发布](https://developer.chrome.com/docs/webstore/publish)
- [图片要求](https://developer.chrome.com/docs/webstore/images)
- [隐私字段、权限与远程代码](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [用户数据与本地处理的披露要求](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [分发可见性](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [公钥与一致扩展 ID](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [审核流程与时长](https://developer.chrome.com/docs/webstore/review-process)
