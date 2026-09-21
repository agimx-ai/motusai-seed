# MotusAI Seed

MotusAI Seed 是需要 Seed Cloud 账号登录的桌面插件与本地能力运行时。它负责在本机安装和隔离插件、执行经过授权且可审计的操作，并可选择性连接 Agent 或其他第三方运行服务；账号登录不依赖这些运行连接。

## 产品与架构

Seed 是通用插件宿主，不内置具体插件业务。能力、配置、管理视图、按钮、图标、数据和动作由独立插件声明；客户端负责安装与校验、沙箱、通用渲染、权限审批、审计、生命周期、本地 HTTP/SSE 网关及受控 Broker。官方插件可独立升级，无需重新发布客户端。

```text
React Renderer（沙箱）
        │ 受限 IPC
Preload Context Bridge
        │
Electron Main ── Cloud OAuth + PKCE、自定义协议、安全存储、安装器、系统权限与 Broker
        ├─ Connector Utility Process：插件生命周期、本地网关、审计与路由
        ├─ Plugin Host：每插件独立的浏览器沙箱或原生 Utility Process，独立监督与恢复
        ├─ Seed Cloud：统一账号登录、固定授权页、签名配置发现、插件目录、客户端版本与失效通知
        └─ 插件自有运行服务：由插件管理连接、任务执行与能力调用
```

详细设计见：

- [插件架构与安全边界](./docs/插件架构与安全边界.md)
- [插件开发手册](./docs/插件开发手册.md)
- [社区插件与插件包规范](./docs/社区插件与插件包规范.md)
- [应用更新](./docs/应用更新.md)
- [登录与可选运行连接](./docs/登录与可选运行连接.md)
- [Seed SDK](./packages/seed-sdk/README.md)

## 项目结构

```text
packages/seed-sdk/  # 插件公开 SDK
src/main/           # Electron 主进程、安装、安全存储与 Broker
src/connector/      # 连接协议、Plugin Host 与本地网关
src/shared/         # 跨进程契约与 Manifest 校验
src/renderer/       # 通用桌面界面与声明式渲染器
resources/app/      # 客户端图标资源
docs/               # 架构、开发与发布文档
scripts/            # 构建和打包脚本
```

`dist/` 和 `release/` 均为生成目录。测试与源码共置，使用 `*.test.ts` 或 `*.integration.test.ts`。

## 本地开发

复制 `.env.example` 为 `.env`，设置 Seed Cloud 发现信任、本地链接和打包目标：

```bash
cp .env.example .env
```

`.env.example` 是客户端环境变量的唯一文档来源。应用名称、应用 ID 和图标固定为统一的 MotusAI Seed 客户端；Seed Cloud 地址和发现公钥写入构建产物。官网固定为 `https://motusseed.com`；OAuth Client ID、精确的自定义协议登录回调、插件市场、事件 WebSocket 和运行时更新地址来自 Seed Cloud 签名发现文档。客户端通过系统浏览器打开 Cloud 固定授权页，使用 Authorization Code + PKCE 登录，并由固定应用 ID 对应的自定义协议唤醒；不监听随机本机端口。第三方运行服务由插件管理，不作为云账号登录前提。生产环境必须使用 HTTPS/WSS；`MOTUSAI_ALLOW_INSECURE_HTTP=true` 仅允许 loopback 或私有 IPv4 开发服务。Seed 是 OAuth 公开客户端，不得配置 Client Secret。

```bash
npm install
npm run dev
```

## 验证与打包

```bash
npm run typecheck
npm test
npm run build
npm run package       # 构建当前平台安装包
npm run package:dir   # 仅生成未打包应用目录
```

打包更新产物时还需设置 `MOTUSAI_UPDATE_CHANNEL` 与 `MOTUSAI_RELEASE_PLATFORM`。`electron-builder` 会根据 Seed Cloud 地址、通道和目标平台生成更新元数据中的 Cloud 地址，不接受单独的 Agent 更新地址。发现公钥以单行 Base64 SPKI DER 写入 `MOTUSAI_DISTRIBUTION_PUBLIC_KEY`；它不是秘密。签名私钥只保存在 Seed Cloud。

插件开发与 `.seedpkg` 产物位于独立的 `motusai-seed-official-plugins` 仓库。本仓库的 Agent 工作规范见 [AGENTS.md](./AGENTS.md)。
