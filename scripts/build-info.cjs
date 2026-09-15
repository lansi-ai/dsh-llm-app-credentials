/**
 * Write lib/build-info.json: which commit this build came from.
 *
 * Why a committed marker instead of a version bump: this plugin's
 * PLUGIN_IDENTITY.version travels upstream as part of the white-label
 * User-Agent, so that string is deliberately frozen — which left an install with
 * no way to answer "am I on the new build?". The marker is committed together
 * with lib/, so a tarball install carries it.
 *
 * Only commit-derived fields are written, so a rebuild of the same commit
 * produces byte-identical output and the tracked lib/ directory does not churn.
 * `dirty` is what keeps the commit field honest: a build from an uncommitted
 * tree records true, and a `dirty: true` marker must not be read as a released
 * version. Build order matters for that reason — commit the sources, then build,
 * then commit lib/.
 *
 * @module dsh-llm-app-credentials/scripts/build-info
 */

const { execFileSync } = require('node:child_process')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')

/**
 * Run one git command in the package root.
 *
 * @param {readonly string[]} args - git arguments.
 * @returns the trimmed stdout, or undefined when git is missing or this is not a
 *   repository (an install built from a tarball has no .git).
 */
function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

const commit = git(['rev-parse', 'HEAD'])
const commitDate = git(['show', '-s', '--format=%cI', 'HEAD'])
const status = git(['status', '--porcelain'])

let version = '0.0.0'
try {
  version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.0.0'
} catch {
  /* the marker still answers "which commit" without a version */
}

const info = {
  name: 'dsh-llm-app-credentials',
  version,
  ...(commit === undefined ? {} : { commit }),
  ...(commit === undefined ? {} : { commitShort: commit.slice(0, 7) }),
  ...(commitDate === undefined || commitDate.length === 0 ? {} : { commitDate }),
  ...(status === undefined ? {} : { dirty: status.length > 0 }),
  source: commit === undefined ? 'unknown' : 'git',
}

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8')
console.log(`[build-info] ${info.version} ${info.commitShort ?? 'no-git'}${info.dirty === true ? ' (dirty)' : ''}`)
