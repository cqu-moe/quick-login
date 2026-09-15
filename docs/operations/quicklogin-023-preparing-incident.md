# 0.2.2 / 0.2.3：长时间“准备登录”故障

2026-09-15，时间均为北京时间。

## 线上证据

在 Auth `0f640b5` / Container 67 / 插件 0.2.1 上，同一账号的两台设备持续显示“正在准备学校登录”，但实际状态不同：

- 第一台 `queued`，operationId、stage、deadlineAt、retryAt 均为空；21:27—21:31 多次快照保持此状态，客户端心跳持续增加。
- 第二台任务 `ff7090cd-da6f-41ca-a0dd-0872b5a14707` 于 21:16:38 开始。Cloudflare 历史错误在 21:17:11 记录 `INVALID_REQUEST`，堆栈为 `invalidRequest → parseCookie → validateSsoCookies → extractSsoCookies → CquQuickloginDeviceDO`。任务仍显示运行，到 21:29:58 左右才按 13 分钟期限加清理余量转为 `OPERATION_TIMEOUT`；21:30:58 又创建下一轮任务。
- 相邻恢复工作流于 21:17:11 完成。工作流成功不能证明学校业务成功，也不能代替设备任务终态。
- 此次只读观察没有触发登录、改绑定、清锁或操作用户 Chrome。

## 根因及修复

容器 `cookies_to_storage_state` 复用了导入 CDP 的 `cookie_to_cdp`。导入会省略会话 Cookie 的 `expires=-1`；导出 storage state 却要求保留该字段，并规范缺省 SameSite。严格消费者因缺字段抛出 `INVALID_REQUEST`。登录任务缺乏异常收尾，导致已经抛错的任务继续显示运行。

修复 Auth `cb4389300e261996551ffac79450c2f66277af5d`：

1. 导出保留 expires，缺省 SameSite 为 Lax，并保留分区元数据供消费者拒绝不支持的 Cookie；不放宽消费者校验。
2. 任务收到畸形结果或内部异常时，以该次 operationId/lease/版本元组结算并安排重试；迟到异常不能改写后继任务。
3. 已绑定、启用且对齐的 preparing 设备若没有 Cookie、活动任务或 alarm，恢复缺失的调度，并保留未来 nextAttemptAt。修复第一台可能遗留的无任务等待状态；是否恢复需线上读回确认。

没有证据说明本次是两台设备争抢验证码导致的死锁。确认的是结果格式不匹配、异常未结算及调度恢复缺口；不据此排除其他校方故障。

## 验证

- 修改前，Python 测试因缺失 expires、partitionKey 失败；DO 测试复现 INVALID_REQUEST 抛出和缺失 alarm。
- 修改后，Auth 850 单元测试、284 DO 测试、两套类型检查通过。
- Container 368 测试与 13 subtests 通过；其中生产者和 TypeScript 消费者共享合成 Cookie fixture。
- EXT 65 测试、typecheck、build、check:package 通过；独立复核未发现阻塞问题。
- 安装包 `releases/cqu-quicklogin-0.2.2-canary.zip`，22998 字节，8 个 dist 文件。源码 `ebb86ad2a0b98c7dc993c57dcd7de71aa4eef5c3`，SHA-256 `4ad4f09b24ff82cf454e50e7798260f6bf80b764a02d39b59db77301bca385e5`。

部署和实际学校验收结果见发布记录，不能仅凭上述测试认定业务恢复。

## 客户端无任务恢复（0.2.3）

第一台的公开快照明确为 queued / operationId=null / canEnsure=true，但 0.2.1 的 sync 只对 absent、expired、blocked 发 ensure_session，因而只轮询而不启动。新增回归测试在修改前失败（operate 调用次数为 0）；修复后 69 项插件测试通过，已有任务、冷却期间、禁止启动均保持不发命令。

最终 EXT `683081ad9b38b43219d024916b9a4f193f040efc`；交付包为 `releases/cqu-quicklogin-0.2.3-canary.zip`，23022 字节，SHA-256 `046cfbb810f7379a366f5a6b882374f46230f7758eba1bb00227e909af021770`。0.2.2 中间包保留但不作为最终交付。

## 上线后读回

CI 34976675384 成功；Worker `22014c4d-c283-4f5f-b12d-557ec2d4ee74` 100%，Container 68 / 镜像 22014c4d / 5 healthy / 0 failed。

22:01，第二台在新容器上的任务 `8408292a-728c-475f-9090-9f0c99fda6f4` 已 ready，Cookie applied 且服务器 ACK 成功；与此前十三分钟后才超时的错误路径不同。用户 Chrome 未操作，第一台仍运行 0.2.1，必须更新 0.2.3 并重载后验证无任务恢复。不能声称两台均已验收通过。

学校业务页探测：Ego 打开 my.cqu.edu.cn 后到达 /workspace，但页面正文为空；因此没有把门户导航或 Cookie ACK 记为学校业务验收成功。诊断 TaskSpace 8 已关闭，未改变安装身份或操作用户 Chrome。
