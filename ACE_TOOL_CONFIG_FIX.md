# ace-tool MCP 配置问题修复方案

## 问题描述

用户反馈 ace-tool 配置"安装不上去"，可能原因：

1. **当前配置**使用环境变量 (`env: { ACE_BASE_URL, ACE_TOKEN }`)，但 ace-tool 可能不支持
2. **用户期望配置**使用命令行参数 (`--base-url`, `--token`)，兼容性更好
3. **缺少关键标志**：
   - 缺少 `-y` 导致 npx 首次运行时需要手动确认
   - 没有预下载包，首次使用时等待时间长

## 对比分析

### 方案 A：环境变量模式（当前实现）

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "ace-tool@latest"],
  "env": {
    "ACE_BASE_URL": "https://api.augmentcode.com",
    "ACE_TOKEN": "your_token_here"
  }
}
```

**优点**：
- ✅ Token 不在命令行中暴露，更安全
- ✅ 使用 `-y` 自动确认
- ✅ 使用 `@latest` 确保最新版本

**缺点**：
- ❌ 如果 ace-tool 不支持环境变量，会失败
- ❌ 需要 ace-tool 包实现环境变量读取逻辑

### 方案 B：参数传递模式（用户反馈）

```json
{
  "type": "stdio",
  "command": "npx",
  "args": [
    "-y",
    "ace-tool@latest",
    "--base-url", "https://api.augmentcode.com",
    "--token", "your_token_here"
  ]
}
```

**优点**：
- ✅ 参数显式传递，兼容性最好
- ✅ 不依赖 ace-tool 的环境变量支持
- ✅ 使用 `-y` 和 `@latest` 确保自动安装

**缺点**：
- ⚠️ Token 存储在配置文件中（但 `~/.claude.json` 是私有文件，可接受）

### 方案 C：auggie 中继服务（实际使用）

```json
{
  "type": "stdio",
  "command": "auggie",
  "args": ["--mcp"],
  "env": {
    "AUGMENT_API_TOKEN": "ace_xxxxx",
    "AUGMENT_API_URL": "https://acemcp.heroman.wtf/relay/"
  }
}
```

**优点**：
- ✅ 使用第三方中继服务，绕过官方 API 限制
- ✅ 社区验证可用

**缺点**：
- ⚠️ 依赖第三方服务稳定性
- ⚠️ 需要全局安装 auggie

## 推荐修复方案

### 修改 1：添加配置模式选择

在 `install_ace_tool()` 函数中添加配置模式选择：

```python
def install_ace_tool(verbose: bool = False) -> Tuple[bool, str]:
    """
    安装并配置 ace-tool MCP
    返回 (成功, 消息)
    """
    print("\n  🔧 配置 ace-tool MCP...")

    # 检查 npm
    if not check_npm_installed():
        return False, "npm 未安装，请先安装 Node.js: https://nodejs.org/"

    # 提示用户选择配置模式
    print("\n  📋 请选择 ace-tool 配置方式：")
    print("     [1] 参数传递模式（推荐，兼容性好）")
    print("     [2] 环境变量模式（更安全，需要 ace-tool 支持）")
    print()

    while True:
        mode = input("  请输入选项 [1/2]: ").strip()
        if mode in ["1", "2"]:
            break
        print("  ❌ 无效选项，请输入 1 或 2")

    # 获取 base-url
    default_base_url = "https://api.augmentcode.com"
    base_url = input(f"  请输入 Base URL (直接回车使用默认值 {default_base_url}): ").strip()
    if not base_url:
        base_url = default_base_url

    # 获取 token
    token = input("  请输入 API Token: ").strip()
    if not token:
        print("  ⚠️  Token 为空，稍后可手动配置")
        token = ""

    # Claude Code CLI 的配置文件路径: ~/.claude.json
    config_file = Path.home() / ".claude.json"

    # 读取现有配置（重要：保留所有其他字段！）
    existing_config = {}
    if config_file.exists():
        try:
            with config_file.open("r", encoding="utf-8") as f:
                existing_config = json.load(f)
        except json.JSONDecodeError as e:
            print(f"  ⚠️  ~/.claude.json 解析失败: {e}")
            print("  ⚠️  请检查文件格式，跳过 MCP 配置")
            return False, f"~/.claude.json 解析失败: {e}"
        except Exception as e:
            print(f"  ⚠️  读取 ~/.claude.json 失败: {e}")
            return False, f"读取配置失败: {e}"

    # 确保 mcpServers 字段存在
    if "mcpServers" not in existing_config:
        existing_config["mcpServers"] = {}

    # 根据选择的模式生成配置
    if mode == "1":
        # 参数传递模式
        existing_config["mcpServers"]["ace-tool"] = {
            "type": "stdio",
            "command": "npx",
            "args": [
                "-y",  # 自动确认
                "ace-tool@latest",  # 最新版本
                "--base-url", base_url,
                "--token", token
            ]
        }
        config_desc = "参数传递模式"
    else:
        # 环境变量模式
        existing_config["mcpServers"]["ace-tool"] = {
            "type": "stdio",
            "command": "npx",
            "args": ["-y", "ace-tool@latest"],
            "env": {
                "ACE_BASE_URL": base_url,
                "ACE_TOKEN": token
            }
        }
        config_desc = "环境变量模式"

    # 写入配置（保留所有其他字段）
    try:
        with config_file.open("w", encoding="utf-8") as f:
            json.dump(existing_config, f, indent=2, ensure_ascii=False)
        if verbose:
            print(f"  📄 已写入配置: {config_file} ({config_desc})")
    except Exception as e:
        return False, f"写入配置失败: {e}"

    # 测试安装 + 预下载包
    print("\n  🚀 验证并预下载 ace-tool...")
    try:
        result = subprocess.run(
            ["npx", "-y", "ace-tool@latest", "--version"],
            capture_output=True,
            text=True,
            timeout=60
        )
        if result.returncode == 0:
            version = result.stdout.strip() or "unknown"
            if verbose:
                print(f"  ✅ ace-tool 版本: {version}")
            print(f"  ✅ ace-tool 包已缓存到本地")
        else:
            if verbose:
                print(f"  ⚠️  ace-tool 验证失败，但配置已保存")
    except subprocess.TimeoutExpired:
        print("  ⚠️  验证超时（网络问题？），但配置已保存")
        print("  💡 建议手动运行: npx -y ace-tool@latest --version")
    except Exception as e:
        if verbose:
            print(f"  ⚠️  验证异常: {e}")

    return True, f"ace-tool MCP 配置完成 ({config_desc}): {config_file}"
```

### 修改 2：更新用户提示文本

在 `choose_mcp_provider()` 中添加配置方式说明：

```python
print("  [1] ace-tool (推荐)")
print("      • 第三方封装版本，使用更简单")
print("      • ✅ 内置 Prompt 增强工具 (enhance_prompt)")
print("      • ✅ 代码库上下文检索 (search_context)")
print("      • 需要注册获取 API Token: https://augmentcode.com/")
print("      • ⚙️  支持参数传递和环境变量两种配置方式")
print()
```

### 修改 3：添加配置验证和故障排查

在 `install.py` 末尾添加配置验证：

```python
def verify_mcp_config(provider: str, verbose: bool = False) -> bool:
    """验证 MCP 配置是否正确"""
    config_file = Path.home() / ".claude.json"

    if not config_file.exists():
        print(f"  ⚠️  配置文件不存在: {config_file}")
        return False

    try:
        with config_file.open("r", encoding="utf-8") as f:
            config = json.load(f)

        if "mcpServers" not in config:
            print("  ⚠️  配置文件缺少 mcpServers 字段")
            return False

        if provider not in config["mcpServers"]:
            print(f"  ⚠️  配置文件缺少 {provider} 配置")
            return False

        server_config = config["mcpServers"][provider]

        # 检查必需字段
        if "type" not in server_config:
            print(f"  ❌ {provider} 配置缺少 type 字段（应为 'stdio'）")
            return False

        if "command" not in server_config:
            print(f"  ❌ {provider} 配置缺少 command 字段")
            return False

        if "args" not in server_config:
            print(f"  ❌ {provider} 配置缺少 args 字段")
            return False

        if verbose:
            print(f"  ✅ {provider} 配置格式正确")
            print(f"     type: {server_config['type']}")
            print(f"     command: {server_config['command']}")
            print(f"     args: {server_config['args']}")

        return True

    except Exception as e:
        print(f"  ❌ 验证配置失败: {e}")
        return False
```

## 预下载机制

为了避免用户首次使用时等待，添加预下载步骤：

```python
# 在安装完成后自动运行
print("\n  📦 预下载 ace-tool 包（避免首次使用等待）...")
try:
    result = subprocess.run(
        ["npx", "-y", "ace-tool@latest", "--version"],
        capture_output=True,
        text=True,
        timeout=60
    )
    if result.returncode == 0:
        print("  ✅ ace-tool 包已缓存到 ~/.npm/_npx/")
    else:
        print("  ⚠️  预下载失败（可能是网络问题），首次使用时会自动下载")
except subprocess.TimeoutExpired:
    print("  ⚠️  预下载超时（网络问题？），首次使用时会自动下载")
except Exception as e:
    print(f"  ⚠️  预下载异常: {e}")
```

## 故障排查文档

在 README 或安装输出中添加：

```markdown
## 常见问题

### ace-tool 安装失败

如果遇到 "ace-tool 安装失败" 错误：

1. **检查网络连接**：
   ```bash
   # 测试 npm registry 连接
   npm view ace-tool
   ```

2. **手动预下载**：
   ```bash
   # 提前下载 ace-tool 包
   npx -y ace-tool@latest --version
   ```

3. **切换配置模式**：
   - 如果**参数传递模式**失败，尝试**环境变量模式**
   - 如果两者都失败，考虑使用 **auggie 中继服务**

4. **验证配置**：
   ```bash
   # 检查配置文件
   cat ~/.claude.json | grep -A 10 "ace-tool"
   ```

   确保包含：
   - `"type": "stdio"`（必需）
   - `"command": "npx"`
   - `"args"` 中包含 `"-y"` 和 `"ace-tool@latest"`

5. **清除缓存**：
   ```bash
   # 清除 npx 缓存
   rm -rf ~/.npm/_npx
   npx -y ace-tool@latest --version
   ```
```

## 总结

**推荐实施步骤**：

1. ✅ 添加配置模式选择（参数 vs 环境变量）
2. ✅ 添加预下载步骤，避免首次使用等待
3. ✅ 添加配置验证函数
4. ✅ 更新文档，添加故障排查指南
5. ✅ 发布新版本到 npm

**兼容性策略**：

- **默认推荐**：参数传递模式（兼容性最好）
- **高级选项**：环境变量模式（更安全）
- **备选方案**：auggie 中继服务（社区验证）
