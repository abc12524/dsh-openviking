#!/usr/bin/env bash
# 一键把 dsh 检出的 @deepseek-ai/* 包符号链接到本插件 node_modules，
# 使自包含 tsconfig 能解析全部 import（含仅编译期需要的类型包）。
#
# 用法:  ./scripts/link-deps.sh <deepseek-harness 检出路径>
# 例:    ./scripts/link-deps.sh /app            # 容器内 dsh 检出
#        ./scripts/link-deps.sh /root/deepseek-harness
#
# 链接目标是 realpath 后的包实体目录（不是 workspace 软链本身），
# 包内的 node_modules 依赖自洽，无需解析 pnpm 结构。
set -euo pipefail

HARNESS="${1:?用法: link-deps.sh <deepseek-harness 检出路径>}"
[ -d "$HARNESS/packages" ] || { echo "错误: $HARNESS 不是 dsh 检出（无 packages/）" >&2; exit 1; }

# 插件 import 的全部 @deepseek-ai 包（value import 运行时必需，type-only 编译期必需）
declare -A PKG_PATHS=(
  [@deepseek-ai/schemastery]="vendor/schemastery"
  [@deepseek-ai/cordis]="vendor/cordis"
  [@deepseek-ai/dsh-agent]="packages/core/agent"
  [@deepseek-ai/dsh-llm]="packages/llm/llm"
  [@deepseek-ai/dsh-settings]="packages/settings/settings"
  [@deepseek-ai/dsh-client-ui-slots]="packages/client/ui-slots"
  [@deepseek-ai/dsh-client-runtime]="packages/client/runtime"
  [@deepseek-ai/dsh-client-ui-settings]="packages/client/ui-settings"
  [@deepseek-ai/dsh-client-locale]="packages/client/locale"
)

mkdir -p node_modules/@deepseek-ai node_modules/@types

# react 本体是平台模块（运行时 external，不落地）；但 tsc 编译 .tsx 需要
# @types/react 提供类型（TS 的 @types fallback 会应答 'react'/'react/jsx-runtime'）
if [ -d "$HARNESS/node_modules/@types/react" ]; then
  ln -sfn "$(realpath -m "$HARNESS/node_modules/@types/react")" "node_modules/@types/react"
  echo "✅ @types/react -> $HARNESS/node_modules/@types/react"
fi

for pkg in "${!PKG_PATHS[@]}"; do
  rel="${PKG_PATHS[$pkg]}"
  src="$HARNESS/$rel"
  # 优先解析真实路径（处理嵌套软链）
  if [ -e "$src" ]; then
    src=$(realpath -m "$src")
  fi
  if [ ! -d "$src" ]; then
    echo "❌ 跳过 $pkg: $src 不存在" >&2
    continue
  fi
  ln -sfn "$src" "node_modules/$pkg"
  echo "✅ $pkg -> $src"
done

echo
echo "完成。现在可用 harness 的 tsc/tsdown 构建："
echo "  PATH=$HARNESS/node_modules/.bin:\$PATH pnpm run build:client"
