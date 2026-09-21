# 本地差异

本文件记录相对 Cordis `4.0.0-rc.8` 的行为差异。

1. Fiber effect 在执行 setup 前先进入所有者清理列表，确保 setup 内触发重入卸载时仍会等待并回收资源。
2. 异步 cleanup 在完全静止前保持所有者可见；内部组合可以加入已经开始的 cleanup。
3. Fiber 进入 `UNLOADING` 后拒绝注册新 effect，防止资源逃逸卸载快照。
4. 子 Fiber 在发布 `internal/plugin` 前完成父级所有权登记，并处理发布期间发生的重入 dispose。
5. PENDING Fiber 已登记的 effect 在销毁时也会被清空。
6. teardown 观察者错误相互隔离，单个监听器不能阻断其他监听器和所有权清理。
7. `Fiber.update()` 返回 `internal/update` waterfall 的结果，使调用者能够等待配置重启完成。
8. 源码内部模块说明和类型导入适配 Seed 的 TypeScript 构建；基础工具依赖使用官方 `cosmokit`。

这些修改来源和许可证见 `UPSTREAM.md` 与 `LICENSE`。
