# QuickLogin 0.2.0 协议调查记录

2026-09-15。基线：EXT `7db7957`（0.1.4），Auth `204e0c3`。完整设计见 [协议方案](../../superpowers/specs/2026-09-15-quicklogin-020-protocol-design.md)。

## 调查测试

测试调用现有 sync、popup 归约器、消息处理及 Auth Broker 客户端，网络和 Chrome API 使用合成替身，不访问生产、不修改真实 Cookie。

从本工作树根目录执行：

```sh
./node_modules/.bin/vitest run --config docs/research/2026-09-15-protocol-020/vitest.config.ts
```

默认从相邻的 Auth 仓库读入 Broker；目录不同时设置 AUTH_REPO_DIR。测试依赖使用现有 QuickLogin node_modules，本次工作树以符号链接接入。

| 编号 | 期望的新行为 | 修复前行为 |
| --- | --- | --- |
| R1 | 本次对账网络失败后不能宣称当前 ready | 仍显示“已就绪” |
| R2 | 新 generation 下，旧 appliedVersion 不能当作完整回执 | sessionVersion 相同即跳过 export |
| R3 | 重试可恢复云端故障应发出服务端恢复命令 | 只查询 status，没有调用 refresh |
| R4 | 对账失败时旧重绑提示必须标为历史，不能继续当作当前诊断 | 仍显示“学校账号状态已变化” |
| R5 | 查询绑定服务 503 必须抛暂时不可用 | 返回 `{bound:false,epoch:0}` |

修复前：5 个测试均因目标行为缺失而失败，约半秒完成。完整输出保存在 [reproduction-output.txt](reproduction-output.txt)。退出码 1 为预期 RED，并非测试依赖加载错误。修复后：同一组业务期望迁移至 v3 接口，5/5 通过，见 [regression-output.txt](regression-output.txt)。

这组测试位于 docs/research，使用独立 vitest config，不进入原有 `npm test`。R3 已改为验证真实的 v3 operation 命令。实施中的跨仓库检查应设置 `AUTH_REPO_DIR` 指向 Auth 配套工作树。

## 调查开始时的验证

- `npm test`：14 文件、47 测试通过。
- `npm run typecheck`：通过。
- 未修改业务源码、未重新构建主目录 dist、未创建 0.2.0 安装包。
- 未部署、未检查真实 Chrome storage、未做生产登录或业务验收。

## 证据边界

截图的“需要重新绑定”在现有 popup 中来自缓存 status.state=needs_reauth。其具体原始服务端 reason 已被丢弃，不能靠截图恢复。

源码证实存在“明确密码被拒绝 → Device needs_reauth → 删除 alarm → popup 要求重绑”的路径；也存在“内部绑定查询失败 → false unbound”的路径。测试锁定的是代码行为缺口，不声称已定位截图设备当时的唯一根因。

当前代码回归已通过；发行、部署和浏览器验收证据以 operations 中的 release/handoff 记录为准。
