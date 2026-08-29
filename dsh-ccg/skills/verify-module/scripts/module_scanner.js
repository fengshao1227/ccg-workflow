#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseCliArgs, buildReport, hasFatal } = require(path.join(__dirname, '..', '..', 'lib', 'shared.js'));

const REQUIRED_FILES = { 'README.md': '模块说明文档', 'DESIGN.md': '设计决策文档' };
const ALT_SRC_DIRS = ['src', 'lib', 'pkg', 'internal', 'cmd', 'app'];
const ALT_TEST_DIRS = ['tests', 'test', '__tests__', 'spec'];
const ROOT_SCRIPT_FILES = new Set([
  'install.sh', 'uninstall.sh', 'install.ps1',
  'uninstall.ps1', 'Dockerfile', 'Makefile'
]);
const CODE_EXTS = new Set(['.py', '.go', '.rs', '.ts', '.js', '.java', '.sh', '.ps1']);
const TEST_PATTERNS = ['test_', '_test.', '.test.', 'spec_', '_spec.'];

function scanStructure(p, depth = 3) {
  const s = { name: path.basename(p), type: 'dir', children: [] };
  if (depth <= 0) return s;
  try {
    for (const name of fs.readdirSync(p).sort()) {
      if (name.startsWith('.')) continue;
      const full = path.join(p, name);
      const stat = fs.statSync(full);
      if (stat.isFile()) s.children.push({ name, type: 'file', size: stat.size });
      else if (stat.isDirectory()) s.children.push(scanStructure(full, depth - 1));
    }
  } catch {}
  return s;
}

function rglob(dir, test) {
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (stat.isFile() && test(name)) return true;
        if (stat.isDirectory()) { if (rglob(full, test)) return true; }
      } catch {}
    }
  } catch {}
  return false;
}

function scanModule(target) {
  const modulePath = path.resolve(target);
  const issues = [];
  const add = (severity, message, p) => issues.push({ severity, message, path: p || null });

  if (!fs.existsSync(modulePath)) {
    add('error', `路径不存在: ${modulePath}`);
    return { modulePath, issues, structure: {} };
  }
  if (!fs.statSync(modulePath).isDirectory()) {
    add('error', `不是目录: ${modulePath}`);
    return { modulePath, issues, structure: {} };
  }

  const structure = scanStructure(modulePath);

  // required files
  for (const [file, desc] of Object.entries(REQUIRED_FILES)) {
    const fp = path.join(modulePath, file);
    if (!fs.existsSync(fp)) add('error', `缺少必需文档: ${file} (${desc})`, fp);
    else if (fs.statSync(fp).size < 50) add('warning', `文档内容过少: ${file} (< 50 bytes)`, fp);
  }

  // source dirs
  let srcFound = ALT_SRC_DIRS.some(d => {
    try { return fs.statSync(path.join(modulePath, d)).isDirectory(); }
    catch { return false; }
  });
  const entries = fs.readdirSync(modulePath);
  const rootCode = entries.filter(n => {
    try {
      const s = fs.statSync(path.join(modulePath, n));
      return s.isFile() && CODE_EXTS.has(path.extname(n));
    } catch { return false; }
  });
  const rootScript = entries.filter(n => {
    try {
      return fs.statSync(path.join(modulePath, n)).isFile()
        && ROOT_SCRIPT_FILES.has(n);
    } catch { return false; }
  });
  if (rootCode.length || rootScript.length) {
    srcFound = true;
    if (rootCode.length > 5) {
      add('warning', `根目录代码文件过多 (${rootCode.length}个)，建议整理到 src/ 目录`);
    }
  }
  if (!srcFound) add('warning', '未找到源码目录或代码文件');

  // test dirs
  let testFound = ALT_TEST_DIRS.some(d => {
    try { return fs.statSync(path.join(modulePath, d)).isDirectory(); }
    catch { return false; }
  });
  if (!testFound) testFound = rglob(modulePath, n => TEST_PATTERNS.some(p => n.includes(p)));
  if (!testFound) add('warning', '未找到测试目录或测试文件');

  // doc quality
  const readme = path.join(modulePath, 'README.md');
  if (fs.existsSync(readme)) {
    const c = fs.readFileSync(readme, 'utf-8');
    if (!c.includes('#')) add('warning', 'README.md 缺少标题', readme);
    const docKeys = ['usage', 'install', '使用', '安装', 'example', '示例'];
    if (!docKeys.some(k => c.toLowerCase().includes(k)))
      add('info', 'README.md 建议添加使用说明或示例', readme);
  }
  const design = path.join(modulePath, 'DESIGN.md');
  if (fs.existsSync(design)) {
    const c = fs.readFileSync(design, 'utf-8');
    const designKeys = ['决策', 'decision', '选择', 'choice', '权衡', 'trade'];
    if (!designKeys.some(k => c.toLowerCase().includes(k)))
      add('info', 'DESIGN.md 建议记录设计决策和权衡', design);
  }

  return { modulePath, issues, structure };
}

function formatStructure(s, indent = 0) {
  const pre = '  '.repeat(indent);
  if (s.type === 'dir') {
    const lines = [`${pre}\u{1F4C1} ${s.name}/`];
    for (const ch of (s.children || [])) lines.push(formatStructure(ch, indent + 1));
    return lines.join('\n');
  }
  const sz = (s.size || 0) < 1024 ? `(${s.size} B)` : `(${Math.floor(s.size / 1024)} KB)`;
  return `${pre}\u{1F4C4} ${s.name} ${sz}`;
}

function formatReport(r, verbose) {
  const errs = r.issues.filter(i => i.severity === 'error').length;
  const warns = r.issues.filter(i => i.severity === 'warning').length;
  const passed = !hasFatal(r.issues);
  const fields = {
    '模块路径': r.modulePath,
    '扫描结果': passed ? '\u2713 通过' : '\u2717 未通过',
    '统计': `错误: ${errs} | 警告: ${warns}`,
  };
  const issues = r.issues.map(i => ({
    severity: i.severity, message: i.message, path: i.path,
    file_path: i.path || '', line_number: null,
  }));
  let report = buildReport('模块完整性扫描报告', fields, issues, verbose);
  if (verbose && r.structure.name) {
    report += '\n' + '-'.repeat(40) + '\n目录结构:\n' + '-'.repeat(40) + '\n' + formatStructure(r.structure);
  }
  return report;
}

// CLI
const opts = parseCliArgs(process.argv);
const result = scanModule(opts.target);
const passed = !hasFatal(result.issues);

if (opts.json) {
  console.log(JSON.stringify({
    module_path: result.modulePath, passed,
    error_count: result.issues.filter(i => i.severity === 'error').length,
    warning_count: result.issues.filter(i => i.severity === 'warning').length,
    issues: result.issues
  }, null, 2));
} else {
  console.log(formatReport(result, opts.verbose));
}

process.exit(passed ? 0 : 1);
