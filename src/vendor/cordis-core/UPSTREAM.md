# Cordis Core 来源

本目录是 MotusAI Seed 自持构建的 Cordis Core 源码快照，不是 npm 依赖，也不是
`@deepseek-ai/cordis` 的运行时依赖。

- 上游项目：`cordiverse/cordis`
- 上游包：`packages/core`
- 基线版本：`4.0.0-rc.8`
- 基线上游提交：`f46ae95e039f156b966e1e0f7e8d1af91e73e9db`
- 许可证：MIT，见同目录 `LICENSE`

Seed 只收录 Core。Cordis Loader、Include、Group、HMR、Timer 和配置中的代码执行
方言均未收录。Seed 的插件发现、静态清单、安全 YAML、隔离和权限边界由 Seed
自己实现。

## 生命周期加固来源

Core 在基线之上移植了 DeepSeek Harness 对 Cordis Fiber 生命周期的 MIT 许可修复，
参考快照：

- 仓库：`deepseek-ai/deepseek-harness`
- 目录：`vendor/cordis/src`
- 参考提交：`7bedce822f2c6b076df167dff46eecf81bbd5de4`

移植内容包括重入卸载、异步清理所有权、子 Fiber 发布顺序、卸载期间拒绝新 effect、
观察者异常隔离，以及可等待的配置更新。包名与依赖均已还原为上游名称；Seed 不依赖
任何 `@deepseek-ai/*` 包。

## 更新规则

1. 先记录新的上游版本和完整 commit SHA。
2. 对比 `packages/core/src`，不得直接覆盖本地生命周期加固。
3. 在 `PATCHES.md` 逐项记录保留、删除和新增的行为差异。
4. 必须通过生命周期测试、客户端类型检查和完整构建后才能更新基线。
