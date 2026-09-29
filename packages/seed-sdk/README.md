# @motus-ai/seed-sdk

MotusAI Seed 插件的 TypeScript SDK。它提供插件生命周期、能力调用、配置、本地 API 与受控宿主服务的类型，以及少量可在插件中使用的运行时工具。

## 安装

```bash
npm install @motus-ai/seed-sdk
```

SDK 面向插件开发者。安装这个 npm 包不会安装 Seed 客户端，也不会创建插件包。

## 最小插件

```ts
import { SeedPluginError, type SeedPluginContext } from '@motus-ai/seed-sdk'

export function apply(ctx: SeedPluginContext) {
  ctx.effect(() => ctx.capabilities.register('clock', {
    async invoke(method) {
      if (method !== 'now') {
        throw new SeedPluginError('method_not_supported', `Unknown method: ${method}`, { method })
      }
      return { iso: new Date().toISOString() }
    },
  }))
}
```

插件入口导出 `apply(ctx)`。`clock` 能力及其 `now` 方法还须在插件的 Manifest 和能力 YAML 中声明；运行时只能注册静态声明的子集。使用 `ctx.effect()` 绑定注册与清理，插件卸载或重载时 Seed 会释放这些贡献。

把插件源码构建为 `.seedpkg` 时，插件的运行入口是**插件包**中的 `dist/index.mjs`。本 SDK 作为 npm 依赖，其自身入口是 **npm 包**中的 `dist/index.js`。两者属于不同产物。

## 常用接口

| 需求 | SDK 接口 |
| --- | --- |
| 注册能力、调用已声明依赖的插件能力 | `ctx.capabilities.register()`、`list()`、`invoke()` |
| 注册配置和读取当前值 | `ctx.configuration.register()`、`get()` |
| 注册插件管理视图、推送面板文本 | `ctx.management.registerView()`、`ctx.management.publishText()` |
| 向本地应用提供 HTTP/SSE 路由 | `ctx.localApi.register()`、`SeedLocalEventStream` |
| 调用经过权限检查的宿主服务 | `ctx.invokeHost()` |
| 登记插件自己创建的长连接 | `ctx.connections.register()` |
| 浏览器 OAuth/OIDC 授权 | `ctx.authorization.authorize()` |
| 生成打开 Seed 的深链 | `createSeedDeepLink()` |

`ctx.capabilities.invoke()` 只能调用插件在根 Manifest 的 `consumes` 中声明的能力与方法。存在多个提供方时，调用需指定 `provider_plugin_id`。能力参数和结果由 Seed 按声明的 Schema 校验；写入与控制操作仍须经过确认。

### 管理面板的实时文本

`seed.panel` 的 Markdown 块从数据源结果读取快照；需要实时输出时，声明 `stream_id_path` 并调用 `ctx.management.publishText()`：

```ts
await ctx.management.publishText({
  view_id: 'my-view',
  value_path: 'result',
  stream_id: runId,
  operation: 'append',
  text: chunk,
  offset: currentText.length,
})
```

- `value_path` 必须指向本插件该视图声明的 Markdown 块，`stream_id` 必须匹配当前运行。
- `append` 的 `offset` 是追加前的文本长度；也可用 `replace` 替换当前文本。
- 首次加载的骨架图，以及状态块配合 Markdown 块时的复制按钮，均由 Seed 统一提供。完整的视图字段见[插件开发手册](https://github.com/agimx-ai/motusai-seed/blob/main/docs/插件开发手册.md)。

## 宿主边界

SDK 不提供 Electron、任意文件系统访问、原始本地网关令牌或 Cordis 内核实现。插件按需在 Manifest 中声明权限，再通过 `ctx.invokeHost()` 使用对应的受控服务。不要从 Seed 客户端 `src` 目录相对导入，也不要让插件自行监听本地 HTTP 端口。

- 原生工具声明为 `sidecars`，通过 `seed.process` 调用。文件操作需使用文件系统根标识与相对路径；不要拼接 shell 命令。
- 插件内置 Python Skill 需声明 `process.python`，通过 `seed.python` 运行，并随插件包准备锁定的依赖与目标平台 wheel。Python 虚拟环境隔离依赖，不提供操作系统沙箱。
- 本地 HTTP/SSE 需声明 `local.http-api` 并通过 `ctx.localApi.register()` 注册。Seed 拥有回环网关、认证与授权；插件不会收到原始令牌。
- 主动联网的原生插件按目标范围声明 `network.connect.internet`、`network.connect.lan` 或 `network.connect.loopback`。连接由插件实现，`ctx.connections.register()` 负责生命周期登记与清理。
- 浏览器授权需声明 `authorization.oauth2.pkce` 或 `authorization.oidc.pkce` 及相应网络权限。Seed 负责浏览器回调、`state` 和 PKCE；插件负责令牌交换与后续凭据管理。

协议字段使用 `snake_case`（如 `request_id`、`input_schema`），TypeScript 上下文方法使用 `camelCase`（如 `invokeHost`、`localApi`）。

## 进一步阅读

- [插件开发手册](https://github.com/agimx-ai/motusai-seed/blob/main/docs/插件开发手册.md)：Manifest、能力声明、配置与权限。
- [插件包规范](https://github.com/agimx-ai/motusai-seed/blob/main/docs/社区插件与插件包规范.md)：`.seedpkg` 结构与发布流程。
- [官方插件示例](https://github.com/agimx-ai/motusai-seed-official-plugins)：可运行的插件实现。
