# @motus-ai/seed-sdk

此分支的官方插件已迁移到 Seed Plugin API v2；新 SDK 和插件尚未正式发布。本地测试构建不等于已经安装或正式交付，发布前仍须同步正式 SDK 版本与最低客户端版本。

新插件使用类式生命周期，直接编写 DOM 或 React 界面，不声明表单、管理视图、Renderer 或 presentation。Seed 只提供可信前端 DOM 容器、后端隔离运行环境、通用组件和受控服务。

## 界面入口

源码入口默认导出 Plugin 子类。设置内容由插件代码直接渲染；下面使用 SDK 的可选 DOM 组件：

```ts
import { Plugin, PluginSettingTab, Setting } from '@motus-ai/seed-sdk';

class Settings extends PluginSettingTab {
  display() {
    this.addChild(new Setting(this.containerEl).setName('Clock')).addButton((button) =>
      button.setButtonText('Read').onClick(async () => {
        const result = await this.app.service.call<{ iso: string }>('now');
        this.containerEl.dataset.result = result.iso;
      }),
    );
  }
}

export default class ClockPlugin extends Plugin {
  onload() {
    this.addSettingTab(new Settings(this.app, this));
  }
}
```

React 界面可以继承 ReactSettingTab，实现 render() 并返回普通 JSX。模型选择器、下拉框、思考等级滑块和主题图标由客户端与插件共用同一份实现：

```ts
import { ReactSettingTab, ModelSelect, SelectControl, SegmentedControl, DiscreteSlider, ThemedIcon } from '@motus-ai/seed-sdk/react';
```

插件可以组合这些组件，也可以自行实现任何新控件。这里没有控件名称白名单，也没有根据 JSON 配置生成页面的解释器。ReactSettingTab 会在隐藏或卸载时卸载 React Root，并跟随宿主语言和主题更新。

`SegmentedControl` 复用产品壳原有的分段切换样式和键盘交互。插件直接传入 `value`、`options`、`onValueChange` 和 `label`，自己决定切换后的 JSX 内容；组件不读写配置，也不解释模型来源等业务概念。

`AsyncCombobox` 复用原有可输入搜索下拉框：单个输入框支持自由输入、按选项名称／值过滤和键盘选择，选择后显示名称、通过 `onChange` 返回真实值。选项、加载状态、空态／失败文案和刷新回调由插件传入；组件不请求模型目录、不读取凭据或保存配置。

`FileInputControl` 复用原有文件字段的选择、列表和删除样式，扩展名、数量限制、路径解析、文案和持久化由调用方传入。`StatusLine` 只展示状态圆点、内容和可选操作；不解释连接、任务或插件业务状态。两者都是直接导入的 React 组件，不是声明式页面解释器。

官方可信插件前端直接挂载到客户端同一文档的 HTMLElement 容器；没有 iframe、独立 WebContentsView、坐标／高度同步或滚动转发。页面按浏览器原生文档流自动撑高，整页统一滚动；插件内部确有需要的滚动列表和模态弹窗保留原生滚动语义。插件 CSS 使用自己的类名前缀或根容器作用域，复用宿主主题变量，不覆盖产品壳全局样式。可信前端与壳共享 Renderer，不是逐插件安全沙箱；Renderer 关闭 Node，后端仍独立隔离。

## 后端入口

需要特权服务时，在独立源码入口默认导出 PluginService 子类。界面不能导入后端实现；两端通过当前插件私有的、可取消的服务调用通信：

```ts
import { PluginService } from '@motus-ai/seed-sdk';

export default class ClockService extends PluginService {
  onload() {
    this.registerMethod('now', () => ({ iso: new Date().toISOString() }));
  }
}
```

当前样例的对外能力使用 addCapability()，本地 HTTP/SSE 使用 registerLocalApi()，连接使用 registerConnection()。公开方法的权限、Schema、审批、审计和计费仍由宿主校验；私有服务方法不是公开 HTTP 路由。

官方插件使用 `addCapability(definition, handler)` 在代码中同时注册公开方法和实现，Manifest 不包含能力、方法、错误或 UI 清单。宿主接收隔离进程的运行时注册，校验后用于发现、审批与调用；读取基础元数据和翻译无需执行插件代码。SDK 用 i18next 处理语言资源，错误键为 `capabilities.<id>.errors.<code>`。

PluginServices 不提供声明式管理视图或宿主内部接口。网络连接、任务、授权、凭据和系统 Broker 仍通过受控宿主服务访问。

## 生命周期与事件

- onload() 可以异步；失败后仍清理已经注册的资源。
- onunload() 是同步钩子。需要等待的异步清理使用 register(async () => ...)，宿主卸载过程会排空注册的清理。
- addChild/removeChild 绑定子组件生命周期；已卸载实例不能重新加载，重载必须构造新实例。
- registerEvent/registerDomEvent/registerInterval 自动释放监听和定时器。
- addCommand 自动命名空间隔离；removeCommand 接收插件内原始 ID，清理幂等。
- Events/EventRef 是内存通知，不提供重启回放。持久任务、会话和 SSE 恢复仍由各自的权威存储和协议负责。
- 前端控制器首次打开插件页时加载，设置页打开时才渲染。关闭页面只清理显示资源并保留控制器；停止或重载插件时释放控制器及所属贡献。后端生命周期不由页面开关决定。

## 数据

Plugin 与 PluginService 的 loadData/saveData 访问同一个按插件隔离的加密普通数据记录。每个实例持有自己的读取修订号；并发冲突返回 plugin_data_conflict，不静默覆盖。读取不存在的数据返回 null，解密失败或存储不可用不能当成空数据。

后端 `app.settings` 直接访问旧加密配置记录，不复制到明文 data.json。snapshot/save/saveMany 提供修订号与原子并发校验，读取失败不能当成空配置。插件保存前校验自己的字段，界面只收到插件明确返回的脱敏数据。原有凭据键和 plugin-data/<plugin_id> 路径沿用。

配置内容是插件拥有的任意 JSON，不存在通用 profiles、default_profile_id、values 或 schema_version 要求。`snapshot<T>(id)`、`get<T>(id)`、`update<T>(id, ...)` 的 T 由插件定义。宿主不补默认字段、不改写旧记录；插件按自身业务解释已有数据。`app.settings` 仅向后端提供，不能把凭据放进 UI 和后端共用的 `loadData/saveData`。

`buildPlugin` 为当前插件 UI 依赖图独立编译 Tailwind 类和可选自定义 CSS，生成并校验 `styles.css`。工具类通过 CSS `@scope` 限定在相同插件 ID 的 `[data-plugin-view-owner]` 与 `[data-plugin-view-portal]` 中，不能覆盖产品壳或其他插件。SDK 弹窗和菜单自动标记弹出层；插件自行 portal 到 document.body 时，可从 `usePluginStyleScope()` 读取当前 ID 并赋给 `data-plugin-view-portal`。ReactSettingTab 自动提供作用域；手动使用 ComponentProvider 时传入 `pluginId`。自定义 CSS 仍须使用插件类名前缀或根容器作用域。无需客户端扫描插件源码或重新构建客户端。动态类使用完整类名，必要时在插件样式中使用 Tailwind `@source inline(...)`。共享组件和主题样式由 SDK 维护，与客户端窗口、侧栏和平台页面样式分离。

`@motus-ai/seed-sdk/react` 也导出原有的 `ActionButton`、`IconButton`、`Tooltip`、`FieldLabel`、`DisclosureControl` 和 `TextInputControl`。客户端与插件复用同一份组件实现，迁移设置页时保留既有尺寸、帮助提示和折叠交互；`StatusBadge` 只负责状态胶囊的展示，`Dialog` 负责模态焦点、关闭和原有面板样式。页面分组、文案、业务状态和调用仍由插件代码组合，不增加声明式表单解释器。单个设置页不额外显示重复的导航按钮；多个设置页或注册视图仍保留导航。

全局短提示统一使用 `@motus-ai/seed-sdk` 导出的 `toast`，支持 `success`、`info`、`warning`、`error`、`loading`、`promise`、`dismiss` 以及描述、操作按钮和同 ID 更新。客户端在应用根挂载一次 `@motus-ai/seed-sdk/react` 的 `Toaster`，负责主题和内容区域居中；插件直接调用 `toast`，共用同一个队列和完整样式，无需再次挂载组件。

```ts
import { toast } from '@motus-ai/seed-sdk';

const id = toast.loading('正在保存…');
toast.success('保存成功', { id });
toast.error('保存失败', { description: '请检查连接后重试。' });
```

native-host 和 sandboxed-web 后端都支持经 consumes、Schema、审批、审计与计费校验的 capabilities.list/invoke/stream；调用的取消和所属 Component 卸载都会沿 IPC 传到提供方。后台 tasks 在两种环境中均参与平台活动观察。sandboxed-web 不开放 Node、任意网络连接或本地 HTTP handler；后两者仍需 native-host 及对应静态权限，不提供伪成功或静默降级。

UI 的命令、toolbar/ribbon、视图和状态项属于当前插件的 DOM 容器，不是 Obsidian 的全局工作区。toolbar 图标使用 Lucide 名称并随注册清理；页面隐藏不等于卸载后端。SDK 不宣称提供尚不存在的全局命令面板或全局 DOM 状态栏。

UI 可调用 `app.reloadService()` 重新加载自己的后端；不能重载其他插件。正常卸载与用户取消不同，持久提问和会话须通过 Pi 的原有恢复机制保留。

`app.resources.url(path)` / `PluginService.resourceUrl(path)` 返回已声明资源地址；`app.files.pick()` 和 `app.files.path(file)` 复用系统文件选择与拖放路径能力。`PluginService.publish(name,data)` 将通知发给自己的 UI `app.events`，不提供跨插件事件广播或重启回放。

`app.clipboard.writeText(text)` 通过通用平台桥写入文本，复用客户端现有的大小校验，不依赖浏览器剪贴板权限；不提供剪贴板读取。复制按钮、复制内容和反馈由插件自己实现。

## 单文件构建

使用 @motus-ai/seed-plugin-tools 的 buildPlugin() 分别编译 UI 与服务依赖图。宿主注入 SDK，浏览器依赖图禁止 Node 导入。最终只生成一个 main.js，内部两个入口分别加载，不共享对象或实例。

构建选项 `view` 指定界面源码，默认 `src/main.ts`；`service` 指定可选后端源码。产物提供 `loadView` 和可选 `loadService`，由宿主分别加载。ReactSettingTab 提供插件自己的 i18next 实例，以及 `ComponentProvider` 弹层样式作用域；自行挂载 React Root 时也可从 `@motus-ai/seed-sdk/react` 导入该组件。

`ModelSelectControl` 的 `presentation: ModelSelectPresentation` 由插件自己的语言资源提供：包括占位／加载／不可用文案、任意模型分类及顺序，以及思考等级名称。模型和支持的等级仍通过 `options` 传入；SDK 只处理布局、选择和键盘交互，不内置模型来源或等级枚举。

`SelectControl` 的选项可通过递归 `children` 声明多级菜单，不限两级。父项负责展开，只有叶子项触发 `onValueChange`；选中后显示叶子名称。每项支持 `disabled`、`description` 及图标；空的子菜单不可选择。上下键在当前列移动，左右键进入／返回层级，Enter 选择，Escape 关闭并返回焦点。`portal`、`loading`、`closeOnSelect` 等行为与单级下拉共用，普通单级及模型分组用法保持不变。

```tsx
<SelectControl
  label="Destination"
  value={destination}
  onValueChange={setDestination}
  options={[
    { value: 'team', label: 'Team', children: [
      { value: 'engineering', label: 'Engineering', children: [
        { value: 'room-1', label: 'Project room', description: 'Available' },
      ] },
    ] },
  ]}
/>
```

节点 `value` 在整棵选项树中保持唯一。分组、具体业务状态和文案由插件提供，SDK 不解释业务数据。

调用 `seed.cloud.relay` 或 `seed.cloud.relay.stream.start` 时，按模型计费的插件显式传入顶层 `model_id`。宿主校验并交给 Cloud，不从 `payload` 推断计费标识；不按模型计费的调用不传此字段。价格、权限与最终结算仍由 Cloud 决定。

源码 `manifest.json` 只维护基本信息、兼容要求和图标／语言资源引用，所有字段位于顶层，不使用 `seed` 外层对象。`apiVersion`、`runtime`、`service` 和资源摘要由构建工具生成到同一顶层，不能在源码 Manifest 中重复填写；运行环境在 `buildPlugin({ runtime: 'native-host', ... })` 中选择，默认是 Node-free 的 `sandboxed-web`。源码 Manifest 不包含 `publisherId`、`labels` 或能力声明。

构建工具从同一份能力代码生成 `metadata.json` 并作为摘要覆盖的资源携带，分类取自插件工程 `package.json` 的 `keywords`。能力入口默认 `src/capabilities.ts`，可通过构建选项 `capabilities` 指定其他源码路径。云端静态读取这个索引，不执行插件，也不要求作者维护第二套声明；客户端仍以服务进程实际注册的能力为准。新客户端查询云端 `/api/v2` 插件目录并传入客户端版本，旧客户端 `/api/v1` 目录不分发新框架插件。

权限声明只适用于确实由宿主检查的接口，例如音频、截屏和受控文件服务；声明不代表用户或系统已经授权。受信任的原生后端可以直接使用 Node，它与界面的进程隔离不等于操作系统权限沙箱，不能靠未受检查的 `process.shell` 字符串限制原生命令。原有来源校验、受控接口权限检查和调用审批保持不变。

安装产物为 manifest.json、main.js、可选 styles.css，以及在 Manifest 中声明并校验的必要资源。.seedpkg 是这些产物的 ZIP 容器，不包含用户配置、凭据或业务数据。

## 当前迁移状态

全部 14 个官方插件已采用独立工程、轻量 Manifest、代码注册功能和插件自有 UI。Terminal 可作为最小结构样例；复杂设置参照 Agent Harness 和机器人插件。纯布局组件 Flow/FlowStep 由插件直接组合 JSX，不接收 Renderer 或节点类型声明。

原生与 sandboxed-web 服务均使用独立的 PluginService 实例。私有服务调用可取消；原生进程与沙箱进程退出后，排队中的普通数据写入会被旧实例的生命周期门禁拒绝。

客户端与官方插件只加载 Plugin API v2。旧 apply(ctx)、声明式表单／管理视图、对应 IPC 和 Cordis/Cosmokit 生命周期已删除。已有旧安装记录标为不兼容，不执行旧代码；原加密配置、凭据和插件数据原位保留，新插件沿用相同 ID 后继续读取。

## 本地开发

先在 Seed 仓库运行 npm run dev，再在任一插件独立工程运行 npm run dev（官方仓库也可使用 npm run dev --workspace=<plugin_id>）。构建工具调用插件自己的 build.mjs，将完整构建文件原子同步到用户数据目录 plugins/development/<plugin_id>，不用打包、上传或通过云端更新。

开发命令首次同步后持续监听源码，终端显示 Synced 和 Watching，不表示客户端已经加载成功。产品页面与沙箱服务通过 Vite 的随机 nonce 加载开发初始化脚本，只连接配置的 loopback HTTP/WebSocket 开发源；产品页面只允许已声明插件资源读取，沙箱服务禁止外部网络；未授权内联脚本保持禁止。宿主开发链路可通过 `npm run smoke:plugin-development` 验证，附加完整构建目录可同时验证真实插件：`npm run smoke:plugin-development -- /absolute/plugin/dist`。

Seed 仅在未打包且使用开发服务器启动时识别这个固定目录，也支持手动放入符合新规范的完整构建文件。目录中的 manifest.json、main.js、可选 styles.css 和声明资源使用正式插件相同的静态校验器与隔离运行时。运行使用完整产物快照，构建或校验失败不覆盖上一次完整产物；同版本可以反复构建，界面和后端一起重载。源目录移除后卸载开发实例。

同 ID 的开发插件只在开发环境覆盖运行，不修改正式安装记录；移除后恢复已获授权的正式插件。开发实例沿用相同配置、凭据键和私有数据路径。正式云端下载、包摘要、版本不可变、原子安装和授权机制保持独立，不允许开发目录削弱正式校验。SDK 与插件正式云发布链路仍需另外验收。

## 现有通用宿主协议

### 通用音频采集

声明 `device.audio.capture` 后，可调用 `this.app.invokeHost('seed.audio', { operation: 'capture.start', source })`。
`source` 可选 `microphone`（默认）、`system`、`mixed`，分别采集默认麦克风、系统输出及两者混合。
音源在会话开始时确定，暂停/继续不更换音源；状态和持久会话记录返回 `source`。
三种音源共用现有 `capture.segment/stop/consume/read/ack` PCM16 单声道 16 kHz 与持久分段协议。
麦克风通过隔离 AudioWorklet 按 20 ms 分块采集，由浏览器统一重采样至 16 kHz。混合模式对齐两路音频帧，以固定 1:1 比例混音，只输出一条音轨，不做额外自动增益、音乐压低或活跃判断；它不是语音分离，重叠人声的识别效果仍取决于转写模型。
系统音频由宿主的原生 Core Audio Tap（macOS 14.2+）或 WASAPI 回环（Windows）采集，不调用屏幕共享 API、不创建视频轨道，也不显示屏幕选择器。麦克风继续使用原有隔离采集窗口；混合模式在宿主合并两路 PCM，复用同一持久分段流程。
Linux 继续支持麦克风，但当前不支持系统音频；权限拒绝、格式错误、音源断开或混音队列失步会失败，不自动降级为其他音源。
macOS 使用锁定的 AudioTee 通用二进制，作为应用资源置于 ASAR 外；Windows 使用锁定的 WASAPI 平台 N-API 包。只加载当前平台所需的纯音频后端，Linux 不加载系统音频后端。
非法音源返回 `audio_source_invalid`，不支持的平台返回 `audio_source_unsupported`，采集失败返回 `audio_capture_failed`。
macOS 应用包必须声明 `NSAudioCaptureUsageDescription`；首次使用可能请求“系统音频录制”权限，但不需要选择共享屏幕。开发时从终端/IDE 启动 Electron 也受系统权限归属限制。
宿主在本机用户数据目录 `recordings/latest` 保留最近一次录音的 WAV，下一次录音覆盖，不积累历史。混合模式保存麦克风、系统声音和最终混合音；单音源模式只保存实际输入及最终输出，不复制模型请求或增加转写调用。
用户主动上传诊断包时，会附带 `recordings/latest` 中存在的 `microphone.wav`、`system.wav` 和 `mixed.wav`，不扫描历史目录。上传前生成独立快照，续传复用同一份诊断包；缺少录音时仍可上传普通诊断记录。

- [插件开发手册](https://github.com/agimx-ai/motusai-seed/blob/main/docs/插件开发手册.md)
- [插件包规范](https://github.com/agimx-ai/motusai-seed/blob/main/docs/社区插件与插件包规范.md)
- [官方插件示例](https://github.com/agimx-ai/motusai-seed-official-plugins)
- [版本变更](https://github.com/agimx-ai/motusai-seed/blob/main/packages/seed-sdk/CHANGELOG.md)

SDK 与 Seed 客户端的兼容要求会随新增接口记录在版本变更中。使用新接口前，请确认插件声明的最低 Seed 版本满足要求。

## 本地异步固定计费

在目标方法声明 `billing.settlement: local_relay` 和 `billing.product`，通过 `this.app.invokeHost('seed.local.relay.prepare', { capability_id, method, invocation_id, plugin_version, arguments })` 使用 Cloud 现有的调用准备与价格快照。持久化稳定请求编号和返回的 `call_id`，随后调用 `seed.local.relay`，参数为 `{ capability_id, method, call_id, task_id, outcome }`。`outcome` 依次使用 `started` 和最终的 `succeeded`、`failed` 或 `cancelled`；只有成功终态扣费。

Cloud 负责价格、余额和幂等记账；插件负责业务终态以及重启后的任务查询和待确认结果重试。价格不能由客户端保存或提交来决定实际扣费；相同请求重试必须保留原编号，新业务请求使用新编号。断网、待确认及结算失败不表示免费，也不能为了重试结算重新执行业务。
