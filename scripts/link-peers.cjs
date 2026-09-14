/**
 * 把本插件的 peer / 运行期依赖以 Windows junction 链到宿主（dsh-forge 或官方 dsh）的
 * node_modules。
 *
 * 为什么需要它：
 *   1. 本插件不打包自己的依赖副本 —— ESM 模块身份必须与宿主一致，
 *      `LlmAdapter` / `LlmError` / `Service` 基类若来自第二份副本，
 *      `registerAdapter` 的身份校验与 Service 提供关系都会失效。junction 指向真实
 *      目录后，Node 的 ESM 解析走 realpath，拿到的是**同一个模块实例**。
 *   2. 开发期免联网：不必 `npm install`，直接复用宿主已装好的 typescript /
 *      @types/node / eventsource-parser。
 *
 * junction（而非 symlink）在 Windows 上**不需要管理员权限或开发者模式**。
 * 幂等：已存在且指向正确目标时跳过。
 *
 * 用法：node scripts/link-peers.cjs [--forge <宿主目录>]
 */
'use strict'

const { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

const pluginDir = resolve(__dirname, '..')

/** 候选宿主目录：先看 --forge，再按「同级宿主目录 / 上级目录」两种部署位置探测。 */
function resolveHost() {
  const flagIndex = process.argv.indexOf('--forge')
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return resolve(process.argv[flagIndex + 1])
  const candidates = [resolve(pluginDir, '..', '..', 'desktop'), resolve(pluginDir, '..', '..')]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'node_modules', '@deepseek-ai', 'dsh-llm'))) return candidate
  }
  return candidates[0]
}

const hostDir = resolveHost()
const hostModules = join(hostDir, 'node_modules')
if (!existsSync(hostModules)) {
  console.error(`[link-peers] 找不到宿主 node_modules：${hostModules}`)
  console.error('[link-peers] 用 --forge <宿主目录> 指定，例如 node scripts/link-peers.cjs --forge E:/Projects/DSH/desktop')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))

/** 需要链接的包名：peer + 运行期依赖 + 编译期工具。 */
const needed = new Set([
  ...Object.keys(manifest.peerDependencies ?? {}),
  ...Object.keys(manifest.dependencies ?? {}),
  'typescript',
  '@types/node',
])

/** 链接一个包（幂等）。 */
function link(name) {
  const source = join(hostModules, name)
  if (!existsSync(source)) return `跳过（宿主未安装）: ${name}`
  const linkPath = join(pluginDir, 'node_modules', name)
  mkdirSync(dirname(linkPath), { recursive: true })
  try {
    const stat = lstatSync(linkPath)
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      if (realpathSync.native(linkPath) === realpathSync.native(source)) return `已就绪: ${name}`
      unlinkSync(linkPath)
    }
  } catch {
    /* ENOENT：首次链接 */
  }
  symlinkSync(source, linkPath, 'junction')
  return `已链接: ${name}`
}

for (const name of [...needed].sort()) console.log(`[link-peers] ${link(name)}`)
console.log(`[link-peers] 宿主: ${hostDir}`)
