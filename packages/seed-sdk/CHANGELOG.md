# Changelog

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
