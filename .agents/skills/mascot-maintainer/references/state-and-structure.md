# 状态与渲染结构

## 状态来源

框架级任务链路固定为：

`SeedPluginHost.invoke` → `GlobalTaskActivityObserver` → `task.changed` → `main/runtime.ts activeTasks` → `SeedSnapshot.mascot` → `companionPresentation` → `bloubStateForPresentation` → `BotEngine.setState`

观察器位于框架统一能力执行边界，覆盖 Socket、插件间和本地来源的能力调用。它只转发开始、完成和失败事实，不创建、调度或控制任务。插件只执行能力；吉祥物不得读取插件 ID、操作名称或插件内部状态。

运行时视觉状态分为：

- 任务：`idle`、`running`、`working`、`waiting`、`review`、`failed`
- 录音：`listening`、`paused`、`processing`
- 连接：`unconfigured`、`disconnected`、`reconnecting`、`connectionFailed`、`connectionRestored`
- 并发连接状态：通过 `connectionAccessory` 附加在任务或录音主状态上

当前 Bloub 映射由 `src/renderer/lib/bloub/presentation.ts` 唯一维护。修改映射必须同步测试，不要在本文复制另一份可漂移的映射表。

## 动画连续性

- `BotEngine.sample(t)` 是时间的确定性函数。
- 组件维护单调场景时钟；每帧增量上限为 64ms，避免窗口恢复时跳过动画。
- 状态变化使用 `engine.setState(next, clock)`，让引擎从当前合成姿势平滑形变。
- 不要因为状态改变而重建引擎或给 SVG 设置状态 key，否则会丢失上一姿势并产生瞬切。
- 点击反应结束时仍通过同一引擎回到框架状态。
- 减弱动态效果使用 `POSES` 中的可读关键姿势，不运行 rAF；特殊状态可以选择更清楚的确定性时间点。

## SVG 图层

React 渲染层应保持以下顺序：

1. `defs`：身体 mask 和轨道渐变；
2. 轨道后半段；
3. 需要位于身体后方的粒子；
4. 与页面背景同色的身体底层；
5. 通过 mask 填充品牌色的身体，眼睛和通知缺口作为真实孔洞；
6. 前景粒子；
7. 通知圆点；
8. 轨道前半段；
9. SVG 外部的紧凑连接附属状态点。

眼睛必须通过 mask 从身体中扣除，不能改成覆盖在身体上的固定白色图形。轨道前后层不能合并，否则会失去绕过身体的空间关系。粒子的 `depth` 继续用于品牌色与页面底色之间的混合。

## 状态优先级

- 录音状态优先于普通任务姿势，但文案仍报告并发任务数量。
- 活动任务存在时，连接问题只能作为附属点出现。
- 空闲时连接状态可以使用完整的 Bloub 状态。
- 多任务共享一个主姿势，通过 `activeTaskCount` 和文案表达数量。
- 快速任务仍遵守 `mascot-timing.ts` 的最短展示时长；失败和完成状态停留后再返回空闲。

## 品牌、主题和尺寸

- 每个 `resources/brands/<branding>/brand.json` 提供 `mascot.light` 与 `mascot.dark` 六位十六进制颜色。
- `generate-build-config.mjs` 根据 `MOTUSAI_BRANDING` 读取当前品牌令牌；组件只读取生成后的 `buildConfig`。
- 页面底色用于眼睛孔洞和粒子深度混合。切换主题时必须同时更新 ink 与 paper。
- 通知蓝点和连接状态点保持语义颜色，不随品牌色覆盖。
- 正常页面尺寸范围为 176–208px；状态总览应按实际尺寸检查，放大模式用于观察 mask、粒子和轨道细节。
