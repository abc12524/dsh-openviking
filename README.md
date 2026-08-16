# dsh-openviking

DeepSeek Harness (dsh) 的 OpenViking 长期记忆集成插件。

- **宿主侧**：注册 `openviking` 设置命名空间（服务地址、用户、密钥、相关性阈值、结果数量），并在每次用户提问后自动检索候选记忆（分数高于阈值、最多 maxResults 条）作为背景上下文注入。
- **浏览器侧**：在 Web 设置页渲染 OpenViking 配置表单。

检索是**提示而非闸门**（silent-by-design）：任何检索失败只记录警告，对话照常继续，不会阻塞。

## 依赖

- DeepSeek Harness 源码检出（需含已构建的包；`scripts/link-deps.sh` 会从它链接 `@deepseek-ai/*` 依赖）。
- 一个 OpenViking 记忆服务（MCP Streamable HTTP 端点，如 `http://<host>:1933/mcp`）。

## 安装

插件从 TS 源码加载。在 dsh profile 的 patch 层（`cordis.patch.yml`）中插入：

```yaml
- insert:
    - id: openviking
      name: '/path/to/dsh-openviking/src/index.ts'
      config:
        url: http://<openviking-host>:1933/mcp
        key: '<bearer-token>'
        minScore: 0.4
```

要让 Web 设置页显示表单，还需要在 dsh 侧应用 `patches/` 中的补丁（已在本机验证，基于 dsh 上游 `47f943859b` 导出）：

| 补丁 | 必需 | 作用 |
|---|---|---|
| `0001-connection-privileged-methods-trusted-host.patch` | ✅ | 特权 API（settings/credentials/agentPreset 等）在 `--trusted-host` 下放行，LAN 可写 |
| `0002-client-modules-path-entry-resolution.patch` | ✅ | 路径型插件 entry 解析 package.json，前端 manifest 能加载本插件（否则设置页静默不显示） |
| `0003-settings-scope-host-mode.patch` | ✅ | LAN 访问时设置页不再降级 memory（否则恒显"设置服务不可用"） |
| `0004-apiproxy-openviking-settings-whitelist.patch` | ✅ | `openviking` 命名空间加入 settings API 白名单（否则 `settings-not-exposed`） |
| `0005-ui-settings-models-welcome-notice-host-mode.patch` | 可选 | 内测声明弹窗不再每次刷新都弹 |
| `0006-web-app-allow-bind-0.0.0.0.patch` | 可选 | 允许 `--host 0.0.0.0`（Docker/无反代场景；上游出于安全故意拒绝） |
| `0007-web-main-randomuuid-polyfill.patch` | 可选 | 明文 HTTP（非 secure context）下 `crypto.randomUUID` polyfill；HTTPS 不需要 |
| `0008-frontend-static-mime-png-webp.patch` | 可选 | 静态资源 MIME 补全 `.png`/`.webp` |

应用步骤（在 dsh 仓库根目录，`<插件路径>` 换成 dsh-openviking 的绝对路径）：

```sh
# 1. 应用必需补丁（可选补丁按需追加）
git apply <插件路径>/patches/0001-connection-privileged-methods-trusted-host.patch \
           <插件路径>/patches/0002-client-modules-path-entry-resolution.patch \
           <插件路径>/patches/0003-settings-scope-host-mode.patch \
           <插件路径>/patches/0004-apiproxy-openviking-settings-whitelist.patch

# 2. 重新构建（src 与编译产物 lib 必须同步，运行时加载的是 lib）
pnpm run build

# 3. 重启 dsh web
```

> 补丁基于上游 `47f943859b` 导出；dsh 迭代快，若上游漂移导致 `git apply` 冲突，按各补丁内的代码上下文手动适配（改动都很小）。

另外从局域网访问时，dsh web 启动需带 `--trusted-host <LAN-IP>`，否则 `/api` 返回 403 `forbidden`；若经 nginx 反代，可让 `proxy_set_header Host/Origin` 指向 loopback（`127.0.0.1:<port>`）等效放行。

## 构建（客户端 bundle）

`tsconfig.json` 已自包含（不 extends dsh 的 tsconfig base、无源码路径别名），构建只需两步：

```bash
# 1. 把 dsh 检出的 @deepseek-ai/* 包符号链接到 node_modules（9 个包，含仅编译期需要的类型包）
./scripts/link-deps.sh /path/to/deepseek-harness

# 2. 复用 dsh 检出的 tsc/tsdown 构建（tsc 出 lib/types/，tsdown 出 lib/client.js）
PATH=/path/to/deepseek-harness/node_modules/.bin:$PATH pnpm run build:client
```

产物：`lib/types/`（tsc 类型与发射的 JS）+ `lib/client.js`（浏览器 bundle，banner 以 `__ModuleLoader__.load({id:"@deepseek-ai/dsh-openviking"})` 注册）。`lib/` 已 gitignore，不入库。完整 `pnpm run build`（host lib + client bundle）等价于 dsh 的 Client pass（`DSH_BUILD_FACE=client`）。

## 部署顺序建议

插件检索是 silent-by-design：URL/Key 留空部署时检索自动禁用（不报错、不阻塞对话）。可以先完成上面安装流程，之后再在 Web 设置页填写 OpenViking 服务地址与密钥——设置 live 生效，无需重启。

## 设置项

| 字段 | 说明 |
|------|------|
| Server URL | OpenViking MCP Streamable HTTP 端点 |
| User | OpenViking 用户标识（可选，默认 `default`） |
| API Key | 完整 Bearer token（敏感字段，保存后不回显，以 `****` 掩码显示） |
| Relevance threshold | 只注入相关性**高于**此值的候选（0-1），默认 0.4 |
| Result count | 每次提问最多注入的候选记忆条数，默认 3 |

## 许可证

MIT
