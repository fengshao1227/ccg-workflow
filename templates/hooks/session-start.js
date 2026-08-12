#!/usr/bin/env node
// CCG Session Start Hook — SessionStart
// Injects full project context when session starts, clears, or compacts.

'use strict';

try {
  const path = require('path');
  const fs = require('fs');
  const {
    findProjectRoot, getActiveTask, readFileSafe,
    detectTechStack, getGitInfo, outputHook
  } = require('./task-utils.js');

  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findProjectRoot(cwd);

  if (!root) process.exit(0);

  const sections = [];

  // Project info
  const techStack = detectTechStack(root);
  const git = getGitInfo(root);
  sections.push(`<project>
Tech: ${techStack}
Branch: ${git.branch}
Dirty files: ${git.dirtyCount}
Root: ${root}
</project>`);

  // Model routing config — read the real CCG config written by `ccg init`.
  // A project-local .ccg/config.toml overrides the user-level one when present.
  const routing = (() => {
    const candidates = [
      path.join(root, '.ccg', 'config.toml'),
      path.join(require('os').homedir(), '.claude', '.ccg', 'config.toml'),
    ];
    for (const configPath of candidates) {
      if (!fs.existsSync(configPath)) continue;
      const raw = readFileSafe(configPath);
      if (!raw) continue;
      // [routing.frontend] / [routing.backend] each carry their own primary =
      const primaryOf = (section) => {
        const block = raw.split(`[routing.${section}]`)[1];
        if (!block) return null;
        const m = block.split('[')[0].match(/primary\s*=\s*"([\w-]+)"/);
        return m ? m[1] : null;
      };
      const frontend = primaryOf('frontend');
      const backend = primaryOf('backend');
      if (frontend || backend) {
        return `frontend=${frontend || 'antigravity'}, backend=${backend || 'codex'}`;
      }
    }
    return null;
  })();
  sections.push(`<models>${routing || 'Default (frontend=antigravity, backend=codex)'}</models>`);

  // Active task
  const task = getActiveTask(root);
  if (task) {
    const taskLines = [
      `<active-task>`,
      `Task: ${task.title || task.id} (${task.status})`,
      `Strategy: ${task.strategy}`,
      `Phase: ${task.currentPhase}`,
    ];

    if (task.gate) taskLines.push(`⛔ GATE: ${task.gate}`);
    taskLines.push(`Next: ${task.nextAction || 'Continue'}`);
    taskLines.push(`Dir: ${task.dir}`);

    // Check for plan/prd
    const planPath = path.join(task.dir, 'plan.md');
    const prdPath = path.join(task.dir, 'requirements.md');
    if (fs.existsSync(planPath)) taskLines.push(`Plan: ${planPath}`);
    if (fs.existsSync(prdPath)) taskLines.push(`PRD: ${prdPath}`);

    taskLines.push('</active-task>');
    sections.push(taskLines.join('\n'));
  } else {
    sections.push('<active-task>No active task. Use /ccg:go to start.</active-task>');
  }

  // Spec availability
  const specDir = path.join(root, '.ccg', 'spec');
  if (fs.existsSync(specDir)) {
    try {
      const specPaths = [];
      const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
          else if (entry.name.endsWith('.md')) specPaths.push(rel);
        }
      };
      walk(specDir, '');
      if (specPaths.length > 0) {
        sections.push(`<specs>\nAvailable specs in .ccg/spec/:\n${specPaths.map(p => `  - ${p}`).join('\n')}\n</specs>`);
      }
    } catch { /* silent */ }
  }

  // Available commands hint
  sections.push(`<commands>
Key commands: /ccg:go (smart entry), /ccg:commit, /ccg:review
All /ccg:* commands available. Use /ccg:go for intelligent routing.
</commands>`);

  const context = `<ccg-session>\n${sections.join('\n\n')}\n</ccg-session>`;
  outputHook('SessionStart', context);
} catch {
  process.exit(0);
}
