# @motus-ai/seed-sdk

用于开发 MotusAI Seed 插件的官方 TypeScript SDK。它提供插件运行时上下文、生命周期管理，以及能力、配置、管理界面和受控宿主服务的公开类型。

## 安装

```bash
npm install @motus-ai/seed-sdk
```

SDK 是插件开发依赖，不包含 Seed 客户端和插件打包工具。安装客户端请前往 [MotusAI Seed 官网](https://motusseed.com)。

## 第一个插件

插件入口导出 `apply(ctx)`，并在运行时注册 Manifest 已声明的能力：

```ts
import { SeedPluginError, type SeedPluginContext } from '@motus-ai/seed-sdk'

export function apply(ctx: SeedPluginContext) {
  ctx.effect(() =>
    ctx.capabilities.register('clock', {
      async invoke(method) {
        if (method !== 'now') {
          throw new SeedPluginError(
            'method_not_supported',
            `Unknown method: ${method}`,
            { method },
          )
        }

        return { iso: new Date().toISOString() }
      },
    }),
  )
}
```

这个示例还需要在插件的 Manifest 和能力声明中定义 `clock.now`。Seed 会校验静态声明、权限和运行时注册是否一致，并在插件卸载或重载时清理 `ctx.effect()` 注册的资源。

## 开发模型

一个 Seed 插件由声明和实现共同组成：

1. **Manifest** 定义插件身份、权限、提供的能力及使用的外部能力。
2. **声明文件** 定义能力方法、参数、结果、配置和管理界面。
3. **运行入口** 使用 SDK 注册实现，并通过 Seed 提供的受控接口访问宿主能力。
4. **插件包** 将 Manifest、声明、资源和构建后的 `dist/index.mjs` 组合为 `.seedpkg`。

运行时只能注册静态声明的能力子集。跨插件调用也必须先在 Manifest 的 `consumes` 中声明。

## 核心接口

| 场景 | 接口 |
| --- | --- |
| 注册和调用能力 | `ctx.capabilities.register()`、`ctx.capabilities.list()`、`ctx.capabilities.invoke()` |
| 注册配置并读取值 | `ctx.configuration.register()`、`ctx.configuration.get()` |
| 注册管理界面 | `ctx.management.registerView()`、`ctx.management.publishText()` |
| 提供本地 HTTP/SSE 接口 | `ctx.localApi.register()`、`SeedLocalEventStream` |
| 调用受控宿主服务 | `ctx.invokeHost()` |
| 管理后台任务 | `ctx.tasks.start()`、`ctx.tasks.run()` |
| 管理长连接 | `ctx.connections.register()` |
| 保存插件密钥 | `ctx.secrets.get()`、`set()`、`delete()` |
| 发起 OAuth/OIDC 授权 | `ctx.authorization.authorize()` |
| 记录审计与诊断信息 | `ctx.audit.record()`、`ctx.diagnostics.report()` |
| 生成 Seed 深链 | `createSeedDeepLink()` |

完整参数和返回类型由包内 TypeScript 声明提供。

## 生命周期

使用 `ctx.effect()` 绑定需要清理的注册、监听器和资源：

```ts
ctx.effect(() => {
  const stop = startWatching()
  return () => stop()
})
```

耗时操作应响应 SDK 提供的 `AbortSignal`。插件卸载、重载或调用取消时，Seed 会通过生命周期信号停止相关工作。

## 权限与安全

插件在 Manifest 中声明所需权限，Seed 在调用时执行校验、审批和审计。文件、进程、网络、本地接口与浏览器授权等宿主能力均通过 SDK 的受控接口访问。

协议字段使用 `snake_case`，例如 `request_id` 和 `input_schema`；TypeScript 上下文方法使用 `camelCase`，例如 `invokeHost` 和 `localApi`。

## 文档与示例

- [插件开发手册](https://github.com/agimx-ai/motusai-seed/blob/main/docs/插件开发手册.md)
- [插件包规范](https://github.com/agimx-ai/motusai-seed/blob/main/docs/社区插件与插件包规范.md)
- [官方插件示例](https://github.com/agimx-ai/motusai-seed-official-plugins)
- [版本变更](https://github.com/agimx-ai/motusai-seed/blob/main/packages/seed-sdk/CHANGELOG.md)

SDK 与 Seed 客户端的兼容要求会随新增接口记录在版本变更中。使用新接口前，请确认插件声明的最低 Seed 版本满足要求。
