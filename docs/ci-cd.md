# CI/CD

本文描述当前流水线的责任边界和可在本机复现的命令。自动化通过不表示已发布、已部署或已完成真实浏览器验收。

## GitHub Actions

`Checks / verify` 是稳定的必检候选：PR、main 手动触发都会执行同一个 composite 验证；main 提交在全部验证通过后才打包并上传私有 Actions artifact。当前仓库管理接口无法确认分支保护配置，不能假设该检查已经被设为 required；有权限的维护者应在 GitHub 分支保护中使用 `Checks / verify`。

验证顺序：

```sh
npm ci
npm run typecheck
npm test
npm run test:release
npm run build
npm run check:package
npm run typecheck:website
npm run build:website
npm run check:website
```

PR 也会在上述门禁全部通过后执行打包演练，但不上传构建包。main 的完整流程在同样门禁后执行：

```sh
python3 scripts/package_ci.py --output ci-artifacts
```

输出包含扩展 ZIP、官网 ZIP、`build.json` 和 `SHA256SUMS`。这些是私有 GitHub Actions artifacts，只在登录且有仓库权限时可下载；它们不挂在 GitHub Release、不提供公开直链，也不是 Chrome Web Store 包。下载后可在 artifact 目录执行：

```sh
shasum -a 256 -c SHA256SUMS   # macOS
sha256sum -c SHA256SUMS       # Linux
unzip -t cqu-quicklogin-*.zip
unzip -t quicklogin-website-*.zip
```

`scripts/package_ci.py` 复用正式发布脚本的确定性 ZIP、CRC 与逐字节回读逻辑，并校验 `package.json`、lockfile、manifest、`build-info.json` 的版本和源码提交。它不需要发布说明，也不生成可传给 `release.py publish` 的 canary 记录；因此 PR 包不改变业务版本，也不能进入私有 R2 发布通道。

触发与并发规则：

- PR 使用 `pull_request`；同源分支的普通 push 不再触发第二份 Checks，避免重复。
- main push 和 `workflow_dispatch` 使用 `checks-<ref>` 并发组，新运行可取消旧运行。
- `verify` 20 分钟超时；发布 select/publish 分别 5/30 分钟，回滚 10 分钟。
- 发布与回滚共享 `quicklogin-canary-publish` 并发组且不取消进行中的操作，保留现有互斥。

## 构建输出安全

扩展侧由 `npm run check:package` 检查：只允许批准的权限和 CSP，manifest 引用必须存在，并拒绝源码 map、`.env`、私钥、`client_secret`、token 导出和远程动态代码。官网侧由 `npm run check:website` 递归检查输出，同样拒绝 symlink、源码 map、`.env`、私钥和 `sourceMappingURL`。CI 打包前还会再次扫描两类输出。

PostHog 项目 token 是公开浏览器端标识，不是服务端 secret。Cloudflare 官网构建命令不传入 R2 或发布凭据。

## 官网 Cloudflare Builds

官网继续由 Cloudflare Workers Builds 从 main 构建部署；GitHub Actions 不部署官网。配置就绪条件：

1. Cloudflare 已登录并连接本私有仓库的 main，根目录为仓库根目录。
2. 构建环境使用 Node 22；`.nvmrc` 的 `22.22.3` 是本地与 GitHub Actions 的稳定精确 pin，Cloudflare 可使用其支持的 22.x 补丁版本。
3. Build command 使用下方完整命令，不能用只构建官网的旧命令。
4. Deploy command 保持 `npm run deploy:website`；Preview command 保持 `npx wrangler preview`。

推荐 Build command：

```sh
node -e "if (!process.version.startsWith('v22.')) throw new Error('QuickLogin requires Node 22')" && npm ci && npm run typecheck && npm test && npm run test:release && npm run build && npm run check:package && npm run typecheck:website && npm run build:website && npm run check:website
```

该命令先拒绝非 Node 22 环境，再执行扩展类型检查、全部测试、发布脚本测试、扩展构建与包检查、官网类型检查、构建和结构检查。任一环节失败时 Cloudflare Build 失败，不会执行部署命令。

## 发布与回滚边界

版本发布仍由现有 `Publish canary` 工作流执行：先完整验证，再构建带发布说明的正式 canary ZIP，创建不可变版本标签，条件写入私有 R2，读回包和元数据后推进 canary 指针。本文的 CI ZIP 不参与该流程，也不会 bump 业务版本。

`Roll back canary` 仍只能从 main 手动 dispatch，按已发布版本读取并校验 R2 对象后显式恢复指针；它不删除或覆盖历史包。Chrome Web Store 上传和发布仍必须单独人工授权。

现有发布环境与配置项只记录名称：GitHub environment `quicklogin-release`；变量 `POSTHOG_PROJECT_TOKEN`、`R2_BUCKET`；secrets `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`CLOUDFLARE_ACCOUNT_ID`。官网部署由 Cloudflare Git integration 持有部署权限，当前没有对应的 GitHub Actions website 环境。
