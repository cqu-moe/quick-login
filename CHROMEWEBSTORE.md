# CQU 快捷登录 · Chrome Web Store 提交材料

更新日期：2026-10-14（Asia/Shanghai）。状态：0.4.6 已上传并提交 Google 审核，选择审核通过后自动发布；后台显示待审核，当前已发布版本为 0.4.4（Unlisted）。

本文件集中维护商店文案、权限说明、数据申报和待办；版本更新说明仍以 `docs/releases/X.Y.Z.md` 为准。以下内容依据 0.4.6 源码、正式包、实际商店状态及官方文档整理，待确认项不能当作已满足的承诺。

## 当前判断

0.4.3 已补齐品牌 PNG 图标、manifest 简介、440×280 RGB 宣传图及 1280×800 真实授权恢复截图，并修复独立标签页打开弹窗时的消息路由。官网隐私页已发布，浏览器读回更新日期为 2026 年 10 月 10 日。当前为 Manifest V3，四项浏览器权限和三个精确站点，无 `<all_urls>`。

商店 Item ID：`ainapeknaclcpoioimonkodmoakhacjd`。已提交商品详情、隐私申报、普通审核账号及不公开分发；账号密码只填 Google 保密测试字段。最终源提交、包摘要和发布证据统一记录到 `docs/operations/quicklogin-release.md` 与 `quicklogin-handoff.md`。

本地和实际 Ego 浏览器已验证授权恢复弹窗，不代表学校 SSO 或商店签名安装验收。审核账号没有学校绑定，用户明确要求只提供普通测试账号；如审核需要完整学校登录，需要审核员自己的合法重庆大学账号。

## 商店文案（可复制草稿）

名称：CQU 快捷登录

简短描述（132 字符以内）：为重庆大学统一认证同步登录状态，减少重复登录；支持设备管理、手动登录和授权恢复。需要 CQU.MOE Auth 账号及 QuickLogin 使用资格。

后台类别：工具（效率分类下）。主要语言：中文（中国）。

单一用途：为有使用资格的重庆大学用户在当前浏览器维护统一认证登录状态，减少访问学校服务时的重复登录。

详细描述：

```text
CQU 快捷登录为重庆大学统一认证同步登录状态，减少打开学校服务时的重复登录。

你可以查看当前浏览器的准备和同步状态，暂停快捷登录，在已有学校登录与快捷登录之间明确选择，并在授权失效时重新连接当前设备。需要时也可以继续手动登录。

使用前需要 CQU.MOE Auth 账号、已绑定的重庆大学账号和 QuickLogin 使用资格。当前仍为内测服务；安装扩展不会自动获得资格。

安装后点击工具栏中的扩展图标，前往 Auth 完成设备授权，再等待扩展显示已就绪，然后打开需要统一认证的学校服务。服务故障或学校要求额外验证时，请按界面提示处理或手动登录。

扩展仅访问 Auth、重庆大学统一认证站点及 CQU.MOE 诊断服务。扩展自身不读取或保存学校密码；Auth 在学校账号绑定和会话流程中处理必要凭据。扩展处理授权令牌和统一认证 Cookie，并在启用诊断时发送操作结果、耗时、有限错误分类，以及已连接账号的内部标识（未连接时使用独立安装标识）；诊断不上传 Cookie、账号凭据或输入内容。详细数据用途见隐私说明。

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
| 截图 | 至少 1 张、最多 5 张，1280×800 或 640×400 | 已准备 store-assets/screenshot-reconnect.png，1280×800 RGB，无 alpha |
| 小宣传图 | 440×280 PNG/JPEG | 已生成 store-assets/promo-small.png，440×280 RGB，无 alpha |
| 大宣传图 | 1400×560 PNG/JPEG | 可选 |

截图使用真实“需要重新连接 Auth”弹窗，配以授权恢复说明。只能使用实际功能画面，去除个人信息、凭据与令牌；`docs/acceptance/quicklogin-home.png` 不能直接当作当前商店截图。使用 CQU.MOE 自有标识；学校校徽或其他授权状态不明的标识不作为默认素材。

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

商店包通过 scripts/package-webstore.py 从 dist 生成，仅移除 canary 公钥字段；ZIP 内容、版本、来源提交和 CRC 在上传前核验。

## 隐私与数据申报

必须申报数据处理。官方明确：仅在本地处理的数据也要披露。以下分类已按 Dashboard 定义填写；正式包沿用 canary 的诊断配置。

| Dashboard 数据类型 | 后台选择 | 实际范围与用途 |
| --- | --- | --- |
| Personally identifiable information | 是 | 账号关联的设备/安装标识、设备名称与浏览器元数据；Auth 账号流程处理账号信息。随机标识不能作为“不收集”的理由。 |
| Authentication information | 是 | OAuth 授权令牌、统一认证 Cookie；Auth 还处理学校账号绑定凭据。扩展本地 Cookie 回滚快照不会作为诊断上传。 |
| User activity | 是（诊断启用时） | connect/sync/cookie_apply/enable/disable/resume/switch_managed 的结果与耗时，含版本、有限错误分类、已连接账号的内部标识或未连接时的独立安装标识。正式 canary 的 CI 注入新项目诊断配置；不录制扩展或学校页面。 |
| Website content | 是，限定本地 DOM 检测 | 仅检测统一认证登录页表单结构以展示提示；不读取输入值、不上传页面内容。 |
| Web history | 否 | 内容脚本检查当前 SSO URL 和登录表单是否可见，不读取浏览历史列表、不记录其他站点浏览轨迹；Dashboard 将此项定义为访问的网站列表；此扩展不收集该列表。 |
| Location | 是 | 服务端请求处理涉及来源 IP；诊断 SDK 配置 ip:false 及 $geoip_disable:true。不能据此推断代理访问日志或服务端地理解析完全不存在。 |
| Health information | 否 | 当前功能不处理该类数据。 |
| Financial information | 否 | 当前功能不处理该类数据。 |
| Personal communications | 否 | 当前功能不读取个人通信内容。 |

隐私页：[https://quicklogin.cqu.moe/privacy/](https://quicklogin.cqu.moe/privacy/)。源码已补充 CQU.MOE 运营与支持邮箱、Cloudflare 与 PostHog、清理后的错误信息及环境数据、保存与删除方式。没有统一自动删除承诺，撤销授权不表示所有历史记录立即删除。生产 URL 已在本次通过实际浏览器读取验证。

三项有限使用认证已按当前项目用途填写：不出售用户数据、不用于与单一用途无关的目的、不用于信用或借贷评估。未来运营或代码改变时需要同步修订政策及申报。

## 账号与分发

发布者名称：401doubleu。联系与支持邮箱：uu@401.moe（Dashboard 已验证）。主页：`https://quicklogin.cqu.moe/`。

在 [Developer Dashboard](https://chrome.google.com/webstore/devconsole/) 注册，支付一次性注册费（金额以后台为准），启用 Google 账号两步验证，填写并验证发布者联系邮箱。交易者身份、地址等字段按后台实际要求和运营事实填写。

分发已设置 Unlisted（不公开），免费，保留所有地区默认选择，供有使用资格的人通过直链安装。Unlisted 仍允许知道链接的人安装，使用资格继续由 Auth 控制；如需限定 Google 账号安装，用 Private / trusted testers。所有模式都需要审核。地区选择由运营者确认。

## 扩展 ID 与 Auth 门禁

当前 manifest.key 对应 canary ID `igfidegfgfoofnoncpmbcokbffjmmook`，公开 clientId 为 `cqu-quicklogin-chrome`。**不能假定商店 ID 与 canary ID 相同。**

商店 ID 与 canary ID 不同。已在现有 public client 上登记两个精确回调：

- `https://igfidegfgfoofnoncpmbcokbffjmmook.chromiumapp.org/`
- `https://ainapeknaclcpoioimonkodmoakhacjd.chromiumapp.org/`

Auth 配套修改已部署，同时接受上述两个 ID 的精确 `chrome-extension://` Origin，保留已有 canary、PKCE S256 与 `openid offline_access cqu:quicklogin:device` scopes；不使用通配 Origin。后端部署证据独立记录。正式商店安装可能产生新设备，不能承诺 unpacked 授权自动迁移。

Chrome Web Store 拒绝 ZIP 中的 manifest.key；源清单与 canary 保留原公钥，商店打包脚本只从该发行包移除 key，不提交私钥或改变 canary ID。

## 审核测试说明（已保存普通账号）

审核员通常不具备学校账号、CQU.MOE 内测资格或实时验证码。若无法验证核心功能，只有演示视频和截图不能保证审核通过。

已按用户要求创建普通 Auth 专用审核账号，设置两台设备额度，密码登录验证成功；没有学校绑定，也不具备管理权限。审核员可体验 Auth 与 QuickLogin 界面，但验证实际学校 SSO 仍需要其自己的合法学校账号及绑定。审核说明必须披露这个限制，不能声称已提供全功能学校测试账号。禁止把个人日常账号、Cookie 或长期令牌写进仓库。凭据仅填 Dashboard 的 Test instructions，说明有效期和必要的验证步骤。

```text
普通 Auth 审核账号，已验证邮箱、QuickLogin 额度 2 台，无学校绑定，也没有管理员权限。打开扩展并前往 https://auth.cqu.moe 登录；在“CQU 集成”页体验设备管理、开关与授权流程。真实学校 SSO 需要审核员自己的合法重庆大学账号，在该页面“绑定 CQU 账户”后完成学校要求的验证码；我们不是学校官方，无法提供学校测试账号。因此未绑定时不会进入已就绪状态。可验证重新连接提示、暂停及手动登录入口。支持：uu@401.moe
```

## 打包与提交流程

1. 补图标、manifest 文案及隐私政策；涉及用户可见的扩展或服务变更时按项目规则升版本。仅本上架文档不升版本。
2. 在提交对应源码运行 `npm run typecheck`、`npm test`、`npm run build`、`npm run check:package`；官网变更也运行官网门禁。构建诊断配置必须与实际申报一致，无 token 的本地构建不会代表 CI 启用诊断的包。
3. 版本变更检查通过并合入 main 后，让现有发布工作流完成官网 canary；构建 `releases/cqu-quicklogin-<version>-canary.zip`，仅含 dist 的内容，根目录直接放 manifest.json，禁止覆盖旧包。
4. 核验 ZIP 清单、CRC、manifest 版本、build-info 和 SHA-256；记录扩展提交、包名、摘要和必要的 Auth 提交/Worker 版本。正式商店最终 ZIP 若不同，单独记录摘要，不能套用 canary 摘要。
5. 获得明确商店上传授权后，Dashboard → Add new item → 上传 ZIP。填 Store Listing、Privacy practices、Distribution、Test instructions；核对商店 ID 后完成上面的 Auth 与 Chrome 验收。
6. 获得明确提交/发布授权后 Submit for Review。本次按用户“其余上架流程自行完成”的指示选择审核通过后自动发布，并保持 Unlisted；手动分阶段发布的条目通过后有 30 天可发布。
7. 审核通过后按授权发布，记录条目 ID、商店 URL、版本、日期与审核反馈；官网安装入口再指向真实商店地址。

初审通常数日，也可能数周；官方建议超过三周联系开发者支持。本站构建/部署、canary 下载、商店上传、提交审核、审核通过和商店发布分别记录。

## 提交门禁

- [x] 发布者账号已有注册记录、联系邮箱已验证；Google 已接受本次审核提交。
- [x] 128 PNG 图标入包，manifest 引用正确；真实截图与 440×280 小宣传图齐全。
- [x] 商店文案准确表达内测资格及非学校官方身份，支持联系方式已确认。
- [x] 隐私页补齐运营者、实际服务商、保存与删除路径；生产 URL 已回读，申报与正式包一致。
- [x] 普通审核账号密码登录可用、额度 2 台，凭据与学校绑定限制已填写；完整学校 SSO 未提供。
- [x] 商店 Item ID、公钥与 Auth callback/Origin/clientId 完成核对；两个精确回调及 Origin 共存。
- [x] 最终包通过本地门禁、ZIP 核验及 Google 草稿 CRX 回读；正式 canary 在 Ego 显示正常恢复界面。
- [ ] 商店签名安装后的完整学校 SSO 验收；审核账号无学校绑定，未声明通过。
- [x] 官网 canary 已发布，受控下载 200；提交与两个渠道的包摘要已记录。
- [x] 用户已交办谷歌商城上架及其余操作；最终包已提交审核并选择自动发布。

## 商店版本记录

| 版本 | 日期 | 商店状态 | 说明 |
| --- | --- | --- | --- |
| 0.4.6 | 2026-10-14 | 待审核，获批后自动发布；当前线上0.4.4 | 更新说明见 `docs/releases/0.4.6.md` |
| 0.4.4 | 2026-10-14核验 | 已发布（Unlisted） | 本次后台实际读回 |
| 0.4.3 | 2026-10-10 | 历史送审记录，已被后续版本替代 | 更新说明见 `docs/releases/0.4.3.md` |

0.4.6 审核反馈：尚无。Google 已接受提交，状态为“待审核”；提交、包、Auth 部署与验收边界见 [发布证据](docs/operations/quicklogin-release.md)。

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
