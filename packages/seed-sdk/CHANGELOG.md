# Changelog

## 0.2.2

- Export `SeedLocalizedText` with required `en_US` and `zh_Hans` strings.
- Add optional `SeedCapabilityMethod.display_name` for plugin-owned bilingual short names.
- Document language-preserving capability discovery and presentation-only use. Invocation names, descriptions, arguments, results and approvals retain their existing semantics.

中文：新增双语短名称类型和能力方法 `display_name` 字段，发现与适配链路保留两种语言；该字段只影响展示，不改变调用与审批语义。
