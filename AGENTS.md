# QuickLogin

本仓库维护扩展和官网；Auth 是独立的 `cqu-moe/auth` 仓库，只有任务包含后端行为时才修改它，路径按工作区确认。

- 修改用户可见扩展行为、QuickLogin 服务行为、版本或发布流程前，读 [发布约定](docs/agents/release.md)。
- 修改协议、设备授权、恢复或 Cookie 同步前，读 [协议设计](docs/superpowers/specs/2026-09-15-quicklogin-020-protocol-design.md) 与相关测试；保留外来 Cookie 所有权和过期任务撤销边界。
- 构建及加载目录见 [README](README.md)；`experiment/` 是历史材料。
- 在独立 worktree 工作，复用前确认它属于当前任务且无无关修改。Git push、本地 ZIP、浏览器加载、Worker 部署和商店发布分别记录；Chrome Web Store 操作需明确授权。

## Agent skills

- Issue tracker：处理 issue、规格或任务拆分前，读 [GitHub Issues 约定](docs/agents/issue-tracker.md)。
- Triage labels：分类或变更 issue 状态前，读 [标签映射](docs/agents/triage-labels.md)。
- Domain docs：探索领域、命名或设计决策前，读 [领域文档约定](docs/agents/domain.md)。
- 技能按任务选用：排障用 diagnosing-bugs，模块边界用 codebase-design，领域术语与 ADR 用 domain-modeling，代码审查用 code-review，PR 描述用 pr；修改 Agent 文档用 writing-for-agents。已安装 Matt 插件时优先使用 mattpocock-skills 命名空间；技能不可用时按仓库约定完成任务并说明缺失。
