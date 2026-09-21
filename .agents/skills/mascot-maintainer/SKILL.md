---
name: mascot-maintainer
description: 维护并验收 MotusAI Seed 的 Bloub SVG 吉祥物。修改其视觉、动画引擎、框架任务状态、品牌适配或预览工具时使用；不要用于无关界面工作。
---

# Bloub 伙伴吉祥物维护

Seed 的吉祥物是由框架状态驱动的 Bloub SVG 动画系统，不是一组静态图标。

## 工作流程

1. 先运行 `git status --short`，保留用户已有修改。
2. 只阅读与当前请求直接相关的文件：
   - 渲染与交互：`src/renderer/components/SeedlingMascot.tsx`、`src/renderer/styles.css`
   - 状态选择：`src/renderer/lib/companion.ts`、`src/renderer/lib/bloub/presentation.ts` 及测试
   - 动画数据或形变：`src/renderer/lib/bloub/engine.ts`、`states.ts` 及其直接依赖
   - 页面布局：`src/renderer/pages/OverviewPage.tsx`
   - 任务时序：`src/main/mascot-timing.ts`、`src/main/runtime.ts`、`src/connector/global-task-activity-observer.ts`、`src/connector/plugin-host.ts`
   - 品牌配色：`scripts/generate-build-config.mjs`、`resources/brands/*/brand.json`
3. 修改状态来源、优先级、动画、SVG 图层、品牌或尺寸前，阅读 [状态与渲染结构](references/state-and-structure.md)。
4. 任何可见或状态行为变化都运行 `scripts/start-preview.sh`，并按 [验收清单](references/qa-checklist.md) 检查生产组件。
5. 完成后执行验收清单中的自动化检查。

## 必须保持的架构边界

- `GlobalTaskActivityObserver` 只在框架能力执行边界观察并转发任务事实；不得依赖 Socket 或加入插件专用触发逻辑。
- 状态变化必须复用同一个 `BotEngine` 连续形变；业务优先级不得进入 SVG 渲染组件。
- 品牌主色来自构建配置；状态语义色、减弱动态和无障碍信息必须保留。

## 上游代码范围

`src/renderer/lib/bloub` 只保留动画所需核心、来源说明和许可，不复制上游页面、编辑器、路由、导出工具或整站样式。更新上游代码时记录来源 commit。
