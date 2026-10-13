# 宿主截图、文件与跨进程错误

## 所有权

Seed 提供通用 OS/文件安全设施，官方插件定义列屏、观察、保存等业务方法并声明风险/权限；Agent 选择与编排由 Pi 驱动。宿主不能按插件 ID 特判，也不把保存截图的业务流程复制到客户端。

实现和测试路径以本仓库根目录为基准。

## 整屏截图

- `src/main/screen-capture-service.ts` 的 `seed.screen` 在进入 OS 前校验版本、严格参数及插件声明的 `system.screen-capture` 权限；这与下述 macOS 系统授权检查不同。不能通过窗口参数将整屏接口变成另一个观察工具。
- 显式 display ID 必须匹配真实显示器，不可用时报告失败，不静默改截另一块屏。截图按物理尺寸和缩放因子处理，保留像素/字节上限；列屏不隐式截图。
- macOS 先允许 OS 请求/登记截图访问，再检查权限，避免首次检查拒绝导致运行应用根本不出现在权限列表。失败指引指向实际运行的应用，并说明授权后退出重开再试。
- 不把任意 OS 错误都改成权限拒绝；保留真实错误，不能以旧授权截图或前台窗口观察代替当前整屏结果。
- 宿主只做一次截图，不自行保存文件、持有长期图像或启动后台截图流；保存通过独立文件 Broker 权限执行。

## 二进制与创建语义

- 入口是 `src/main/brokers/files/index.ts`、`file-service.ts`、`permissions.ts`。二进制写入需要写权限，不能借读取权限写文件；绝对目标路径不授予根发现或其他资源权限。
- 校验编码、大小、目标路径、敏感位置和符号链接；保留原有路径边界，不能因多级父目录尚不存在就绕过安全检查。
- `create_only` 必须原子地拒绝已存在目标；覆盖需要明确契约及必要的 revision 检查/备份。并发创建和跨服务实例竞争不能替换获胜者的文件。
- 写入后摘要、大小对应实际字节，不是显示文本或重新编码结果；保存失败不能返回伪造的成功路径。
- 目录创建后再写文件/Canvas 的测试经过真实 Broker 路径；普通写文件是否创建父目录按契约验证，不靠客户端补救。

## 跨进程错误

- `src/shared/plugin-error.ts` 仅允许声明的 string/number/boolean 参数跨边界，不序列化任意对象、堆栈或凭据。
- 同时追踪 connector worker 与 native-plugin worker 的发送和接收端；保留错误 code、允许的 params 和有用消息，不能只传 `String(error)` 丢失恢复依据。
- 回归不仅验证错误文本，还验证调用方实际收到结构化 code/params；真实进程 smoke 与纯单元测试分开报告。

## 回归入口

- `src/main/screen-capture-service.test.ts`：权限/版本/参数先验检查、物理尺寸、显示器不匹配、拒绝/授权时机、OS 错误及大小限制。
- `src/main/plugin-sandbox-host.test.ts`：通用服务的权限声明与二进制读写区分。
- `src/main/brokers/files/file-service.test.ts`、`index.test.ts`：字节/摘要、原子创建并发、revision、路径安全、拒绝和多级目录后写入。
- `src/shared/plugin-error.test.ts`、`src/main/connector-manager.test.ts`、`native-plugin-manager.test.ts`：安全参数与进程边界错误保真。
- 修改实现后按范围运行 `npm test -- <目标测试路径>`、类型检查及构建；跨进程行为另运行 `npm run smoke:native-isolation`，Host 生命周期按需运行 `npm run smoke:plugin-host`。

原生实测使用无敏感素材，记录运行应用、权限、显示器与结果；确认真正安装了目标版本。用户授权或重启尚未完成时明确留作未验证，不为测试擅自更改系统权限、发布安装包或重启应用。
