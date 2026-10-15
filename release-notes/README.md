# 发布说明维护

格式、版本语义、影响字段与发布验收以官网仓库的 [统一发布流程](https://github.com/agimx-ai/motusai-seed-website/blob/main/docs/release-process.md) 为准；教程按 [指南维护规范](https://github.com/agimx-ai/motusai-seed-website/blob/main/docs/guide-authoring.md) 维护。本文件只补充客户端的执行入口。

- 在 `release-notes/seed/<version>/` 维护 `metadata.json`、`zh-CN.md`、`en.md`，版本与 `package.json` 和发布标签一致。
- 使用现有 `documentation.pages` 登记 `/docs/...` 或 `/guides/<slug>`，`documentation.screenshots` 登记截图影响；无影响填空数组和 `false`。指南正文在官网维护，不复制到本库。
- 发布前调用官网 `scripts/release/source.mjs`，传入 `RELEASE_VERSION`；CI 从官网 `main` 读取工具，本地可使用官网 checkout。缺双语说明阻止发布。

通知、官网审核、部署与频道发送遵循统一流程，不在同步 PR 中生成逐版本待办。仅改规范或 CI 不提升客户端版本。
