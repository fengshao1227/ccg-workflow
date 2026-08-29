#!/usr/bin/env node
/**
 * 文档生成器
 * 自动生成/更新 README.md 和 DESIGN.md 骨架
 */

const fs = require('fs');
const path = require('path');

// --- Utilities ---

function parseGitignore(modPath) {
  const patterns = [];
  const hardcoded = ['node_modules', '.git', '__pycache__', '.vscode', '.idea', 'dist', 'build', '.DS_Store'];

  // 硬编码常见排除
  hardcoded.forEach(p => patterns.push({ pattern: p, negate: false }));

  // 解析 .gitignore
  try {
    const gitignorePath = path.join(modPath, '.gitignore');
    const content = fs.readFileSync(gitignorePath, 'utf8');
    content.split('\n').forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#')) {
        const negate = line.startsWith('!');
        if (negate) line = line.slice(1);
        patterns.push({ pattern: line, negate });
      }
    });
  } catch {}

  return patterns;
}

function shouldIgnore(filePath, basePath, patterns) {
  const relPath = path.relative(basePath, filePath);
  const parts = relPath.split(path.sep);
  const name = path.basename(filePath);

  let ignored = false;
  for (const {pattern, negate} of patterns) {
    let match = false;
    const cleanPattern = pattern.replace(/\/$/, '');

    if (cleanPattern.includes('*')) {
      // 通配符 → 正则：先转义特殊字符，再将 \* 还原为 [^/]*
      const escaped = cleanPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      const regex = new RegExp('^' + escaped + '$');
      match = regex.test(name) || parts.some(p => regex.test(p));
    } else if (cleanPattern.includes('/')) {
      // 路径匹配：必须从头匹配或完整段匹配
      match = relPath === cleanPattern || relPath.startsWith(cleanPattern + '/');
    } else {
      // 目录/文件名精确匹配
      match = name === cleanPattern || parts.includes(cleanPattern);
    }

    if (match) ignored = !negate;
  }
  return ignored;
}

function rglob(dir, filter, basePath = dir) {
  const patterns = parseGitignore(basePath);
  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (shouldIgnore(full, basePath, patterns)) continue;

    if (entry.isDirectory()) {
      results.push(...rglob(full, filter, basePath));
    } else if (!filter || filter(entry.name, full)) {
      results.push(full);
    }
  }
  return results;
}

// --- Language Detection ---

const LANG_MAP = {
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.ts': 'TypeScript',
  '.js': 'JavaScript', '.java': 'Java', '.c': 'C', '.cpp': 'C++',
};

function detectLanguage(modPath) {
  const exts = {};
  try {
    for (const f of rglob(modPath)) {
      const ext = path.extname(f).toLowerCase();
      if (ext) exts[ext] = (exts[ext] || 0) + 1;
    }
  } catch { return 'Unknown'; }
  const codeExts = Object.entries(exts).filter(([k]) => k in LANG_MAP);
  if (codeExts.length) {
    const best = codeExts.reduce((a, b) => b[1] > a[1] ? b : a);
    return LANG_MAP[best[0]] || 'Unknown';
  }
  return 'Unknown';
}

// --- Python AST-lite extraction via regex ---

function analyzePythonModule(modPath) {
  const info = makeInfo(modPath, 'Python');
  const pyFiles = rglob(modPath, (name) => name.endsWith('.py'));
  info.files = pyFiles.map(f => path.relative(modPath, f));

  for (const pyFile of pyFiles) {
    const basename = path.basename(pyFile);
    if (basename.startsWith('test_') || basename.includes('_test')) continue;
    let content;
    try { content = fs.readFileSync(pyFile, 'utf-8'); } catch { continue; }

    // Module docstring (triple-quoted at top)
    if (!info.description) {
      const docM = content.match(/^(?:#[^\n]*\n)*\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
      if (docM) info.description = (docM[1] || docM[2]).split('\n')[0].trim();
    }

    const rel = path.relative(modPath, pyFile);

    // Functions
    for (const m of content.matchAll(/^def\s+([A-Za-z]\w*)\s*\(/gm)) {
      info.functions.push({ name: m[1], file: rel, doc: '' });
    }
    // Classes
    for (const m of content.matchAll(/^class\s+([A-Za-z]\w*)\s*[:(]/gm)) {
      info.classes.push({ name: m[1], file: rel, doc: '' });
    }

    // Entry points
    if (['main.py', '__main__.py', 'cli.py', 'app.py'].includes(basename)) {
      info.entry_points.push(rel);
    }
  }

  // Dependencies
  const reqPath = path.join(modPath, 'requirements.txt');
  try {
    const content = fs.readFileSync(reqPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        info.dependencies.push(trimmed.split(/[=><]/)[0]);
      }
    }
  } catch {}

  return info;
}

// --- Generic analysis (regex fallback) ---

const LANG_PATTERNS = {
  'Go':         [/^\s*func\s+(\w+)/,              /^\s*type\s+(\w+)\s+struct\b/],
  'Rust':       [/^\s*(?:pub\s+)?fn\s+(\w+)/,     /^\s*(?:pub\s+)?struct\s+(\w+)/],
  'TypeScript': [/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, /^\s*(?:export\s+)?class\s+(\w+)/],
  'JavaScript': [/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, /^\s*(?:export\s+)?class\s+(\w+)/],
  'Java':       [/^\s*(?:public|private|protected)?\s*(?:static\s+)?\w+\s+(\w+)\s*\(/,
                  /^\s*(?:public\s+)?class\s+(\w+)/],
  'C++':        [/^\s*(?:\w+\s+)+(\w+)\s*\([^;]*$/, /^\s*class\s+(\w+)/],
  'C':          [/^\s*(?:\w+\s+)+(\w+)\s*\([^;]*$/, null],
};

const CODE_EXTS = new Set(['.py', '.go', '.rs', '.ts', '.js', '.java', '.c', '.cpp']);

function analyzeModule(modPath) {
  const language = detectLanguage(modPath);
  if (language === 'Python') return analyzePythonModule(modPath);

  const info = makeInfo(modPath, language);
  const [funcPat, clsPat] = LANG_PATTERNS[language] || [null, null];

  try {
    for (const f of rglob(modPath)) {
      if (!CODE_EXTS.has(path.extname(f).toLowerCase())) continue;
      const rel = path.relative(modPath, f);
      info.files.push(rel);

      if (!funcPat && !clsPat) continue;
      let content;
      try { content = fs.readFileSync(f, 'utf-8'); } catch { continue; }
      for (const line of content.split('\n')) {
        if (funcPat) {
          const m = line.match(funcPat);
          if (m && !m[1].startsWith('_')) info.functions.push({ name: m[1], file: rel, doc: '' });
        }
        if (clsPat) {
          const m = line.match(clsPat);
          if (m && !m[1].startsWith('_')) info.classes.push({ name: m[1], file: rel, doc: '' });
        }
      }
    }
  } catch {}

  return info;
}

function makeInfo(modPath, language) {
  return {
    name: path.basename(modPath), path: modPath, description: '', language,
    files: [], functions: [], classes: [], dependencies: [], entry_points: [],
  };
}

// --- README Generation ---

function generateReadme(info) {
  const L = [];
  L.push(`# ${info.name}`, '');
  if (info.description) {
    L.push(info.description);
  } else {
    L.push('> 请在此描述模块的核心功能、解决的问题和主要用途。');
    L.push('> 例如：本模块提供 X 功能，用于解决 Y 问题。');
  }
  L.push('', '## 概述', '', '<!-- 描述这个模块是什么，解决什么问题 -->', '');
  L.push('## 特性', '', '<!-- 列出模块的主要特性，每项应包含简短描述 -->', '');
  L.push('- **特性1**: 请描述第一个主要特性');
  L.push('- **特性2**: 请描述第二个主要特性');
  L.push('- **特性3**: 请描述第三个主要特性', '');

  if (info.dependencies.length) {
    L.push('## 依赖', '', '```');
    info.dependencies.slice(0, 10).forEach(d => L.push(d));
    if (info.dependencies.length > 10) L.push(`# ... 及其他 ${info.dependencies.length - 10} 个依赖`);
    L.push('```', '');
  }

  L.push('## 使用方法', '');
  if (info.entry_points.length) {
    L.push('### 运行', '', '```bash');
    const cmds = {
      Python: `python -m ${info.name}`, Go: 'go run ./cmd/main.go',
      Rust: 'cargo run', TypeScript: 'npm start', JavaScript: 'npm start'
    };
    L.push(cmds[info.language] || `# 请根据 ${info.language} 项目结构添加运行命令`);
    L.push('```', '');
  }

  L.push('### 示例', '');
  const EXAMPLES = {
    Python: `from ${info.name.toLowerCase()} import main\n\n` +
      `# 初始化\nobj = main()\n\n# 执行操作\nresult = obj.process()\nprint(result)`,
    Go: `package main\n\nimport "${info.name.toLowerCase()}"\n\nfunc main() {\n` +
      `    // 初始化\n    obj := ${info.name.toLowerCase()}.New()\n` +
      `\n    // 执行操作\n    result := obj.Process()\n    println(result)\n}`,
    Rust: `use ${info.name.toLowerCase()}::*;\n\nfn main() {\n` +
      `    // 初始化\n    let obj = Object::new();\n\n` +
      `    // 执行操作\n    let result = obj.process();\n` +
      `    println!("{}", result);\n}`,
    TypeScript: `import { main } from "./${info.name.toLowerCase()}";\n\n` +
      `// 初始化\nconst obj = new main();\n\n` +
      `// 执行操作\nconst result = obj.process();\nconsole.log(result);`,
    JavaScript: `const { main } = require("./${info.name.toLowerCase()}");\n\n` +
      `// 初始化\nconst obj = new main();\n\n` +
      `// 执行操作\nconst result = obj.process();\nconsole.log(result);`,
  };
  if (EXAMPLES[info.language]) {
    L.push('```' + info.language.toLowerCase(), EXAMPLES[info.language], '```');
  } else {
    L.push('```' + info.language.toLowerCase());
    L.push(`<!-- 请根据 ${info.language} 语言特性提供使用示例 -->`);
    L.push(`<!-- 示例应包含：初始化、基本操作、结果处理 -->`);
    L.push('```');
  }
  L.push('');

  if (info.classes.length || info.functions.length) {
    L.push('## API 概览', '');
    if (info.classes.length) {
      L.push('### 类', '', '| 类名 | 描述 |', '|------|------|');
      info.classes.slice(0, 10).forEach(c => L.push(`| \`${c.name}\` | ${c.doc || '请补充此类的功能描述'} |`));
      L.push('');
    }
    if (info.functions.length) {
      L.push('### 函数', '', '| 函数 | 描述 |', '|------|------|');
      info.functions.slice(0, 10).forEach(f => L.push(`| \`${f.name}()\` | ${f.doc || '请补充此函数的功能描述'} |`));
      L.push('');
    }
  }

  L.push('## 目录结构', '', '```', `${info.name}/`);
  info.files.sort().slice(0, 15).forEach(f => L.push(`├── ${f}`));
  if (info.files.length > 15) L.push(`└── ... (${info.files.length - 15} more files)`);
  L.push('```', '');
  L.push('## 相关文档', '', '- [设计文档](DESIGN.md)', '');
  return L.join('\n');
}

// --- DESIGN Generation ---

function generateDesign(info) {
  const today = new Date().toISOString().slice(0, 10);
  const L = [];
  L.push(`# ${info.name} 设计文档`, '');
  L.push('## 设计概述', '', '### 目标', '', '<!-- 这个模块要解决什么问题？ -->', '');
  L.push('### 非目标', '', '<!-- 这个模块明确不做什么？ -->', '');
  L.push('## 架构设计', '', '### 整体架构', '', '```');
  L.push('┌─────────────────────────────────────┐');
  L.push('│  请在此绘制模块的整体架构图          │');
  L.push('│  包括主要组件、数据流、依赖关系      │');
  L.push('│  可使用 ASCII 图或 Mermaid 图表      │');
  L.push('└─────────────────────────────────────┘');
  L.push('```', '');
  L.push('### 核心组件', '');
  if (info.classes.length) {
    info.classes.slice(0, 5).forEach(c => L.push(`- **${c.name}**: ${c.doc || '请描述此组件的职责和功能'}`));
  } else {
    L.push('<!-- 列出模块的核心组件及其职责 -->');
    L.push('- **组件1**: 请描述第一个核心组件的职责');
    L.push('- **组件2**: 请描述第二个核心组件的职责');
    L.push('- **组件3**: 请描述第三个核心组件的职责');
  }
  L.push('');
  L.push('## 设计决策', '', '### 决策记录', '');
  L.push('| 日期 | 决策 | 理由 | 影响 |', '|------|------|------|------|');
  L.push(`| ${today} | 初始设计 | - | - |`, '');
  L.push('### 技术选型', '', `- **语言**: ${info.language}`);
  if (info.dependencies.length) L.push(`- **主要依赖**: ${info.dependencies.slice(0, 5).join(', ')}`);
  L.push('- **理由**: <!-- 请说明为什么选择这些技术栈，包括性能、可维护性、生态等考量 -->', '');
  L.push('## 权衡取舍', '', '### 已知限制', '');
  L.push('<!-- 列出模块的已知限制和约束条件 -->');
  L.push('- **限制1**: 请描述第一个已知限制及其原因');
  L.push('- **限制2**: 请描述第二个已知限制及其原因', '');
  L.push('### 技术债务', '');
  L.push('<!-- 记录有意引入的技术债务、临时方案及其原因 -->');
  L.push('- **债务1**: 描述 | 原因：性能优先 | 计划偿还时间：v2.0', '');
  L.push('## 安全考量', '', '### 威胁模型', '');
  L.push('<!-- 识别潜在的安全威胁，如认证、授权、数据泄露等 -->');
  L.push('- **威胁1**: 请描述潜在威胁及其影响');
  L.push('- **威胁2**: 请描述潜在威胁及其影响', '');
  L.push('### 安全措施', '');
  L.push('<!-- 列出已实施的安全措施，如输入验证、加密、访问控制等 -->');
  L.push('- **措施1**: 请描述已实施的安全措施');
  L.push('- **措施2**: 请描述已实施的安全措施', '');
  L.push('## 变更历史', '', `### ${today} - 初始版本`, '');
  L.push('**变更内容**: 创建模块', '', '**变更理由**: 初始开发', '');
  return L.join('\n');
}

// --- Core: generate_docs ---

function generateDocs(targetPath, force) {
  const modPath = path.resolve(targetPath);
  const result = { readme: null, design: null, status: 'success', messages: [] };

  if (!fs.existsSync(modPath)) {
    result.status = 'error';
    result.messages.push(`路径不存在: ${modPath}`);
    return result;
  }

  const info = analyzeModule(modPath);

  const readmePath = path.join(modPath, 'README.md');
  if (fs.existsSync(readmePath) && !force) {
    result.messages.push('README.md 已存在，跳过（使用 --force 覆盖）');
  } else {
    fs.writeFileSync(readmePath, generateReadme(info));
    result.readme = readmePath;
    result.messages.push('已生成 README.md');
  }

  const designPath = path.join(modPath, 'DESIGN.md');
  if (fs.existsSync(designPath) && !force) {
    result.messages.push('DESIGN.md 已存在，跳过（使用 --force 覆盖）');
  } else {
    fs.writeFileSync(designPath, generateDesign(info));
    result.design = designPath;
    result.messages.push('已生成 DESIGN.md');
  }

  return result;
}

// --- CLI ---

function parseArgs(argv) {
  const args = { path: '.', force: false, json: false, readmeOnly: false, designOnly: false };
  const rest = argv.slice(2);
  const positional = [];
  for (const a of rest) {
    if (a === '-f' || a === '--force') args.force = true;
    else if (a === '--json') args.json = true;
    else if (a === '--readme-only') args.readmeOnly = true;
    else if (a === '--design-only') args.designOnly = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: doc_generator.js [path] [-f|--force] [--json] [--readme-only] [--design-only]');
      process.exit(0);
    } else positional.push(a);
  }
  if (positional.length) args.path = positional[0];
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const result = generateDocs(args.path, args.force);

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log('='.repeat(50));
    console.log('文档生成报告');
    console.log('='.repeat(50));
    for (const msg of result.messages) {
      console.log(`  \u2022 ${msg}`);
    }
    console.log('='.repeat(50));
  }

  process.exitCode = result.status === 'success' ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  parseGitignore,
  shouldIgnore,
  rglob,
  detectLanguage,
  analyzeModule,
  generateReadme,
  generateDesign,
  generateDocs,
  parseArgs,
  main,
};
