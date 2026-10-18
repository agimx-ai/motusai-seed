---
name: plugin-architecture
description: 维护 Seed Plugin API v2 的 SDK、构建工具、DOM 承载、隔离后端、安装与宿主协议；涉及通用插件框架边界或生命周期时使用，不承接插件业务实现。
---

# Seed 插件框架维护

## 判断归属

单个插件的配置、业务、界面、文案和交互留在插件；确有多方需求的组件或系统机制才进入 SDK／宿主。接口按通用语义设计，不用插件 ID 或现有业务字段伪装通用能力。

沿受影响链路核对：SDK → 构建产物 → 静态校验／安装 → 后端与 Broker → DOM 宿主 → 提供方和消费方。规范入口见仓库 AGENTS.md；截图、文件和跨进程错误另读 [宿主服务参考](references/host-screen-and-files.md)。

## 作者接口与产物

- 源码 Manifest 扁平轻量：身份、兼容要求、必要权限／消费边界和资源引用。能力、Schema、风险、错误键、命令和视图由代码注册；禁止恢复 YAML 能力文件、声明式 UI 或第二份作者维护的功能清单。
- `buildPlugin` 分别构建 view/service 依赖图，输出单个 `main.js` 的 `loadView`／可选 `loadService`；两端不共享实例，前端不能导入 Node 或后端代码。
- `apiVersion`、runtime、service、资源摘要由工具生成。自动生成的 `metadata.json` 供 Cloud 静态读取；客户端以实际服务注册为准，不能用该索引替代运行时注册。
- 源码文案采用独立 i18next 资源；Manifest 引用翻译键，不执行插件代码也能读取基础信息。已发布外部协议的 `snake_case`、`en_US`／`zh_Hans` 与错误码保持其契约。
- `.seedpkg` 只是声明产物的 ZIP；不包含源码工作区、用户配置、凭据或业务数据。校验目录与压缩包复用同一套规则，不旁路摘要、路径和资源范围检查。

## 承载、样式与生命周期

- 可信前端挂载产品文档的普通 HTMLElement；布局和滚动由浏览器处理，不创建 iframe、WebContentsView 或高度／坐标／滚动同步链路。
- 前端共享 Renderer 且关闭 Node，不宣称逐插件安全沙箱。native-host 是可信进程隔离，不是 OS 沙箱；sandboxed-web 服务保持 Node-free 及其能力限制。
- 插件独立构建样式；工具类限定在插件根和 portal 作用域，自定义 CSS 也须隔离，不能污染产品壳或其他插件。SDK 共享组件由客户端与插件直接导入。
- Component 的注册、事件、计时器、子组件和异步清理绑定生命周期。页面隐藏只释放显示资源，不停止后端；卸载／重载撤销贡献、RPC、资源和旧代次写入。
- Events 是内存通知，不提供重启回放。持久任务与会话由所属插件及其权威存储恢复，不能通过保留旧 DOM 模拟恢复。

## 数据、权限与调用

- 普通 `loadData/saveData` 与仅后端可用的 `app.settings` 保持各自加密存储和 CAS。宿主不解释配置类型、不注入 profiles/default_profile_id/values 等结构；不能把凭据放入前后端共享数据或页面响应。
- 更新继续读取同 ID 的配置、凭据及数据；解密失败或冲突不能当成空数据、静默补默认值或覆盖。
- 跨插件只通过声明的 consumes 与公开能力代理。保留逐方法 opt-in、Schema、风险审批、审计、循环保护和取消，不导入提供方实现。
- 宿主受控服务在触碰资源前检查声明权限；声明不代表用户／OS 已授权。不要把未受检查的权限字符串或 publisher_type 当成实际安全边界。
- Local HTTP 由宿主统一监听并管理 Origin、授权、限流、请求大小和撤权。插件注册业务相对路由，不自行监听端口或取得原始 Bearer Token。
- 业务 SSE 使用 SeedLocalEventStream；Core `/v1/events` 负责框架生命周期。全局任务观察覆盖能力调用、本地网关和后台任务事实，不在渲染组件推断业务状态。

## 开发与正式安装

- 固定 `plugins/development/<id>` 只在未打包且通过开发服务器启动时启用；自动发现符合规范的手动目录或 dev 同步产物，不要求选择工程目录或先上传云端。
- 完整构建原子同步，宿主运行不可变快照；失败保留最后有效产物，同版本开发重载不改正式安装记录、凭据和数据。移除覆盖后恢复已授权正式版本。
- 开发同步不等于客户端加载成功；用实际活动记录和页面确认。正式安装仍校验不可变版本、摘要和授权，不能因开发便利降低门禁。
- 新客户端使用 `/api/v2` 目录并携带真实客户端版本；Cloud 对旧客户端保留的 v1 分发协议不代表 Seed 恢复 v1 执行入口。
- 新增 SDK 接口时核对插件的最低客户端版本；本地可加载不证明正式 SDK／客户端兼容，版本准备与发布仍需明确授权。

## 验证

按改动范围运行类型检查、目标／全量测试、Electron 与 renderer 构建。SDK 变化先构建 SDK，再验证依赖方；可见变化遵循 AGENTS.md 的真实页面验收。

运行时变化按需执行 `smoke:plugin-sdk`、`smoke:plugin-isolation`、`smoke:native-isolation`；本地发现／重载用 `smoke:plugin-development`。单包安装 smoke 需要显式包路径：`npm run smoke:plugin-host -- /absolute/plugin.seedpkg`。这些验证不授予打包、重启用户应用或发布权限。
