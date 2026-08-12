import type { ModelRouting, ModelType } from '../types'
import ansis from 'ansis'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import ora from 'ora'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { checkForUpdates, compareVersions } from '../utils/version'
import { showBinaryDownloadWarning, verifyBinary } from '../utils/installer'
import { readCcgConfig, writeCcgConfig } from '../utils/config'
import { migrateToV1_4_0, needsMigration } from '../utils/migration'
import { i18n } from '../i18n'

const execAsync = promisify(exec)

/**
 * Main update command - checks for updates and installs if available
 */
export async function update(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold(`🔄 ${i18n.t('update:checking')}`))
  console.log()

  const spinner = ora(i18n.t('update:checkingLatest')).start()

  try {
    const { hasUpdate, currentVersion, latestVersion } = await checkForUpdates()

    // Check if local workflow version differs from running version
    const config = await readCcgConfig()
    const localVersion = config?.general?.version || '0.0.0'
    const needsWorkflowUpdate = compareVersions(currentVersion, localVersion) > 0

    spinner.stop()

    if (!latestVersion) {
      console.log(ansis.red(`❌ ${i18n.t('update:cannotConnect')}`))
      return
    }

    console.log(`${i18n.t('update:currentVersion')}: ${ansis.yellow(`v${currentVersion}`)}`)
    console.log(`${i18n.t('update:latestVersion')}: ${ansis.green(`v${latestVersion}`)}`)
    if (localVersion !== '0.0.0') {
      console.log(`${i18n.t('update:localWorkflow')}: ${ansis.gray(`v${localVersion}`)}`)
    }
    console.log()

    // Determine effective update status
    const effectiveNeedsUpdate = hasUpdate || needsWorkflowUpdate
    let defaultConfirm = effectiveNeedsUpdate

    let message: string
    if (hasUpdate) {
      message = i18n.t('update:newVersionFound', { latest: latestVersion, current: currentVersion })
      defaultConfirm = true
    }
    else if (needsWorkflowUpdate) {
      message = i18n.t('update:localOutdated', { local: localVersion, current: currentVersion })
      defaultConfirm = true
    }
    else {
      message = i18n.t('update:alreadyLatest', { current: currentVersion })
      defaultConfirm = false
    }

    const { confirmUpdate } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmUpdate',
      message,
      default: defaultConfirm,
    }])

    if (!confirmUpdate) {
      console.log(ansis.gray(i18n.t('update:cancelled')))
      return
    }

    // Pass localVersion as fromVersion for accurate display
    const fromVersion = needsWorkflowUpdate ? localVersion : currentVersion
    await performUpdate(fromVersion, latestVersion || currentVersion, hasUpdate)
  }
  catch (error) {
    spinner.stop()
    console.log(ansis.red(`❌ ${i18n.t('update:error', { error: String(error) })}`))
  }
}

/**
 * Ask user if they want to reconfigure model routing
 */
async function askReconfigureRouting(currentRouting?: ModelRouting): Promise<ModelRouting | null> {
  console.log()
  console.log(ansis.cyan.bold(`🔧 ${i18n.t('init:summary.modelRouting')}`))
  console.log()

  if (currentRouting) {
    console.log(ansis.gray(`${i18n.t('menu:api.currentConfig')}`))
    console.log(`  ${ansis.cyan('Frontend:')} ${currentRouting.frontend.models.map(m => ansis.green(m)).join(', ')}`)
    console.log(`  ${ansis.cyan('Backend:')} ${currentRouting.backend.models.map(m => ansis.blue(m)).join(', ')}`)
    console.log()
  }

  const { reconfigure } = await inquirer.prompt([{
    type: 'confirm',
    name: 'reconfigure',
    message: i18n.t('init:selectFrontendModels'),
    default: false,
  }])

  if (!reconfigure) {
    return null
  }

  console.log()

  // Frontend models selection
  const { selectedFrontend } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selectedFrontend',
    message: i18n.t('init:selectFrontendModels'),
    choices: [
      { name: 'Antigravity', value: 'antigravity' as ModelType, checked: currentRouting?.frontend.models.includes('antigravity') ?? true },
      { name: 'Grok', value: 'grok' as ModelType, checked: currentRouting?.frontend.models.includes('grok') ?? false },
      { name: 'Kimi', value: 'kimi' as ModelType, checked: currentRouting?.frontend.models.includes('kimi') ?? false },
      { name: 'OpenCode', value: 'opencode' as ModelType, checked: currentRouting?.frontend.models.includes('opencode') ?? false },
      { name: 'Claude', value: 'claude' as ModelType, checked: currentRouting?.frontend.models.includes('claude') ?? false },
      { name: 'Codex', value: 'codex' as ModelType, checked: currentRouting?.frontend.models.includes('codex') ?? false },
      { name: `Gemini (${i18n.t('init:model.deprecated')})`, value: 'gemini' as ModelType, checked: currentRouting?.frontend.models.includes('gemini') ?? false },
    ],
    validate: (answer: string[]) => answer.length > 0 || i18n.t('init:validation.selectAtLeastOne'),
  }])

  // Backend models selection
  const { selectedBackend } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selectedBackend',
    message: i18n.t('init:selectBackendModels'),
    choices: [
      { name: 'Codex', value: 'codex' as ModelType, checked: currentRouting?.backend.models.includes('codex') ?? true },
      { name: 'Grok', value: 'grok' as ModelType, checked: currentRouting?.backend.models.includes('grok') ?? false },
      { name: 'Kimi', value: 'kimi' as ModelType, checked: currentRouting?.backend.models.includes('kimi') ?? false },
      { name: 'OpenCode', value: 'opencode' as ModelType, checked: currentRouting?.backend.models.includes('opencode') ?? false },
      { name: 'Antigravity', value: 'antigravity' as ModelType, checked: currentRouting?.backend.models.includes('antigravity') ?? false },
      { name: 'Claude', value: 'claude' as ModelType, checked: currentRouting?.backend.models.includes('claude') ?? false },
      { name: `Gemini (${i18n.t('init:model.deprecated')})`, value: 'gemini' as ModelType, checked: currentRouting?.backend.models.includes('gemini') ?? false },
    ],
    validate: (answer: string[]) => answer.length > 0 || i18n.t('init:validation.selectAtLeastOne'),
  }])

  const frontendModels = selectedFrontend as ModelType[]
  const backendModels = selectedBackend as ModelType[]

  // Build new routing config
  const newRouting: ModelRouting = {
    frontend: {
      models: frontendModels,
      primary: frontendModels[0],
      strategy: frontendModels.length > 1 ? 'parallel' : 'fallback',
    },
    backend: {
      models: backendModels,
      primary: backendModels[0],
      strategy: backendModels.length > 1 ? 'parallel' : 'fallback',
    },
    review: {
      models: [...new Set([...frontendModels, ...backendModels])],
      strategy: 'parallel',
    },
    mode: currentRouting?.mode || 'smart',
    geminiModel: currentRouting?.geminiModel,
    grokModel: currentRouting?.grokModel,
    kimiModel: currentRouting?.kimiModel,
    opencodeModel: currentRouting?.opencodeModel,
  }

  console.log()
  console.log(ansis.green('✓ New config:'))
  console.log(`  ${ansis.cyan('Frontend:')} ${frontendModels.map(m => ansis.green(m)).join(', ')}`)
  console.log(`  ${ansis.cyan('Backend:')} ${backendModels.map(m => ansis.blue(m)).join(', ')}`)
  console.log()

  return newRouting
}

/**
 * Check if CCG is installed globally via npm
 */
async function checkIfGlobalInstall(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('npm list -g ccg-workflow --depth=0', { timeout: 5000 })
    return stdout.includes('ccg-workflow@')
  }
  catch {
    return false
  }
}

/**
 * Perform the actual update process
 */
async function performUpdate(fromVersion: string, toVersion: string, isNewVersion: boolean): Promise<void> {
  console.log()
  console.log(ansis.yellow.bold(`⚙️  ${i18n.t('update:starting')}`))
  console.log()

  // Check if installed globally via npm
  const isGlobalInstall = await checkIfGlobalInstall()

  // If globally installed and only workflow needs update (package is already latest)
  if (isGlobalInstall && !isNewVersion) {
    console.log(ansis.cyan(`ℹ️  ${i18n.t('update:globalDetected')}`))
    console.log()
    console.log(ansis.green(`✓ ${i18n.t('update:packageLatest')} (v${toVersion})`))
    console.log(ansis.yellow(`⚙️  ${i18n.t('update:workflowOnly')}`))
    console.log()
  }
  else if (isGlobalInstall && isNewVersion) {
    console.log(ansis.yellow(`⚠️  ${i18n.t('update:globalDetected')}`))
    console.log()
    console.log(`${i18n.t('update:recommendNpm')}`)
    console.log()
    console.log(ansis.cyan('  npm install -g ccg-workflow@latest'))
    console.log()
    console.log(ansis.gray(i18n.t('update:willUpdateBoth')))
    console.log()

    const { useNpmUpdate } = await inquirer.prompt([{
      type: 'confirm',
      name: 'useNpmUpdate',
      message: i18n.t('update:useNpmUpdate'),
      default: true,
    }])

    if (useNpmUpdate) {
      console.log()
      console.log(ansis.cyan(i18n.t('update:runInNewTerminal')))
      console.log()
      console.log(ansis.cyan.bold('  npm install -g ccg-workflow@latest'))
      console.log()
      console.log(ansis.gray(`(${i18n.t('update:autoUpdateAfter')})`))
      console.log()
      return
    }

    console.log()
    console.log(ansis.yellow(`⚠️  ${i18n.t('update:continueBuiltin')}`))
    console.log(ansis.gray(i18n.t('update:willNotUpdateCli')))
    console.log()
  }

  // Step 1: Download latest package
  let spinner = ora(i18n.t('update:downloading')).start()

  try {
    if (process.platform === 'win32') {
      spinner.text = i18n.t('update:clearingCache')
      try {
        await execAsync('npx clear-npx-cache', { timeout: 10000 })
      }
      catch {
        const npxCachePath = join(homedir(), '.npm', '_npx')
        try {
          await fs.remove(npxCachePath)
        }
        catch {
          // Cache clearing failed, but continue anyway
        }
      }
    }

    spinner.text = i18n.t('update:downloading')
    await execAsync(`npx --yes ccg-workflow@latest --version`, { timeout: 60000 })
    spinner.succeed(i18n.t('update:downloadDone'))
  }
  catch (error) {
    spinner.fail(i18n.t('update:downloadFailed'))
    console.log(ansis.red(`${i18n.t('common:error')}: ${error}`))
    return
  }

  // Step 2: Auto-migrate from old directory structure (if needed)
  if (await needsMigration()) {
    spinner = ora(i18n.t('update:migrating')).start()
    const migrationResult = await migrateToV1_4_0()

    if (migrationResult.migratedFiles.length > 0) {
      spinner.info(ansis.cyan(i18n.t('update:migrationDone')))
      console.log()
      for (const file of migrationResult.migratedFiles) {
        console.log(`  ${ansis.green('✓')} ${file}`)
      }
      if (migrationResult.skipped.length > 0) {
        console.log()
        console.log(ansis.gray(`  ${i18n.t('update:migrationSkipped')}`))
        for (const file of migrationResult.skipped) {
          console.log(`  ${ansis.gray('○')} ${file}`)
        }
      }
      console.log()
    }

    if (migrationResult.errors.length > 0) {
      spinner.warn(ansis.yellow(i18n.t('update:migrationErrors')))
      for (const error of migrationResult.errors) {
        console.log(`  ${ansis.red('✗')} ${error}`)
      }
      console.log()
    }
  }

  // ── Atomic update: backup → install → verify → cleanup / rollback ──
  // Old approach deleted everything BEFORE installing, so if install failed
  // the user was left with nothing. New approach backs up first, installs new,
  // verifies, then cleans up backups. On failure, restores from backup.

  const installDir = join(homedir(), '.claude')
  const BACKUP_SUFFIX = '.ccg-update-bak'

  // Directories to back up before installing new version
  const backupTargets = [
    join(installDir, 'commands', 'ccg'),
    join(installDir, 'agents', 'ccg'),
    join(installDir, 'skills', 'ccg'),
    join(installDir, 'hooks', 'ccg'),
    join(installDir, '.ccg', 'engine'),
  ]

  // Step 3: Back up existing files (move to *.ccg-update-bak)
  spinner = ora(i18n.t('update:removingOld')).start()

  const backedUp: string[] = []
  try {
    for (const dir of backupTargets) {
      if (await fs.pathExists(dir)) {
        const backupPath = dir + BACKUP_SUFFIX
        // Clean up leftover backups from previous failed update
        if (await fs.pathExists(backupPath)) {
          await fs.remove(backupPath)
        }
        await fs.move(dir, backupPath)
        backedUp.push(dir)
      }
    }
    spinner.succeed(i18n.t('update:oldRemoved'))
  }
  catch (error) {
    // Backup failed — restore what we moved and abort
    spinner.warn(`Backup failed: ${error}`)
    for (const dir of backedUp) {
      const backupPath = dir + BACKUP_SUFFIX
      try {
        if (await fs.pathExists(backupPath)) {
          await fs.move(backupPath, dir)
        }
      }
      catch { /* best-effort restore */ }
    }
    console.log(ansis.yellow('  旧版本文件已保留 / Old files preserved'))
    return
  }

  // Step 4: Install new workflows using the latest version via npx
  spinner = ora(i18n.t('update:installingNew')).start()

  let installSuccess = false
  try {
    await execAsync(`npx --yes ccg-workflow@latest init --force --skip-mcp --skip-prompt`, {
      timeout: 300000, // 5min — binary download from GitHub Release may be slow (especially in China)
      env: {
        ...process.env,
        CCG_UPDATE_MODE: 'true',
      },
    })

    // Step 5: Verify new installation actually produced files
    const commandsDir = join(installDir, 'commands', 'ccg')
    const hasCommands = await fs.pathExists(commandsDir)
      && (await fs.readdir(commandsDir)).some(f => f.endsWith('.md'))

    if (hasCommands) {
      installSuccess = true
      spinner.succeed(i18n.t('update:installDone'))

      // Read updated config to display installed commands
      const config = await readCcgConfig()
      if (config?.workflows?.installed) {
        console.log()
        console.log(ansis.cyan(i18n.t('update:installed', { count: config.workflows.installed.length })))
        for (const cmd of config.workflows.installed) {
          console.log(`  ${ansis.gray('•')} /ccg:${cmd}`)
        }
      }
    }
    else {
      // Subprocess reported success but no files were created
      spinner.fail(i18n.t('update:installFailed'))
      console.log(ansis.red('  Install subprocess completed but no command files were created'))
    }
  }
  catch (error) {
    spinner.fail(i18n.t('update:installFailed'))
    console.log(ansis.red(`${i18n.t('common:error')}: ${error}`))
  }

  // Step 6: Cleanup or rollback
  if (installSuccess) {
    // Success: remove backups
    for (const dir of backedUp) {
      try {
        await fs.remove(dir + BACKUP_SUFFIX)
      }
      catch { /* non-critical: stale backup files */ }
    }

    // Verify binary exists, is functional, AND version matches
    if (!(await verifyBinary(installDir))) {
      showBinaryDownloadWarning(join(installDir, 'bin'))
    }
    else {
      // Binary exists and runs, but check version
      const { verifyBinaryVersion } = await import('../utils/installer')
      const versionOk = await verifyBinaryVersion(installDir)
      if (!versionOk) {
        showBinaryDownloadWarning(join(installDir, 'bin'))
      }
    }
  }
  else {
    // Failure: restore from backups so user still has a working installation
    console.log()
    console.log(ansis.yellow.bold('  ⚠ 正在恢复旧版本文件 / Restoring old version files...'))
    let restored = 0
    for (const dir of backedUp) {
      const backupPath = dir + BACKUP_SUFFIX
      try {
        // Remove any partial install artifacts
        if (await fs.pathExists(dir)) {
          await fs.remove(dir)
        }
        if (await fs.pathExists(backupPath)) {
          await fs.move(backupPath, dir)
          restored++
        }
      }
      catch (restoreErr) {
        console.log(ansis.red(`  Failed to restore ${dir}: ${restoreErr}`))
      }
    }

    if (restored > 0) {
      console.log(ansis.green(`  ✓ 已恢复 ${restored} 个目录 / Restored ${restored} directories`))
      console.log(ansis.gray('    旧版命令仍可正常使用 / Old commands still work'))
    }
    console.log()
    console.log(ansis.yellow(i18n.t('update:manualRetry')))
    console.log(ansis.cyan('  npx ccg-workflow@latest'))
    return
  }

  console.log()
  console.log(ansis.green.bold(`✅ ${i18n.t('update:updateDone')}`))
  console.log()
  if (isNewVersion) {
    console.log(ansis.gray(i18n.t('update:upgradedFromTo', { from: fromVersion, to: toVersion })))
  }
  else {
    console.log(ansis.gray(i18n.t('update:reinstalled', { version: toVersion })))
  }
  console.log()
}
