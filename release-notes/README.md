# 发布说明维护

格式、版本语义、影响字段与发布验收以官网仓库的 [统一发布流程](https://github.com/agimx-ai/motusai-seed-website/blob/main/docs/release-process.md) 为准；教程按 [指南维护规范](https://github.com/agimx-ai/motusai-seed-website/blob/main/docs/guide-authoring.md) 维护。本文件只补充客户端的执行入口。

- 在 `release-notes/seed/<version>/` 维护 `metadata.json`、`zh-CN.md`、`en.md`，版本与 `package.json` 和发布标签一致。
- 使用现有 `documentation.pages` 登记 `/docs/...` 或 `/guides/<slug>`，`documentation.screenshots` 登记截图影响；无影响填空数组和 `false`。指南正文在官网维护，不复制到本库。
- 发布前调用官网 `scripts/release/source.mjs`，传入 `RELEASE_VERSION`；CI 从官网 `main` 读取工具，本地可使用官网 checkout。缺双语说明阻止发布。

客户端与 SDK 绑定完整版本号（`x.y.z`，可带预发布后缀）：每次客户端发布都发布同版本的 `@motus-ai/seed-sdk`，即使 SDK 源码没有变化。修复统一提升补丁版本，不另加 `+build` 构建号，避免 npm 去掉构建元数据后版本不一致。历史独立版本不回填、不重发。

- 准备新版本使用 `npm run version:client -- <新版本号>`，同时更新根 `package.json`、SDK `package.json` 与 `package-lock.json`。`npm run version:check` 只校验这几处一致，不修改文件；发布 CI 在创建草稿前执行此检查。历史独立版本若不一致，在准备新发布时通过该命令对齐，不得复用已发布的客户端版本号。
- `.github/workflows/release.yml` 从同一标签构建三个平台和 SDK；SDK 的最终 `.tgz` 也进入草稿 Release。全部附件齐全后，先把该 `.tgz` 发布到 npm，再公开客户端 Release。正式 SDK 使用 `latest`，预发布使用 `beta`；不再提供独立 `publish:sdk` 入口。
- npm 与 GitHub 无法跨服务原子发布。如果 npm 已成功而公开 Release 失败，只重跑失败的 `publish` job，复用草稿中的 `.tgz`；仅当 npm 同版本摘要一致时跳过重复发布，内容不同会停止，不能覆盖已发布包或手动公开不完整 Release。
- 首次启用前，在 npm 的 `@motus-ai/seed-sdk` 设置中配置 GitHub Actions Trusted Publisher：Organization `agimx-ai`、Repository `motusai-seed`、Workflow filename `release.yml`，不填 Environment，并允许直接 `npm publish`。工作流只在最终发布 job 获得 `id-token: write`，无需保存 npm 长期令牌。配置方式以 [npm 官方文档](https://docs.npmjs.com/trusted-publishers/) 为准；本地测试不能证明此 npm 侧配置已生效。
- 发布后分别核对并报告 npm SDK 版本与 `.tgz` 的完整性摘要、公开客户端 Release 及全部附件，并确认预发布状态与版本一致；仅 npm 发布成功不能代表整次发布完成。

版本绑定不改变运行时来源：客户端内置对应 SDK；插件升级不会替换旧客户端的 SDK。插件版本仍独立维护，`minAppVersion` 按实际使用接口首次提供的客户端版本填写，不因构建 SDK 升版就强制提高。

通知、官网审核、部署与频道发送遵循统一流程，不在同步 PR 中生成逐版本待办。仅改规范或 CI 不提升客户端版本。
