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
| 注册、读取配置与安全新增档案 | `ctx.configuration.register()`、`ctx.configuration.get()`、`ctx.configuration.addProfile()` |
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

`ctx.configuration.addProfile(configurationId, { id, ...fields })` 只向自身已注册的 `seed.profiles` / `secret_access: owner` 配置追加一个新档案。宿主串行校验并加密保存敏感字段，保留现有档案和默认项；重复 ID、未声明字段、缺少必填值或超过数量限制均拒绝。调用不返回 Secret，也不重启调用插件；插件在保存完成后自行更新连接。该接口需包含此能力的 Seed 开发构建，发布前应同步 SDK 依赖和 `min_seed_version`。

动态文本配置字段可声明 `control: 'model_select'` 和 `thinking_field_key`，复用共享模型选择器；关联的思考等级必须是同一配置中的独立文本字段。`registerOptionsResolver()` 返回的 `SeedConfigurationOption` 可携带 `group: 'seed' | 'custom'`、`icon_data_url` 与 `thinking_levels`，宿主校验后仅负责渲染和保存。模型目录、提供方发现和调用参数由插件拥有，宿主不会按插件 ID 选择模型。该表单入口需要配套的 Seed 开发构建。

独立配置表单可用 `renderer: 'seed.form'`、`save_mode: 'auto'` 声明自动保存，不声明 `actions.save`。宿主合并连续编辑并串行保存，保留失败草稿以供重试；模型和关联思考等级作为同一次修改提交。默认 `save_mode: 'manual'` 仍使用声明的保存动作，档案接入流程不变。此入口需要配套 Seed 开发构建。

动态配置选项和管理视图选项可同时提供 `icon_data_url`、`icon_dark_data_url`，共享图标组件按界面主题切换。未提供深色图时，仅以 `currentColor` / `none` 着色的简单 SVG 跟随文字颜色；固定品牌色、多色、复杂 SVG 和位图保持原图，不统一反色。这一通用渲染规则同时用于配置选项、模型触发按钮和弹出列表。

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

## 本地异步固定计费

在目标方法声明 `billing.settlement: local_relay` 和 `billing.product`，通过 `ctx.invokeHost('seed.local.relay.prepare', { capability_id, method, invocation_id, plugin_version, arguments })` 使用 Cloud 现有的调用准备与价格快照。持久化稳定请求编号和返回的 `call_id`，随后调用 `seed.local.relay`，参数为 `{ capability_id, method, call_id, task_id, outcome }`。`outcome` 依次使用 `started` 和最终的 `succeeded`、`failed` 或 `cancelled`；只有成功终态扣费。

Cloud 负责价格、余额和幂等记账；插件负责业务终态以及重启后的任务查询和待确认结果重试。价格不能由客户端保存或提交来决定实际扣费；相同请求重试必须保留原编号，新业务请求使用新编号。断网、待确认及结算失败不表示免费，也不能为了重试结算重新执行业务。
