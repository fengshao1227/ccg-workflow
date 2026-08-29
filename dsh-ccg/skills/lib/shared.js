'use strict';

/**
 * 验证工具共享库
 * 消灭 verify-* 脚本间的重复代码
 */

// --- CLI 参数解析 ---

function parseCliArgs(argv, extraFlags) {
  const args = argv.slice(2);
  const result = { target: '.', verbose: false, json: false };
  if (extraFlags) Object.assign(result, extraFlags);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-v' || args[i] === '--verbose') result.verbose = true;
    else if (args[i] === '--json') result.json = true;
    else if (args[i] === '-h' || args[i] === '--help') { result.help = true; }
    else if (args[i] === '--mode' && args[i + 1]) { result.mode = args[++i]; }
    else if (args[i] === '--exclude') {
      result.exclude = result.exclude || [];
      while (i + 1 < args.length && !args[i + 1].startsWith('-')) result.exclude.push(args[++i]);
    }
    else if (!args[i].startsWith('-')) result.target = args[i];
  }
  return result;
}

// --- 报告格式化 ---

const SEP = '='.repeat(60);
const DASH = '-'.repeat(40);
const ICONS = {
  error: '\u2717', warning: '\u26A0', info: '\u2139',
  critical: '\u{1F534}', high: '\u{1F7E0}', medium: '\u{1F7E1}', low: '\u{1F535}'
};

function reportHeader(title, fields) {
  const lines = [SEP, title, SEP];
  for (const [k, v] of Object.entries(fields)) {
    lines.push(`\n${k}: ${v}`);
  }
  return lines;
}

function reportIssues(issues, verbose, groupBy) {
  if (!issues.length) return [];
  const lines = ['\n' + DASH, '问题列表:', DASH];

  if (groupBy) {
    const groups = {};
    for (const i of issues) (groups[i[groupBy]] || (groups[i[groupBy]] = [])).push(i);
    for (const cat of Object.keys(groups).sort()) {
      const items = groups[cat];
      lines.push(`\n【${cat}】(${items.length} 个)`);
      for (const i of items.slice(0, 10)) {
        lines.push(`  ${ICONS[i.severity] || '\u2139'} ` +
          `${i.file_path || ''}${i.line_number ? ':' + i.line_number : ''}`);
        lines.push(`    ${i.message}`);
        if (verbose && i.suggestion) lines.push(`    \u{1F4A1} ${i.suggestion}`);
        if (verbose && i.recommendation) lines.push(`    \u{1F4A1} ${i.recommendation}`);
      }
      if (items.length > 10) lines.push(`  ... 及其他 ${items.length - 10} 个问题`);
    }
  } else {
    for (const i of issues) {
      const icon = ICONS[i.severity] || '\u2139';
      lines.push(`  ${icon} [${i.severity.toUpperCase()}] ${i.message}`);
      if (i.path && verbose) lines.push(`    路径: ${i.path}`);
    }
  }
  return lines;
}

function reportFooter() { return ['\n' + SEP]; }

function buildReport(title, fields, issues, verbose, groupBy) {
  return [...reportHeader(title, fields), ...reportIssues(issues, verbose, groupBy), ...reportFooter()].join('\n');
}

// --- 通用计数 ---

function countBySeverity(issues, field) {
  field = field || 'severity';
  const counts = {};
  for (const i of issues) counts[i[field]] = (counts[i[field]] || 0) + 1;
  return counts;
}

function hasFatal(issues, fatalLevels) {
  fatalLevels = fatalLevels || ['error'];
  return issues.some(i => fatalLevels.includes(i.severity));
}

module.exports = {
  parseCliArgs, buildReport, reportHeader, reportIssues,
  reportFooter, countBySeverity, hasFatal, SEP, DASH, ICONS
};
