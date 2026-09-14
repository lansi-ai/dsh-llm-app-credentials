/**
 * 把本插件安装到 dsh-forge 的外部插件装载点（幂等，可反复执行）。
 *
 * 三步：
 *   1. 链 peer 依赖（复用 scripts/link-peers.cjs）—— 保证 `@deepseek-ai/*` 与宿主
 *      是**同一个模块实例**，否则 `LlmAdapter` 身份对不上；
 *   2. 在 `<DSH_HOME>/profiles/node_modules/` 建 junction 指向本插件目录
 *      （junction 不需要管理员权限；开发期改完代码重新 build 即生效，不必再复制）；
 *   3. 在 `<DSH_HOME>/profiles/dsh-forge/cordis.patch.yml` 里加一行 insert。
 *
 * dsh-forge 启动时会把该 patch 层的裸包名解析成入口绝对路径后交给上游 Loader
 * （见 src/forge-host/profile-plugins.ts），所以这里只写包名即可。
 *
 * 用法：
 *   node scripts/install-forge.cjs                                   # 自动探测宿主与 $DSH_HOME
 *   node scripts/install-forge.cjs --forge E:/Projects/DSH/desktop
 *   node scripts/install-forge.cjs --home C:/Users/me/.dsh
 *   node scripts/install-forge.cjs --uninstall
 */
'use strict'

const { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, lstatSync, unlinkSync, writeFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { dirname, join, resolve } = require('node:path')
const { execFileSync } = require('node:child_process')

const PLUGIN_ID = 'llm-app-credentials'
const PACKAGE_NAME = 'dsh-llm-app-credentials'
const PROFILE_NAME = 'dsh-forge'
const PATCH_FILENAME = 'cordis.patch.yml'

const pluginDir = resolve(__dirname, '..')
const uninstall = process.argv.includes('--uninstall')

/** 取 --flag 的值。 */
function argOf(flag) {
  const index = process.argv.indexOf(flag)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : undefined
}

/** 解析 $DSH_HOME：--home > 环境变量 > ~/.dsh（与官方 dsh-home-paths 同序）。 */
function resolveHome() {
  const explicit = argOf('--home')
  if (explicit) return resolve(explicit)
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim().length > 0) return resolve(fromEnv)
  return join(homedir(), '.dsh')
}

const home = resolveHome()
const profilesRoot = join(home, 'profiles')
const profileDir = join(profilesRoot, PROFILE_NAME)
const patchPath = join(profileDir, PATCH_FILENAME)
const installLink = join(profilesRoot, 'node_modules', PACKAGE_NAME)

/** 本插件在补丁层里的那一行。 */
const ROW = `- insert:\n    - id: ${PLUGIN_ID}\n      name: ${PACKAGE_NAME}\n`

/** 首次安装时写出的补丁层模板（与 dsh-forge 运行时自动生成的模板同义）。 */
const TEMPLATE = `# dsh-forge 外部插件装载点（用户补丁层，在每个 bundle 层之后应用）。\n# 删掉下面的 insert 行即卸载该插件；文件为空或只剩注释会导致启动失败，要停用本层就写 []。\n`

/** 一条命令跑完三步中的第 1 步；失败即中止（装不干净不如不装）。 */
function linkPeers() {
  const args = ['scripts/link-peers.cjs']
  const forge = argOf('--forge')
  if (forge) args.push('--forge', forge)
  console.log('[install] 链接 peer 依赖…')
  execFileSync(process.execPath, args, { cwd: pluginDir, stdio: 'inherit' })
}

/** 建/删安装 junction（已存在且指向本目录时视为就绪）。 */
function placeLink() {
  mkdirSync(dirname(installLink), { recursive: true })
  if (uninstall) {
    try {
      lstatSync(installLink)
      rmSync(installLink, { recursive: true, force: true })
      console.log(`[install] 已移除安装链接：${installLink}`)
    } catch {
      console.log(`[install] 安装链接本就不存在：${installLink}`)
    }
    return
  }
  try {
    lstatSync(installLink)
    console.log(`[install] 安装链接已存在：${installLink}`)
    return
  } catch {
    /* 首次安装 */
  }
  symlinkSync(pluginDir, installLink, 'junction')
  console.log(`[install] 已建立安装链接：${installLink} → ${pluginDir}`)
}

/** 在补丁层里加/去那一行（保留既有内容；无法安全改写时先备份再整写）。 */
function editPatch() {
  if (uninstall) {
    if (!existsSync(patchPath)) return
    const text = readFileSync(patchPath, 'utf8')
    const next = text.replace(new RegExp(`- insert:\\s*\\n\\s+- id: ${PLUGIN_ID}\\s*\\n\\s+name: ${PACKAGE_NAME}\\s*\\n`, 'u'), '[]\n')
    if (next === text) {
      console.log('[install] 补丁层里没有本插件的行，无需改动')
      return
    }
    writeFileSync(patchPath, next, 'utf8')
    console.log(`[install] 已从补丁层移除插入行：${patchPath}`)
    return
  }

  mkdirSync(profileDir, { recursive: true })
  const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : undefined

  if (existing === undefined) {
    writeFileSync(patchPath, TEMPLATE + ROW, 'utf8')
    console.log(`[install] 已创建补丁层并写入插入行：${patchPath}`)
    return
  }
  // 只看**生效行**：模板注释里本就带一条 `#     - id: <本插件>` 的示例，直接 includes 会被自己的
  // 注释骗到（实测假阳性：报「已含插入行」但补丁层仍是 []，插件静默不加载——坑 64）。
  const activeLines = existing.split('\n').filter((line) => !line.trimStart().startsWith('#'))
  if (activeLines.some((line) => line.includes(`id: ${PLUGIN_ID}`))) {
    console.log(`[install] 补丁层已含本插件的插入行：${patchPath}`)
    return
  }
  // 空列表（模板/手写 []）→ 直接替换，注释得以保留。
  if (/^\s*(#.*\n|\s*\n)*\[\]\s*$/u.test(existing)) {
    const head = existing.replace(/\[\]\s*$/u, '')
    writeFileSync(patchPath, `${head}${ROW}`, 'utf8')
    console.log(`[install] 已写入插入行：${patchPath}`)
    return
  }
  // 已有其它行：备份后追加（YAML 块序列可直接续写）。
  const backup = `${patchPath}.bak`
  renameSync(patchPath, backup)
  writeFileSync(patchPath, `${existing.replace(/\s*$/u, '')}\n${ROW}`, 'utf8')
  console.log(`[install] 已追加插入行（原文件备份于 ${backup}）：${patchPath}`)
}

/** 安装前自检：构建产物必须在，否则装了也加载不了。 */
function assertBuilt() {
  if (uninstall) return
  const entry = join(pluginDir, 'lib', 'index.js')
  if (!existsSync(entry)) {
    console.error(`[install] 缺少构建产物 ${entry}，先执行 npm run build`)
    process.exit(1)
  }
  const client = join(pluginDir, 'lib', 'client.js')
  if (!existsSync(client)) console.warn(`[install] 警告：缺少浏览器半 ${client}，设置页不会出现`)
}

/** 复制模式的辅助入口（--copy：不用链接，直接拷一份进 profiles/node_modules）。 */
function copyInstead() {
  mkdirSync(dirname(installLink), { recursive: true })
  // 已存在旧安装（链接或旧副本）先清掉，避免拷进链接目标里。
  try {
    lstatSync(installLink)
    rmSync(installLink, { recursive: true, force: true })
  } catch {
    /* 首次安装 */
  }
  cpSync(pluginDir, installLink, {
    recursive: true,
    dereference: true,
    filter: (source) => !source.includes(join(pluginDir, 'node_modules')),
  })
  console.log(`[install] 已复制插件到 ${installLink}`)
}

assertBuilt()
if (process.argv.includes('--copy')) {
  copyInstead()
} else {
  linkPeers()
  placeLink()
}
editPatch()
console.log(uninstall ? '[install] 卸载完成（重启 dsh-forge 生效）' : '[install] 安装完成（重启 dsh-forge 生效）')
