# Chrome Web Store 自动发布

2026-10-20：用户确认 PR 中明确版本号和更新说明；Canary 发布后自动上传商店、送审、获批后发布，保持 Unlisted。有其他版本待审时等待，只保留最新候选。用户同时要求启用 Verified CRX Uploads。

## 触发与等待

`.github/workflows/webstore.yml` 由 `Publish canary` 的成功 main 运行触发，并在每小时第 17、47 分钟检查一次。GitHub 定时任务可能延迟；这不是精确的 30 分钟 SLA。任务也可从 main 手动触发。

R2 的 `quicklogin/channels/canary.json` 是最新候选来源。没有额外队列数据库，也不依赖会过期的 Actions artifact：每次重新读取指针、不可变版本记录及 ZIP，检查 SHA-256、CRC、版本和来源提交，再准备商店包。Canary 在 A 审核期间发布 B、C 后，下一次可提交时只取 C。回滚 Canary 会改变候选；商店已有更新版本时记录 `SUPERSEDED`，不会降级。

| 商店状态 | 自动动作 |
| --- | --- |
| 目标版本已发布 | 记录 `PUBLISHED`，不重复上传 |
| 目标版本待审核 | 记录 `PENDING_REVIEW`，不重复送审 |
| 其他版本待审核 | 记录 `WAITING_REVIEW`，正常结束，下一次再检查 |
| 已审核但等待手动发布 | 记录 `WAITING_PUBLICATION`；不擅自发布已有手动暂存版本 |
| 上一版已发布、候选更新 | 上传签名 CRX，等待上传处理完成，再以 `DEFAULT_PUBLISH` 送审 |
| 拒审、政策警告或下架 | 任务失败；在 Dashboard 处理原因后再恢复 |
| 未知状态、接口失败、包校验失败 | 任务失败，不撤审、不盲目重试写入 |

商店检查使用独立的 `quicklogin-webstore-publish` 并发组，不取消正在执行的运行；后来的待执行检查替换较早的待执行检查，真正启动时重新取最新候选。它与 Canary / 回滚分组隔离，避免定时检查取消正在排队的 Canary 发布。候选在准备期间变化则停止并重试；准备完成后出现的新 Canary 留给下一次检查。不要在流水线执行期间从 Dashboard 或其他脚本并行替换草稿：Google 异步上传状态属于整个条目，不返回上传任务 ID 或草稿版本，无法将并行上传与本次包严格关联。需要人工上传时先禁用工作流并等待当前运行结束。

## Google 身份与 GitHub 配置

Google Cloud 只用于管理商店 API 身份。官网仍由 Cloudflare Builds 部署；扩展仍在 GitHub 构建。启用 Chrome Web Store API、IAM Credentials API 与 Security Token Service，创建专用服务账号，在商店发布者设置中绑定其邮箱。

GitHub OIDC 经 Workload Identity Federation 模拟该服务账号，获得带 `https://www.googleapis.com/auth/chromewebstore` scope 的短期 access token。无需保存 Google 服务账号 JSON 私钥或用户 refresh token。

WIF 信任条件必须同时限制：

- 仓库 ID `1365767829`、所有者 ID `254842203`；
- `refs/heads/main`；
- `cqu-moe/quick-login/.github/workflows/webstore.yml@refs/heads/main`；
- `repo:cqu-moe@254842203/quick-login@1365767829:environment:quicklogin-release` subject（已通过仓库 OIDC API 确认启用 immutable subject）。

在已有 GitHub environment `quicklogin-release` 配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Variable | `CWS_WORKLOAD_IDENTITY_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>` |
| Variable | `CWS_SERVICE_ACCOUNT` | 专用 Google 服务账号邮箱 |
| Variable | `CWS_PUBLISHER_ID` | `49da818d-a01c-4995-a0cd-f0f3f2535c71`，已由后台核对 |
| Secret（也兼容 Variable） | `CWS_UPLOAD_KEY_SHA256` | 上传签名公钥的 DER SPKI SHA-256；当前配置为 Secret |
| Secret | `CWS_UPLOAD_PRIVATE_KEY` | 专用 RSA PEM 上传签名私钥 |

R2 仍使用已有 `R2_BUCKET`、`CLOUDFLARE_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。商店条目固定为 `ainapeknaclcpoioimonkodmoakhacjd`，不会接受调用者传入其他扩展 ID。

## 当前配置记录

2026-10-20 已创建 Google Cloud 项目 `cqu-quicklogin-cd`（编号 `555328388321`）、服务账号 `quicklogin-webstore@cqu-quicklogin-cd.iam.gserviceaccount.com` 和 WIF provider `projects/555328388321/locations/global/workloadIdentityPools/github/providers/quicklogin`。已为该仓库的联合主体授予该服务账号的 `roles/iam.workloadIdentityUser`；服务账号已在商店发布者设置绑定；三个身份相关 GitHub environment variables 已配置。

用户自行配置上传私钥和指纹，均存为 `quicklogin-release` 的 Secret；后台已显示已登记的 Verified CRX Uploads 公钥。真实 OIDC、上传和送审验收仍需以工作流运行结果为准。

## Verified CRX Uploads

这是一把独立的上传签名密钥，与 Canary 的 `manifest.key` 和商店给用户安装包签名的密钥用途不同。生成专用 RSA 至少 2048 位私钥（当前使用 4096 位）；先安全保存备份、写入 GitHub Secret、验证完整签名链路，再在 Dashboard → 文件包 → Verified CRX Uploads 中登记 PEM 公钥并启用。

流水线从已经校验的 Canary ZIP 准备商店 ZIP，仅删除 `manifest.key`，然后用 Chrome `--pack-extension` / `--pack-extension-key` 生成 CRX3。签名之后验证 RSA 签名、公钥指纹及每个运行文件；上传使用 `.crx` 文件名和 Google 要求的 raw upload 请求头。私钥只在临时文件中供 Chrome 使用，不放入包、artifact、日志或仓库。

**启用后不能再直接上传普通 ZIP。** 妥善保管私钥；GitHub Secret 无法读回，不能作为唯一备份。官方说明丢失签名密钥需要联系商店支持，恢复可能需要一周。新增签名公钥或轮换必须先确保对应私钥和流水线可用。

## 重试、暂停与验收

手动检查最新候选：

```sh
gh workflow run webstore.yml --ref main
```

暂停全部商店自动操作（Canary 不受影响）：

```sh
gh workflow disable webstore.yml
```

处理异常后恢复：

```sh
gh workflow enable webstore.yml
gh workflow run webstore.yml --ref main
```

拒审时先在 Dashboard 阅读反馈并处理；自动任务不会撤审或替人确认政策。遇到上传成功但送审失败，先检查草稿版本。若 Google 拒绝重复上传该草稿版本，核对包后从 Dashboard 送审或发布新版本；脚本不会假定一个来源不明的草稿就是本次包。

本地测试模拟 Google/R2 边界，不能证明真实 Google 授权或发布成功。启用验收应分别记录：OIDC 换令牌、真实 API 状态、CRX 签名验证、Google 接受上传、`PENDING_REVIEW`、最终 `PUBLISHED` 和商店签名安装后的业务行为。发布摘要中的提交与包 SHA-256 是本地已验证包证据，Google 状态回读不提供远端包的 SHA-256。

## 官方依据

- [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)
- [服务账号](https://developer.chrome.com/docs/webstore/service-accounts)
- [自动发布与暂存发布](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish)
- [Verified CRX Uploads](https://developer.chrome.com/docs/webstore/update#protect-your-package-updates)
- [GitHub Actions 的 Google OIDC 认证](https://github.com/google-github-actions/auth)
