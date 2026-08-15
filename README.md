# dsh-openviking

OpenViking long-term memory integration plugin for DeepSeek Harness (dsh).

- Host side: registers the `openviking` settings namespace (server URL, user, key, relevance threshold, result count) and injects candidate memories (score > threshold, at most maxResults) as background context after every new user question.
- Browser side: renders the OpenViking form on the Web Settings page.

## Requirements

- A DeepSeek Harness checkout with the tsconfig path aliases this plugin relies on. The plugin's `tsconfig.json` and `tsdown.client.ts` reference the harness at `../../deepseek-harness` relative to this package.
- An OpenViking memory server (MCP Streamable HTTP endpoint, e.g. `http://<host>:1933/mcp`).

## Install

The plugin loads from TS source. In the dsh profile patch layer (`cordis.patch.yml`), insert:

```yaml
- insert:
    - id: openviking
      name: '/path/to/dsh-openviking/src/index.ts'
      config:
        url: http://<openviking-host>:1933/mcp
        key: '<bearer-token>'
        minScore: 0.4
```

For the Web Settings form to appear, the `openviking` namespace must be in the harness API gateway's `WEB_SETTINGS_NAMESPACES` allowlist (`packages/host/apiproxy/src/api-proxy.ts`), and the `dsh-client-modules` registry must resolve this package's `dsh.client` declaration (path-style loader entries require the package.json lookup patch).

## Build (client bundle)

The browser half is a tsdown client bundle:

```bash
pnpm run build:client
```

or the harness's client pass (`DSH_BUILD_FACE=client`). Output lands in `lib/` (gitignored).

## Settings

| Field | Description |
|-------|-------------|
| Server URL | OpenViking MCP Streamable HTTP endpoint |
| User | OpenViking user identity (optional) |
| API Key | Full bearer token (redacted; never echoed back) |
| Relevance threshold | Only inject candidates with relevance above this (0-1); default 0.4 |
| Result count | Maximum candidate memories injected per question; default 3 |

## License

MIT
