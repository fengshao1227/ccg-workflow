# bt-panel 实战食谱

## 一、场景对应的命令模板

### 场景 1：更新一个纯前端静态站（Vue/React dist）

**特点**：无状态、需要完整替换、无服务重启、可以清空目标目录。

```bash
python3 bt_deploy.py \
  --local ./dist \
  --remote /www/wwwroot/h5.example.com \
  --clean \
  --owner www:www \
  --exclude '*.map'
```

或做成 alias：
```json
"h5-frontend": {
  "panel": "https://1.2.3.4:8888",
  "key":   "xxxx",
  "local": "~/projects/myapp-h5/dist",
  "remote": "/www/wwwroot/h5.example.com",
  "clean": true,
  "exclude": ["*.map"]
}
```
```bash
python3 bt_deploy.py --alias h5-frontend
```

---

### 场景 2：更新 Node.js 后端（pm2 管理）

```bash
python3 bt_deploy.py \
  --alias myapp-api \
  --backup \
  --restart 'cd /www/wwwroot/myapp-api && npm install --production && pm2 restart myapp-api'
```

alias 配置：
```json
"myapp-api": {
  "panel": "https://1.2.3.4:8888",
  "key": "xxxx",
  "local": "~/projects/myapp-api",
  "remote": "/www/wwwroot/myapp-api",
  "database": "myapp_db",
  "backup": true,
  "exclude": ["node_modules", ".git", ".env.local", "*.log"],
  "restart": [
    "cd /www/wwwroot/myapp-api && npm install --production --silent",
    "cd /www/wwwroot/myapp-api && pm2 restart myapp-api || pm2 start ecosystem.config.js"
  ]
}
```

---

### 场景 3：更新 PHP 站（FastAdmin/ThinkPHP）

```json
"jys-backend": {
  "panel": "https://1.2.3.4:8888",
  "key": "xxxx",
  "local": "~/projects/mysite-php",
  "remote": "/www/wwwroot/mysite-php",
  "database": "jys",
  "backup": true,
  "exclude": ["vendor", ".git", "runtime/*", "*.log", ".idea"],
  "restart": [
    "cd /www/wwwroot/mysite-php && find runtime/temp -name '*.php' -delete 2>/dev/null; true",
    "systemctl reload nginx"
  ]
}
```

---

### 场景 4：只改一两个配置文件（热修复）

无需重部署，直接 `put` 或 `write`：

```bash
# 覆盖单文件（本地有改动）
python3 bt_client.py put ./server/config/prod.ts /www/wwwroot/app/server/config/

# 直接写一行（本地没改动，想快速改）
python3 bt_client.py write /www/wwwroot/app/.env 'API_URL=https://new.api.com
DEBUG=false'

# 重启服务
python3 bt_client.py exec 'pm2 restart app' --cwd /www/wwwroot/app
```

---

### 场景 5：数据库迁移（带备份）

```bash
# 1. 先备份（exec 方式，避开 ToBackup 的面板任务队列）
python3 bt_client.py exec \
  "mysqldump -u\$USR -p\$PWD mydb > /www/backup/mydb_$(date +%Y%m%d_%H%M%S).sql" \
  --cwd /tmp --wait 600

# 2. 执行迁移 SQL
python3 bt_client.py sql mydb --from-file ./migrations/2026-04-10-add-column.sql

# 3. 回滚预案（记下备份路径，必要时）
python3 bt_client.py sql mydb --from-file /www/backup/mydb_xxx.sql
```

或用 `bt_deploy.py` 的集成 `sql` 字段把迁移融入部署：
```json
{
  "sql": "./migrations/2026-04-10.sql",
  "database": "mydb"
}
```

---

### 场景 6：远程诊断（查日志 / 查进程 / 查端口）

```bash
# 查 pm2 状态
python3 bt_client.py exec 'pm2 status' --cwd /root

# 查最近的 nginx error log
python3 bt_client.py exec 'tail -200 /www/wwwlogs/myapp.example.com.error.log'

# 查端口占用
python3 bt_client.py exec 'ss -tlnp | grep :3000'

# 磁盘占用 top 10
python3 bt_client.py exec 'du -sh /www/wwwroot/* | sort -hr | head -10'
```

---

### 场景 7：回滚（基于自动备份）

部署时 `--backup` 会生成 `/www/backup/bt_skill/<站点名>_<timestamp>.tar.gz`。

```bash
# 1. 列出备份
python3 bt_client.py exec 'ls -la /www/backup/bt_skill/'

# 2. 选一个备份包解压回目标位置
python3 bt_client.py exec '
  SITE=/www/wwwroot/myapp.example.com
  BAK=/www/backup/bt_skill/myapp.example.com_20260410_120000.tar.gz
  find $SITE -mindepth 1 -delete
  tar -xzf $BAK -C $(dirname $SITE)
  chown -R www:www $SITE
  pm2 restart myapp
'
```

---

## 二、故障排查

### 🔑 `签名校验失败 / Invalid signature`

**可能原因**：
1. API 密钥复制错了（多一个空格、少一个字符）
2. 本地机器时间漂移（与面板服务器差 >60 秒）
3. 面板设置里 API 密钥被改过了

**排查**：
```bash
# 对时
ntpdate pool.ntp.org          # Linux
sudo sntp -sS time.apple.com  # macOS

# 验证密钥：登宝塔面板 → 设置 → API 接口 → 查看密钥
```

---

### 🚫 `IP 未在白名单`

**原因**：宝塔 API 接口默认只放特定 IP。

**修复**：
1. 登宝塔面板 → 设置 → API 接口
2. "IP 白名单" 添加本机公网 IP（curl ifconfig.me 查）
3. 临时方案：加 `0.0.0.0` 放行全部（仅测试环境）

---

### ❓ `指定参数无效` (指定参数无效!)

**原因**：API 接口的字段名在宝塔不同版本间变化。

**案例**：
- `ExecShellMsg` → v11 改名为 `ExecShell`
- `SqlExecute` → v11 可能拦截，用 shell + mysql 代替

**调试方法**（仿效）：
```python
for candidate in ({"shell": cmd, "path": "/tmp"}, {"cmd": cmd}, ...):
    r = c.request("/files?action=<NewAction>", candidate)
    print(candidate, '→', r)
```

`references/api-reference.md` 列出了已知正确字段名。

---

### 💾 `FILE_SAVE_ERR Permission denied`

**原因**：`/tmp` 的 sticky bit 让 SaveFileBody 无法覆写其他进程创建的文件。

**修复**：
1. `bt_client.write_file()` 已自动 delete+recreate 兜底
2. 或改用子目录：`/tmp/bt_work/xxx` 代替直接 `/tmp/xxx`
3. 或走 `/files?action=upload`（不受此问题影响）

---

### ⏳ `FILE_SHELL_EMPTY` / exec 永远 timeout

**原因 A**：用错了接口名。v11 必须是 `/files?action=ExecShell`（不是 `ExecShellMsg`）。
**原因 B**：首次 poll 太快，`/tmp/panelExec.pl` 还没被宝塔创建。

**修复**：`bt_client.exec_shell()` 已处理——首次下发后 `sleep 0.8s` 再轮询。

---

### 🔐 `Access denied for user 'xxx'` (MySQL)

**原因**：数据库用户/密码错。

**排查**：
```bash
# 1. 从面板查看实际凭据
python3 bt_client.py dbs

# 2. bt_client.sql_execute 默认会自动查凭据，如果还报错：
#    可能是 accept 限制了 localhost（面板 → 数据库 → 权限设置）
python3 bt_client.py exec "grep -r $DB_NAME /etc/mysql 2>/dev/null; cat /etc/my.cnf | head -30"
```

---

### 📦 `上传文件为 0 字节` / upload 状态异常

**可能原因**：
1. 文件大小超过面板 nginx 限制（默认 1GB）
2. 分片上传中某一片失败
3. 磁盘空间不足

**排查**：
```bash
python3 bt_client.py exec 'df -h / /tmp /www'
python3 bt_client.py exec 'cat /www/server/nginx/conf/proxy.conf | grep client_max'
```

---

### 🔄 `pm2 重启没生效`

**排查**：
```bash
# 1. 确认 pm2 已启动
python3 bt_client.py exec 'pm2 status' --cwd /root

# 2. 确认你用的是宝塔用户的 pm2（宝塔用 www 用户时需要 sudo -u www）
python3 bt_client.py exec 'which pm2; pm2 --version'

# 3. 强制重启
python3 bt_client.py exec 'pm2 kill; pm2 start /www/wwwroot/app/ecosystem.config.js'
```

---

## 三、最佳实践

### 📁 组织 sites.json

```bash
# 1. 复制模板
cp ~/.claude/skills/ccg/bt-panel/sites.example.json ~/.claude/skills/ccg/bt-panel/sites.json

# 2. 设置权限（防手滑 commit）
chmod 600 ~/.claude/skills/ccg/bt-panel/sites.json

# 3. 加入全局 .gitignore
echo 'sites.json' >> ~/.gitignore_global
```

### 🧪 部署前必看

```bash
# 先干跑
python3 bt_deploy.py --alias myapp --dry-run

# 查远端当前状态（最近改动时间）
python3 bt_client.py exec 'find /www/wwwroot/myapp -type f -mtime -1 | head -20'

# 检查重启脚本在本地能跑通
bash -n ecosystem.config.js
```

### 🛡 部署后核验

```bash
# 1. HTTP 探活
python3 bt_client.py exec 'curl -I -s http://localhost:3000/health'

# 2. 日志尾部
python3 bt_client.py exec 'tail -50 /www/wwwroot/myapp/logs/app.log'

# 3. pm2 状态
python3 bt_client.py exec 'pm2 status'
```

### ⚡ 多站点并发部署

```bash
# 用 & 并发 + wait 汇总
python3 bt_deploy.py --alias site1 &
python3 bt_deploy.py --alias site2 &
python3 bt_deploy.py --alias site3 &
wait
echo "all done"
```

注意：同一面板并发 exec 会互相覆盖 `/tmp/panelExec.pl`，但 `upload` 和 `SaveFileBody` 独立，所以 **不同站点并发 OK**，**同站点并发可能有 exec 日志串**。
