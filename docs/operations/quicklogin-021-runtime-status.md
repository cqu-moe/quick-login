# 0.2.1 运行状态与剩余验收

2026-09-15，最新 Auth `0f640b5` / EXT `6a4be42`。

## 已确认

生产 Worker 100%、Container 67 的 5 个实例健康。新协议接口返回 200，线上源码标识一致。Ego 从既有 0.1.4 升级至 0.2.1，deviceId/授权未变化，设备数量未增加。最新状态是 `retry_wait / VERIFICATION_COOLDOWN`，对应“等待验证恢复”；未获得新 Cookie ACK。

此前 0.2.0 的 `SCHOOL_UNREACHABLE` 是有损归类：实际 raw-CDP 生产者返回描述性错误，而 Worker 只识别固定符号。此问题在 0.2.1 已修复，生产者和消费者共享 13 种真实格式 fixture；不能用旧归类认定当前失败属于密码、网络或验证码。

## 下一步应观察的证据

1. 定位当前设备同一 operationId 的开始、deadlineAt、终态 resultCode 和 retryAt；不要用下一轮操作覆盖前一轮结论。
2. 在对应 Container 镜像及时间窗口读取结构化 `errorCode/phase` 终态，确认是验证码未到、验证许可等待、浏览器 deadline 还是其他失败。不要记录 raw error、Cookie、验证码或学校页面内容。
3. 对 VERIFICATION_COOLDOWN 核对共享验证码租约 owner、过期时间及恢复工作流的 stop-confirmation；只读取必要状态，不能通过删锁或反复发码绕开归属保护。
4. 若需要用户检查学校密保邮箱或完成学校验证，应给出明确原因和入口，不重新归类为账号未绑定。CAPTCHA 仅影响相应设备，插件提供手动登录并停止自动覆盖。

## 通过条件

同一设备当前授权/绑定/会话元组一致 → cloud ready → 浏览器 Cookie 精确读回 → 对应 exportId/reportEpoch/seq 的 ACK 成功 → 实际学校业务页面已登录。最后复核 Auth 主会话与另一设备未被破坏。

目前最后三项没有成功证据，必须保留为未通过。无需再次设计协议；应沿上述真实运行链定位剩余等待原因。不要通过重新打包、改提示文案、新建设备或让用户来回开关代替业务验收。
