# @motusai/seed-sdk

MotusAI Seed 插件公开 SDK。插件通过这个包使用能力描述、生命周期上下文和受控 Host Service 类型，不应从 Seed 客户端源码目录进行相对导入。

```ts
import type { SeedPlugin } from '@motusai/seed-sdk'
```

这个包不包含 Electron、Terminal Token、文件系统权限或 Cordis 内核实现。插件包运行入口固定为 `dist/index.mjs`，Manifest 只声明 `runtime.kind`。

协议对象字段使用 `snake_case`，例如 `request_id` 和 `input_schema`；运行时上下文遵循 TypeScript API 命名，例如 `ctx.invokeHost()` 与 `ctx.localApi`。插件源码应维护在独立仓库并构建为 `.seedpkg`；不要从客户端源码目录做相对导入。

插件入口只导出 `apply(ctx)`。一个插件包对应一个 Cordis Fiber；所有运行时贡献都在 `apply` 中注册，并使用原生 Cordis 形式 `ctx.effect(() => register(...))` 绑定清理。插件不得导出另一套 `start/invoke/stop` 生命周期。

官方 `native-host` 可使用 `ctx.audit.record()` 上报绕过框架能力路由的本地语义事件。审计接口只接受 SDK 声明的有界元数据字段，Seed 会强制附加实际插件身份；不要上报消息正文、凭据或绝对路径。连接建立、缓存刷新等运维事件可声明 `visibility: 'technical'`，保留在诊断数据中但不进入用户活动记录。

插件如需使用其他已安装插件提供的能力，必须先在根 Manifest 的 `consumes` 中声明精确的能力与方法，或声明通用的方法 annotation 匹配器，再通过 `ctx.capabilities.list()` 与 `invoke()` 调用。匹配器只授权提供方显式标注且当前已安装、已启用的方法，适合 Agent Harness 等需要动态发现可插拔工具的编排插件。多个插件可以实现同一能力契约；`list()` 为每个实现返回全局唯一的 `provider_plugin_id`，存在多个匹配实现时 `invoke()` 必须携带该字段进行精确路由。能力实现通过 `ctx.capabilities.register()` 注入。Seed 统一执行声明校验、输入输出 Schema、写入/控制操作确认、循环调用保护和活动审计；插件不得直接导入另一个插件或调用内部 Host Service。

原生工具通过 Manifest `sidecars` 声明，并由插件调用通用 `seed.process`。读写用户文件时，调用必须提供声明的 Sidecar ID、文件系统 `root_id`、相对工作目录和参数数组；纯计算工具可使用 `cwd_scope: package`，以插件包为工作目录处理插件私有资源，并且只接受 `access: read` 语义。不得自行拼接 shell 命令。平台/架构二进制、命令语义与读写方法拆分属于插件，进程与文件边界属于 Core。

需要运行插件内置 Skill 的 Python 脚本时，声明 `process.python`。每个 Skill 放在 `skills/<skill-id>/`，由它自己包含 `SKILL.md`、`scripts/*.py`、`pyproject.toml` 和 `uv.lock`；打包时用 `uv export --locked` 生成带哈希的 `requirements.txt`，并将目标平台的 wheel 放入同一 Skill 的 `wheels/`。调用 `ctx.invokeHost('seed.python', { operation: 'run', request_id, script: './skills/<skill-id>/scripts/example.py', args: [] })`。Seed 优先使用宿主机兼容的 Python 3.12，否则使用随客户端打包的 Python 3.12；每个插件版本的每个 Skill 在宿主机拥有独立虚拟环境，首次运行由随客户端打包的 uv 只从该 Skill 的 wheel 离线安装。也可用 `{ operation: 'prepare', skill_id: '<skill-id>' }` 提前准备，或按 `request_id` 调用 `operation: 'cancel'` 终止运行中的脚本。虚拟环境隔离 Python 包，**不是操作系统沙箱**；插件打包时必须准备完整的目标平台 wheel，运行时不下载依赖。

官方 `native-host` 主动联网时按目标范围声明 `network.connect.internet`、`network.connect.lan` 或 `network.connect.loopback`，不得使用带业务名称的网络权限。HTTP、WebSocket、TCP、MQTT 等协议、地址、认证、心跳、重连和限流都由插件实现，Seed 不代理流量，也不理解连接业务。长连接通过 `ctx.connections.register()` 登记使用的权限、传输类型和状态；插件 Fiber 卸载、重载或 Seed 退出时，框架先终止 `signal`，再调用插件提供的 `close()`。连接本身不是全局任务，不应使用 `ctx.tasks.start()` 长期占用忙碌状态。

官方 `native-host` 如需向已授权的本地应用提供 HTTP/SSE 接口，必须声明 `local.http-api`，并通过 `ctx.localApi.register()` 使用 Seed 的统一 loopback 网关。插件不得自行监听端口，也不会收到 Seed Local Gateway 的原始 Bearer Token。

需要向 MCP 客户端提供的能力方法，可在能力声明中标注 `mcp.tool: true`，并提供双语描述和对象类型的 `input_schema`；可选 `mcp.tool_name` 指定工具名。Seed 统一在 `http://127.0.0.1:43127/mcp` 提供 Streamable HTTP 入口，插件仍只注册现有能力实现。

通过统一网关提供 SSE 时，使用 `SeedLocalEventStream` 处理事件编号、短期回放、心跳和断连清理。插件只在 `localApi.register()` 的处理器中返回 `events.response()`，并在业务状态变化时调用 `events.publish()`。调用端可用 `after` 或 `Last-Event-ID` 续接事件。

每条本地路由通过 `activity` 声明运行语义：省略或使用 `foreground` 的真实用户操作会进入活动记录并驱动全局忙碌状态；状态检查、列表同步和轮询使用 `background`，仅保留技术诊断；SSE 等长连接使用 `stream`，同样不进入活动记录或长期占用忙碌状态。后台路由中触发的嵌套能力与任务会继承该技术可见性。

插件在 `apply` 中通过 `ctx.configuration.register()` 贡献配置声明，并通过 `renderer` 选择 Seed 提供的声明式元渲染器；字段、布局、动作、条件和文案均由插件定义。`seed.profiles` 渲染可展开的配置档案；`seed.option-list` 把一个无需依赖其他字段的动态选项源渲染为单选列表，并把选中项保存为该配置唯一的默认档案；`seed.catalog-list` 使用相同的动态数据来源只展示目录，不保存选择或默认项。注册后使用 `ctx.configuration.get()` 读取当前值。`secret` 值只进入 Seed 安全存储，只有声明 `secret_access: owner` 的所属插件可读取自己的完整配置。

插件详情中的运行时数据通过 `ctx.management.registerView()` 贡献。每个视图声明通用 renderer，并可把 `source.capability` 与 `source.method` 指向本插件的只读能力方法；Seed 在内部能力通道调用该方法，不会要求插件监听额外端口。视图还可声明 `actions`，由插件定义按钮位置、状态条件、确认表单及目标能力方法；Seed 只负责通用渲染、调用边界和审计，不解释插件业务。视图、动作与能力随 Cordis Fiber 一起装载和注销。`seed.collection` 用于插件拥有的动态集合；客户端不得按插件 ID 增加业务分支。

管理动作的 `input.fields` 支持 `text`、`textarea`、`password`、`email`、`url`、`number`、`date`、`select`、`checkbox`、`file`、`files`。`select` 使用 `options: [{ value, label }]`；`number` 可声明 `min_value`、`max_value`；`file` 和 `files` 可用 `accept: ['.pdf', '.xlsx']` 限定扩展名。用户可以选择或拖入本地文件；`file` 提交一个绝对路径字符串，`files` 提交最多 32 个绝对路径的数组，均不提交文件内容。插件要读取文件时仍使用已有的宿主文件能力。数字和勾选字段分别提交为 number 和 boolean，其余非文件字段提交为 string。

能力和方法可通过 `annotations` 声明可选宿主投影及 Agent 工具语义。Seed 只识别通用注解，不按能力 ID 或插件 ID 推断行为；同一包可在一个 Fiber 中注册多个能力，调用时可从 `SeedInvocation.capability` 取得当前能力 ID。

声明 `agent.tool: true` 时，可用 `agent.tool_name` 指定 Agent 最终看到的稳定别名。别名必须以小写字母开头，只包含小写字母、数字、下划线或连字符，长度不超过 64；应使用 `read_file`、`search_file_contents`、`list_directory` 这类“动作 + 明确对象”名称，避免 `read`、`search`、`run` 等宽泛词。工具名位于跨插件和 Agent 内置工具共享的全局命名空间；消费方应拒绝非法名称和重名，不得静默覆盖或保留旧名 fallback。

```ts
import type { SeedPluginContext } from '@motusai/seed-sdk'

export function apply(ctx: SeedPluginContext) {
  ctx.effect(() => ctx.configuration.register(configuration))
  ctx.effect(() => ctx.capabilities.register('example', handler))
  ctx.effect(() => ctx.management.registerView(view))
  ctx.effect(() => ctx.localApi.register(routes))
}
```

插件需要浏览器授权时，在 Manifest 的 `permissions` 中声明所用标准：OAuth 2.0 Authorization Code + PKCE 用 `authorization.oauth2.pkce`，OIDC Authorization Code + PKCE 用 `authorization.oidc.pkce`；并声明授权端点对应的 `network.connect.internet`、`network.connect.lan` 或 `network.connect.loopback`。不是按 GitHub、Google 等服务商申请特定权限。Seed 使用系统浏览器、固定的 `com.motusai.seed:/plugin/oauth/callback` 回调，统一生成并验证一次性 `state` 和 PKCE S256；插件不能监听临时端口，也不能指定回调地址。

```ts
const { code, code_verifier, redirect_uri } = await ctx.authorization.authorize({
  standard: 'oauth2.authorization_code.pkce',
  authorization_endpoint: authorizationEndpoint,
  client_id: clientId,
  scope: 'read',
  // parameters: { prompt: 'select_account' },
}, signal)
```

插件或插件所属服务端随后使用 `code`、`code_verifier` 和**原样的** `redirect_uri` 换取凭据；令牌交换、OIDC 身份令牌校验、用户资料、刷新与撤销都由插件/服务端负责。需要客户端密钥或不允许自定义协议回调的提供方应通过插件所属服务端完成授权中转，不能把客户端密钥内置在 Seed 或插件包中。插件长期凭据使用 `ctx.secrets` 按插件隔离保存。设备码/扫码不使用这个回调 API，由插件实现服务商流程并通过声明式配置/管理界面呈现。

插件卸载、重载、Seed 退出、调用方取消或超时都会终止尚未完成的浏览器授权。授权地址必须是 HTTPS；仅显式声明相应网络范围时允许局域网或 loopback 的 HTTP 内测地址。这个 API 不提供 Seed Cloud 登录令牌。

插件拥有连接实现，框架只观察生命周期：

```ts
const socket = createPluginOwnedSocket()
const connection = ctx.connections.register({
  id: 'primary',
  transport: 'websocket',
  permission: 'network.connect.internet',
  close: () => socket.close(),
})
connection.update({ state: 'connecting' })
```

插件或外部程序需要唤醒 Seed 并导航到客户端页面时，使用 SDK 的 `createSeedDeepLink()` 生成受控深链，不要自行拼接客户端内部路径。标准格式为 `motusai-seed://open/<destination>`，查询参数由具体目标定义。深链协议属于 Seed 框架；当前注册了 `plugins` 目标，后续目标通过客户端路由注册表扩展。

```ts
import { createSeedDeepLink } from '@motusai/seed-sdk'

const url = createSeedDeepLink({
  destination: 'plugins',
  pluginId: 'com.example.plugin',
})
```
