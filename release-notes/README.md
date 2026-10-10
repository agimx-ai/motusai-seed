# 发布说明维护

每个新版本在 release-notes/<产品 ID>/<版本>/ 中维护 metadata.json、zh-CN.md、en.md。
metadata.json 写明 version 和 documentation（pages 为受影响的 /docs 路由数组，screenshots 为布尔值；没有影响也必须显式填写空数组和 false）。
正文不写 frontmatter：以带版本号的一级标题开头，接一段短摘要，再按需使用“新增、改进、修复、使用提醒、版本”（英文 New、Improvements、Fixes、Usage notes、Versions）和带粗体名称的短条目。不得提交占位文本。

发布检查调用官网唯一共享工具 scripts/release/source.mjs，缺少双语说明直接阻止发布。Release 正文与 website-release-notes.json 附件均由这些文件生成；GitHub 正文自动去掉重复的一级标题，并把变化类型统一渲染为与官方插件一致的带图标标题。官网按真实发布时间生成展示文件，成功发布前不会上线。

新增版本时复制目录结构而不是照抄旧版本的功能。文档、截图有变化时列明范围，官网同步 PR 中会生成待办。修改已发布版本的说明需要明确纠错，不得静默替换原有发布附件。

凭据与启用顺序见官网 docs/release-process.md。仅调整发布流程不提升应用或插件版本；未要求时不推送或打标签。
