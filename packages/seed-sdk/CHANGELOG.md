# Changelog

## 0.2.5

- Add `ctx.configuration.addProfile()` so a plugin can append one profile to its own host-managed `seed.profiles` configuration without reading or replacing existing secrets.
- Validate new profiles against the plugin declaration, preserve existing profiles and defaults, and reject duplicate IDs, undeclared fields, missing required values, and profile-limit overflow.
- Requires Seed 0.2.14. Publish this SDK version before installing official plugins that use plugin-owned profile creation.

中文：新增 `ctx.configuration.addProfile()`，让插件在不读取或覆盖现有密钥的情况下，安全地向自身的 `seed.profiles` 配置追加档案；宿主负责声明校验并保留已有档案与默认项。该能力需要 Seed 0.2.14，使用前须先发布 SDK 0.2.5。

## 0.2.4

- Expose optional host-owned billing metadata on `SeedPluginError` so failed capability calls can retain confirmed settlement receipts. Missing or incomplete receipts remain unknown, not zero.
- Document the `local_relay` prepare, start and terminal settlement flow, including persistent call IDs and restart recovery. These host features require Seed 0.2.13.

中文：公开插件错误的可选宿主结算回执类型，失败调用保留已确认费用，缺失或不完整回执不代表零费用；补充本地插件计费、稳定调用编号与重启恢复说明。对应宿主能力需要 Seed 0.2.13。

## 0.2.3

- Add opt-in `include_billing` to capability invocations and export `SeedBillingReceipt` and `SeedBilledCapabilityResult`.
- Return host-owned, confirmed settlement receipts separately from business results, with call IDs for deduplication and an explicit completeness flag.
- Document nested invocation accounting, incomplete receipts, and persistence outside model-visible content. Default capability results remain unchanged.
- Streamline the public README around installation, the first plugin, core interfaces, lifecycle and security, with links to the authoritative development guides.
- Requires Seed 0.2.10 for billing receipts. Publish this SDK version before installing the updated official plugins' dependencies.

中文：新增跨插件调用的实际结算回执，支持嵌套调用去重与完整性标记；默认业务结果不变。整理 SDK 公开文档，聚焦安装、首个插件、核心接口、生命周期与安全边界。回执能力需要 Seed 0.2.10，官方插件依赖安装前须先发布 SDK 0.2.3。

## 0.2.2

- Export `SeedLocalizedText` with required `en_US` and `zh_Hans` strings.
- Add optional `SeedCapabilityMethod.display_name` for plugin-owned bilingual short names.
- Document language-preserving capability discovery and presentation-only use. Invocation names, descriptions, arguments, results and approvals retain their existing semantics.

中文：新增双语短名称类型和能力方法 `display_name` 字段，发现与适配链路保留两种语言；该字段只影响展示，不改变调用与审批语义。
