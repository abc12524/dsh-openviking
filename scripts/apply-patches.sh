#!/usr/bin/env bash
# 在 dsh 检出里一键应用 dsh-openviking 的必需补丁（0001-0004）。
# 用法: ./scripts/apply-patches.sh <dsh 检出路径> [--all]
#   --all   连可选补丁（0005-0008）一起应用
# 例:   ./scripts/apply-patches.sh /app
#       ./scripts/apply-patches.sh /root/deepseek-harness --all
set -euo pipefail

DSH="${1:?用法: apply-patches.sh <dsh 检出路径> [--all]}"
ALL="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCHES="$SCRIPT_DIR/../patches"

[ -d "$DSH/packages" ] || { echo "错误: $DSH 不是 dsh 检出（无 packages/）" >&2; exit 1; }
cd "$DSH"

# 幂等：0001 已应用过（connection 特权方法走 trusted-host）则全部跳过
if grep -q "isTrustedApiRequest(request, trustedHosts)" packages/client/connection/src/index.ts 2>/dev/null; then
  echo "检测到必需补丁已应用（0001 标记），跳过。"
  exit 0
fi

for p in "$PATCHES"/000{1,2,3}-*.patch; do
  echo "== 应用 $(basename "$p") =="
  git apply "$p"
done

# 0004 只对旧版 dsh（< rc.7）需要：rc.7+ (#2404) 上游已移除 settings 白名单
if grep -q "WEB_SETTINGS_NAMESPACES" packages/host/apiproxy/src/api-proxy.ts 2>/dev/null; then
  echo "== 应用 0004-apiproxy-openviking-settings-whitelist.patch（旧版 dsh 需要）=="
  git apply "$PATCHES"/0004-*.patch
else
  echo "== 跳过 0004（rc.7+ 已移除 settings 白名单，无需应用）=="
fi

if [ "$ALL" = "--all" ]; then
  for p in "$PATCHES"/000{5,6,7,8}-*.patch; do
    echo "== 应用（可选）$(basename "$p") =="
    git apply "$p" || echo "⚠️  $(basename "$p") 应用失败（可选，可跳过）"
  done
fi

echo
echo "✅ 补丁应用完成。接下来："
echo "  1. 重新构建（src 与 lib 必须同步，运行时加载的是 lib）: pnpm run build"
echo "  2. 重启 dsh web"
