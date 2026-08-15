# dsh-openviking

DeepSeek Harness (dsh) 的 OpenViking 长期记忆集成插件。

- **宿主侧**：注册 `openviking` 设置命名空间（服务地址、用户、密钥、相关性阈值、结果数量），并在每次用户提问后自动检索候选记忆（分数高于阈值、最多 maxResults 条）作为背景上下文注入。
- **浏览器侧**：在 Web 设置页渲染 OpenViking 配置表单。

检索是**提示而非闸门**（silent-by-design）：任何检索失败只记录警告，对话照常继续，不会阻塞。

## 依赖

- DeepSeek Harness 源码检出，以及本插件 tsconfig 路径别名所依赖的目录结构。`tsconfig.json` 与 `tsdown.client.ts` 通过 `../../deepseek-harness` 相对路径引用 Harness（**按你的实际部署位置调整**）。
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

要让 Web 设置页显示表单，还需满足：

1. `openviking` 命名空间加入 Harness API 网关的 `WEB_SETTINGS_NAMESPACES` 白名单（`packages/host/apiproxy/src/api-proxy.ts`），否则 API 层 `settings-not-exposed` 拒绝读写；
2. `dsh-client-modules` 注册表能解析本包的 `dsh.client` 声明（路径型 loader entry 需要 package.json 查找补丁）。

> 详情见项目内 `docs/` 或 Harness 排障记录。

## 构建（客户端 bundle）

浏览器端是 tsdown 客户端 bundle：

```bash
pnpm run build:client
```

或使用 Harness 的 client pass（`DSH_BUILD_FACE=client`）。产物输出到 `lib/`（已 gitignore，不入库）。

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
