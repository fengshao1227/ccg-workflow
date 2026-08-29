---
name: verify-security
description: 安全校验关卡。自动扫描代码安全漏洞，检测危险模式，确保安全决策有文档记录。当用户提到安全扫描、漏洞检测、安全审计、代码安全、OWASP、注入检测、敏感信息泄露时使用。在新建模块、安全相关变更、攻防任务、重构完成时自动触发。
license: MIT
compatibility: node>=18
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash, Read, Grep
argument-hint: <扫描路径>
---

# ⚖ 校验关卡 · 安全校验


## 核心原则

```
安全即道基，破则劫败
安全决策必须可追溯
Critical/High 问题必须修复后才能交付
```

## 自动扫描

运行安全扫描脚本（跨平台）：

```bash
# 在 skill 目录下运行
node scripts/security_scanner.js <扫描路径>
node scripts/security_scanner.js <扫描路径> -v           # 详细模式
node scripts/security_scanner.js <扫描路径> --json       # JSON 输出
node scripts/security_scanner.js <扫描路径> --exclude vendor  # 排除目录
```

## 检测范围

### 自动检测的漏洞类型

| 类别 | 检测项 | 严重度 |
|------|--------|--------|
| **注入** | SQL 注入、命令注入、代码注入 | 🔴 Critical |
| **敏感信息** | 硬编码密钥、AWS Key、私钥 | 🔴 Critical |
| **XSS** | innerHTML、dangerouslySetInnerHTML | 🟠 High |
| **反序列化** | pickle.loads、yaml.load | 🟠 High |
| **路径遍历** | 未验证的文件路径操作 | 🟠 High |
| **SSRF** | 未验证的 URL 请求 | 🟠 High |
| **XXE** | 不安全的 XML 解析 | 🟠 High |
| **弱加密** | MD5、SHA1 用于安全场景 | 🟡 Medium |
| **不安全随机** | random 模块用于安全场景 | 🟡 Medium |
| **调试代码** | console.log、print、debugger | 🔵 Low |

### 文档层面检查

安全相关代码必须在 DESIGN.md 中记录：

- [ ] **威胁模型** — 防御哪些攻击
- [ ] **安全决策** — 为何选择此方案
- [ ] **安全边界** — 信任边界在哪里
- [ ] **已知风险** — 接受了哪些风险

## 危险模式速查

### Python
```python
# 🔴 危险 - 触犯道基
eval(), exec(), os.system()
subprocess(..., shell=True)
pickle.loads(), yaml.load()
cursor.execute(f"SELECT * FROM t WHERE id = {id}")

# ✅ 安全替代 - 道基稳固
ast.literal_eval()
subprocess([...], shell=False)
yaml.safe_load()
cursor.execute("SELECT * FROM t WHERE id = %s", (id,))
```

### JavaScript
```javascript
// 🔴 危险 - 触犯道基
eval(), innerHTML, document.write()
new Function(userInput)

// ✅ 安全替代 - 道基稳固
JSON.parse(), textContent
模板引擎自动转义
```

### Go
```go
// 🔴 危险 - 触犯道基
exec.Command("sh", "-c", userInput)
template.HTML(userInput)

// ✅ 安全替代 - 道基稳固
exec.Command("cmd", args...)
html/template 自动转义
```

## 校验流程

```
1. 运行 security_scanner.js 自动扫描
2. 分析扫描结果，按严重度排序
3. 检查安全决策是否有文档记录
4. 输出安全校验报告
5. Critical/High 问题必须修复后才能交付
```

## 自动触发时机

| 场景 | 触发条件 |
|------|----------|
| 新建模块 | 模块创建完成时 |
| 安全相关变更 | 涉及认证、授权、加密、输入处理 |
| 攻防任务 | 红队/蓝队任务完成时 |
| 重构完成 | 重构任务完成时 |
| 提交前 | 代码提交前检查 |

## 校验报告格式

```
## 安全校验报告

✓ 通过 | ✗ 未通过

- 🔴 Critical: N
- 🟠 High: N
- 🟡 Medium: N
- 🔵 Low: N

### 发现问题

| 文件 | 行号 | 类型 | 严重度 | 描述 |
|------|------|------|--------|------|
| ... | ... | ... | ... | ... |

### 结论

可交付 / 需修复后交付
```

---
