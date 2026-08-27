---
name: bt-panel
description: 通过宝塔 (aaPanel/BT Panel) API 远程管理服务器 — 部署项目、更新已有站点、上传/下载/读写文件、执行 shell、操作 MySQL 数据库。当用户提到宝塔、更新线上、部署到服务器、`/www/wwwroot`、或给出宝塔面板地址 + API 密钥时触发。
license: MIT
user-invocable: true
disable-model-invocation: false
---

# bt-panel · 宝塔远程操控秘典

一套通过宝塔面板 HTTP API 完成部署 / 运维 / 数据库变更的 Python 工具集。
无需 SSH、无需 rsync、无需本地装 vercel/docker — 只要一个面板地址和 API 密钥。

## 何时使用

**自动触发**（魔尊未显式点名时也应主动调用）：
- 用户给出 `https://IP:port` 形式的宝塔面板地址和一串 32 位 API 密钥
- 用户说 "更新线上 / 更新一下 / 发布一下 / 部署到服务器 / 推到宝塔"
- 用户提到具体站点名且路径位于 `/www/wwwroot/` / `/www/server/` 下
- 用户要求"操作线上数据库 / 跑一下 SQL / 重启 pm2 / 看一下日志 / 改配置"
- 用户提交项目目录让你"推上去"

**不触发**：
- 用户只提到 Vercel / Netlify / AWS / 其他平台
- 纯本地开发任务

## 支持矩阵（面板变体自适应）

本 skill 不假设特定版本 — `bt_client.py` 首次调用 `test()` 时会自动探测
面板的 **OS / 变体 / 主版本**，缓存到 `client.panel_info`，后续所有方法都据此选择接口。

| 面板 | `panel_info` 识别 | 状态 | 说明 |
|---|---|---|---|
| 宝塔 Linux **v11+** | `{os:linux, variant:bt, major:11}` | ✅ 已实测 | Debian 12 + v11.6.0，主验证环境 |
| 宝塔 Linux **v7/v8/v9/v10** | `{major:7-10}` | ✅ 支持 | `exec_shell` 自动走老接口 `ExecShellMsg`；`sql_execute` 先试面板 `SqlExecute` API |
| **aaPanel**（英文国际版） | `{os:linux, variant:aapanel}` | ✅ 支持 | API 与宝塔 Linux 完全一致，仅错误消息是英文；`write_file` 兜底已识别中英双语 |
| 宝塔 **Windows 面板** | `{os:windows}` | ⚠️ 实验 | 文件 / shell / SQL 可用；`bt_deploy.py`（依赖本地 tar）仅在宝塔 Linux 下完整 |
| **1Panel**（飞致云） | — | ❌ 不覆盖 | 完全不同的 REST API，**不要**用本 skill 操作 1Panel |
| **宝塔企业版** | 同 v11+ | ✅ 预期兼容 | 未实测但 API 同源 |

### 自动适配要点（你不需要配置）

- **Shell 接口**：v11+ → `ExecShell`；v7–v10 → `ExecShellMsg`；均失败自动回退另一个
- **SQL 执行**：先试面板 API（老版本可用），失败退 shell + mysql CLI
- **MySQL 路径探测**：`/www/server/mysql/bin/mysql` → `/www/server/mariadb/bin/mysql` → `/usr/local/mysql/bin/mysql` → `$(command -v mysql)` → `mysql`
- **错误消息识别**：中文 `"不存在"/"权限"` ∪ 英文 `"not exist"/"Permission denied"`
- **Windows MySQL**：heredoc 改为临时文件 + `type` 重定向（cmd 不支持 heredoc）

### 探测输出示例

```bash
python3 bt_client.py test
# 返回里附带：
# "_skill_detected": {"os": "linux", "variant": "bt", "major": 11, "shell": "bash"}
```

Claude 收到 `_skill_detected` 后应据此决定：
- `major < 11` + `variant=bt`  → 可以直接用 SQL API（可能更快）
- `variant=aapanel`            → 错误消息会是英文，别困惑
- `os=windows`                 → 重启命令要改成 Windows 等价（`net stop nginx` 代替 `systemctl restart nginx`）
- `major=0`                    → 探测失败，面板返回不标准 → 跑 `test` 时把原始 JSON 给魔尊看

## 关键事实

- **签名**：`request_token = md5(request_time + md5(api_key))`，每次请求带 `request_time` 和 `request_token`
- **Shell 执行身份**：宝塔 Linux/aaPanel 为 root（可写任何目录）；Windows 面板为安装账户（通常 Administrator）
- **文件上传身份**：Linux 面板为 www（上传后文件属主是 www:www）
- **/tmp sticky bit**：`SaveFileBody` 在 /tmp 下可能报 `FILE_SAVE_ERR Permission denied`，`write_file` 已自动 delete+recreate 兜底

## 工具布局

```
~/.claude/skills/ccg/bt-panel/
├── SKILL.md                 # 本文件（给你用的指南）
├── bt_client.py             # 核心 API 客户端 + 通用 CLI（test/sites/ls/cat/put/exec/sql …）
├── bt_deploy.py             # 一键部署器（tar→upload→extract→sql→restart→cleanup）
├── sites.example.json       # 站点别名配置示例（复制为 sites.json 使用）
└── references/
    ├── api-reference.md     # 宝塔 v11 API 接口速查（踩过的坑都在这）
    └── recipes.md           # 实战食谱：更新前端 / PHP / Node / 回滚 …
```

## 快速开始

### 1. 提供凭据（任选其一）

```bash
# 环境变量（一次性）
export BT_URL="https://panel.example.com:8888"
export BT_KEY="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 或 CLI 参数：--panel ... --key ...
# 或 ~/.claude/skills/ccg/bt-panel/sites.json 里配置别名，然后 --alias <name>
```

### 2. 连通测试

```bash
python3 ~/.claude/skills/ccg/bt-panel/bt_client.py test
# → 返回 {version, system, cpuNum, memTotal, ...}
```

### 3. 一键部署

```bash
python3 ~/.claude/skills/ccg/bt-panel/bt_deploy.py \
  --local ~/projects/myapp \
  --remote /www/wwwroot/myapp.example.com \
  --exclude node_modules --exclude .git --exclude '*.log' \
  --backup \
  --restart 'cd /www/wwwroot/myapp.example.com && pm2 restart myapp'
```

部署器会：连通测试 → 备份远端 → 本地 tar.gz → 上传 → 解压 → chown → SQL → 重启 → 清理。

## CLI 速查

```bash
# 通用客户端 — bt_client.py
python3 bt_client.py test                     # 系统信息
python3 bt_client.py sites                    # 站点列表
python3 bt_client.py dbs                      # 数据库列表
python3 bt_client.py ls /www/wwwroot          # 列目录
python3 bt_client.py cat /www/wwwroot/app/.env
python3 bt_client.py write /www/wwwroot/app/config.json '{"a":1}'
python3 bt_client.py put ./local.js /www/wwwroot/app/
python3 bt_client.py get /www/wwwroot/app/log.txt ./log.txt
python3 bt_client.py mkdir /www/wwwroot/app/cache
python3 bt_client.py rm /www/wwwroot/app/old.js
python3 bt_client.py exec "cd /www/wwwroot/app && pm2 restart app" --cwd /www/wwwroot/app
python3 bt_client.py sql mydb "SELECT COUNT(*) FROM users"
python3 bt_client.py sql mydb --from-file migration.sql

# 一键部署 — bt_deploy.py
python3 bt_deploy.py --alias myapp                   # 用别名
python3 bt_deploy.py --alias myapp --dry-run         # 预览不执行
python3 bt_deploy.py --alias myapp --clean           # 清空目标再部署（慎用）
python3 bt_deploy.py --local DIR --remote DIR ...     # 无别名
```

## 作为库调用

```python
import os
import sys
sys.path.insert(0, os.path.expanduser('~/.claude/skills/ccg/bt-panel'))
from bt_client import BtClient

c = BtClient('https://1.2.3.4:8888', 'API_KEY')
c.test()                                        # 系统信息
c.get_sites()                                   # 站点
c.exec_shell('pm2 restart all', cwd='/root')    # 远程执行
c.sql_execute('mydb', 'UPDATE users SET ...')   # SQL
c.upload('./dist.tar.gz', '/tmp/')              # 上传
c.write_file('/www/wwwroot/app/.env', 'KEY=1')  # 写文件
```

## 响应流程（魔尊发话时你的执行链）

**触发场景**：用户发来形如 `https://1.2.3.4:8888 <32位API密钥> 更新一下 xxx` 的指令。

1. **识别** — 面板 URL + API 密钥（32 位大小写字母数字）+ 动作关键词
2. **连通** — 先 `bt_client.py test` 确认密钥有效、面板可达
3. **盘点** — `bt_client.py sites` 列出站点、`ls /www/wwwroot` 找到目标
4. **决策** — 判断用户想要的是：
   - **更新静态前端** → 直接 `bt_deploy.py --clean`（前端资源需要完整替换）
   - **更新 Node/PHP 后端** → `bt_deploy.py` + 重启服务
   - **改一两个文件** → 直接 `bt_client.py put` 或 `write`
   - **执行数据迁移** → `bt_client.py sql ... --from-file`
   - **重启服务** → `bt_client.py exec "pm2 restart xxx"`
5. **执行** — 优先 `--dry-run` 预览给魔尊确认，无歧义直接干
6. **核验** — 执行后 `exec 'curl -I <url>'` 或 `cat .env` 之类读回确认
7. **上报** — 精简报告：目标、改动范围、服务状态

## 安全铁律

- ❌ **绝不**直接用 `rm -rf` 删除 `/www/wwwroot/*`，先 `--backup` 再 `--clean`
- ❌ **绝不**把 API 密钥写入 git 跟踪的文件（sites.json 应进 `.gitignore`）
- ❌ **绝不**在 SQL 语句里拼接未校验的用户输入（heredoc delimiter 用 uuid 已自动防注入）
- ✅ 部署前先 `--dry-run`
- ✅ 数据库变更前先 `db_backup(db_id)` 或 `exec "mysqldump ... > backup.sql"`
- ✅ 多个站点共用同一面板时，每次命令都在日志里打印目标路径，避免串站

## 故障排查

见 `references/recipes.md` → 故障排查章节。常见问题：
- `签名校验失败` → API 密钥错 / 客户端时间漂移（差 >60s）
- `IP 未在白名单` → 宝塔面板 → 设置 → API 接口 → 添加本机公网 IP
- `指定参数无效` → 接口字段名版本差异，参考 `api-reference.md`
- `FILE_SAVE_ERR Permission denied` → sticky bit 冲突，客户端已自动兜底
- `FILE_SHELL_EMPTY` → 首轮轮询太快，`exec_shell` 已延后首次 poll
