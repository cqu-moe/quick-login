# QuickLogin 验收记录

记录日期：2026-09-11（Asia/Shanghai）

范围：本地代码、自动化测试与构建。未在真实 Chrome 中加载扩展，未使用真实学校账号，未部署。

## 自动化证据

- EXT 协议、授权、同步、Cookie journal、登录页检测和 popup 测试：见 Task 17 全量命令输出。
- AUTH 协议、账号/设备 DO、OAuth provider、验证码租约、CQU 会话回归：见 Task 17 全量命令输出。
- 五会话短测：沿用 [five-session-verification.md](../five-session-verification.md)，不重复付费或真实登录压测。

自动化与 fake clock 只证明本地状态机和协议，不等同真实学校业务登录或长期会话并存。

## 真实用户路径

| ID | 结果 | 环境与证据 | 原因 |
| --- | --- | --- | --- |
| A01 | NOT RUN | 需要干净普通 Chrome + 已批准测试 Auth | 未加载正式 dist，未授权真实测试账号 |
| A02 | NOT RUN | 需要学校真实门户页面 | 不能用 Cookie/302/new-ST 代替业务页面登录成功 |
| A03 | NOT RUN | 需要真实 Chrome 多 tab | 未执行 |
| A04 | NOT RUN | 需要删除插件管理的真实 SSO Cookie | 未执行 |
| A05 | NOT RUN | 需要真实浏览器故障注入 | 本地单测覆盖重试预算，但不冒充实测 |
| A06 | NOT RUN | 需要学校真实登录表单 | 未执行 |
| A07 | NOT RUN | 需要真实手动输入路径 | 未执行；不会保存学校信息 |
| A08 | NOT RUN | 需要普通 profile 的外来 TGC | 本地合成测试覆盖归属保护 |
| A09 | NOT RUN | 需要真实在途下载/写入 | 本地 generation 测试通过，真实浏览器未跑 |
| A10 | NOT RUN | 需要已部署 Auth 与插件 | 本地 DO 测试覆盖开关保留 |
| A11 | NOT RUN | 需要已部署 Auth 与两个安装实例 | 本地 provider/撤销测试通过 |
| A12 | NOT RUN | 需要离线设备重连 | 未执行 |
| A13 | NOT RUN | 需要管理员真实额度操作 | 本地 preview-changed 测试通过 |
| A14 | NOT RUN | 需要管理员真实额度操作 | 本地 quota 状态机测试通过 |
| A15 | NOT RUN | 需要 Worker 停止、Chrome 重启和升级 | 未执行 |
| A16 | NOT RUN | 需要真实课表认证与设备重登并发 | 本地共享 OTP 租约测试通过 |
| A17 | NOT RUN | 需要两个真实插件授权 | 本地 Better Auth provider 测试通过 |
| A18 | NOT RUN | 需要 1h/7h/7d 观察窗口 | fake-clock 状态机覆盖不作为长期实测 |

## UI 检查

- 代码级键盘、原生按钮/表单语义、小屏换行、quota 0 与撤销状态：PASS（自动化与静态复查）。
- 真实 Chrome 截图、焦点遍历、学校页面不遮挡：NOT RUN（本轮无正式扩展加载环境）。

## 发布边界

- 生产额度映射：NOT RUN，未获管理员确认。
- 正式 OAuth client 登记：NOT RUN，正式扩展 ID/clientId 未提供。
- 部署、mode on、Chrome Web Store：NOT RUN，且不在本计划授权范围。
