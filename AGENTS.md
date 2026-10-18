# MotusAI Seed Agent 指引

文件末尾只保留一个换行符，不追加空白行。GitHub Workflow YAML 使用两空格缩进和块式列表；步骤、作业和顶层区块之间留一空行，简短标量列表不额外插空行。格式化不得改变脚本或工作流语义。

## 发布与官网内容

涉及发布或官网内容时，先读官网仓库的 [统一发布流程](https://github.com/agimx-ai/motusai-seed-website/blob/main/docs/release-process.md)；涉及教程再读 [指南维护规范](https://github.com/agimx-ai/motusai-seed-website/blob/main/docs/guide-authoring.md)。优先读取本地官网 checkout 的同名文件，不另行复制规则或检查器。

- 本库维护 `release-notes/seed/<version>/metadata.json`、`zh-CN.md`、`en.md`；目录、metadata、package 与发布标签版本一致。格式与校验由官网共享工具负责，入口见 `release-notes/README.md`。
- 客户端版本统一使用严格 SemVer：`x.y.z` 为正式版并进入 stable 更新通道；`-dev.N`、`-beta.N`、`-rc.N` 等为内测版并进入 beta 更新通道及 GitHub prerelease；`+build.N` 仅作构建元数据且不改变通道或版本优先级。
- 公开使用方式变化时登记 `documentation.pages`（`/docs/...`、`/guides/<slug>`）与 `documentation.screenshots`，无影响也显式登记。文档与指南正文只在官网维护，小修复不强制写文章。
- 发布、官网审核、CF 部署与频道通知按统一流程分层验收；仅调整规范或 CI 不升产品版本，不因通知失败重复发布。

## 硬性原则：一切皆是插件

Seed 是通用插件宿主，不是插件业务逻辑的集合。插件专属能力与界面由插件代码通过公开 SDK 注册和实现；Seed 只提供通用接口、隔离运行环境、共享组件、生命周期和安全设施。新插件禁止声明式表单、管理视图和 Renderer 清单。

客户端严禁按插件 ID、能力 ID 或 Skill、模型、搜索、录音等业务名称写条件分支，也不得为官方插件提供默认数据、内置包、兜底页面或特殊调用路径。卸载插件后，其入口、视图、动作、路由和监听器必须完整消失。现有协议不足时，只能增加所有插件都可复用的版本化原语，不能用插件特判或旧协议 fallback 过渡。

任何插件相关需求开始前，必须完整阅读并遵循：

`./.agents/skills/plugin-architecture/SKILL.md`

## 指引路由

- Bloub 吉祥物的视觉、动画或状态来源：`./.agents/skills/mascot-maintainer/SKILL.md`
- 架构与权限边界：`docs/插件架构与安全边界.md`
- Manifest、配置、管理视图和 Broker：`docs/插件开发手册.md`
- SDK 与生命周期：`packages/seed-sdk/README.md`
- `.seedpkg` 安装和发布：`docs/社区插件与插件包规范.md`

## 仓库边界

- `src/main`：安装、安全存储、系统权限和受控 Broker。
- `src/connector`：协议、Plugin Host、统一 Local HTTP/SSE、审批、审计和全局任务观察。
- `src/shared`：跨进程的版本化契约与 Manifest 校验。
- `src/renderer`：通用产品壳与可信插件 DOM 容器，不解释插件业务；统一组件通过 SDK 直接导入。
- `packages/seed-sdk`：插件唯一可依赖的公开接口。
- 官方插件源码属于独立的 `motusai-seed-official-plugins` 仓库，不得复制回客户端。

产品已正式发布，此分支迁移 Plugin API v2。插件身份、旧配置、凭据和数据须沿用；新作者接口以 SDK 类和代码注册为准，不包装旧声明式 UI。

## 宿主能力与错误传递

- 截屏、文件二进制读写等系统机制由通用 Host Service/Broker 提供；业务工具、保存意图和 Agent 编排分别归插件与 Pi，不能在 Seed 按插件 ID 补专用执行路径。
- 声明的宿主权限在触碰 OS/文件前检查，并覆盖各实际调用入口；系统授权按 OS 流程请求与核验，不能用前置拒绝阻止首次权限登记。跨进程传递保留声明的错误码和允许的标量参数，不能把可执行的权限指引退化成普通字符串或泄漏任意错误对象。
- 屏幕权限核对正在运行的应用，整屏截图不能由前台窗口观察替代；文件输出保持路径安全、原子创建与明确覆盖语义。
- 具体入口和回归见 `plugin-architecture` Skill 的宿主服务参考；源码测试、原生 smoke、用户安装实例和权限实测分别报告。

## Agent 工具命名门禁

任何新增或修改 `agent.tool: true` 的能力方法，都必须同时审计 Agent 最终看到的名称、描述和参数。显式 `agent.tool_name` 必须使用小写稳定名称，采用“动作 + 明确对象”，例如 `read_file`、`search_file_contents`、`list_filesystem_roots`；禁止使用脱离上下文后含义不清的 `read`、`search`、`run`、`roots` 等名称。工作区文件、临时附件、网页、Office 和 Skill 私有资源必须使用不同名称，不得让一个工具根据路径猜测资源类型。

最终工具名必须在所有已安装插件及 Agent 自身内置工具之间全局唯一。非法名称或重名必须在创建 Agent 运行时直接失败，不得静默改名、覆盖或保留旧名称 fallback。工具名变化后，必须同步提供方 capability annotation、消费方提示词、替代/路由规则、文档、测试和插件版本，并检查全仓旧名称残留。

公开能力方法本身必须直接使用最终规范名称，不得保留 `read`、`write`、`roots` 等旧方法再依赖别名或兼容分支。Files v1 的公开方法与 Agent 工具同名；Core Broker 的内部操作码不属于插件公开契约。

## 客户端与交付

- 应用名称、应用 ID、图标和发现 ID 固定为统一的 MotusAI Seed 客户端。Seed Cloud 地址、发现公钥和更新通道来自 `MOTUSAI_*` 构建配置。官网固定为 `https://motusseed.com`；OAuth Client ID、精确登录回调、插件目录、更新源和事件地址来自 Seed Cloud 签名发现文档；运行服务连接由插件管理。客户端不得配置 OAuth Client Secret。
- 开始前检查 `git status --short`，保留并隔离用户已有修改。
- 需要与现有界面完全一致时复用共享组件，不复制近似 CSS；插件决定业务内容，Seed 只实现通用布局和交互语义。
- 类型检查、测试、构建、视觉验收、打包、提交和推送是独立结论，交付时分别说明。
- 未经用户明确要求，不提升版本、不打包、不提交、不推送。
