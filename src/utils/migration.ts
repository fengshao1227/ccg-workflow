/**
 * Migration utilities for v1.4.0
 * Handles automatic migration from old directory structure to new one
 */

import fs from 'fs-extra'
import { homedir } from 'node:os'
import { join } from 'pathe'

export interface MigrationResult {
  success: boolean
  migratedFiles: string[]
  errors: string[]
  skipped: string[]
}

/**
 * Migrate from v1.3.x to v1.4.0
 *
 * Changes:
 * 1. ~/.ccg/ → ~/.claude/.ccg/
 * 2. ~/.claude/prompts/ccg/ → ~/.claude/.ccg/prompts/
 */
export async function migrateToV1_4_0(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    migratedFiles: [],
    errors: [],
    skipped: [],
  }

  const oldCcgDir = join(homedir(), '.ccg')
  const newCcgDir = join(homedir(), '.claude', '.ccg')
  const oldPromptsDir = join(homedir(), '.claude', 'prompts', 'ccg')
  const newPromptsDir = join(newCcgDir, 'prompts')

  try {
    // Ensure new config directory exists
    await fs.ensureDir(newCcgDir)

    // 1. Migrate ~/.ccg/ → ~/.claude/.ccg/
    if (await fs.pathExists(oldCcgDir)) {
      const files = await fs.readdir(oldCcgDir)
      for (const file of files) {
        const srcFile = join(oldCcgDir, file)
        const destFile = join(newCcgDir, file)

        try {
          // Skip if destination already exists (don't overwrite)
          if (await fs.pathExists(destFile)) {
            result.skipped.push(`~/.ccg/${file} (already exists in new location)`)
            continue
          }

          // Copy file or directory
          await fs.copy(srcFile, destFile)
          result.migratedFiles.push(`~/.ccg/${file} → ~/.claude/.ccg/${file}`)
        }
        catch (error) {
          result.errors.push(`Failed to migrate ${file}: ${error}`)
          result.success = false
        }
      }

      // Remove old directory (only if migration succeeded and it's empty)
      try {
        const remaining = await fs.readdir(oldCcgDir)
        if (remaining.length === 0) {
          await fs.remove(oldCcgDir)
          result.migratedFiles.push('Removed old ~/.ccg/ directory')
        }
        else {
          result.skipped.push(`~/.ccg/ (not empty, keeping for safety)`)
        }
      }
      catch (error) {
        // It's okay if we can't remove the old directory
        result.skipped.push(`~/.ccg/ (could not remove: ${error})`)
      }
    }
    else {
      result.skipped.push('~/.ccg/ (does not exist, nothing to migrate)')
    }

    // 2. Migrate ~/.claude/prompts/ccg/ → ~/.claude/.ccg/prompts/
    if (await fs.pathExists(oldPromptsDir)) {
      try {
        // Skip if destination already exists
        if (await fs.pathExists(newPromptsDir)) {
          result.skipped.push('~/.claude/prompts/ccg/ (already exists in new location)')
        }
        else {
          await fs.copy(oldPromptsDir, newPromptsDir)
          result.migratedFiles.push('~/.claude/prompts/ccg/ → ~/.claude/.ccg/prompts/')

          // Remove old directory
          await fs.remove(oldPromptsDir)
          result.migratedFiles.push('Removed old ~/.claude/prompts/ccg/ directory')

          // Try to remove parent directory if empty
          const promptsParentDir = join(homedir(), '.claude', 'prompts')
          const remaining = await fs.readdir(promptsParentDir)
          if (remaining.length === 0) {
            await fs.remove(promptsParentDir)
            result.migratedFiles.push('Removed empty ~/.claude/prompts/ directory')
          }
        }
      }
      catch (error) {
        result.errors.push(`Failed to migrate prompts: ${error}`)
        result.success = false
      }
    }
    else {
      result.skipped.push('~/.claude/prompts/ccg/ (does not exist, nothing to migrate)')
    }
  }
  catch (error) {
    result.errors.push(`Migration failed: ${error}`)
    result.success = false
  }

  return result
}

/**
 * Check if migration is needed
 */
export async function needsMigration(): Promise<boolean> {
  const oldCcgDir = join(homedir(), '.ccg')
  const oldPromptsDir = join(homedir(), '.claude', 'prompts', 'ccg')
  const oldConfigFile = join(homedir(), '.claude', 'commands', 'ccg', '_config.md')

  const hasOldCcgDir = await fs.pathExists(oldCcgDir)
  const hasOldPromptsDir = await fs.pathExists(oldPromptsDir)
  const hasOldConfigFile = await fs.pathExists(oldConfigFile)

  return hasOldCcgDir || hasOldPromptsDir || hasOldConfigFile
}
