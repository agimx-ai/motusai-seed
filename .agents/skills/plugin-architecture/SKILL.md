---
name: plugin-architecture
description: 维护 MotusAI Seed 的插件架构、共享协议、插件代码 UI、Plugin Host、Core Broker、本地 HTTP/SSE 与全局生命周期。新增或修改插件能力、配置、管理视图、动作、跨插件调用、宿主服务或插件相关客户端界面时使用；用于确保客户端不硬编码插件业务。
---

# Seed 插件架构维护

涉及整屏截图、二进制写入、原子创建或跨进程插件错误时，另读 [宿主截图、文件与错误边界](references/host-screen-and-files.md)。该参考中的路径均以本仓库根目录为基准，不要求普通插件代码 UI 改动运行全部原生检查。

## 不可违背的边界

“一切皆是插件”指所有可安装业务功能及其呈现都由插件拥有。Seed Core 只拥有安全且通用的机制：安装与校验、隔离运行环境、版本化协议、共享组件、授权与审批、审计、生命周期传输，以及少量经过审查的 Broker/Host Service。

插件必须通过代码实现并拥有：

- 能力、方法、Schema、错误码、风险等级和 exposure；
- 配置字段、校验、布局、默认值及配置操作；
- 设置页、视图、列表、卡片、按钮、图标、顺序、状态和确认流程；
- 本地业务路由与业务 SSE 事件；
- 跨插件能力的精确白名单或通用 annotation 匹配条件；
- 所有运行时贡献的注册与清理。

客户端不得硬编码：

- 插件 ID、能力 ID、Skill/模型/搜索服务等业务概念；
- 某插件是否显示、如何排序、显示什么按钮或调用哪个方法；
- 某插件的默认记录、兜底详情页、内置安装包或私有路由；
- 仅为绕过当前协议而增加的兼容分支、旧版本重试或静默 fallback。

发现客户端出现 `if (pluginId === ...)`、按能力名称推断 UI、复制插件列表样式形成近似组件，或卸载后仍保留入口时，先停止局部修补，回到协议和贡献模型重新设计。

## 决策方法

按以下顺序确定归属：

1. **业务是否只属于一个插件？** 放入插件声明或实现。
2. **多个插件是否需要同类表达能力？** 扩展通用 SDK 组件、生命周期、annotation 或 Broker API；命名描述展示语义，不绑定当前插件形态。
3. **是否需要操作系统权限、原始凭据、绝对路径、文件、音频、任意网络或本机进程？** 设计为 Core Broker/Host Service，并进行安全审查。插件只持有短期句柄和最小结果。
4. **是否必须覆盖全部插件调用入口？** 放在共享框架边界。授权、审批、审计和全局任务状态不能只挂在某一种调用路径上。

新插件使用现有 Broker 时通常只改插件；新增摄像头、系统命令等高权限原语才需要改客户端。若一个需求仍要求插件专属客户端分支，说明抽象尚未完成。

## 变更前追踪

1. 运行 `git status --short`，记录并保留已有修改。
2. 确认真正应修改的仓库。Seed 是宿主；官方插件通常位于独立的 `motusai-seed-official-plugins`；Obsidian 等调用端也有自己的仓库。
3. 沿完整链路搜索：
   - Manifest/能力声明；
   - `src/shared` 的类型、Schema 和 normalizer；
   - `src/connector/plugin-host.ts` 与 Host 执行边界；
   - `src/connector/local-http-gateway.ts` 与统一网关；
   - `src/renderer` 的可信插件 DOM 宿主；
   - `packages/seed-sdk` 的公开接口；
   - 插件实现、调用端和相关测试。
4. 只在必要时读取对应规范：
   - 架构/权限：`../../../docs/插件架构与安全边界.md`
   - Manifest/配置/管理视图：`../../../docs/插件开发手册.md`
   - SDK/生命周期：`../../../packages/seed-sdk/README.md`
   - 打包/目录：`../../../docs/社区插件与插件包规范.md`

## 协议与运行时约束

- Manifest 是轻量元数据和静态权限边界；能力、方法、Schema 与风险由 SDK 代码注册，宿主在隔离环境校验。
- 已发布外部协议保持 `snake_case` 与 `en_US`／`zh_Hans` 展示结构；插件源码文案使用独立 i18next `en-US`／`zh-CN` 资源，Manifest 引用翻译键。
- 插件通过公开 SDK 的 Plugin/PluginService 类注册，界面与后端分图构建为一个 main.js；资源清理绑定 Component 生命周期。
- 跨插件调用只允许 Manifest `consumes` 通过精确 capability/method 或通用方法 annotation 匹配后，再使用 `ctx.capabilities.list/invoke`；不得导入提供方代码或绕过能力代理。动态发现必须由提供方逐方法显式 opt-in，不能无条件暴露全部能力。
- `agent.tool: true` 的方法必须审计 Agent 最终看到的名称、描述和参数。显式 `agent.tool_name` 使用小写字母开头，只包含小写字母、数字、下划线或连字符且不超过 64 个字符；名称采用“动作 + 明确对象”，避免 `read`、`search`、`run`、`roots` 等脱离上下文的宽泛词。不同资源类型不得共用一个工具后再按参数或路径猜测分流。
- 最终 Agent 工具名在全部插件和消费方内置工具之间必须唯一；非法名称或重名直接拒绝创建运行时，不得静默改名、按顺序覆盖或增加旧名 fallback。改名时同步 capability annotation、消费方提示词、命令替代规则、文档、测试与提供方/消费方版本，并用全仓搜索确认旧别名已清除。
- 公开能力方法必须直接使用最终规范名称，不得保留 `read`、`write`、`roots` 等旧方法再依赖别名或兼容分支。Files v1 的公开方法与 Agent 工具同名；Core Broker 内部操作码不属于插件公开契约。
- `terminal` 能力参与服务端注册；`local` 能力只在本地。过滤规则必须通用，禁止插件 ID 特判。
- 配置验证和界面由插件代码负责；Seed 提供加密存储与 CAS，不解释字段业务含义。
- 共享组件直接通过 SDK 导出，不新增声明式 Renderer 或旧 action 协议。
- 同一插件版本不可变；不要内置 `.seedpkg` 或把 `publisher_type` 当作密码学信任。

## Local HTTP、SSE 与生命周期

- 插件声明 `local.http-api`，通过 `ctx.localApi.register()` 注册相对业务路由。Seed 统一拥有 loopback 监听器、`/v1` 前缀、Origin、授权、限流、请求大小和撤权。
- 插件不得自行启动 HTTP Server，也不得接收原始 Bearer Token。
- 业务事件使用 `SeedLocalEventStream`，复用事件 ID、回放、心跳和断连清理；全局任务生命周期使用 Core 的 `/v1/events`，不能伪装成某插件业务流。
- `SeedPluginHost.invoke()` 与 `SeedLocalHttpGateway` 都可能发起工作。修改全局忙碌、吉祥物状态、审计或任务完成判断时，必须覆盖两条入口并处理并发、失败、取消和清理。
- 调用端遇到 `workspace_not_found` 应使旧 workspace 失效并重新创建，不能只刷新模型或在陈旧状态上无限重试。

## 插件代码 UI 与视觉一致性

- 官方可信前端直接在产品文档的普通 DOM 容器中实现 DOM/React；客户端只提供容器、后端隔离、可取消 RPC、共享组件和主题，不解释插件表单、动作或业务状态。
- 模型选择、下拉、图标、卡片、预览等组件通过 @motus-ai/seed-sdk/react 直接导入；自定义页面和样式由插件构建并随包携带。
- 要求样式一致时复用同一组件实现，不复制 CSS 或按插件 ID 分支；加载态、草稿、空态、错误态也由插件代码组合。
- Native 后端是官方可信进程隔离，不是操作系统沙箱。可信前端与产品壳共享 Renderer，不是逐插件安全沙箱；Renderer 关闭 Node 并使用统一 CSP。资源、RPC、事件和取消绑定实际插件、窗口与代次。禁止为普通插件页面创建 iframe、WebContentsView 或坐标／滚动转发链路。
- 改 UI 后验证宽窄、亮暗、键盘焦点、溢出以及隐藏/卸载清理。

## 验证与交付

根据改动范围执行：

```bash
npm run typecheck
npm test
npm run build
npm run smoke:plugin-host   # Plugin Host、沙箱或运行时变化
```

协议变化至少覆盖成功、Schema 拒绝、权限拒绝、取消/失败、卸载/重载清理和多入口生命周期。共享类型变化后先构建 `@motus-ai/seed-sdk`，再检查依赖方。可见 UI 变化必须在真实页面验证窄宽、溢出、悬停、滚动、亮暗主题和插件卸载后的消失行为。

最终分别报告类型检查、测试、构建、视觉验收、打包、提交和推送结果。不要把其中一项成功描述成全部完成；用户未明确要求时，不提升版本、不打包、不提交、不推送。
