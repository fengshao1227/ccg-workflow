---
name: verify-quality
description: 代码质量校验关卡。检测复杂度、重复代码、命名规范、函数长度等质量指标。当用户提到代码质量、复杂度检查、代码异味、重构建议、lint检查、代码规范时使用。在复杂模块、重构完成时自动触发。
license: MIT
compatibility: node>=18
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash, Read, Glob
argument-hint: <扫描路径>
---

# ⚖ 校验关卡 · 代码质量


## 核心原则

```
代码质量 = 可读性 + 可维护性 + 可测试性
劣质代码是技术债，技术债是道基裂痕
复杂度是 bug 的温床
```

## 自动检查

运行质量检查脚本（跨平台）：

```bash
# 在 skill 目录下运行
node scripts/quality_checker.js <扫描路径>
node scripts/quality_checker.js <扫描路径> -v      # 详细模式
node scripts/quality_checker.js <扫描路径> --json  # JSON 输出
```

## 检测指标

### 复杂度指标

| 指标 | 阈值 | 超标后果 |
|------|------|----------|
| **圈复杂度** | ≤ 10 | 🟠 警告，建议拆分 |
| **函数长度** | ≤ 50 行 | 🟠 警告，建议拆分 |
| **文件长度** | ≤ 500 行 | 🟡 提示，考虑拆分 |
| **参数数量** | ≤ 5 | 🟠 警告，考虑封装 |
| **嵌套深度** | ≤ 4 | 🟠 警告，建议重构 |
| **行长度** | ≤ 120 | 🔵 提示 |

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| **类名** | PascalCase | `UserService`, `HttpClient` |
| **函数名** | snake_case | `get_user`, `process_data` |
| **常量** | UPPER_SNAKE | `MAX_RETRY`, `DEFAULT_TIMEOUT` |
| **变量** | snake_case | `user_id`, `total_count` |

### 代码异味

| 异味 | 说明 | 严重度 |
|------|------|--------|
| 重复代码 | 相似代码块 > 10 行 | 🟠 High |
| 过长参数列表 | 参数 > 5 个 | 🟡 Medium |
| 魔法数字 | 未命名的常量 | 🟡 Medium |
| 死代码 | 未使用的函数/变量 | 🔵 Low |
| 注释代码 | 被注释的代码块 | 🔵 Low |

## 自动触发时机

| 场景 | 触发条件 |
|------|----------|
| 复杂模块 | 代码行数 > 200 |
| 重构完成 | 重构任务完成时 |
| 代码审查 | PR/MR 审查时 |
| 提交前 | 代码提交前检查 |

## 校验流程

```
1. 扫描代码文件
2. 计算复杂度指标
3. 检测代码异味
4. 验证命名规范
5. 输出质量校验报告
```

## 校验报告格式

```
## 代码质量校验报告

✓ 通过 | ✗ 未通过

### 复杂度指标
- 平均函数复杂度: N
- 超标函数数: N
- 最大文件行数: N

### 代码异味
- 🟠 High: N
- 🟡 Medium: N
- 🔵 Low: N

### 问题清单

| 文件 | 行号 | 类型 | 严重度 | 描述 |
|------|------|------|--------|------|
| ... | ... | ... | ... | ... |

### 结论
可交付 / 需重构后交付
```

## 重构建议

### 降低复杂度

```python
# 🔴 高复杂度 - 道基不稳
def process(data):
    if condition1:
        if condition2:
            if condition3:
                # 深层嵌套
                pass

# ✅ 低复杂度 - 道基稳固
def process(data):
    if not condition1:
        return
    if not condition2:
        return
    if not condition3:
        return
    # 主逻辑
```

### 消除重复

```python
# 🔴 重复代码 - 异端
def func1():
    # 10行相同逻辑
    pass

def func2():
    # 10行相同逻辑
    pass

# ✅ 提取公共函数 - 正道
def common_logic():
    # 公共逻辑
    pass

def func1():
    common_logic()

def func2():
    common_logic()
```

---
