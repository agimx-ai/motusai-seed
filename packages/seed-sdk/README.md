# @motus-ai/seed-sdk

MotusAI Seed 插件开发 SDK —— 提供设置页、前后端通信、数据存储、公开能力、事件订阅和插件构建等核心能力。

## ✨ 特性

- 🧩 **插件生命周期** — 支持异步初始化，卸载时自动清理监听器、定时器和子组件
- 🎨 **DOM / React 界面** — 提供设置页、输入框、选择器、按钮、弹窗和消息提示
- 🔗 **前后端通信** — 从页面调用插件后端方法，支持异步返回和取消
- 🔐 **数据存储** — 按插件保存加密数据、后端配置和凭据
- 🔌 **公开能力** — 注册公开方法，支持参数、结果校验和跨插件调用
- 📡 **事件订阅** — 支持前后端通知，以及跨插件后台事件
- 🔔 **系统通知** — 发送桌面通知，监听显示、点击和关闭事件
- 🔄 **开发热更新** — 监听源码变化，自动构建并同步到 Seed 开发客户端
- 📦 **插件打包** — 生成 `.seedpkg` 安装包及 SHA-256 摘要

## 📦 安装

```bash
npm install --save-dev @motus-ai/seed-sdk
# 或
yarn add --dev @motus-ai/seed-sdk
```

使用 React 组件时：

```bash
npm install react@^19 react-dom@^19 react-i18next@^17 lucide-react@^0.468 streamdown@^2.6
npm install --save-dev typescript @types/react@^19 @types/react-dom@^19
```

## 🚀 快速开始

`src/service.ts`：

```ts
import { PluginService } from '@motus-ai/seed-sdk';

export default class ClockService extends PluginService {
  onload() {
    // 1. 注册后端方法
    this.registerMethod('now', (_args, signal) => {
      signal.throwIfAborted();
      return { iso: new Date().toISOString() };
    });
  }
}
```

`src/main.ts`：

```ts
import { Plugin, PluginSettingTab, Setting } from '@motus-ai/seed-sdk';

class ClockSettings extends PluginSettingTab {
  display() {
    // 2. 添加设置项和按钮
    const row = this.addChild(
      new Setting(this.containerEl)
        .setName('当前时间')
        .setDesc('点击按钮，从插件后端读取时间。'),
    );

    row.addButton((button) => {
      button.setButtonText('读取时间').onClick(async () => {
        button.setDisabled(true);
        try {
          // 3. 调用后端方法并显示结果
          const result = await this.app.service.call<{ iso: string }>(
            'now',
            {},
            row.signal,
          );
          row.setDesc(result.iso);
        } finally {
          button.setDisabled(false);
        }
      });
    });
  }
}

export default class ClockPlugin extends Plugin {
  onload() {
    // 4. 注册设置页
    this.addSettingTab(new ClockSettings(this.app, this));
  }
}
```

`build.mjs`：

```js
import { buildPlugin } from '@motus-ai/seed-sdk/tools';

// 5. 构建插件
await buildPlugin({
  root: import.meta.dirname,
  service: 'src/service.ts',
});
```

---

## 📖 API 文档

### `Plugin`

前端插件类，继承自 `Component`，提供设置页、命令、视图和数据读写等功能。

#### 方法一览

| 方法 | 说明 | 返回值 |
| --- | --- | --- |
| `addSettingTab(tab)` | 添加设置页 | `void` |
| `registerView(type, creator)` | 注册视图类型和创建函数 | `void` |
| `addCommand(command)` | 注册命令 | `Command` |
| `removeCommand(id)` | 按插件内 ID 移除命令 | `void` |
| `addRibbonIcon(icon, title, callback)` | 添加工具栏按钮，使用 Lucide 图标名 | `HTMLElement` |
| `addStatusBarItem()` | 添加当前插件的状态元素 | `HTMLElement` |
| `loadData<T>()` | 读取普通数据；不存在时返回 `null` | `Promise<T \| null>` |
| `saveData(data)` | 保存可序列化的数据 | `Promise<void>` |

#### 属性

| 属性 | 说明 | 类型 |
| --- | --- | --- |
| `app` | 前端接口 | `App` |
| `manifest` | 插件信息 | `PluginManifest` |

### `App`

| 属性 / 方法 | 类型或返回值 | 说明 |
| --- | --- | --- |
| `locale` | `string` | 当前语言 |
| `theme` | `'light' \| 'dark'` | 当前主题 |
| `i18n` | i18next 实例 | 读取当前语言的文案 |
| `events` | `Events` | 当前插件前端事件 |
| `service.call<T>(method, args?, signal?)` | `Promise<T>` | 调用插件后端方法 |
| `reloadService?.()` | `Promise<void>` | 重新加载插件后端 |
| `resources?.url(path)` | `string` | 包内资源 URL |
| `files?.pick(options?)` | `Promise<string[]>` | 选择文件，取消返回 `[]` |
| `files?.path(file)` | `string` | 获取 `File` 的本地路径 |
| `clipboard?.writeText(text)` | `Promise<void>` | 写入剪贴板 |

### `PluginService`

后端插件类，继承自 `Component`，提供方法注册、能力注册、事件发布和配置读写等功能。

#### 方法一览

| 方法 | 说明 | 返回值 |
| --- | --- | --- |
| `registerMethod(name, handler)` | 注册私有方法；`handler(args, signal)` 返回结果或 Promise | `void` |
| `publish(name, data)` | 将通知发送给当前插件前端的 `app.events` | `Promise<void>` |
| `addCapability(definition, handler?)` | 注册公开能力；有方法时必须传处理器 | `void` |
| `registerLocalApi(registration)` | 注册本地 HTTP 路由和请求处理器 | `void` |
| `registerConnection(descriptor)` | 注册连接状态、重连与关闭回调 | `SeedConnectionHandle` |
| `resourceUrl(path)` | 获取已声明资源的 URL | `string` |
| `loadData<T>()` / `saveData(data)` | 与前端共用的普通数据 | `Promise<T \| null>` / `Promise<void>` |

#### 属性

| 属性 | 说明 | 类型 |
| --- | --- | --- |
| `app` | 后端接口 | `ServiceApp` |
| `manifest` | 插件信息 | `PluginManifest` |
| `i18n` | 读取翻译文案 | i18next 实例 |

### `ServiceApp`

| 属性 | 常用接口 / 返回值 | 用途 |
| --- | --- | --- |
| `package` | `package_id`、`version`、`data_path` | 当前插件身份与数据目录 |
| `settings` | `PluginSettingsStore` | 后端配置记录 |
| `secrets` | `get(key): Promise<string \| undefined>`、`set(key, value)`、`delete(key)` | 凭据存储；写入 / 删除返回 `Promise<void>` |
| `capabilities` | `list()`、`invoke(input)`、可选 `stream(input)` | 调用已声明消费的公开能力 |
| `events` | `list()`、`publish(input)`、`subscribe(options, handler)` | 跨插件后台事件 |
| `notifications` | `show(options, handlers?): Promise<SystemNotification>` | 发送系统通知 |
| `tasks` | `start(input)`、`run(input, work)` | 后台任务的状态与取消 |
| `connections` | `register(descriptor)` | 插件连接的生命周期与状态 |
| `authorization` | `authorize(request, signal?)` | 浏览器 OAuth / OIDC 授权 |
| `audit` | `record(entry): Promise<void>` | 记录审计信息 |
| `diagnostics` | `report(entry)`、`error(event, error, context?)` | 记录诊断信息 |
| `invokeHost(service, args)` | `Promise<unknown>` | 调用受控宿主服务，如音频采集 |

---

### `service.call` 详细说明

调用当前插件的后端方法，支持异步返回和取消。

```ts
import type { App } from '@motus-ai/seed-sdk';

export async function greet(app: App, name: string, signal?: AbortSignal) {
  return await app.service.call<{ message: string }>(
    'greet',  // 后端方法名
    { name }, // 方法参数
    signal,   // 取消信号
  );
}
```

返回值：`Promise<T>`。

### `registerMethod` 详细说明

注册供插件页面调用的方法，回调接收方法参数和取消信号。

```ts
import { PluginService } from '@motus-ai/seed-sdk';

export default class GreetingService extends PluginService {
  onload() {
    this.registerMethod('greet', ({ name }, signal) => {
      signal.throwIfAborted();
      return { message: 'Hello, ' + String(name ?? 'World') };
    });
  }
}
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 方法名 |
| `handler` | `(args: Record<string, unknown>, signal: AbortSignal) => unknown \| Promise<unknown>` | 方法实现 |

返回值：`void`。

---

### `Component`

生命周期管理类，提供事件注册、定时器和资源清理等功能。

| 方法 | 说明 | 返回值 |
| --- | --- | --- |
| `onload()` | 初始化钩子，由宿主调用，可异步 | `void \| Promise<void>` |
| `onunload()` | 同步卸载 | `void` |
| `register(disposer)` | 注册清理函数，卸载时按逆序执行并等待完成 | `void` |
| `registerEvent(ref)` | 注册 `Events.on()` 返回的监听引用，卸载时取消 | `void` |
| `registerDomEvent(target, type, callback, options?)` | 监听 DOM 事件，卸载时移除 | `void` |
| `registerInterval(id)` | 接收 `setInterval()` 的返回值，卸载时清除 | 原定时器 ID |
| `addChild(child)` | 接管一个子组件的生命周期 | 传入的子组件 |
| `removeChild(child)` | 卸载并移除子组件 | `Promise<T>` |
| `load()` | 加载新组件实例 | `Promise<void>` |
| `unload()` | 取消工作并等待资源清理 | `Promise<void>` |

#### 属性

| 属性 | 说明 | 类型 |
| --- | --- | --- |
| `signal` | 组件卸载时触发取消 | `AbortSignal` |
| `loaded` | 是否已完成加载 | `boolean` |

---

### `PluginSettingTab` / `Setting`

创建设置页并添加文本、开关、下拉框、滑块和按钮。

| 接口 | 参数 / 用途 | 返回值 |
| --- | --- | --- |
| `new PluginSettingTab(app, plugin)` | 前端 `App` 与所属 `Plugin` | 设置页实例 |
| `display()` | 渲染页面，可异步 | `void \| Promise<void>` |
| `update()` | 重新渲染当前设置页 | `Promise<void>` |
| `new Setting(containerEl)` | 在指定元素中创建一行设置 | `Setting` |
| `setName(text)` / `setDesc(text)` | 设置名称 / 说明 | `this` |
| `setHeading()` / `setDisabled(value)` | 标题行 / 禁用整行 | `this` |
| `addText(callback)` / `addTextArea(callback)` | 创建文本输入框 | `this` |
| `addToggle(callback)` / `addDropdown(callback)` | 创建开关 / 下拉框 | `this` |
| `addSlider(callback)` / `addButton(callback)` | 创建滑块 / 按钮 | `this` |

#### 控件方法

| 控件 | 常用方法 | 返回值 |
| --- | --- | --- |
| `TextComponent` / `TextAreaComponent` | `setValue(string)`、`setPlaceholder(string)`、`onChange(callback)` | `this`；`getValue()` 返回 `string` |
| `ToggleComponent` | `setValue(boolean)`、`onChange(callback)` | `this`；`getValue()` 返回 `boolean` |
| `DropdownComponent` | `addOption(value, label)`、`addOptions(record)`、`setValue(string)` | `this`；`getValue()` 返回 `string` |
| `SliderComponent` | `setLimits(min, max, step)`、`setValue(number)`、`onChange(callback)` | `this`；`getValue()` 返回 `number` |
| `ButtonComponent` | `setButtonText(text)`、`setTooltip(text)`、`setCta()`、`setWarning()`、`onClick(callback)` | `this` |

---

### `PluginSettingsStore`

读取和更新后端配置，通过 `this.app.settings` 使用。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `snapshot<T>(id)` | 配置 ID | `Promise<PluginSettingsSnapshot<T>>` |
| `get<T>(id)` | 配置 ID | `Promise<T \| null>` |
| `save<T>(id, value, revision)` | 配置 ID、新值、读取时的修订号 | `Promise<PluginSettingsSnapshot<T>>` |
| `saveMany<T>(updates)` | `{ id, value, revision }[]`；整批校验并保存 | `Promise<Record<string, PluginSettingsSnapshot<T>>>` |
| `update<T>(id, mutate)` | `mutate(value: T \| null)` 返回新值或 Promise | `Promise<PluginSettingsSnapshot<T>>` |
| `transaction<T>(ids, mutate)` | 多个 ID；回调返回要更新的 ID 与值 | `Promise<Record<string, PluginSettingsSnapshot<T>>>` |

返回结构为 `PluginSettingsSnapshot<T>`；保存冲突时返回 `plugin_settings_conflict`。

### `notifications`

发送系统通知，通过 `this.app.notifications` 使用。需在 `manifest.json` 中声明 `system.notifications` 权限。

需要 Seed SDK 0.3.2 和 MotusAI Seed 0.3.6 或更新版本；使用该接口时，`minAppVersion` 不得低于 `0.3.6`。

| 方法 | 说明 | 返回值 |
| --- | --- | --- |
| `isSupported()` | 检查当前系统是否支持通知 | `Promise<boolean>` |
| `create(options)` | `SystemNotificationOptions`，创建通知，暂不发送 | `SystemNotification` |
| `show(options, handlers?)` | `SystemNotificationOptions`、可选 `SystemNotificationHandlers`，创建并发送通知 | `Promise<SystemNotification>` |

#### `SystemNotificationOptions`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 否 | 通知标题，最多 16,384 字符 |
| `body` | `string` | 否 | 通知正文，最多 65,536 字符；系统可能截断展示 |
| `silent` | `boolean` | 否 | 是否静音 |
| `icon` | `string` | 否 | PNG / JPEG 图片，使用已声明的包内资源相对路径或 Base64 data URL；最多 2 MiB、2048 × 2048 像素 |
| `clickTarget` | `SeedNavigationTarget` | 否 | 点击后打开的客户端目标；省略时不自动跳转 |

#### `SystemNotification`

| 属性 / 方法 | 说明 | 类型或返回值 |
| --- | --- | --- |
| `id` | 通知句柄 ID | `string` |
| `result` | 最近一次发送结果；未发送时为 `undefined` | `SystemNotificationResult \| undefined` |
| `on(event, listener)` | 监听事件，返回取消监听函数 | `() => void` |
| `show(options?)` | 发送通知；传参替换全部配置，省略时沿用上次配置 | `Promise<SystemNotificationResult>` |
| `close()` | 关闭通知并释放句柄 | `Promise<void>` |
| `closed` | 句柄释放时完成；事件接收失败时拒绝 | `Promise<void>` |

每个插件最多同时保留 64 个已发送通知句柄。不再使用时调用 `close()`，插件卸载时自动清理。

#### `SystemNotificationResult`

| 返回值 | 说明 |
| --- | --- |
| `sent` | 系统报告已发送，不代表用户已阅读 |
| `disabled` | 用户关闭客户端通知开关，或客户端正在退出 |
| `unsupported` | 当前系统不支持通知 |
| `failed` | 发送失败或超时 |

非 `sent` 结果会关闭句柄，重试时需重新创建通知。参数或权限错误会拒绝调用。

### `secrets`

保存、读取和删除 Token 等凭据，通过 `this.app.secrets` 使用。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `get(key)` | `key: string` | `Promise<string \| undefined>` |
| `set(key, value)` | `key: string`、`value: string` | `Promise<void>` |
| `delete(key)` | `key: string` | `Promise<void>` |

---

### `ReactSettingTab`

使用 React 编写设置页，实现 `render()` 返回 JSX。

| 接口 | 参数 | 返回值 |
| --- | --- | --- |
| `new Settings(app, plugin)` | 前端 `App` 与所属 `Plugin` | 设置页实例 |
| `render()` | 无 | `ReactNode` |

#### 组件一览

| 组件 | 主要参数 | 用途 |
| --- | --- | --- |
| `SelectControl` | `label`、`value`、`options`、`onValueChange` | 单级或递归多级下拉选择 |
| `SegmentedControl` | `label`、`value`、`options`、`onValueChange` | 分段切换 |
| `ModelSelectControl` / `ModelSelect` | `label`、`value`、`options`、`onChange`、`presentation` | 选择模型和思考等级 |
| `AsyncCombobox` | `value`、`options`、`onChange` | 可输入、可搜索的选择框 |
| `TextInputControl` | 原生 input 属性，如 `value`、`onChange` | 文本输入 |
| `ActionButton` | 原生 button 属性、`tone`、`busy`、`icon` | 操作按钮 |
| `IconButton` | `icon`、`label`、`onClick`、`tone`、`busy` | 图标按钮；`label` 同时用作可访问名称和提示 |
| `Tooltip` | `children`、`content`、`delayMs`、`placement` | 悬停 / 聚焦提示 |
| `FieldLabel` | `children`、`description`、`helpUrl` | 字段名称、帮助提示与链接 |
| `DisclosureControl` | `open`、`label`、`onToggle`、`children`、`actions` | 显示折叠标题栏与操作按钮 |
| `FileInputControl` | `value`、`multiple`、`accept`、`onChange`、`getPathForFile` 及标签 / 错误文案 | 本地文件选择与拖放 |
| `StatusLine` | `children`、`tone`、`pending`、`actions` | 状态行 |
| `StatusBadge` | `children`、`tone`、可选 `onClick` | 状态胶囊 |
| `Dialog` | `open`、`title`、`closeLabel`、`onClose`、`children`、`busy` | 带焦点管理的对话框 |
| `Flow` / `FlowStep` | `children`；步骤还需 `icon`、`title`，可选 `muted` | 步骤布局 |
| `MarkdownContent` | `children: string`、`streaming` | 静态 / 流式 Markdown |
| `Collection` / `CollectionCard` | `children`；卡片使用 `icon`、`title`、`description`、`onOpen`、`actions` | 集合与可打开的卡片 |

#### `SelectControl` 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `label` | `string` | 是 | — | 控件名称 |
| `value` | `Value` | 是 | — | 当前选中值 |
| `options` | `SelectControlOption<Value>[]` | 是 | — | 选项列表，`children` 用于添加子选项 |
| `onValueChange` | `(value: Value) => void` | 是 | — | 选中叶子选项时回调，参数为该项的 `value` |
| `placeholder` | `string` | 否 | `label` | 未选中时显示的文案 |
| `disabled` / `loading` | `boolean` | 否 | `false` | 禁用 / 加载状态 |
| `portal` | `boolean` | 否 | `false` | 将下拉菜单挂载到页面弹层容器 |
| `closeOnSelect` | `boolean` | 否 | `true` | 选择后关闭菜单 |
| `variant` | `'compact' \| 'form' \| 'model'` | 否 | `'compact'` | 展示样式 |
| `size` | `'default' \| 'form'` | 否 | `'default'` | 控件尺寸 |

#### `ModelSelectControl` 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `label` | `string` | 是 | 控件名称 |
| `value` | `string` | 是 | 选中的模型 |
| `options` | `(SelectControlOption<string> & { thinkingLevels?: readonly string[] })[]` | 是 | 模型选项 |
| `onChange` | `(model: string, thinking: string) => void` | 是 | 模型 / 思考等级变化 |
| `presentation` | `ModelSelectPresentation` | 是 | 分类与状态文案 |
| `thinkingValue` | `string` | 否 | 当前思考等级 |
| `disabled` / `loading` | `boolean` | 否 | 禁用 / 加载状态 |
| `size` | `'default' \| 'form'` | 否 | 控件尺寸，默认 `'default'` |

---

### `toast` 使用示例

```ts
import { toast } from '@motus-ai/seed-sdk';

toast.success('保存成功');
toast.error('保存失败', { description: '请检查连接后重试。' });
```

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `toast(message, options?)` | 消息、提示选项 | `string \| number` |
| `toast.success/info/warning/error(message, options?)` | 消息、提示选项 | `string \| number` |
| `toast.loading(message, options?)` | 加载提示 | `string \| number` |
| `toast.promise(promise, options)` | Promise 与状态文案 | 带 `unwrap(): Promise<T>` 的提示结果 |
| `toast.dismiss(id?)` | 提示 ID，省略时关闭全部 | `string \| number` |

---

### `addCapability` 详细说明

注册公开能力和调用处理器。处理器接收方法名和 `SeedInvocation`，返回 `Promise<unknown>`。

#### `CapabilityDefinition`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 能力标识 |
| `version` | `number` | 是 | 能力版本号 |
| `exposure` | `'terminal' \| 'plugin' \| 'local'` | 否 | 能力公开范围 |
| `methods` | `CapabilityMethod[]` | 是 | 公开方法；只发布事件时填 `[]` |
| `events` | `CapabilityEvent[]` | 否 | 后台事件定义 |
| `descriptionKey` | `string` | 否 | 能力描述的翻译键 |
| `annotations` | `Record<string, unknown>` | 否 | 能力注解 |

#### `CapabilityMethod`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | 是 | 方法名 |
| `risk` | `'read' \| 'write' \| 'control'` | 是 | 读取、写入或控制风险 |
| `inputSchema` / `outputSchema` | JSON Schema 对象 | 否 | 校验方法参数 / 返回结果 |
| `displayNameKey` / `descriptionKey` | `string` | 否 | 展示名称 / 描述的翻译键 |
| `platforms` | `('darwin' \| 'linux' \| 'win32')[]` | 否 | 支持的平台 |
| `annotations` | `Record<string, unknown>` | 否 | 方法注解 |

### `capabilities` 详细说明

查找其他插件提供的能力，并调用指定方法。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `list()` | 无 | `Promise<SeedAvailableCapability[]>` |
| `invoke(input)` | 下表 | `Promise<unknown>` |
| `stream?(input)` | 相同调用参数，方法注解需包含 `seed.stream: true` | `AsyncIterable<unknown>` |

`invoke()` 参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `capability` | `string` | 是 | — | 能力 ID |
| `method` | `string` | 是 | — | 方法名 |
| `arguments` | `Record<string, unknown>` | 是 | — | 方法参数 |
| `provider_plugin_id` | `string` | 多提供方时 | — | 提供方插件 ID |
| `request_id` | `string` | 否 | — | 请求编号 |
| `signal` | `AbortSignal` | 否 | — | 取消信号 |
| `include_billing` | `boolean` | 否 | `false` | 返回 `{ result, billing }` |
| `activity` | `'foreground' \| 'background'` | 否 | `'foreground'` | 活动记录方式 |

---

### `invokeHost` 详细说明

调用 Seed 系统服务，例如音频采集。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `service` | `string` | 是 | 服务标识，例如 `seed.audio` |
| `args` | `Record<string, unknown>` | 是 | 服务参数 |

返回值：`Promise<unknown>`。

### `mountPluginService` 详细说明

加载插件后端，用于测试方法调用、配置读写和能力注册。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `entry` | `PluginTestEntry` | 是 | 后端服务类或初始化函数 |
| `options.project` | `URL` | 是 | 包含 `manifest.json` 的工程目录 |
| `options.settings` | `Record<string, unknown>` | 否 | 初始配置 |
| `options.invokeHost` | `PluginServices['invokeHost']` | 否 | 宿主服务替身 |
| `options.invokeCapability` | `SeedPluginCapabilityService['invoke']` | 否 | 能力调用替身 |

返回的测试上下文：

| 属性 / 方法 | 返回值 / 说明 |
| --- | --- |
| `service` | 已加载的 `PluginService` |
| `definitions` | `Map<string, CapabilityDefinition>` |
| `invoke(id, method, invocation)` | `Promise<unknown>`，调用注册的能力 |
| `dispose()` | `Promise<void>`，卸载服务 |
| `reconnectConnection(id)` | `Promise<void>`，触发连接重连 |
| `activeTaskCount()` | `number`，当前任务数 |

---

## ⚙️ 配置选项

### `manifest.json`

| 方法 | 参数说明 | 返回值 |
| --- | --- | --- |
| `addSettingTab(tab)` | 设置页实例，如 `new Settings(this.app, this)` | `void` |
| `registerView(type, creator)` | 视图类型及 `(host: ViewHost) => View` 创建函数 | `void` |
| `addCommand(command)` | 命令对象，字段见下表 | 带命名空间 ID 的 `Command` |
| `removeCommand(id)` | 插件内的原始命令 ID | `void` |
| `addRibbonIcon(icon, title, callback)` | Lucide 图标名、提示文案、点击回调 | `HTMLElement` |
| `addStatusBarItem()` | 添加当前插件的状态元素 | `HTMLElement` |
| `loadData<T>()` | 读取普通数据；不存在时返回 `null` | `Promise<T \| null>` |
| `saveData(data)` | 保存可序列化的数据 | `Promise<void>` |

### `buildPlugin`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `root` | `string` | 当前工作目录 | 插件工程目录 |
| `view` | `string` | `src/main.ts` | 前端入口；React 通常使用 `src/main.tsx` |
| `service` | `string` | 不构建后端 | 后端入口 |
| `runtime` | `'sandboxed-web' \| 'native-host'` | `'sandboxed-web'` | 后端运行环境；`native-host` 必须提供 `service` |
| `styles` | `string` | — | 自定义 CSS 文件 |
| `outdir` | `string` | `dist` | 工程目录内的输出子目录 |
| `resources` | `{ path: string; source: string }[]` | `[]` | 包内路径与工程源文件 |
| `capabilities` | `string` | `src/capabilities.ts`（若存在） | 导出 `capabilities` 数组的文件 |
| `serviceOptions` | esbuild `BuildOptions` | — | 后端构建选项 |

返回值：`Promise<{ output: string; manifest: BuiltPluginManifest }>`。

### `packPlugin`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `root` | `string` | 当前工作目录 | 工程目录 |
| `outdir` | `string` | `'dist'` | 已构建产物目录 |
| `packages` | `string` | `'artifacts'` | 安装包输出目录 |
| `variant` | `PluginPackageVariant` | — | 平台目标与附加资源 |

返回值：`Promise<{ packagePath: string; sha256: string; size: number }>`，`size` 单位为字节。

---

## 📡 事件列表

### 系统通知事件

通过 `notification.on(event, listener)` 监听，或在 `app.notifications.show(options, handlers)` 中传入回调。

| 事件 | 回调参数 | 说明 |
| --- | --- | --- |
| `show` | `notification: SystemNotification` | 系统报告通知已显示 |
| `click` | `notification: SystemNotification` | 用户点击通知 |
| `close` | `notification: SystemNotification` | 系统报告通知已关闭，不代表句柄已释放 |

回调返回 `void` 或 `Promise<void>`。使用 `create()` 时，先注册监听，再调用通知的 `show()`。

事件是否触发取决于系统通知服务和用户设置。

### 前端事件

通过 `app.events.on(name, listener)` 监听后端 `publish(name, data)` 发送的通知。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `events.on(name, listener, context?)` | 事件名、回调及可选 this 上下文 | `EventRef` |
| `events.off(name, listener)` | 移除指定监听 | `void` |
| `events.offref(ref)` | 移除监听引用 | `void` |
| `events.trigger(name, ...args)` | 触发当前事件对象的监听 | `void` |

### 后台事件

通过 `app.events.subscribe(options, handler)` 订阅其他插件发布的事件。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `list()` | 无 | `Promise<AvailablePluginEvent[]>` |
| `publish(input)` | `{ capability, event, version, data }` | `Promise<PluginEvent>` |
| `subscribe<T>(options, handler)` | 订阅参数，及 `(event: PluginEvent<T>, signal) => void \| Promise<void>` | `Promise<PluginEventSubscription>` |

订阅参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `provider_plugin_id` | `string` | 是 | 精确指定提供方插件 |
| `capability` | `string` | 是 | 能力 ID |
| `event` | `string` | 是 | 事件名 |
| `version` | `number` | 是 | 事件版本 |
| `signal` | `AbortSignal` | 否 | 主动取消订阅 |

订阅结果：

| 属性 / 方法 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 订阅 ID |
| `signal` | `AbortSignal` | 订阅取消信号 |
| `closed` | `Promise<void>` | 投递结束；提供方停止、撤权、传输异常或溢出时拒绝 |
| `unsubscribe()` | `Promise<void>` | 停止投递 |

---

## 📋 数据类型

### `SeedInvocation`

```ts
import type { SeedInvocationPrincipal } from '@motus-ai/seed-sdk';

export type SeedInvocation = {
  request_id: string;                 // 请求 ID
  arguments: Record<string, unknown>; // 方法参数
  signal?: AbortSignal;              // 取消信号
  provider_plugin_id?: string;        // 提供方插件 ID
  capability?: string;               // 能力 ID
  session_id?: string;               // 会话 ID
  principal?: SeedInvocationPrincipal;
  billing?: { call_id: string; amount: number; price_revision: number };
  approval?: unknown;
  context?: unknown;
  input?: unknown;
};
```

### `PluginSettingsSnapshot<T>`

```ts
export type PluginSettingsSnapshot<T = unknown> = {
  revision: string; // 保存时使用的修订号
  value: T | null;  // 配置内容
};
```

### `PluginEvent<T>`

```ts
export type PluginEvent<T = unknown> = {
  id: string;                  // 事件 ID
  provider_plugin_id: string;   // 发布事件的插件 ID
  capability: string;          // 所属能力
  capability_version: number;  // 能力版本
  event: string;               // 事件名称
  event_version: number;       // 事件版本
  published_at: string;        // 发布时间
  data: T;                    // 事件数据
};
```

### `SelectControlOption<Value>`

```ts
export type SelectControlOption<Value extends string> = {
  value: Value;
  label: string;
  description?: string;
  children?: SelectControlOption<Value>[];
  disabled?: boolean;
  group?: string;
  iconDataUrl?: string;
  iconDarkDataUrl?: string;
};
```

### `ModelSelectPresentation`

```ts
export type ModelSelectPresentation = {
  placeholder: string;
  unavailable: string;
  loading: string;
  groups?: Record<string, string>;
  thinking: {
    label: string;
    unselected: string;
    unsupported: string;
    chooseModel: string;
    default: string;
    levels: Record<string, string>;
  };
};
```

---

## 📂 项目结构

```text
clock-plugin/
├── src/
│   ├── main.ts             # 插件页面
│   ├── service.ts          # 插件后端
│   └── capabilities.ts     # 公开能力（可选）
├── locales/                # 翻译文件（可选）
├── manifest.json           # 插件信息
├── package.json
└── build.mjs               # 构建脚本
```

`package.json`：

```json
{
  "name": "example-clock-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "keywords": ["productivity"],
  "scripts": {
    "build": "node build.mjs",
    "dev": "seed-plugin dev",
    "pack": "npm run build && seed-plugin pack"
  }
}
```

`manifest.json`：

```json
{
  "id": "com.example.clock",
  "name": "Clock",
  "version": "1.0.0",
  "minAppVersion": "0.3.6",
  "description": "Read the current time from a plugin service.",
  "author": "Your Name"
}
```

---

## 🧩 完整使用示例

### 读取和保存数据

```ts
import { PluginService } from '@motus-ai/seed-sdk';

type Counter = { count: number };

export default class CounterService extends PluginService {
  onload() {
    this.registerMethod('read', async () => {
      return (await this.loadData<Counter>()) ?? { count: 0 };
    });

    this.registerMethod('increment', async (_args, signal) => {
      signal.throwIfAborted();
      const current = (await this.loadData<Counter>()) ?? { count: 0 };
      const next = { count: current.count + 1 };
      await this.saveData(next);
      return next;
    });
  }
}
```

### 校验和保存配置

```ts
import { PluginService, SeedPluginError } from '@motus-ai/seed-sdk';

type Preferences = { title: string };

export default class PreferencesService extends PluginService {
  onload() {
    this.registerMethod('getPreferences', async () => {
      return (await this.app.settings.get<Preferences>('preferences'))
        ?? { title: 'My plugin' };
    });

    this.registerMethod('savePreferences', async ({ title }, signal) => {
      signal.throwIfAborted();
      if (typeof title !== 'string' || !title.trim() || title.length > 100) {
        throw new SeedPluginError('invalid_title', '标题必须为 1–100 个字符。');
      }
      const saved = await this.app.settings.update<Preferences>(
        'preferences',
        () => ({ title: title.trim() }),
      );
      return saved.value;
    });
  }
}
```

### 保存和删除凭据

```ts
import { PluginService, SeedPluginError } from '@motus-ai/seed-sdk';

export default class CredentialService extends PluginService {
  onload() {
    this.registerMethod('setToken', async ({ token }) => {
      if (typeof token !== 'string' || !token.trim()) {
        throw new SeedPluginError('token_required', '请输入 Token。');
      }
      await this.app.secrets.set('api-token', token);
      return { configured: true };
    });

    this.registerMethod('tokenStatus', async () => ({
      configured: Boolean(await this.app.secrets.get('api-token')),
    }));

    this.registerMethod('deleteToken', async () => {
      await this.app.secrets.delete('api-token');
      return { configured: false };
    });
  }
}
```

### 发送和关闭系统通知

`manifest.json`：

```json
{ "permissions": ["system.notifications"] }
```

`src/service.ts`：

```ts
import { PluginService, type SystemNotification } from '@motus-ai/seed-sdk';

export default class NotificationService extends PluginService {
  private notification?: SystemNotification;

  onload() {
    this.registerMethod('notify', async () => {
      await this.notification?.close();
      this.notification = await this.app.notifications.show({
        title: '任务完成',
        body: '结果已准备好，点击查看。',
        silent: true,
        clickTarget: { destination: 'plugins', pluginId: this.manifest.id },
      }, {
        click: async (notification) => {
          await notification.close();
        },
      });
      return { result: this.notification.result };
    });

    this.registerMethod('closeNotification', async () => {
      await this.notification?.close();
    });
  }
}
```

### React 设置页

`src/main.tsx`：

```tsx
import { useState } from 'react';
import { Plugin, toast, type App } from '@motus-ai/seed-sdk';
import {
  ActionButton,
  ReactSettingTab,
  SelectControl,
} from '@motus-ai/seed-sdk/react';

function ClockPage({ app }: { app: App }) {
  const [format, setFormat] = useState<'local' | 'iso'>('local');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const result = await app.service.call<{ iso: string }>('now');
      setTime(format === 'iso'
        ? result.iso
        : new Date(result.iso).toLocaleString(app.locale));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SelectControl<'local' | 'iso'>
        label="时间格式"
        value={format}
        options={[
          { value: 'local', label: '本地时间' },
          { value: 'iso', label: 'ISO 8601' },
        ]}
        onValueChange={setFormat}
        disabled={busy}
      />
      <ActionButton busy={busy} onClick={() => void refresh()}>
        读取时间
      </ActionButton>
      <output aria-live="polite">{time}</output>
    </div>
  );
}

class ClockSettings extends ReactSettingTab {
  render() {
    return <ClockPage app={this.app} />;
  }
}

export default class ClockPlugin extends Plugin {
  onload() {
    this.addSettingTab(new ClockSettings(this.app, this));
  }
}
```

`build.mjs`：

```js
import { buildPlugin } from '@motus-ai/seed-sdk/tools';

await buildPlugin({
  root: import.meta.dirname,
  view: 'src/main.tsx',
  service: 'src/service.ts',
});
```

### 多级下拉菜单

```ts
import type { SelectControlOption } from '@motus-ai/seed-sdk/react';

export const destinations: SelectControlOption<string>[] = [
  {
    value: 'team',
    label: '团队',
    children: [
      { value: 'engineering', label: '研发', children: [
        { value: 'room-1', label: '项目频道', description: '可用' },
      ] },
    ],
  },
];
```

### 保存结果提示

```ts
import { toast } from '@motus-ai/seed-sdk';

export async function saveWithNotice(save: () => Promise<void>) {
  const id = toast.loading('正在保存…');
  try {
    await save();
    toast.success('保存成功', { id });
  } catch (error) {
    toast.error('保存失败', {
      id,
      description: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
```

### 注册公开能力 + 跨插件调用

提供方 `src/capabilities.ts`：

```ts
import type { CapabilityDefinition } from '@motus-ai/seed-sdk';

export const clockCapability: CapabilityDefinition = {
  id: 'example_clock',
  version: 1,
  exposure: 'plugin',
  methods: [{
    name: 'now',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { iso: { type: 'string' } },
      required: ['iso'],
      additionalProperties: false,
    },
  }],
};

export const capabilities = [clockCapability];
```

提供方 `src/service.ts`：

```ts
import { PluginService, SeedPluginError } from '@motus-ai/seed-sdk';
import { clockCapability } from './capabilities.js';

export default class ClockService extends PluginService {
  onload() {
    const now = () => ({ iso: new Date().toISOString() });
    this.registerMethod('now', now);

    this.addCapability(clockCapability, {
      async invoke(method, invocation) {
        invocation.signal?.throwIfAborted();
        if (method !== 'now') {
          throw new SeedPluginError('unknown_method', '不支持的方法。');
        }
        return now();
      },
    });
  }
}
```

消费方 `manifest.json`：

```json
{
  "consumes": [
    { "capability": "example_clock", "methods": ["now"] }
  ]
}
```

消费方 `src/service.ts`：

```ts
import { PluginService, SeedPluginError } from '@motus-ai/seed-sdk';

export default class ClockConsumer extends PluginService {
  onload() {
    this.registerMethod('readProviderClock', async ({ providerPluginId }, signal) => {
      if (typeof providerPluginId !== 'string' || !providerPluginId) {
        throw new SeedPluginError('provider_required', '请选择提供时钟的插件。');
      }
      return await this.app.capabilities.invoke({
        provider_plugin_id: providerPluginId,
        capability: 'example_clock',
        method: 'now',
        arguments: {},
        signal,
      });
    });

    this.registerMethod('clockProviders', async () => {
      const available = await this.app.capabilities.list();
      return available.filter((item) => item.id === 'example_clock');
    });
  }
}
```

### 前后端事件通知

`src/main.ts`：

```ts
import { Plugin, PluginSettingTab, Setting } from '@motus-ai/seed-sdk';

class UpdateSettings extends PluginSettingTab {
  display() {
    const output = document.createElement('output');
    output.textContent = '等待后台更新';
    this.containerEl.append(output);
    this.addChild(new Setting(this.containerEl).setName('后台通知'))
      .addButton((button) => button.setButtonText('发送更新')
        .onClick(() => this.app.service.call('notify')));

    this.registerEvent(this.app.events.on('updated', (data: { iso: string }) => {
      output.textContent = data.iso;
    }));
  }
}

export default class UpdatePlugin extends Plugin {
  onload() {
    this.addSettingTab(new UpdateSettings(this.app, this));
  }
}
```

`src/service.ts`：

```ts
import { PluginService } from '@motus-ai/seed-sdk';

export default class UpdateService extends PluginService {
  onload() {
    this.registerMethod('notify', async () => {
      const data = { iso: new Date().toISOString() };
      await this.publish('updated', data);
      return data;
    });
  }
}
```

### 跨插件后台事件

提供方 `src/capabilities.ts`：

```ts
import type { CapabilityDefinition } from '@motus-ai/seed-sdk';

export const updates: CapabilityDefinition = {
  id: 'example_updates',
  version: 1,
  exposure: 'plugin',
  methods: [],
  events: [{
    name: 'changed',
    version: 1,
    dataSchema: {
      type: 'object',
      properties: { revision: { type: 'integer' } },
      required: ['revision'],
      additionalProperties: false,
    },
  }],
};

export const capabilities = [updates];
```

提供方 `src/service.ts`：

```ts
import { PluginService } from '@motus-ai/seed-sdk';
import { updates } from './capabilities.js';

export default class UpdatePublisher extends PluginService {
  onload() {
    this.addCapability(updates);
    this.registerMethod('notify', async ({ revision }) => {
      return await this.app.events.publish({
        capability: 'example_updates',
        event: 'changed',
        version: 1,
        data: { revision },
      });
    });
  }
}
```

消费方 `manifest.json`：

```json
{
  "consumes": [
    { "capability": "example_updates", "events": ["changed"] }
  ]
}
```

消费方 `src/service.ts`：

```ts
import { PluginService, SeedPluginError } from '@motus-ai/seed-sdk';

export default class UpdateSubscriber extends PluginService {
  async onload() {
    const offered = await this.app.events.list();
    const providers = offered.filter((item) =>
      item.capability === 'example_updates'
      && item.name === 'changed'
      && item.version === 1,
    );
    if (providers.length !== 1) {
      throw new SeedPluginError('provider_required', '请先配置唯一的更新事件提供方。');
    }

    const subscription = await this.app.events.subscribe<{ revision: number }>({
      provider_plugin_id: providers[0].provider_plugin_id,
      capability: 'example_updates',
      event: 'changed',
      version: 1,
      signal: this.signal,
    }, async (event, signal) => {
      signal.throwIfAborted();
      await this.app.settings.update<{ revision: number }>(
        'last-update',
        () => ({ revision: event.data.revision }),
      );
    });

    this.register(async () => {
      await subscription.unsubscribe();
      await subscription.closed;
    });
  }
}
```

### 中英文翻译

`manifest.json`：

```json
{
  "id": "com.example.clock",
  "name": { "$t": "plugin.name" },
  "version": "1.0.0",
  "minAppVersion": "0.3.6",
  "description": { "$t": "plugin.description" },
  "author": "Your Name",
  "i18n": {
    "defaultLocale": "en-US",
    "resources": {
      "en-US": "locales/en-US.json",
      "zh-CN": "locales/zh-CN.json"
    }
  }
}
```

`locales/en-US.json`：

```json
{
  "plugin": {
    "name": "Clock",
    "description": "Read the current time."
  },
  "settings": { "title": "Current time" }
}
```

`locales/zh-CN.json`：

```json
{
  "plugin": {
    "name": "时钟",
    "description": "读取当前时间。"
  },
  "settings": { "title": "当前时间" }
}
```

前端通过 `this.app.i18n.t('settings.title')` 读取文案，后端通过 `this.i18n.t('settings.title')` 读取。

### 音频采集

`manifest.json`：

```json
{ "permissions": ["device.audio.capture"] }
```

`src/service.ts`：

```ts
import { PluginService } from '@motus-ai/seed-sdk';

export default class AudioService extends PluginService {
  onload() {
    this.registerMethod('startRecording', async () => {
      return await this.app.invokeHost('seed.audio', {
        operation: 'capture.start',
        source: 'microphone',
      });
    });
    this.registerMethod('pauseRecording', async () => {
      return await this.app.invokeHost('seed.audio', {
        operation: 'capture.pause',
      });
    });
    this.registerMethod('stopRecording', async () => {
      return await this.app.invokeHost('seed.audio', {
        operation: 'capture.stop',
      });
    });
  }
}
```

| 参数 / 操作 | 说明 |
| --- | --- |
| `capture.start` 的 `source` | `microphone`（默认）、`system`、`mixed`；一次采集期间不更换音源 |
| `capture.pause` / `capture.resume` | 暂停 / 继续当前录音 |
| `capture.status` | 读取当前录音状态，包含音源 |
| `capture.segment` / `capture.stop` | 取得当前分段 / 停止录音 |
| `capture.consume` 的 `audio_session_id` | 读取分段音频，返回 `pcm_base64`、`duration_ms`、`sample_rate`、`channels` |
| `capture.sessions` | 返回当前插件的持久录音会话 |
| `capture.read` / `capture.ack` 的 `session_id`、`segment_id` | 读取 / 确认持久分段；读取结果还包含 `segment_id` |

- 音频格式为 PCM16、单声道、16 kHz
- `microphone` 支持 macOS、Windows 和 Linux
- `system` / `mixed` 支持 macOS 14.2+ 和 Windows

### 测试后端方法

```ts
import assert from 'node:assert/strict';
import { mountPluginService } from '@motus-ai/seed-sdk/testing';
import ClockService from './src/service.js';

const context = await mountPluginService(ClockService, {
  project: new URL('./', import.meta.url),
});

try {
  const result = await context.service.call('now', {}) as { iso: string };
  assert.ok(Number.isFinite(Date.parse(result.iso)));
} finally {
  await context.dispose();
}
```

```bash
npm install --save-dev tsx
npx tsx clock.test.ts
```

### 构建和打包

```js
import { buildPlugin, packPlugin } from '@motus-ai/seed-sdk/tools';

await buildPlugin({
  root: import.meta.dirname,
  service: 'src/service.ts',
});

const { packagePath, sha256, size } = await packPlugin({
  root: import.meta.dirname,
});
console.log({ packagePath, sha256, bytes: size });
```

### 自定义样式和资源

```js
import { buildPlugin } from '@motus-ai/seed-sdk/tools';

const result = await buildPlugin({
  root: import.meta.dirname,
  view: 'src/main.tsx',
  service: 'src/service.ts',
  styles: 'src/styles.css',
  resources: [
    { path: 'assets/logo.png', source: 'assets/logo.png' },
  ],
});

console.log(result.output);
console.log(result.manifest.id);
```

---

## 🔧 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 构建
npm run build

# 打包
npm run pack
```

工具函数：

| 方法 | 参数 / 默认值 | 返回值 |
| --- | --- | --- |
| `readPluginCapabilities({ root?, entry? })` | `entry` 默认 `src/capabilities.ts` | `Promise<CapabilityDefinition[]>` |
| `collectPluginFiles({ root?, outdir?, variant? })` | `outdir` 默认 `dist` | `Promise<{ manifest: BuiltPluginManifest; entries: Map<string, Buffer>; targeted: boolean }>` |
| `packPlugin({ root?, outdir?, packages?, variant? })` | `outdir='dist'`，`packages='artifacts'` | `Promise<{ packagePath: string; sha256: string; size: number }>` |
| `publishDevelopmentPlugin({ root?, directory? })` | 同步已有 `dist`；`directory` 默认开发目录 | `Promise<{ id: string; directory: string; ownership: { dev: number; ino: number } }>` |
| `developmentPluginDirectory()` | 根据当前系统和用户计算路径 | `string` |
| `developPlugin({ root?, directory?, log?, signal? })` | 构建、同步并持续监听；`log` 接收字符串 | `Promise<{ rebuild(): Promise<void>; stop(): Promise<void> }>` |

---

## 🔗 导出说明

```ts
// 类和函数
import { Plugin, PluginSettingTab, Setting, toast } from '@motus-ai/seed-sdk';

// 类型
import type { App, PluginManifest, CapabilityDefinition } from '@motus-ai/seed-sdk';
```

| 入口 | 主要内容 | 使用位置 |
| --- | --- | --- |
| `@motus-ai/seed-sdk` | `Plugin`、`PluginService`、`Component`、`Events`、能力 / 数据 / 事件类型；前端还可使用 DOM 控件和 `toast` | 插件运行代码 |
| `@motus-ai/seed-sdk/react` | `ReactSettingTab`、共享组件、`ComponentProvider`、`usePluginStyleScope` | React 前端 |
| `@motus-ai/seed-sdk/testing` | 服务挂载、翻译与能力测试辅助 | Node.js 测试 |
| `@motus-ai/seed-sdk/tools` | 构建、开发同步、打包与工具类型 | Node.js 构建脚本 |
| `@motus-ai/seed-sdk/theme.css` / `styles.css` | 主题变量 / 组件样式 | 独立页面预览 |

---

## 📄 License

UNLICENSED
