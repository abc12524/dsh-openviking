# dsh-openviking

DeepSeek Harness (dsh) 的 OpenViking 长期记忆集成插件。

- **宿主侧**：注册 `openviking` 设置命名空间（服务地址、用户、密钥、相关性阈值、结果数量），并在每次用户提问后自动检索候选记忆（分数高于阈值、最多 maxResults 条）作为背景上下文注入。
- **浏览器侧**：在 Web 设置页的插件配置区域渲染 OpenViking 配置卡片（`settings.plugin.item` 槽按 `openviking` 命名空间接线）。

检索是**提示而非闸门**（silent-by-design）：任何检索失败只记录警告，对话照常继续，不会阻塞。

## 安装

```sh
# 在 dsh 检出目录执行（纯拷贝安装，无需构建/授权）
pnpm dsh plugin --profile web add github:abc12524/dsh-openviking
# 重启 dsh web
```

> 可锁定到具体提交以获得可复现安装：`...add github:abc12524/dsh-openviking#<commit>`。安装后在 **设置 → 插件 → OpenViking** 填写服务地址与密钥即可，无需重启。

机制：仓库已预构建并提交 `lib/`（host `lib/index.js` + 浏览器 `lib/client.js`），且包**不含 `dependencies`/`devDependencies`/`prepare`**——`dsh plugin add` 只做纯拷贝接线，不触发任何 `npm install` 或构建，因此**无需 `allowBuilds` 授权、无需 harness 检出**。reconcile 检测到包的 `dsh.bundle.patch` 声明，自动把插件加入 profile 的 bundles 层栈并读取 `cordis.patch.yml` 接线（entry 为包名 `@abc12524/dsh-openviking`）——**无需手动编辑任何文件**。url/key 通过 Web 设置页配置（**设置 → 插件 → OpenViking**），或在你自己的 profile patch 层用同名 entry 覆盖 config。

## 依赖

- 运行时 peer 依赖由 DeepSeek Harness 注入（`@deepseek-ai/*` 与 `react`），插件包本身不含任何需安装的 `dependencies`/`devDependencies`。
- 一个 OpenViking 记忆服务（REST 端点，如 `http://<host>:1933`，无需 `/mcp` 后缀）。

## 构建（客户端 bundle）

`tsconfig.json` 已自包含（不 extends dsh 的 tsconfig base、无源码路径别名）。宿主端与客户端均由 `tsdown` 直接从 `src` 转译（`@deepseek-ai/*` peer 依赖 external，不打包），因此 **git 安装的 `prepare` 不再需要 harness 检出**：

```bash
pnpm run build        # tsdown：lib/index.js（host）+ lib/client.js（浏览器 bundle）
pnpm run build:client # 同上但显式标注 client face（等价于 dsh Client pass）
```

 类型检查（可选，开发者用）需要 DeepSeek Harness 的类型，按你本地的 harness 检出自行链好 `@deepseek-ai/*` 后 `pnpm run build:types`。

 产物：`lib/index.js` + `lib/client.js`（banner 以 `__ModuleLoader__.load({id:"@abc12524/dsh-openviking"})` 注册）。`lib/` 已提交入库——git 安装直接复用，无需现场构建。本地改 `src/` 后跑 `pnpm run build` 刷新 `lib/` 并提交即可。

## ov 工具系列（REST，非 MCP）

插件在 harness 中注册一组 `openviking_*` 工具，与自动记忆注入共用同一套 REST 客户端，直接调用 OpenViking REST API（v1），不经由 ov 的 MCP 端点。服务端根地址即设置项中的 `url`（自动兼容残留的 `/mcp` 后缀），鉴权复用同一 bearer token。

**工具可见性（软披露）**：九个工具在插件加载时**无条件注册**，因此始终出现在工具列表中（harness 在 agent 构造时从全局工具表快照，迟到的动态注册/注销无法可靠生效）。未配置 `url`/`key` 时，一个全局 `guard` 会以清晰原因（`OpenViking 未配置…`）拒绝任意 `openviking_*` 调用，而不是把工具藏起来；在「设置 → 插件 → OpenViking」填好地址与密钥后即可正常调用，无需重启（guard 读取实时配置，即时生效）。

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `openviking_search` | 语义搜索外置记忆 | `query`, `limit?`, `min_score?` |
| `openviking_remember` | 保存长期记忆（写入 `viking://user/<user>/memories/<category>/<name>.md`） | `category`, `name`, `content` |
| `openviking_read` | 读取单个 `viking://` 文件 | `uri` |
| `openviking_list_dir` | 列出目录（可递归） | `uri`, `recursive?` |
| `openviking_write_file` | 写入 `viking://` 文件 | `uri`, `content`, `mode`(create/replace/append) |
| `openviking_create_session` | 创建对话 Session | `session_id?` |
| `openviking_add_message` | 向 Session 追加消息 | `session_id`, `role`, `content` |
| `openviking_commit_session` | 归档 Session 并提取长期记忆 | `session_id`, `keep_recent_count?` |
| `openviking_delete_file` | 删除 `viking://` 文件（不可撤销） | `uri` |

实现见 `src/ov-client.ts`（REST 客户端）与 `src/ov-tools.ts`（工具定义）。端点对齐 OpenViking v0.4.13 REST API：`POST /api/v1/search/find`（阈值字段为 `score_threshold`）、`GET /api/v1/content/read`、`POST /api/v1/content/write`、`GET /api/v1/fs/ls`、`DELETE /api/v1/fs`、`/api/v1/sessions`、`/api/v1/sessions/{id}/messages`、`/api/v1/sessions/{id}/commit`；`remember` 映射到在用户命名空间下写入 `.md` 文件。

## 部署顺序建议

插件检索是 silent-by-design：URL/Key 留空部署时检索自动禁用（不报错、不阻塞对话）。可以先完成上面安装流程，之后再在 Web 设置页填写 OpenViking 服务地址与密钥——设置 live 生效，无需重启。

## 设置卡片

浏览器侧把配置表单注册进 **设置 → 插件（Plugins）→ OpenViking** 卡片（`settings.plugin.item` 槽，以 `key: 'openviking'` 接线已注册的命名空间），与其他可配置插件（如 Bash、Web Search）并列显示。卡片组件自绘（折叠头、未保存徽标、只读横幅、逐字段「已覆盖」标记与重置），不 import 官方卡片 chrome —— client bundle-purity 门禁禁止跨插件 value import。命名空间不可用时卡片渲染为空（未接线的部署在设置页不留痕迹）。

## 设置项

| 字段 | 说明 |
|------|------|
| Server URL | OpenViking REST 服务端根地址（如 `http://<host>:1933`，不带 `/mcp`） |
| User | OpenViking 用户标识（可选，默认 `default`） |
| API Key | 完整 Bearer token（敏感字段，保存后不回显，以 `****` 掩码显示） |
| Relevance threshold | 只注入相关性**高于**此值的候选（0-1），默认 0.4 |
| Result count | 每次提问最多注入的候选记忆条数，默认 3 |

> 其余参数（单次 REST 超时、摘要截断长度）使用 host 端 `Config` schema 的默认值（8000ms / 400 字符），当前设置卡片不暴露，需要时可改 composition 配置或后续扩展卡片。

## 许可证

MIT
