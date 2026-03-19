import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'fs-extra'
import { dirname, join } from 'pathe'
import { fileURLToPath } from 'node:url'

const execAsync = promisify(exec)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Find package root by looking for package.json (walk all the way to filesystem root)
function findPackageRoot(startDir: string): string {
  let dir = startDir

  while (true) {
    if (fs.existsSync(join(dir, 'package.json'))) {
      return dir
    }

    const parentDir = dirname(dir)
    if (parentDir === dir) {
      return dir
    }

    dir = parentDir
  }
}

const PACKAGE_ROOT = findPackageRoot(__dirname)

/**
 * Read version field from a package.json path
 */
async function readPackageVersion(pkgPath: string): Promise<string | null> {
  try {
    if (!(await fs.pathExists(pkgPath))) {
      return null
    }
    const pkg = await fs.readJSON(pkgPath)
    return pkg.version || null
  }
  catch {
    return null
  }
}

/**
 * Get current installed version from package.json
 */
export async function getCurrentVersion(): Promise<string> {
  // Prefer path relative to this file so dist/src path depth doesn't matter.
  const relativePkgPath = fileURLToPath(new URL('../../package.json', import.meta.url))
  const relativeVersion = await readPackageVersion(relativePkgPath)
  if (relativeVersion) {
    return relativeVersion
  }

  // Fallback: walk up to find package root (for unusual runtime layouts)
  const rootPkgPath = join(PACKAGE_ROOT, 'package.json')
  const rootVersion = await readPackageVersion(rootPkgPath)
  if (rootVersion) {
    return rootVersion
  }

  return process.env.npm_package_version || '0.0.0'
}

/**
 * Get latest version from npm registry
 */
export async function getLatestVersion(packageName = 'ccg-workflow'): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`npm view ${packageName} version`)
    return stdout.trim()
  }
  catch {
    return null
  }
}

/**
 * Compare two semantic versions
 * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0
    const num2 = parts2[i] || 0

    if (num1 > num2)
      return 1
    if (num1 < num2)
      return -1
  }

  return 0
}

/**
 * Check if update is available
 */
export async function checkForUpdates(): Promise<{
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string | null
}> {
  const currentVersion = await getCurrentVersion()
  const latestVersion = await getLatestVersion()

  if (!latestVersion) {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: null,
    }
  }

  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0

  return {
    hasUpdate,
    currentVersion,
    latestVersion,
  }
}

/**
 * Get changelog between two versions (simplified)
 */
export async function getChangelog(fromVersion: string, toVersion: string): Promise<string[]> {
  // In a real implementation, this would fetch from CHANGELOG.md or GitHub releases
  // For now, return a placeholder
  return [
    `升级从 v${fromVersion} 到 v${toVersion}`,
    '• 优化命令模板',
    '• 更新专家提示词',
    '• 修复已知问题',
  ]
}
