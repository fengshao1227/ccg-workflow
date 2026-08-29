#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

// prettier-ignore
const SECURITY_RULES = [
  {
    id: 'SQL_INJECTION_DYNAMIC', category: '注入',
    severity: 'critical',
    pattern: new RegExp(
      '\\b(execute|query|raw)\\s*\\(\\s*' +
      '(f["\']|["\'][^"\'\\n]*["\']\\s*\\+\\s*|["\'][^"\'\\n]*["\']\\s*%\\s*[^,)]|["\'][^"\'\\n]*["\']' +
      '\\.format\\s*\\()', 'i'),
    extensions: ['.py', '.js', '.ts', '.go', '.java', '.php'],
    message: '可能存在 SQL 注入风险',
    recommendation: '使用参数化查询或 ORM',
  },
  {
    id: 'SQL_INJECTION_FSTRING', category: '注入',
    severity: 'critical',
    pattern: /cursor\.(execute|executemany)\s*\(\s*f["']/i,
    extensions: ['.py'],
    message: '使用 f-string 构造 SQL 语句',
    recommendation: '使用参数化查询',
  },
  {
    id: 'COMMAND_INJECTION', category: '注入',
    severity: 'critical',
    pattern: /(os\.system|os\.popen|subprocess\.call|subprocess\.run|subprocess\.Popen)\s*\([^)]*shell\s*=\s*True/i,
    extensions: ['.py'],
    message: '使用 shell=True 可能导致命令注入',
    recommendation: '避免 shell=True，使用列表参数',
  },
  {
    id: 'COMMAND_INJECTION_EVAL', category: '注入',
    severity: 'critical',
    pattern: /\b(eval|exec)\s*\([^)]*\b(input|request|argv|args)/i,
    extensions: ['.py'],
    message: 'eval/exec 执行用户输入',
    recommendation: '避免对用户输入使用 eval/exec',
  },
  {
    id: 'HARDCODED_SECRET', category: '敏感信息',
    severity: 'high',
    pattern: /(?<!\w)(password|passwd|pwd|secret|api_key|apikey|token|auth_token)\s*=\s*["'][^"']{8,}["']/i,
    excludePattern: /(example|placeholder|changeme|xxx|your[_-]|TODO|FIXME|<.*>|\*{3,})/i,
    extensions: [
      '.py', '.js', '.ts', '.go', '.java', '.php',
      '.rb', '.yaml', '.yml', '.json', '.env',
    ],
    message: '可能存在硬编码密钥/密码',
    recommendation: '使用环境变量或密钥管理服务',
  },
  {
    id: 'HARDCODED_AWS_KEY', category: '敏感信息',
    severity: 'critical',
    pattern: /AKIA[0-9A-Z]{16}/,
    extensions: ['*'],
    message: '发现 AWS Access Key',
    recommendation: '立即轮换密钥，使用 IAM 角色或环境变量',
  },
  {
    id: 'HARDCODED_PRIVATE_KEY', category: '敏感信息',
    severity: 'critical',
    pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    extensions: ['*'],
    message: '发现私钥',
    recommendation: '私钥不应提交到代码库',
  },
  {
    id: 'XSS_INNERHTML', category: 'XSS', severity: 'high',
    pattern: /\.innerHTML\s*=|\.outerHTML\s*=|document\.write\s*\(/i,
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.html'],
    message: '直接操作 innerHTML 可能导致 XSS',
    recommendation: '使用 textContent 或框架的安全绑定',
  },
  {
    id: 'XSS_DANGEROUSLY', category: 'XSS',
    severity: 'medium',
    pattern: /dangerouslySetInnerHTML/i,
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
    message: '使用 dangerouslySetInnerHTML',
    recommendation: '确保内容已经过净化处理',
  },
  {
    id: 'UNSAFE_PICKLE', category: '反序列化',
    severity: 'high',
    pattern: /pickle\.loads?\s*\(|yaml\.load\s*\([^)]*Loader\s*=\s*yaml\.Loader/i,
    extensions: ['.py'],
    message: '不安全的反序列化',
    recommendation: '使用 yaml.safe_load() 或验证数据来源',
  },
  {
    id: 'WEAK_CRYPTO_MD5', category: '加密',
    severity: 'medium',
    pattern: /\b(md5|MD5)\s*\(|hashlib\.md5\s*\(/i,
    extensions: ['.py', '.js', '.ts', '.go', '.java', '.php'],
    message: '使用弱哈希算法 MD5',
    recommendation: '使用 bcrypt/argon2 或 SHA-256+',
  },
  {
    id: 'WEAK_CRYPTO_SHA1', category: '加密',
    severity: 'low',
    pattern: /\b(sha1|SHA1)\s*\(|hashlib\.sha1\s*\(/i,
    extensions: ['.py', '.js', '.ts', '.go', '.java', '.php'],
    message: '使用弱哈希算法 SHA1',
    recommendation: '使用 SHA-256 或更强的算法',
  },
  {
    id: 'PATH_TRAVERSAL', category: '路径遍历',
    severity: 'high',
    pattern: new RegExp(
      '(open|read|write|Path|os\\.path\\.join)\\s*\\([^\\n]*' +
      '(request|input|argv|args|params|query|form|path_param)\\b', 'i'),
    extensions: ['.py'],
    message: '可能存在路径遍历风险',
    recommendation: '验证并规范化用户输入的路径',
  },
  {
    id: 'SSRF', category: 'SSRF', severity: 'high',
    pattern: new RegExp(
      '(requests\\.(get|post|put|delete|head)|urllib\\.request\\.urlopen)' +
      '\\s*\\([^\\n]*(request|input|argv|args|params|query|url)\\b', 'i'),
    extensions: ['.py'],
    message: '可能存在 SSRF 风险',
    recommendation: '验证并限制目标 URL',
  },
  {
    id: 'DEBUG_CODE', category: '调试', severity: 'low',
    pattern: /\b(console\.log|debugger|pdb\.set_trace|breakpoint)\s*\(/i,
    extensions: ['.py', '.js', '.ts'],
    message: '发现调试代码',
    recommendation: '生产环境移除调试代码',
  },
  {
    id: 'INSECURE_RANDOM', category: '加密',
    severity: 'medium',
    pattern: /\brandom\.(random|randint|choice|shuffle)\s*\(/i,
    extensions: ['.py'],
    message: '使用不安全的随机数生成器',
    recommendation: '安全场景使用 secrets 模块',
  },
  {
    id: 'XXE', category: 'XXE', severity: 'high',
    pattern: /etree\.(parse|fromstring)\s*\([^)]*\)|xml\.dom\.minidom\.parse/i,
    extensions: ['.py'],
    message: 'XML 解析可能存在 XXE 风险',
    recommendation: '禁用外部实体: XMLParser(resolve_entities=False)',
  },
];

const CODE_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.jsx', '.tsx', '.go',
  '.java', '.php', '.rb', '.yaml', '.yml', '.json',
]);
const DEFAULT_EXCLUDES = [
  '.git', 'node_modules', '__pycache__', '.venv', 'venv',
  'dist', 'build', '.tox', 'tests', 'test', '__tests__', 'spec',
];

function scanFile(filePath, rules) {
  const findings = [];
  const ext = path.extname(filePath).toLowerCase();
  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return findings; }
  const lines = content.split('\n');

  for (const rule of rules) {
    const exts = rule.extensions;
    if (!exts.includes('*') && !exts.includes(ext)) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = line.trim();
      const isComment = stripped.startsWith('#') ||
        stripped.startsWith('//') || stripped.startsWith('*') ||
        stripped.startsWith('/*');
      if (isComment) continue;
      const ruleDefRe = /^\s*(id|pattern|severity|message|recommendation|extensions|excludePattern|category)\s*:/;
      if (ruleDefRe.test(stripped)) continue;

      if (rule.pattern.test(line)) {
        rule.pattern.lastIndex = 0;
        if (rule.excludePattern && rule.excludePattern.test(line)) {
          rule.excludePattern.lastIndex = 0; continue;
        }
        findings.push({
          severity: rule.severity, category: rule.category,
          message: rule.message, file_path: filePath,
          line_number: i + 1,
          line_content: stripped.slice(0, 100),
          recommendation: rule.recommendation,
        });
      }
    }
  }
  return findings;
}

function walkDir(dir, excludeDirs) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    if (excludeDirs.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { results.push(...walkDir(full, excludeDirs)); }
    else if (entry.isFile()) {
      if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(full);
      }
    }
  }
  return results;
}

function scanDirectory(scanPath, excludeDirs) {
  const resolved = path.resolve(scanPath);
  const findings = [];
  const files = walkDir(resolved, excludeDirs);
  for (const f of files) findings.push(...scanFile(f, SECURITY_RULES));
  findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  const passed = !findings.some(
    f => f.severity === 'critical' || f.severity === 'high'
  );
  return { scan_path: resolved, files_scanned: files.length, passed, findings };
}

const { buildReport, countBySeverity, parseCliArgs } = require(
  path.join(__dirname, '..', '..', 'lib', 'shared.js')
);

function formatReport(result, verbose) {
  const counts = countBySeverity(result.findings);
  const fields = {
    '扫描路径': result.scan_path,
    '扫描文件': result.files_scanned,
    '扫描结果': result.passed ? '\u2713 通过' : '\u2717 发现高危问题',
    '统计': `严重: ${counts.critical || 0} | 高危: ${counts.high || 0}` +
      ` | 中危: ${counts.medium || 0} | 低危: ${counts.low || 0}`,
  };
  return buildReport(
    '代码安全扫描报告', fields, result.findings, verbose, 'category'
  );
}


function main() {
  const opts = parseCliArgs(process.argv, { exclude: [] });
  if (opts.help) {
    console.log('Usage: security_scanner.js [path] [-v] [--json] [--exclude dir1 dir2]');
    process.exit(0);
  }
  const scanPath = opts.target;
  const verbose = opts.verbose;
  const jsonOut = opts.json;
  const excludeDirs = [...DEFAULT_EXCLUDES, ...opts.exclude];
  const result = scanDirectory(scanPath, excludeDirs);

  if (jsonOut) {
    console.log(JSON.stringify({
      scan_path: result.scan_path,
      files_scanned: result.files_scanned,
      passed: result.passed,
      counts: countBySeverity(result.findings),
      findings: result.findings,
    }, null, 2));
  } else {
    console.log(formatReport(result, verbose));
  }
  process.exit(result.passed ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { scanFile, SECURITY_RULES };
