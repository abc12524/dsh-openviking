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

# 幂等：已应用过（api-proxy.ts 含 openviking）则跳过
if grep -q "'openviking'" packages/host/apiproxy/src/api-proxy.ts 2>/dev/null; then
  echo "检测到补丁已应用（api-proxy.ts 已含 openviking），跳过。"
  exit 0
fi

for p in "$PATCHES"/000{1,2,3,4}-*.patch; do
  echo "== 应用 $(basename "$p") =="
  git apply "$p"
done

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
