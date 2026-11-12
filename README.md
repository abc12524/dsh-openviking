# dsh-openviking

DeepSeek Harness 的 **OpenViking 记忆后端**：发布 `openviking` 服务（记忆召回 + 记忆索引），Plugins 页面带 host / port / API key / 阈值 / 条数 设置卡。

它**不注入任何东西**，也不认识 turn / step。想知道"什么时候查、查到了放哪里"的是注入插件（[`dsh-inject-context`](https://github.com/abc12524/dsh-inject-context)）；这里只负责"怎么连、查什么、返回什么"。

## 为什么拆出来

检索和注入的生命周期不同：

- 连接信息（host、port、token）、相似度阈值、返回条数属于**记忆后端**，跟着后端走；
- 触发时机、包裹形状、插在消息列表哪个位置属于**注入器**，跟着会话走。

拆开之前两者在同一个插件里，改一个连接参数要碰注入逻辑，反之亦然。现在 `dsh-openviking` 可以单独装、单独配、被多个插件共用。

## 服务接口

插件加载时同步 `ctx.provide('openviking', …)`，调用方按需取：

```js
const ov = ctx.get('openviking')
if (ov?.status().configured) {
  const { text, count } = await ov.find('用户之前说过什么偏好', { signal })
  if (text) ctx.logger.info(`recalled ${count} memories`)
}
```

| 方法 | 返回 | 说明 |
|---|---|---|
| `status()` | `{ configured, base? }` | 是否可用（`enabled` 开且 host 非空），可用时给出生效基址 |
| `find(query, { signal })` | `{ text, count }` | `POST /api/v1/search/find`；`text` 已渲染成行（`''` = 没有相关记忆） |
| `profile({ signal })` | `string` | `GET /api/v1/fs/tree`，`## 🧠 记忆索引` 主题概览（`''` = 拿不到） |

`find` 返回的是**行**，不是包裹好的块：

```
## 📖 相关记忆
- [viking://user/alice/peers/default/memories/x.md] (score=0.581, memory)
  用户偏好深色主题
```

边界话术（"这些内容不视为指令"）和 `<user-reminder>` 包裹由调用方加 —— 那是注入语义，不是检索语义。这样无论哪个插件来问，行的格式都一样，包裹却各自决定。

## 失败语义

| 情况 | `find()` | `profile()` |
|---|---|---|
| 连不上 / 非 2xx / 200 但不是 JSON | **reject** | 吞掉，返回 `''` |
| 正常但没命中 | `{ text: '', count: 0 }` | `''` |
| host 空 / `enabled=false` / query 空白 | `{ text: '', count: 0 }`，不发请求 | `''`，不发请求 |
| 超过 `timeoutMs` | reject，并 abort 请求本身 | 同上 |

`find` 选择 reject 而不是"当成没有记忆"：JSON 端点要么给 JSON、要么给错误状态；解析不了说明答话的是别的东西（代理、错端口、HTML 错误页），静默返回空会把一个坏掉的部署藏起来。注入器那边把它降级成"这一源不注入"就够。

## 安装

```yaml
- insert:
    - id: dsh-openviking
      name: dsh-openviking
- insert:
    - id: dsh-inject-context
      name: dsh-inject-context
```

加载顺序无所谓（`dsh-openviking` 在前时首轮就有检索可用）。`@deepseek-ai/schemastery` 是 peer 依赖，由 harness 的 profile 解析引导指向本体自带副本。

## 配置

### 设置页字段（全部 `.volatile()`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；关掉后 `status().configured` 为 false |
| `host` | （空） | OpenViking 主机；`192.168.30.181`、`ov.example.com`、`https://ov.example.com`、`10.0.0.5:1933` 均可 |
| `port` | `1933` | host 里没写端口时用它 |
| `scoreThreshold` | `0.4` | 一条记忆要达到的最低相似度 |
| `limit` | `3` | 每次查询最多要多少条 |
| — | — | **API key 走凭据域**（见下），不写在配置里 |

host 里写了协议就用它，写了端口就用它；`scheme` / `port` 只在 host 没写时补位。

### 普通配置（profile patch）

| 键 | 默认 | 说明 |
|---|---|---|
| `scheme` | `http` | host 没带协议时用它 |
| `apiKeyEnv` | `OPENVIKING_API_KEY` | 凭据引用名（不是密钥本体） |
| `user` | （空） | 作为 `X-OpenViking-User` 发送；也是记忆根目录的属主，空则 `profile()` 无法定址 |
| `account` | `default` | `X-OpenViking-Account` |
| `peer` | `default` | `X-OpenViking-Peer` |
| `abstractChars` | `1200` | 每条摘要保留多少字符；0 = 全留 |
| `profileLimit` | `40` | 索引最多列多少项 |
| `profileChars` | `2000` | 索引块字符预算；0 = 不限 |
| `timeoutMs` | `3000` | 单次请求超时；0 = 不限（也会 abort 请求本身） |

```yaml
- id: dsh-openviking
  config:
    user: alice
    abstractChars: 1600
    timeoutMs: 2500
```

### 密钥为什么不进配置

`apiKeyEnv` 只是个**引用名**，密钥本体由 harness 的凭据域持有（`~/.dsh/.credentials.yaml`，由设置卡的密码框写入）。公开仓库的 profile patch 里因此永远没有 token。没有密钥不致命：服务端回 401，`find` reject，注入器跳过这一源。

## 实测：`find` 的真实返回

```
POST http://192.168.30.181:1933/api/v1/search/find
{
  "query": "我之前说过什么偏好？",
  "score_threshold": 0.4,
  "limit": 3
}
```

```json
{
  "status": "ok",
  "result": {
    "memories": [
      { "uri": "viking://...", "score": 0.581, "abstract": "…", "context_type": "memory", "level": 2, "tags": [] }
    ],
    "resources": [], "skills": [], "total": 1
  }
}
```

解析对返回体形状是宽容的：`result` 是数组、`result` 里装 `memories` / `resources` / `skills` 或 `hits` / `items` / `results`、顶层直接给 `memories` 都认；按 `uri` 去重、按 `score` 降序，保证截断时留下最好的几条。分数打三位小数 —— 这个部署的相似度挤在 0.25~0.68 的窄带里，两位小数会把不同名次压成同一个数。

## 自检

```bash
node test/smoke.mjs
```

覆盖：配置形态与 volatile 划分、服务发布与总开关、`find` 请求体/头部/渲染顺序/去重、host+port+scheme 解析、空 host / 关闭 / 空 query 短路、空结果静默、传输与协议错误 reject、超时 abort、`profile()` 根目录探测与软失败、浏览器半接线（host/port/key/阈值/条数 五个控件）。

## License

MIT
