# dsh-openviking

DeepSeek Harness (dsh) 的 OpenViking 长期记忆集成插件。

- **宿主侧**：注册 `openviking` 设置命名空间（服务地址、用户、密钥、相关性阈值、结果数量），并在每次用户提问后自动检索候选记忆（分数高于阈值、最多 maxResults 条）作为背景上下文注入。
- **浏览器侧**：在 Web 设置页的插件配置区域渲染 OpenViking 配置卡片（`settings.plugin.item` 槽按 `openviking` 命名空间接线）。

检索是**提示而非闸门**（silent-by-design）：任何检索失败只记录警告，对话照常继续，不会阻塞。

## 快速开始

两种接线模式（二选一，`id: openviking` 相同勿重复）：

**方式 A：clone + 路径 entry（5 分钟，零补丁零构建，本机 localhost）**

1. `git clone https://github.com/abc12524/dsh-openviking`
2. 把仓库里的 `cordis.patch.yml.example` 的 insert 块复制到 dsh profile 的 patch 层（`~/.dsh/profiles/web/cordis.patch.yml` 或 `~/.dsh/cordis.patch.yml`），`name` 改为实际路径，`config` 直接填 url/key
3. 重启 dsh —— 检索注入立即可用

原理：host 半段由 tsx 直接加载 `src/`，无需构建；检索是 silent-by-design（url/key 留空也不报错不阻塞）。Web 设置页卡片需要 client bundle 补丁 0002，局域网访问还需补丁 0001/0003 —— 需要时再走下方完整安装。

**方式 B：官方插件 CLI（一条命令，推荐）**

```sh
# 在 dsh 检出目录执行
dsh plugin --profile web add github:abc12524/dsh-openviking
# 重启 dsh web
```

机制：命令在 profile 目录执行 `pnpm add github:...`（prepare 钩子自动构建 lib；需 node 22.18+，且本机已检出 DeepSeek Harness 并用 `./scripts/link-deps.sh` 建立 `@deepseek-ai/*` 类型依赖软链），随后 reconcile 检测到包的 `dsh.bundle.patch` 声明，自动把插件加入 profile 的 bundles 层栈并读取 `cordis.patch.yml` 接线（entry 为包名 `@abc12524/dsh-openviking`）——**无需手动编辑任何文件**。url/key 通过 Web 设置页配置（设置页需 dsh 侧补丁，见完整安装），或在你自己的 profile patch 层用同名 entry 覆盖 config。

> 方式 B 的 prepare 需要完整构建环境（见 `scripts/prepare.mjs`）。本机没有 dsh 检出、只想用插件时，推荐先走**方式 A**（clone 直加载 `src/`，零构建），再按需补 dsh 侧补丁。

## 依赖

- DeepSeek Harness 源码检出（需含已构建的包；`scripts/link-deps.sh` 会从它链接 `@deepseek-ai/*` 依赖）。
- 一个 OpenViking 记忆服务（MCP Streamable HTTP 端点，如 `http://<host>:1933/mcp`）。

## 安装（完整：设置页 + 远程访问）

推荐先用 `dsh plugin --profile web add github:abc12524/dsh-openviking` 装包接线（见快速开始方式 B），再按本节补 dsh 侧补丁。也可以手动接线：插件从 TS 源码加载，把仓库里的 `cordis.patch.yml.example` 的 insert 块复制到 dsh profile 的 patch 层（`cordis.patch.yml`）：

```yaml
- insert:
    - id: openviking
      name: '/path/to/dsh-openviking/src/index.ts'
      config:
        url: http://<openviking-host>:1933
        key: '<bearer-token>'
        minScore: 0.4
```

要让 Web 设置页显示表单，还需要在 dsh 侧应用 `patches/` 中的补丁（已在本机验证，基于 dsh 上游 `47f943859b` 导出）。一条命令应用必需补丁：

```sh
/path/to/dsh-openviking/scripts/apply-patches.sh /path/to/deepseek-harness
```

（可选补丁加 `--all`；也可手动 `git apply`，清单如下。）

| 补丁 | 必需 | 作用 |
|---|---|---|
| `0001-connection-privileged-methods-trusted-host.patch` | ✅ | 特权 API（settings/credentials/agentPreset 等）在 `--trusted-host` 下放行，LAN 可写 |
| `0002-client-modules-path-entry-resolution.patch` | ✅ | 路径型插件 entry 解析 package.json，前端 manifest 能加载本插件（否则设置页静默不显示） |
| `0003-settings-scope-host-mode.patch` | ✅ | LAN 访问时设置页不再降级 memory（否则恒显"设置服务不可用"） |
| `0005-ui-settings-models-welcome-notice-host-mode.patch` | 可选 | 内测声明弹窗不再每次刷新都弹 |
| `0006-web-app-allow-bind-0.0.0.0.patch` | 可选 | 允许 `--host 0.0.0.0`（Docker/无反代场景；上游出于安全故意拒绝） |
| `0007-web-main-randomuuid-polyfill.patch` | 可选 | 明文 HTTP（非 secure context）下 `crypto.randomUUID` polyfill；HTTPS 不需要 |
| `0008-frontend-static-mime-png-webp.patch` | 可选 | 静态资源 MIME 补全 `.png`/`.webp` |

> `apply-patches.sh` 已覆盖上表必需补丁（幂等：重复执行自动跳过）。应用后**必须重新构建**（src 与编译产物 lib 需同步，运行时加载的是 lib）并重启：

```sh
# 在 dsh 检出根目录
pnpm run build && systemctl restart dsh-web   # 或重启你的 dsh 进程
```

> 补丁基于上游 `47f943859b` 导出；dsh 迭代快，若上游漂移导致 `git apply` 冲突，按各补丁内的代码上下文手动适配（改动都很小）。

另外从局域网访问时，dsh web 启动需带 `--trusted-host <LAN-IP>`，否则 `/api` 返回 403 `forbidden`；若经 nginx 反代，可让 `proxy_set_header Host/Origin` 指向 loopback（`127.0.0.1:<port>`）等效放行。

## 构建（客户端 bundle）

`tsconfig.json` 已自包含（不 extends dsh 的 tsconfig base、无源码路径别名），构建只需两步：

```bash
# 1. 把 dsh 检出的 @deepseek-ai/* 包符号链接到 node_modules（10 个包，含仅编译期需要的类型包）
./scripts/link-deps.sh /path/to/deepseek-harness

# 2. 复用 dsh 检出的 tsc/tsdown 构建（tsc 出 lib/types/，tsdown 出 lib/client.js）
PATH=/path/to/deepseek-harness/node_modules/.bin:$PATH pnpm run build:client
```

产物：`lib/types/`（tsc 类型与发射的 JS）+ `lib/client.js`（浏览器 bundle，banner 以 `__ModuleLoader__.load({id:"@abc12524/dsh-openviking"})` 注册）。`lib/` 已 gitignore，不入库。完整 `pnpm run build`（host lib + client bundle）等价于 dsh 的 Client pass（`DSH_BUILD_FACE=client`）。

## ov 工具系列（REST，非 MCP）

插件在 harness 中注册一组 `openviking_*` 工具，与自动记忆注入共用同一套 REST 客户端，直接调用 OpenViking REST API（v1），不经由 ov 的 MCP 端点。服务端根地址即设置项中的 `url`（自动兼容残留的 `/mcp` 后缀），鉴权复用同一 bearer token。

**渐进披露**：`url`/`key` 未配置时，这组工具会通过 `ctx.tools.restrict({ deny })` 从模型的工具提示中隐藏（注册仍在，只是不可见、不可调用）；在设置页填好地址与密钥后会即时显示，无需重启。

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `openviking_search` | 语义搜索外置记忆 | `query`, `limit?`, `min_score?` |
| `openviking_remember` | 保存长期记忆（写入 `viking://user/<user>/<category>/<name>.md`） | `category`, `name`, `content` |
| `openviking_read` | 读取单个 `viking://` 文件 | `uri` |
| `openviking_list_dir` | 列出目录（可递归） | `uri`, `recursive?` |
| `openviking_write_file` | 写入 `viking://` 文件 | `uri`, `content`, `mode`(create/replace/append) |
| `openviking_create_session` | 创建对话 Session | `session_id?` |
| `openviking_add_message` | 向 Session 追加消息 | `session_id`, `role`, `content` |
| `openviking_commit_session` | 归档 Session 并提取长期记忆 | `session_id`, `keep_recent_count?` |
| `openviking_delete_file` | 删除 `viking://` 文件（不可撤销） | `uri` |

实现见 `src/ov-client.ts`（REST 客户端）与 `src/ov-tools.ts`（工具定义）。端点路径遵循 OpenViking REST API（`POST /api/v1/search/find`、`/api/v1/fs/read|ls|write|rm`、`/api/v1/sessions`、`/api/v1/sessions/{id}/messages`、`/api/v1/sessions/{id}/commit`）；`remember` 映射到在用户命名空间下写入 `.md` 文件。

## 部署顺序建议

插件检索是 silent-by-design：URL/Key 留空部署时检索自动禁用（不报错、不阻塞对话）。可以先完成上面安装流程，之后再在 Web 设置页填写 OpenViking 服务地址与密钥——设置 live 生效，无需重启。

## 设置卡片

浏览器侧把配置表单注册进设置页的**插件配置区域**（`settings.plugin.item` 槽，以 `key: 'openviking'` 接线已注册的命名空间），显示在 Plugins 区域的「Plugin configuration」tab。卡片组件自绘（折叠头、未保存徽标、只读横幅、逐字段「已覆盖」标记与重置），不 import 官方卡片 chrome —— client bundle-purity 门禁禁止跨插件 value import。命名空间不可用时卡片渲染为空（未接线的部署在设置页不留痕迹）。

## 设置项

| 字段 | 说明 |
|------|------|
| Server URL | OpenViking REST 服务端根地址（如 `http://<host>:1933`，不带 `/mcp`） |
| User | OpenViking 用户标识（可选，默认 `default`） |
| API Key | 完整 Bearer token（敏感字段，保存后不回显，以 `****` 掩码显示） |
| Relevance threshold | 只注入相关性**高于**此值的候选（0-1），默认 0.4 |
| Result count | 每次提问最多注入的候选记忆条数，默认 3 |
| MCP timeout (ms) | 单次 REST 请求超时（毫秒），默认 8000 |
| Max abstract chars | 每条候选摘要截断长度（字符），默认 400 |

## 许可证

MIT
