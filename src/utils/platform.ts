/**
 * Platform utilities for cross-platform compatibility
 * Adapted from zcf project's platform.ts
 */

/**
 * Check if current platform is Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32'
}

/**
 * Check if current platform is macOS
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin'
}

/**
 * Check if current platform is Linux
 */
export function isLinux(): boolean {
  return process.platform === 'linux'
}

/**
 * Get platform-specific MCP command wrapper
 * On Windows, npx/uvx commands need to be wrapped with cmd /c
 *
 * @param command - The command to wrap (e.g., 'npx', 'uvx', 'node')
 * @returns Array of command parts [command, ...args]
 *
 * @example
 * // Windows
 * getMcpCommand('npx') // => ['cmd', '/c', 'npx']
 *
 * // macOS/Linux
 * getMcpCommand('npx') // => ['npx']
 */
export function getMcpCommand(command: string): string[] {
  // List of commands that need Windows wrapping
  const needsWrapping = ['npx', 'uvx', 'node', 'npm', 'pnpm', 'yarn']

  if (isWindows() && needsWrapping.includes(command)) {
    return ['cmd', '/c', command]
  }

  return [command]
}

/**
 * Get current platform name
 */
export function getPlatformName(): string {
  const platform = process.platform
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

/**
 * Get platform-specific path separator
 */
export function getPathSeparator(): string {
  return isWindows() ? '\\' : '/'
}
