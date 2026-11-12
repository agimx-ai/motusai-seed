# 文章主题源码

32 套主题的作者源码、已编译 CSS、代码配色元数据和许可证随本项目维护。网页从这里加载样式，不再安装或引用主题集合 npm 包。

## 来源与目录

主题清单取自[原始集合仓库](https://github.com/xitu/juejin-markdown-themes/tree/9d5975909dcd89489697ee6f5fd0ff4dc7cfec85)的 `v1.34.0`，固定提交为 `9d5975909dcd89489697ee6f5fd0ff4dc7cfec85`。原始集合记录了各主题作者仓库、源码路径和固定提交。

- `sources/`：从作者固定提交获取的全部 32 份 CSS、SCSS 或 Less 源码，原样保留。
- `styles/`：从上述源码编译、完成阅读适配并格式化的 32 份 CSS，网页构建直接加载这些文件。
- `themes.json`：主题标识对应的本地 CSS 文件和代码配色，不包含界面展示名称。
- `sources.json`：每份源码的作者仓库、提交、原始路径、SHA-256 和许可证文件。
- `licenses/`：各作者的完整许可证；根目录 `LICENSE` 是集合本身的 MIT 许可。

中文和英文展示名称仍由 Cloud API 主题目录统一提供。经典主题的本地文件名为 `classic`，主题协议标识保持现有约定。

## 编译与维护

当前 SCSS 由 Dart Sass `1.45.0` 编译，Less 由 `4.2.2` 编译，普通 CSS 直接使用。正常应用构建使用已集成的 CSS，不需要安装这些维护工具。

维护 SCSS 或 Less 时，可在本目录按对应的固定版本重新编译，例如：

```sh
npm exec --yes --package=sass@1.45.0 -- sass --no-source-map --style=expanded sources/cyanosis.scss styles/cyanosis.css
npm exec --yes --package=less@4.2.2 -- lessc sources/koi.less styles/koi.css
```

编译后按下节检查阅读适配并执行仓库 Prettier。Sass 版本需保留对旧式除法的支持，并正确计算 Nico 源码中的 `calc($size - 2px)`；不将原始 Sass 变量留在 CSS 中。此次集成的 32 项编译结果与原有展开样式核对一致。

## 阅读适配

- 移除正文容器的方格渐变及其平铺尺寸和定位。
- 移除清新蓝和舒心阅读标题伪元素中的平台图片及对应悬停规则。
- 移除主题自动添加的 `Tips`、`READ MORE +`、`FROM`、`CITATION`、`Go ->` 和“按虚线剪开”等说明文字。
- 锦鲤使用作者提交 `ca08db0eaaf843d697e5d2bf8b6f2b6c76289b13` 的 `koi.less`，修复集合原先指向失效 CSS 的来源；将 `.markdown-body` 下的 `html`、`body`、`#write` 和 `content #write` 根选择器映射到 `.markdown-body`。
- 代码配色在本地元数据中统一为 highlight.js 11 的样式标识；青黛在浅色模式使用 GitHub 代码配色。

这些调整已落在 `styles/`，阅读时无需再修改主题字符串。修改主题不处理用户文档内容。

## 许可

集合本身为 MIT，各作者版权及许可原文保存在 `licenses/`。完整声明随网页静态资源输出至 `/_assets/assets/licenses/article-themes.txt`。
