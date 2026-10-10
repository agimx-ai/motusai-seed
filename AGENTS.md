# MotusAI Seed Agent 指引

文件末尾只保留一个换行符，不追加空白行。GitHub Workflow YAML 使用两空格缩进和块式列表；步骤、作业和顶层区块之间留一空行，简短标量列表不额外插空行。格式化不得改变脚本或工作流语义。

## 发布说明与官网同步

- 每个新版本先维护 `release-notes/seed/<version>/metadata.json`、`zh-CN.md`、`en.md`，写该版本累计的用户可见变化，显式填写 `documentation.pages` 和 `documentation.screenshots`；无影响填空数组和 false。
- 格式见 `release-notes/README.md`。官网仓库的唯一共享工具在构建前检查版本和双语说明，同一源文件生成 GitHub Release 正文及 `website-release-notes.json` 附件；Release 正文与官方插件共用带图标的变化类型标题，缺说明必须失败，不绕过门禁。
- 发布工作流先创建不可见的草稿 Release，各平台直接上传正式 Release assets；禁止用大型 Actions artifacts 跨 job 传递安装包。全部资产校验成功后才公开 Release 并运行独立 `notify-website` job。通知失败不等于包发布失败；配置 `WEBSITE_SYNC_TOKEN` 后只重跑通知 job，或手动运行官网同步工作流，不重复发布版本。
- 发布验收分别核对本地验证、提交、分支与标签推送、Release 与附件、官网待审 PR、合并与实际部署。官网 PR 处理文档截图待办且部署验证成功后才算同步完成。启用顺序见官网仓库 `docs/release-process.md`。
- 本规则不改变授权边界，未明确要求不提升版本、打标签、推送、发布或部署。

## 硬性原则：一切皆是插件

Seed 是通用插件宿主，不是插件业务逻辑的集合。插件专属能力、业务概念、页面内容、文案、图标、控件、顺序、数据、状态和动作必须由插件通过版本化声明贡献；Seed 只提供通用协议、Renderer、生命周期、安全边界和执行设施。

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
- `src/renderer`：通用产品壳和声明式 Renderer，不解释插件业务。
- `packages/seed-sdk`：插件唯一可依赖的公开接口。
- 官方插件源码属于独立的 `motusai-seed-official-plugins` 仓库，不得复制回客户端。

当前产品尚未正式发布，只维护当前契约。除非用户明确要求，不增加旧协议兼容、静默 fallback 或旧版本重试。

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
