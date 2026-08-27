# 宝塔面板 API 接口速查

所有请求均 **POST** 到 `{panel_url}{path}`，Content-Type 为 `application/x-www-form-urlencoded`（上传文件时是 multipart/form-data）。

## 变体差异对照表（一眼看懂）

| 功能 | 宝塔 v7–v10 | 宝塔 v11+ | aaPanel | 宝塔 Windows |
|---|---|---|---|---|
| 签名 | 相同 | 相同 | 相同 | 相同 |
| `GetSystemTotal` | ✅ | ✅ | ✅ | ✅（`system` 字段含 Windows） |
| `/data?table=sites` | ✅ | ✅ | ✅ | ✅ |
| `/data?table=databases` | ✅ | ✅ | ✅ | ✅ |
| **下发 shell** | `ExecShellMsg` | **`ExecShell`** ← 改名 | `ExecShell` | `ExecShell` |
| **取回 shell** | `GetExecShellMsg` | `GetExecShellMsg` | `GetExecShellMsg` | `GetExecShellMsg` |
| `SaveFileBody` | ✅ 要求先存在 | ✅ 同 + sticky bit | ✅ 同 | ✅（路径 `\`）|
| `/database?action=SqlExecute` | ✅ 多数可用 | ⚠️ 通常被拦截 | ✅ 视版本 | ✅ 视版本 |
| 站点根路径 | `/www/wwwroot/` | `/www/wwwroot/` | `/www/wwwroot/` | `C:\BtSoft\wwwroot\` |
| MySQL 二进制 | `/www/server/mysql/bin/mysql` | 同 | 可能 `/usr/local/mysql/bin/mysql` | `C:\BtSoft\WebSoft\mysql\MySQL*\bin\mysql.exe` |
| 错误消息语言 | 中文 | 中文 | **英文** | 中文/英文 |
| heredoc `<<'EOF'` | ✅ bash | ✅ bash | ✅ bash | ❌ cmd 不支持，用临时文件 |
| 默认 shell 执行身份 | root | root | root | 安装账户 |

`bt_client.py` 根据 `panel_info` 的 `major` / `os` / `variant` 自动处理上述差异。
要绕过自动适配强制走 shell，可用 `sql_execute(..., force_shell=True)`。

## v11.6.0 实测环境基线

下面的接口细节基于在真实面板 `panel.example.com:8888`（Debian 12 + v11.6.0）上的抓包与实测。
每次请求必须携带签名字段：

```
request_time  = str(int(time.time()))
request_token = md5(request_time + md5(api_key))
```

## 系统信息

| Action | 路径 | 参数 | 说明 |
|---|---|---|---|
| 系统概览 | `/system?action=GetSystemTotal` | - | 返回 `{version, system, cpuNum, memTotal, ...}` |
| 网络流量 | `/system?action=GetNetWork` | - | 实时流量 |
| 磁盘 | `/system?action=GetDiskInfo` | - | 磁盘分区 |

## 站点管理

| Action | 路径 | 参数 |
|---|---|---|
| 站点列表 | `/data?action=getData&table=sites` | `search`, `p`, `limit`, `order`, `tojs` |
| 启动站点 | `/site?action=SiteStart` | `id`, `name` |
| 停止站点 | `/site?action=SiteStop` | `id`, `name` |
| 新增站点 | `/site?action=AddSite` | `webname`, `path`, `type_id`, `type`, `version`, `port`, `ps`, `ftp`, `sql` |
| 站点详情 | `/site?action=GetSiteDomains` | `id` |

## 数据库

| Action | 路径 | 参数 | 说明 |
|---|---|---|---|
| 数据库列表 | `/data?action=getData&table=databases` | `search`, `p`, `limit` | 每条记录含 `username`, `password`, `accept` |
| 备份 | `/database?action=ToBackup` | `id` | - |
| 删除备份 | `/database?action=DelBackup` | `id` | - |
| ⚠️ 执行 SQL | `/database?action=SqlExecute` | `name`, `sql` | **v11 已收紧，返回"指定参数无效"** — 使用 shell + mysql CLI 代替（见下） |

### SQL 执行兜底方案（v11 必用）

```python
# 从 get_databases 的返回里取每个 db 的 username/password
# 再通过 shell + mysql CLI + heredoc 执行
cmd = f"""BIN=/www/server/mysql/bin/mysql
[ -x "$BIN" ] || BIN=mysql
MYSQL_PWD='{password}' "$BIN" -u{user} {db_name} 2>&1 <<'__BT_SQL_xxx__'
SELECT ...;
__BT_SQL_xxx__
"""
# 然后通过 files?action=ExecShell 下发
```

`bt_client.py` 的 `sql_execute(db_name, sql)` 已封装此逻辑，自动：
- 查凭据
- 补尾部分号
- 用 uuid 生成唯一 heredoc delimiter（防碰撞）
- 通过 `MYSQL_PWD` 环境变量传密码（不出现在进程列表）

## 文件管理

| Action | 路径 | 参数 | 返回 |
|---|---|---|---|
| 列目录 | `/files?action=GetDir` | `path`, `p`, `search`, `showRow` | `{PAGE, DIR[], FILES[], ...}` |
| 读文件 | `/files?action=GetFileBody` | `path` | `{status, data, encoding, size, st_mtime, ...}` — **注意内容在 `data` 字段** |
| 写文件 | `/files?action=SaveFileBody` | `path`, `data`, `encoding` | 要求文件**先存在**，否则返回 "指定文件不存在" |
| 创建文件 | `/files?action=CreateFile` | `path` | - |
| 创建目录 | `/files?action=CreateDir` | `path` | - |
| 删除文件 | `/files?action=DeleteFile` | `path` | 移到回收站 |
| 删除目录 | `/files?action=DeleteDir` | `path` | 移到回收站 |
| 移动/重命名 | `/files?action=MvFile` | `sfile`, `dfile` | - |
| 复制 | `/files?action=CopyFile` | `sfile`, `dfile` | - |
| 压缩 | `/files?action=Zip` | `sfile`, `dfile`, `type`, `coding` | 支持 zip/tar.gz |
| 解压 | `/files?action=UnZip` | `sfile`, `dfile`, `password`, `coding` | - |

### 文件上传 `/files?action=upload`

**multipart/form-data** 请求。字段：

| 字段 | 含义 |
|---|---|
| `f_path` | 目标目录（不含文件名） |
| `f_name` | 目标文件名 |
| `f_size` | 文件总字节数 |
| `f_start` | 本片起始字节（分片上传用） |
| `blob_num` | 本片编号（从 1 开始） |
| `blob` | 本片二进制 |

一次性上传小文件：`f_start=0, blob_num=1`，`blob` 即整个文件。
`bt_client.py` 的 `upload()` 已支持自动分片（默认 4MB 每片）。

### SaveFileBody 的 sticky bit 陷阱

`/tmp` 有 sticky bit（`drwxrwxrwt`），SaveFileBody 跨进程写文件时可能报：
```
FILE_SAVE_ERR[Errno 13] Permission denied: '/tmp/xxx'
```

`bt_client.py` 的 `write_file()` 遇此错误会自动 `DeleteFile` + `CreateFile` 再重试。
或者把文件放到子目录 `/tmp/bt_work/xxx` 避开该问题。

## Shell 执行（v11 重大变化！）

**v11 把下发接口从 `ExecShellMsg` 改名为 `ExecShell`**，但 `GetExecShellMsg` 保留原名。
用老接口会返回 `{"status": false, "msg": "指定参数无效!"}`。

| Action | 路径 | 参数 | 说明 |
|---|---|---|---|
| 下发 | `/files?action=ExecShell` | `shell`, `path` | **异步**返回 `{status: True, msg: '命令已发送'}` |
| 读日志 | `/files?action=GetExecShellMsg` | - | 返回 `{status: True, msg: <累计 stdout+stderr>}` |

### 正确的轮询姿势

```python
c.request('/files?action=ExecShell', {'shell': 'whoami; echo __DONE__', 'path': '/tmp'})
time.sleep(0.8)  # 给宝塔写 /tmp/panelExec.pl 留时间
while not done:
    r = c.request('/files?action=GetExecShellMsg', {})
    msg = r.get('msg', '')
    if '__DONE__' in msg:
        break
    if msg == 'FILE_SHELL_EMPTY':   # 还没就绪
        time.sleep(1)
        continue
    time.sleep(1)
```

宝塔结束标志：追加 `echo __BT_DONE__` 自行约定。`bt_client.py.exec_shell()` 已封装完整轮询。

### Shell 运行身份

Shell 命令以 **root** 执行。可以读写任何路径、`chown`、`systemctl`、`pm2`。

### /tmp/panelExec.pl 的特殊行为

宝塔用单文件 `/tmp/panelExec.pl` 存储上一次 shell 的输出，**多次并发 exec 会互相覆盖**。如果需要并发执行，互相传递结果要自己写文件：
```bash
your_cmd > /tmp/my_out_$(uuidgen).log 2>&1
```

## 通用数据表 `/data?action=getData`

一个万能的只读表查询接口：

```
POST /data?action=getData&table=<table_name>
参数：search, p, limit, order, tojs
```

| table | 返回 |
|---|---|
| `sites` | 站点列表 |
| `databases` | 数据库列表（含 user/pass/accept） |
| `ftps` | FTP 账号 |
| `backup` | 备份列表 |
| `crontab` | 计划任务 |

## 签名 & 鉴权

```python
import hashlib, time
t = str(int(time.time()))
key_md5 = hashlib.md5(API_KEY.encode()).hexdigest()
token = hashlib.md5((t + key_md5).encode()).hexdigest()
# 每次请求 POST body 里加：
#   request_time=<t>&request_token=<token>
```

**注意**：
- 客户端时间与服务器时间偏差 >60 秒会被拒绝
- IP 必须在 面板设置 → API 接口 → IP 白名单 里
- 面板跳过 TLS 证书校验是常态（自签证书）

## 常见错误码

| msg | 含义 | 处理 |
|---|---|---|
| `签名校验失败` | 密钥错 / 时间漂移 | 对时、复查密钥 |
| `IP 未在白名单` | 白名单未放 | 到面板添加 |
| `指定参数无效` | 字段名版本差异 | 参考本文件 |
| `指定文件不存在` | SaveFileBody 前文件不存在 | 先 CreateFile |
| `FILE_SAVE_ERR Permission denied` | sticky bit | `write_file` 已自动兜底 |
| `FILE_SHELL_EMPTY` | shell 刚下发，`/tmp/panelExec.pl` 还未创建 | 稍后重试 |
| `目录已存在` / `文件已存在` | - | 可忽略 |
| `已将文件/目录移动到回收站` | 删除成功 | - |
