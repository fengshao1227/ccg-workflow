#!/usr/bin/env python3
"""
Skills-v2 安装器
Claude Code 多模型协作系统

用法:
    python install.py                    # 安装核心模块（默认）
    python install.py --module core      # 安装核心模块
    python install.py --module all       # 安装所有启用的模块
    python install.py --list-modules     # 列出可用模块
    python install.py --install-dir ~/.claude  # 自定义安装目录
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_INSTALL_DIR = "~/.claude"
DEFAULT_CONFIG = "config.json"

# 检测操作系统
IS_WINDOWS = platform.system() == "Windows"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Skills-v2 安装器 - 多模型协作系统"
    )
    parser.add_argument(
        "--install-dir",
        default=DEFAULT_INSTALL_DIR,
        help=f"安装目录（默认: {DEFAULT_INSTALL_DIR}）",
    )
    parser.add_argument(
        "--module",
        default="core",
        help="要安装的模块: 'core', 'codex-only', 'gemini-only', 或 'all'",
    )
    parser.add_argument(
        "--config",
        default=DEFAULT_CONFIG,
        help="配置文件路径",
    )
    parser.add_argument(
        "--list-modules",
        action="store_true",
        help="列出可用模块并退出",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="强制覆盖现有文件",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="显示详细输出",
    )
    return parser.parse_args()


def load_config(config_path: str) -> Dict[str, Any]:
    path = Path(config_path)
    if not path.exists():
        print(f"错误: 配置文件未找到: {config_path}", file=sys.stderr)
        sys.exit(1)

    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def list_modules(config: Dict[str, Any]) -> None:
    print("\n📦 可用模块:\n")
    modules = config.get("modules", {})
    for name, module in modules.items():
        status = "✅ 已启用" if module.get("enabled", False) else "⚪ 未启用"
        desc = module.get("description", "无描述")
        print(f"  {name:15} {status:12} - {desc}")
    print()


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def copy_file(src: Path, dst: Path, verbose: bool = False) -> None:
    ensure_dir(dst.parent)
    shutil.copy2(src, dst)
    if verbose:
        print(f"  📄 已复制: {src.name} -> {dst}")


def copy_dir(src: Path, dst: Path, verbose: bool = False) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    if verbose:
        print(f"  📁 已复制目录: {src.name} -> {dst}")


def merge_dir(src: Path, dst: Path, verbose: bool = False) -> None:
    ensure_dir(dst)
    for item in src.iterdir():
        dst_item = dst / item.name
        if item.is_file():
            shutil.copy2(item, dst_item)
            if verbose:
                print(f"  📄 已合并: {item.name}")
        elif item.is_dir():
            if dst_item.exists():
                merge_dir(item, dst_item, verbose)
            else:
                shutil.copytree(item, dst_item)
                if verbose:
                    print(f"  📁 已合并目录: {item.name}")


def check_go_installed() -> bool:
    try:
        result = subprocess.run(
            ["go", "version"],
            capture_output=True,
            text=True
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False


def check_npm_installed() -> bool:
    """检查 npm 是否已安装"""
    try:
        result = subprocess.run(
            ["npm", "--version"],
            capture_output=True,
            text=True
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False


def choose_mcp_provider() -> Optional[str]:
    """
    让用户选择 MCP 提供商
    返回: "ace-tool" | "auggie" | None (跳过)
    """
    print("\n" + "=" * 60)
    print("🔧 MCP 代码检索工具选择")
    print("=" * 60)
    print("\n请选择要安装的 MCP 工具：\n")

    print("  [1] ace-tool (推荐)")
    print("      • 第三方封装版本，使用更简单")
    print("      • ✅ 内置 Prompt 增强工具 (enhance_prompt)")
    print("      • ✅ 代码库上下文检索 (search_context)")
    print("      • 需要注册获取 API Token: https://augmentcode.com/")
    print()

    print("  [2] auggie (官方原版)")
    print("      • Augment 官方 MCP (@augmentcode/auggie)")
    print("      • ⚠️  不包含 Prompt 增强工具")
    print("      • ✅ 代码库上下文检索 (codebase-retrieval)")
    print("      • 📖 配置说明: https://linux.do/t/topic/1280612")
    print()

    print("  [0] 跳过 MCP 安装 (稍后手动配置)")
    print()

    while True:
        choice = input("请输入选项 [1/2/0]: ").strip()
        if choice == "1":
            return "ace-tool"
        elif choice == "2":
            return "auggie"
        elif choice == "0":
            print("  ℹ️  跳过 MCP 安装，稍后可手动配置")
            return None
        else:
            print("  ❌ 无效选项，请输入 1、2 或 0")


def install_ace_tool(verbose: bool = False) -> Tuple[bool, str]:
    """
    安装并配置 ace-tool MCP
    返回 (成功, 消息)

    重要: Claude Code CLI 从 ~/.claude.json 读取 MCP 配置
          NOT ~/.mcp.json (那是给 Claude Desktop 的)
          NOT ~/Library/Application Support/Claude/ (那也是 Claude Desktop)
    """
    print("\n  🔧 配置 ace-tool MCP...")

    # 检查 npm
    if not check_npm_installed():
        return False, "npm 未安装，请先安装 Node.js: https://nodejs.org/"

    # 提示用户配置
    print("\n  📋 ace-tool 需要配置 API 访问信息:")
    print("     获取方式: 访问 https://augmentcode.com/ 注册并获取 API Token")
    print()

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

    # 添加或更新 ace-tool 配置（直接将 base-url 与 token 写入 args）
    existing_config["mcpServers"]["ace-tool"] = {
        "type": "stdio",
        "command": "npx",
        "args": [
            "-y",
            "ace-tool@latest",
            "--base-url",
            base_url,
            "--token",
            token,
        ],
    }

    # 写入配置（保留所有其他字段）
    try:
        with config_file.open("w", encoding="utf-8") as f:
            json.dump(existing_config, f, indent=2, ensure_ascii=False)
        if verbose:
            print(f"  📄 已写入配置: {config_file}")
    except Exception as e:
        return False, f"写入配置失败: {e}"

    # 测试安装
    print("\n  🚀 验证 ace-tool 安装...")
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
        else:
            if verbose:
                print(f"  ⚠️  ace-tool 验证失败，但配置已保存")
    except subprocess.TimeoutExpired:
        print("  ⚠️  验证超时，但配置已保存")
    except Exception as e:
        if verbose:
            print(f"  ⚠️  验证异常: {e}")

    return True, f"ace-tool MCP 配置完成: {config_file}"


def install_auggie(verbose: bool = False) -> Tuple[bool, str]:
    """
    安装并配置 auggie MCP (Augment 官方版本)
    返回 (成功, 消息)
    """
    print("\n  🔧 配置 auggie MCP...")

    # 检查 npm
    if not check_npm_installed():
        return False, "npm 未安装，请先安装 Node.js: https://nodejs.org/"

    # 提示用户配置说明
    print("\n  📖 auggie 配置说明:")
    print("     详细配置教程: https://linux.do/t/topic/1280612")
    print("     获取 API Token: 访问 https://augmentcode.com/ 注册")
    print()
    print("  ⚠️  注意: auggie 不包含 Prompt 增强工具")
    print("     如需使用 Prompt 增强，请查看上述教程手动配置")
    print()

    # 安装 auggie
    print("  🚀 安装 @augmentcode/auggie@prerelease...")
    try:
        result = subprocess.run(
            ["npm", "install", "-g", "@augmentcode/auggie@prerelease"],
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode != 0:
            return False, f"npm 安装失败: {result.stderr}"
        if verbose:
            print(f"  ✅ auggie 安装成功")
    except subprocess.TimeoutExpired:
        return False, "安装超时"
    except Exception as e:
        return False, f"安装异常: {e}"

    # 获取 token
    print("\n  请输入 API Token (从 https://augmentcode.com/ 获取):")
    token = input("  Token: ").strip()
    if not token:
        print("  ⚠️  Token 为空，稍后可手动配置")
        token = ""

    # Claude Code CLI 的配置文件路径: ~/.claude.json
    config_file = Path.home() / ".claude.json"

    # 读取现有配置
    existing_config = {}
    if config_file.exists():
        try:
            with config_file.open("r", encoding="utf-8") as f:
                existing_config = json.load(f)
        except json.JSONDecodeError as e:
            print(f"  ⚠️  ~/.claude.json 解析失败: {e}")
            return False, f"~/.claude.json 解析失败: {e}"
        except Exception as e:
            print(f"  ⚠️  读取 ~/.claude.json 失败: {e}")
            return False, f"读取配置失败: {e}"

    # 确保 mcpServers 字段存在
    if "mcpServers" not in existing_config:
        existing_config["mcpServers"] = {}

    # 添加或更新 auggie 配置
    existing_config["mcpServers"]["auggie-mcp"] = {
        "type": "stdio",
        "command": "auggie",
        "env": {
            "AUGMENT_API_KEY": token
        }
    }

    # 写入配置
    try:
        with config_file.open("w", encoding="utf-8") as f:
            json.dump(existing_config, f, indent=2, ensure_ascii=False)
        if verbose:
            print(f"  📄 已写入配置: {config_file}")
    except Exception as e:
        return False, f"写入配置失败: {e}"

    print("\n  ✅ auggie MCP 配置完成")
    print(f"  📖 详细配置说明: https://linux.do/t/topic/1280612")

    return True, f"auggie MCP 配置完成: {config_file}"


def create_ccg_config(mcp_provider: str, install_dir: Path, verbose: bool = False) -> bool:
    """
    创建 ~/.ccg/config.toml 配置文件

    Args:
        mcp_provider: "ace-tool" | "auggie" | "none"
        install_dir: 安装目录 (通常是 ~/.claude)
        verbose: 详细输出

    Returns:
        成功与否
    """
    ccg_dir = Path.home() / ".ccg"
    config_file = ccg_dir / "config.toml"

    # 确保目录存在
    ensure_dir(ccg_dir)

    # 生成配置内容
    config_content = f"""# CCG (Claude + Codex + Gemini) 多模型协作系统配置
# 生成时间: {subprocess.run(['date'], capture_output=True, text=True).stdout.strip()}

[mcp]
# MCP 提供商: ace-tool | auggie | none
provider = "{mcp_provider}"

[mcp.tools]
# 工具名称映射（命令模板会自动读取此配置）
# 代码检索工具
code_search_ace = "mcp__ace-tool__search_context"
code_search_auggie = "mcp__auggie-mcp__codebase-retrieval"

# Prompt 增强工具
prompt_enhance_ace = "mcp__ace-tool__enhance_prompt"
prompt_enhance_auggie = ""  # auggie 不支持

# 参数名称映射
query_param_ace = "query"
query_param_auggie = "information_request"

[mcp.ace-tool]
# ace-tool (第三方封装) 功能说明
features = ["Prompt 增强", "代码检索"]
setup_url = "https://augmentcode.com/"

[mcp.auggie]
# auggie (官方原版) 功能说明
features = ["代码检索"]
setup_url = "https://linux.do/t/topic/1280612"
note = "auggie 不包含 Prompt 增强工具，需手动配置"

[routing]
# 路由模式: smart | parallel | sequential
mode = "smart"

[routing.frontend]
# 前端任务路由配置
models = ["gemini", "codex"]
primary = "gemini"
strategy = "parallel"

[routing.backend]
# 后端任务路由配置
models = ["codex", "gemini"]
primary = "codex"
strategy = "parallel"

[routing.review]
# 代码审查路由配置
models = ["codex", "gemini"]
strategy = "parallel"
"""

    try:
        with config_file.open("w", encoding="utf-8") as f:
            f.write(config_content)
        if verbose:
            print(f"  📄 已创建配置: {config_file}")
        return True
    except Exception as e:
        print(f"  ⚠️  创建配置失败: {e}", file=sys.stderr)
        return False


def get_prebuilt_binary(source_dir: Path) -> Optional[Path]:
    """查找预编译的二进制文件"""
    system = platform.system().lower()
    machine = platform.machine().lower()

    # 映射架构名称
    arch_map = {
        "x86_64": "amd64",
        "amd64": "amd64",
        "arm64": "arm64",
        "aarch64": "arm64",
    }
    arch = arch_map.get(machine, machine)

    # 映射系统名称
    if system == "darwin":
        binary_name = f"codeagent-wrapper-darwin-{arch}"
    elif system == "linux":
        binary_name = f"codeagent-wrapper-linux-{arch}"
    elif system == "windows":
        binary_name = f"codeagent-wrapper-windows-{arch}.exe"
    else:
        return None

    binary_path = source_dir / "bin" / binary_name
    if binary_path.exists():
        return binary_path
    return None


def build_go_binary(
    source_dir: Path,
    binary_name: str,
    verbose: bool = False
) -> Tuple[bool, Optional[Path]]:
    if not check_go_installed():
        print("  ❌ Go 未安装，请先安装 Go:", file=sys.stderr)
        print("     https://go.dev/doc/install", file=sys.stderr)
        return False, None

    # Windows 添加 .exe 扩展名
    if IS_WINDOWS and not binary_name.endswith(".exe"):
        output_name = binary_name + ".exe"
    else:
        output_name = binary_name

    if verbose:
        print(f"  🔨 正在编译 {output_name}...")

    try:
        result = subprocess.run(
            ["go", "build", "-o", output_name, "."],
            cwd=source_dir,
            capture_output=True,
            text=True
        )

        if result.returncode != 0:
            print(f"  ❌ 编译失败: {result.stderr}", file=sys.stderr)
            return False, None

        binary_path = source_dir / output_name
        if not binary_path.exists():
            print(f"  ❌ 编译后未找到二进制文件", file=sys.stderr)
            return False, None

        if verbose:
            print(f"  ✅ 编译完成: {output_name}")

        return True, binary_path

    except Exception as e:
        print(f"  ❌ 编译错误: {e}", file=sys.stderr)
        return False, None


def install_binary_to_path(
    binary_path: Path,
    verbose: bool = False,
    target_name: Optional[str] = None
) -> bool:
    # 确定目标文件名
    if target_name:
        if IS_WINDOWS and not target_name.endswith(".exe"):
            final_name = target_name + ".exe"
        else:
            final_name = target_name
    else:
        final_name = binary_path.name

    # 根据系统选择安装目录
    if IS_WINDOWS:
        install_dirs = [
            Path.home() / ".local" / "bin",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "codeagent-wrapper",
            Path.home() / "bin",
        ]
    else:
        install_dirs = [
            Path.home() / ".local" / "bin",
            Path("/usr/local/bin"),
        ]

    for install_dir in install_dirs:
        if install_dir.exists() or install_dir == install_dirs[0]:
            try:
                ensure_dir(install_dir)
                target = install_dir / final_name
                shutil.copy2(binary_path, target)

                # 设置执行权限（仅 Unix）
                if not IS_WINDOWS:
                    os.chmod(target, 0o755)

                if verbose:
                    print(f"  📦 已安装到: {target}")

                # 检查安装目录是否在 PATH 中
                path_dirs = os.environ.get("PATH", "").split(os.pathsep)
                if str(install_dir) not in path_dirs:
                    print(f"  ⚠️  注意: {install_dir} 可能不在 PATH 中")
                    if IS_WINDOWS:
                        print(f"     添加到 PATH: setx PATH \"%PATH%;{install_dir}\"")
                    else:
                        print(f"     添加到 PATH: export PATH=\"{install_dir}:$PATH\"")

                return True
            except PermissionError:
                if verbose:
                    print(f"  ⚠️  {install_dir} 权限不足，尝试下一个...")
                continue
            except Exception as e:
                if verbose:
                    print(f"  ⚠️  安装到 {install_dir} 失败: {e}")
                continue

    print("  ❌ 无法安装二进制文件到 PATH", file=sys.stderr)
    if IS_WINDOWS:
        print(f"     手动安装: 复制 {binary_path} 到 PATH 中的目录", file=sys.stderr)
    else:
        print(f"     手动安装: sudo cp {binary_path} /usr/local/bin/", file=sys.stderr)
    return False


def execute_operation(
    op: Dict[str, Any],
    source_dir: Path,
    install_dir: Path,
    verbose: bool = False
) -> bool:
    op_type = op.get("type")
    source = op.get("source", "")
    target = op.get("target", source)
    desc = op.get("description", "")

    src_path = source_dir / source
    dst_path = install_dir / target

    if verbose:
        print(f"\n  🔧 {desc}")

    try:
        if op_type == "copy_file":
            if not src_path.exists():
                print(f"  ⚠️  源文件未找到: {src_path}", file=sys.stderr)
                return False
            copy_file(src_path, dst_path, verbose)

        elif op_type == "copy_dir":
            if not src_path.exists():
                print(f"  ⚠️  源目录未找到: {src_path}", file=sys.stderr)
                return False
            copy_dir(src_path, dst_path, verbose)

        elif op_type == "merge_dir":
            if not src_path.exists():
                print(f"  ⚠️  源目录未找到: {src_path}", file=sys.stderr)
                return False
            merge_dir(src_path, dst_path, verbose)

        elif op_type == "build_go":
            binary_name = op.get("binary", "")

            # 优先使用预编译的二进制文件
            prebuilt = get_prebuilt_binary(source_dir)
            if prebuilt:
                if verbose:
                    print(f"  📦 使用预编译二进制: {prebuilt.name}")
                # 重命名为目标名称
                target_name = binary_name
                if IS_WINDOWS and not target_name.endswith(".exe"):
                    target_name += ".exe"
                binary_path = prebuilt
            else:
                # 没有预编译二进制，尝试编译
                if verbose:
                    print(f"  ℹ️  未找到预编译二进制，尝试编译...")
                if not src_path.exists():
                    print(f"  ⚠️  源目录未找到: {src_path}", file=sys.stderr)
                    return False

                success, binary_path = build_go_binary(src_path, binary_name, verbose)
                if not success:
                    return False

            # 安装到 PATH
            if not install_binary_to_path(binary_path, verbose, target_name=binary_name):
                return False

        elif op_type == "install_ace_tool":
            # 兼容旧配置，直接安装 ace-tool
            success, message = install_ace_tool(verbose)
            if not success:
                print(f"  ⚠️  {message}")
                print(f"  ℹ️  可稍后手动配置 ace-tool MCP")
                return True  # 不阻止其他安装
            if verbose:
                print(f"  ℹ️  {message}")
            # 创建配置文件
            create_ccg_config("ace-tool", install_dir, verbose)

        elif op_type == "install_mcp":
            # 动态 MCP 选择
            mcp_provider = choose_mcp_provider()

            if mcp_provider is None:
                print("  ⚠️  跳过 MCP 安装")
                create_ccg_config("none", install_dir, verbose)
                return True  # 不阻止其他安装

            # 根据选择安装对应的 MCP
            if mcp_provider == "ace-tool":
                success, message = install_ace_tool(verbose)
            elif mcp_provider == "auggie":
                success, message = install_auggie(verbose)
            else:
                print(f"  ❌ 未知的 MCP 提供商: {mcp_provider}", file=sys.stderr)
                return False

            if not success:
                print(f"  ⚠️  {message}")
                print(f"  ℹ️  可稍后手动配置 MCP")
                create_ccg_config("none", install_dir, verbose)
                return True  # 不阻止其他安装

            if verbose:
                print(f"  ℹ️  {message}")

            # 创建配置文件
            create_ccg_config(mcp_provider, install_dir, verbose)

        else:
            print(f"  ⚠️  未知操作类型: {op_type}", file=sys.stderr)
            return False

        return True

    except Exception as e:
        print(f"  ❌ 错误: {e}", file=sys.stderr)
        return False


def install_module(
    name: str,
    module: Dict[str, Any],
    source_dir: Path,
    install_dir: Path,
    verbose: bool = False
) -> bool:
    print(f"\n📦 正在安装模块: {name}")
    print(f"   {module.get('description', '')}")

    operations = module.get("operations", [])
    success_count = 0

    for op in operations:
        if execute_operation(op, source_dir, install_dir, verbose):
            success_count += 1

    if success_count == len(operations):
        print(f"   ✅ 模块 '{name}' 安装成功!")
        return True
    else:
        print(f"   ⚠️  模块 '{name}' 安装完成，但有 {len(operations) - success_count} 个警告")
        return False


def main() -> int:
    args = parse_args()

    # 解析路径
    config_path = Path(args.config)
    if not config_path.is_absolute():
        config_path = Path(__file__).parent / args.config

    source_dir = config_path.parent
    install_dir = Path(args.install_dir).expanduser().resolve()

    # 加载配置
    config = load_config(str(config_path))

    # 列出模块模式
    if args.list_modules:
        list_modules(config)
        return 0

    # 打印标题
    print("\n" + "=" * 50)
    print("🚀 Skills-v2 安装器")
    print("   多模型协作系统")
    print("=" * 50)
    print(f"\n📁 安装目录: {install_dir}")

    # 确保安装目录存在
    ensure_dir(install_dir)

    # 确定要安装的模块
    modules = config.get("modules", {})
    modules_to_install = []

    if args.module == "all":
        modules_to_install = [
            (name, mod) for name, mod in modules.items()
            if mod.get("enabled", False)
        ]
    elif args.module in modules:
        modules_to_install = [(args.module, modules[args.module])]
    else:
        print(f"\n❌ 未知模块: {args.module}", file=sys.stderr)
        print("   使用 --list-modules 查看可用模块")
        return 1

    if not modules_to_install:
        print("\n⚠️  没有可安装的模块")
        return 0

    # 安装模块
    success = True
    for name, module in modules_to_install:
        if not install_module(name, module, source_dir, install_dir, args.verbose):
            success = False

    # 打印摘要
    print("\n" + "=" * 50)
    if success:
        print("✅ 安装完成!")
        print("\n📋 已安装命令 (/ccg:xxx):")
        print("   开发工作流:")
        print("     /ccg:dev       - 完整6阶段多模型工作流")
        print("     /ccg:code      - 多模型代码生成（智能路由）")
        print("     /ccg:debug     - UltraThink 多模型调试")
        print("     /ccg:test      - 多模型测试生成")
        print("     /ccg:bugfix    - 质量门控修复（90%+ 通过）")
        print("     /ccg:think     - 深度分析")
        print("     /ccg:optimize  - 性能优化")
        print("     /ccg:frontend  - 前端任务 → Gemini")
        print("     /ccg:backend   - 后端任务 → Codex")
        print("     /ccg:review    - 双模型代码审查")
        print("     /ccg:analyze   - 双模型分析")
        print("     /ccg:enhance   - Prompt 增强")
        print("   Git 工具:")
        print("     /ccg:commit         - 智能提交")
        print("     /ccg:rollback       - 交互式回滚")
        print("     /ccg:clean-branches - 清理分支")
        print("     /ccg:worktree       - Worktree 管理")
        print("   项目初始化:")
        print("     /ccg:init      - 初始化项目 AI 上下文")
        print("\n🎯 快速开始:")
        print('   /ccg:dev "实现用户认证功能"')
        print('   /ccg:debug "登录接口返回500错误"')
        print('   /ccg:bugfix "密码重置失败"')
    else:
        print("⚠️  安装完成，但有警告")
    print("=" * 50 + "\n")

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
