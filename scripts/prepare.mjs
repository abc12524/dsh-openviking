#!/usr/bin/env node
/**
 * Git 安装（dsh plugin --profile <name> add github:abc12524/dsh-openviking）
 * 触发的 prepare 构建。
 *
 * 完整构建需要类型依赖：仓库根目录已执行过 link-deps.sh，把 dsh 检出的
 * @deepseek-ai/* 包链接进本包 node_modules（构建仅类型检查用，运行时由
 * harness 注入）。缺失这些依赖时，tsc 会报 cannot-find-module；这里改为
 * 先尝试构建，失败再打印可操作的替代安装路径，而不是抛出一堆底层错误。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  cwd: root,
})

if (result.status === 0) {
  process.exit(0)
}

console.error([
  '',
  '[dsh-openviking] prepare 构建失败。',
  '构建需要 DeepSeek Harness 检出的 @deepseek-ai/* 类型依赖（先执行本仓库的',
  '  ./scripts/link-deps.sh <deepseek-harness 检出路径>  建立软链），再重新安装。',
  '',
  '若不想走构建环境，可用零补丁零构建的 clone 路径：把 cordis.patch.yml.example',
  '的 insert 块复制进 profile patch 层，name 指向 <repo>/src/index.ts（见 README）。',
  '',
].join('\n'))

process.exit(result.status ?? 1)
