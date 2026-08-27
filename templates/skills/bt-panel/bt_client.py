#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bt_client.py — 宝塔面板 (BT Panel) API 客户端与通用 CLI

- 仅使用 Python 标准库，无外部依赖
- 支持签名认证、文件上传 / 下载、shell 执行、数据库操作、站点管理
- 可作为库 `from bt_client import BtClient` 引用
- 也可作为 CLI 直接运行：`python3 bt_client.py <cmd> ...`

认证方式（宝塔官方 API 签名）：
    request_time  = 当前 Unix 秒
    request_token = md5( request_time + md5(api_key) )

前置条件（在宝塔面板内设置）：
    面板设置 → API 接口 → 开启 → 记录密钥 → 放行本机公网 IP

用法示例：
    # 环境变量方式
    export BT_URL="https://1.2.3.4:8888"
    export BT_KEY="xxxxxxxxxxxxxxxx"
    python3 bt_client.py test
    python3 bt_client.py sites
    python3 bt_client.py ls /www/wwwroot
    python3 bt_client.py cat /www/wwwroot/demo/.env
    python3 bt_client.py put ./local.js /www/wwwroot/demo/local.js
    python3 bt_client.py write /www/wwwroot/demo/config.json '{"a":1}'
    python3 bt_client.py exec "systemctl restart nginx"
    python3 bt_client.py dbs
    python3 bt_client.py sql mydb "SELECT id,name FROM users LIMIT 5"

    # 显式参数
    python3 bt_client.py --panel https://1.2.3.4:8888 --key XXX test
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import shlex
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple


def shlex_quote(s: str) -> str:
    """包装 shlex.quote 以便内部 shell 拼接。"""
    return shlex.quote(s)


# --------------------------------------------------------------------------- #
# 核心客户端
# --------------------------------------------------------------------------- #
class BtError(RuntimeError):
    """宝塔 API 调用失败。"""


class BtClient:
    """宝塔面板 API 客户端。

    Args:
        panel_url: 面板地址，例如 https://1.2.3.4:8888
        api_key:   API 密钥（面板 → 设置 → API 接口）
        verify_ssl: 是否校验 TLS 证书（面板通常自签，默认 False）
        timeout:   单次请求超时秒
    """

    def __init__(
        self,
        panel_url: str,
        api_key: str,
        verify_ssl: bool = False,
        timeout: int = 60,
    ) -> None:
        if not panel_url or not api_key:
            raise BtError("panel_url 和 api_key 不能为空")
        self.panel_url = panel_url.rstrip("/")
        self.api_key = api_key
        self.verify_ssl = verify_ssl
        self.timeout = timeout
        self.cookies: Dict[str, str] = {}
        self._info_cache: Optional[Dict[str, Any]] = None

        ctx = ssl.create_default_context()
        if not verify_ssl:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        self.ssl_ctx = ctx

    # ---------------- 面板变体自适应 ---------------- #
    @property
    def panel_info(self) -> Dict[str, Any]:
        """懒加载面板信息 — 识别 OS / 版本 / 变体，决定后续接口走哪条路。

        返回字段：
            os        : 'linux' | 'windows' | 'unknown'
            variant   : 'bt' (中文宝塔) | 'aapanel' (英文 aaPanel) | 'unknown'
            version   : 'x.y.z' 字符串
            major     : 整数主版本号
            system    : 原始 system 字符串
            mysql_bin : 默认 mysql CLI 路径
            shell     : 'bash' | 'cmd'
            end_marker: exec_shell 结束标记（shell 风格敏感）
        """
        if self._info_cache is not None:
            return self._info_cache
        raw = self.request("/system?action=GetSystemTotal")
        info: Dict[str, Any] = {
            "os": "unknown",
            "variant": "unknown",
            "version": "",
            "major": 0,
            "system": "",
            "mysql_bin": "/www/server/mysql/bin/mysql",
            "shell": "bash",
            "end_marker": "__BT_DONE__",
        }
        if isinstance(raw, dict):
            system = str(raw.get("system", ""))
            info["system"] = system
            version = str(raw.get("version", ""))
            info["version"] = version
            sl = system.lower()
            # OS 判定
            if "windows" in sl or "microsoft" in sl:
                info["os"] = "windows"
                info["mysql_bin"] = r"C:\BtSoft\WebSoft\mysql\MySQL*\bin\mysql.exe"
                info["shell"] = "cmd"
            elif any(k in sl for k in ("linux", "debian", "ubuntu", "centos", "rhel",
                                       "fedora", "alma", "rocky", "opensuse", "gnu")):
                info["os"] = "linux"
            # 变体判定 — aaPanel 的 system 字段通常不含中文，消息也是英文
            # 这里粗略判定，真正依据是后续请求返回的错误消息语言
            lower_url = self.panel_url.lower()
            if "aapanel" in lower_url:
                info["variant"] = "aapanel"
            else:
                info["variant"] = "bt"
            # 主版本
            try:
                info["major"] = int(version.split(".")[0]) if version else 0
            except (ValueError, IndexError):
                info["major"] = 0
        self._info_cache = info
        return info

    def _err_is(self, msg: str, *keys: str) -> bool:
        """判断错误消息是否包含任一关键字（支持中/英）。"""
        if not msg:
            return False
        low = msg.lower()
        for k in keys:
            if k in msg or k.lower() in low:
                return True
        return False

    # ---------------- 签名 & HTTP ---------------- #
    def _sign(self) -> Dict[str, str]:
        t = str(int(time.time()))
        key_md5 = hashlib.md5(self.api_key.encode()).hexdigest()
        token = hashlib.md5((t + key_md5).encode()).hexdigest()
        return {"request_time": t, "request_token": token}

    def _cookie_header(self) -> Optional[str]:
        if not self.cookies:
            return None
        return "; ".join(f"{k}={v}" for k, v in self.cookies.items())

    def _update_cookies(self, response) -> None:
        for header, value in response.getheaders():
            if header.lower() != "set-cookie":
                continue
            main = value.split(";", 1)[0].strip()
            if "=" in main:
                k, v = main.split("=", 1)
                self.cookies[k.strip()] = v.strip()

    def request(
        self,
        path: str,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Tuple[str, bytes, str]]] = None,
        timeout: Optional[int] = None,
        raw: bool = False,
    ) -> Any:
        """发起 API 请求，自动附加签名。

        Args:
            path:    API 路径，如 `/system?action=GetSystemTotal`
            data:    POST 表单字段
            files:   {name: (filename, content_bytes, content_type)}
            timeout: 覆盖默认超时
            raw:     True 时返回原始 bytes，不做 JSON 解析
        """
        url = self.panel_url + path
        payload: Dict[str, Any] = dict(data or {})
        payload.update(self._sign())

        headers = {"User-Agent": "bt-skill/1.0"}
        cookie_hdr = self._cookie_header()
        if cookie_hdr:
            headers["Cookie"] = cookie_hdr

        if files:
            boundary = "----BtSkill" + uuid.uuid4().hex
            body = self._build_multipart(payload, files, boundary)
            headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        else:
            body = urllib.parse.urlencode(
                {k: ("" if v is None else v) for k, v in payload.items()}
            ).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"

        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(
                req, timeout=timeout or self.timeout, context=self.ssl_ctx
            ) as resp:
                self._update_cookies(resp)
                content = resp.read()
        except urllib.error.HTTPError as e:
            raise BtError(f"HTTP {e.code} {e.reason} | {url}") from e
        except urllib.error.URLError as e:
            raise BtError(f"网络错误：{e.reason} | {url}") from e

        if raw:
            return content

        text = content.decode("utf-8", errors="replace")
        try:
            return json.loads(text)
        except ValueError:
            return text

    @staticmethod
    def _build_multipart(
        fields: Dict[str, Any],
        files: Dict[str, Tuple[str, bytes, str]],
        boundary: str,
    ) -> bytes:
        parts = []
        crlf = b"\r\n"
        for k, v in fields.items():
            parts.append(f"--{boundary}".encode())
            parts.append(
                f'Content-Disposition: form-data; name="{k}"'.encode()
            )
            parts.append(b"")
            parts.append(str("" if v is None else v).encode())
        for field_name, (filename, content, content_type) in files.items():
            parts.append(f"--{boundary}".encode())
            parts.append(
                (
                    f'Content-Disposition: form-data; name="{field_name}"; '
                    f'filename="{filename}"'
                ).encode()
            )
            parts.append(f"Content-Type: {content_type}".encode())
            parts.append(b"")
            parts.append(content)
        parts.append(f"--{boundary}--".encode())
        parts.append(b"")
        return crlf.join(parts)

    # ---------------- 高阶接口 ---------------- #
    def test(self) -> Any:
        """测试连通性 + 返回系统信息与变体探测结果。"""
        raw = self.request("/system?action=GetSystemTotal")
        info = self.panel_info  # 触发探测
        if isinstance(raw, dict):
            raw = dict(raw)
            raw["_skill_detected"] = {
                "os": info.get("os"),
                "variant": info.get("variant"),
                "major": info.get("major"),
                "shell": info.get("shell"),
            }
        return raw

    # ---- 站点 ----
    def get_sites(self, search: str = "", p: int = 1, limit: int = 200) -> Any:
        return self.request(
            "/data?action=getData&table=sites",
            {"search": search, "p": p, "limit": limit},
        )

    def site_set_status(self, site_id: int, name: str, status: bool) -> Any:
        action = "SiteStart" if status else "SiteStop"
        return self.request(
            "/site?action=SiteStart" if status else "/site?action=SiteStop",
            {"id": site_id, "name": name},
        )

    # ---- 文件 ----
    def list_dir(self, path: str, p: int = 1, search: str = "") -> Any:
        return self.request(
            "/files?action=GetDir",
            {"path": path, "p": p, "search": search, "showRow": 1000},
        )

    def read_file(self, path: str) -> Any:
        return self.request("/files?action=GetFileBody", {"path": path})

    def write_file(self, path: str, data: str, encoding: str = "utf-8") -> Any:
        """写入/覆盖远程文本文件。

        宝塔 SaveFileBody 行为差异（多变体自适应）：
        - 要求文件**先存在**（中文："指定文件不存在" / 英文："not exist" / "not found"）
            → 先 CreateFile 再重试
        - `/tmp` sticky bit 冲突（中文："权限" / 英文："Permission denied" / "FILE_SAVE_ERR"）
            → 先 DeleteFile 再 CreateFile 再重试
        """
        def _save() -> Any:
            return self.request(
                "/files?action=SaveFileBody",
                {"path": path, "data": data, "encoding": encoding},
            )

        r = _save()
        if isinstance(r, dict) and r.get("status") is False:
            msg = str(r.get("msg", ""))
            if self._err_is(msg, "不存在", "not exist", "not found", "no such"):
                self.create_file(path)
                r = _save()
            elif self._err_is(
                msg,
                "Permission denied", "FILE_SAVE_ERR", "权限不足", "没有权限",
                "权限拒绝",
            ):
                # sticky bit 或跨用户写冲突：删掉旧文件后重建
                self.delete_file(path)
                self.create_file(path)
                r = _save()
        return r

    def create_file(self, path: str) -> Any:
        return self.request("/files?action=CreateFile", {"path": path})

    def create_dir(self, path: str) -> Any:
        return self.request("/files?action=CreateDir", {"path": path})

    def delete_file(self, path: str) -> Any:
        return self.request("/files?action=DeleteFile", {"path": path})

    def delete_dir(self, path: str) -> Any:
        return self.request("/files?action=DeleteDir", {"path": path})

    def move(self, sfile: str, dfile: str) -> Any:
        return self.request(
            "/files?action=MvFile", {"sfile": sfile, "dfile": dfile}
        )

    def copy(self, sfile: str, dfile: str) -> Any:
        return self.request(
            "/files?action=CopyFile", {"sfile": sfile, "dfile": dfile}
        )

    def upload(
        self,
        local_path: str | Path,
        remote_dir: str,
        remote_name: Optional[str] = None,
        chunk_size: int = 4 * 1024 * 1024,
    ) -> Any:
        """上传单个文件（大文件自动分片）。

        宝塔 upload 接口字段：
            f_path   远程目录（不含文件名）
            f_name   远程文件名
            f_size   总大小
            f_start  本片起始字节
            blob_num 本片编号（从 1 开始）
            blob     本片二进制
        """
        local_path = Path(local_path)
        if not local_path.is_file():
            raise BtError(f"本地文件不存在：{local_path}")
        name = remote_name or local_path.name
        total = local_path.stat().st_size
        ctype, _ = mimetypes.guess_type(name)
        ctype = ctype or "application/octet-stream"

        if total == 0:
            # 空文件用 SaveFileBody 兜底
            self.create_dir(remote_dir)
            return self.write_file(f"{remote_dir.rstrip('/')}/{name}", "")

        last = None
        with local_path.open("rb") as fh:
            idx = 0
            offset = 0
            while True:
                chunk = fh.read(chunk_size)
                if not chunk:
                    break
                idx += 1
                last = self.request(
                    "/files?action=upload",
                    data={
                        "f_path": remote_dir,
                        "f_name": name,
                        "f_size": total,
                        "f_start": offset,
                        "blob_num": idx,
                    },
                    files={"blob": (name, chunk, ctype)},
                )
                if isinstance(last, dict) and last.get("status") is False:
                    raise BtError(f"上传失败：{last}")
                offset += len(chunk)
        return last

    def download(self, remote_path: str, local_path: str | Path) -> Path:
        """下载文件（基于 download 接口）。"""
        sign = self._sign()
        qs = urllib.parse.urlencode({"filename": remote_path, **sign})
        url = f"{self.panel_url}/files?action=download&{qs}"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(
            req, timeout=self.timeout, context=self.ssl_ctx
        ) as resp:
            data = resp.read()
        local_path = Path(local_path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(data)
        return local_path

    def zip_path(self, sfile: str, dfile: str, z_type: str = "zip") -> Any:
        return self.request(
            "/files?action=Zip",
            {"sfile": sfile, "dfile": dfile, "type": z_type, "coding": "UTF-8"},
        )

    def unzip(
        self,
        sfile: str,
        dfile: str,
        password: str = "",
        coding: str = "UTF-8",
    ) -> Any:
        return self.request(
            "/files?action=UnZip",
            {
                "sfile": sfile,
                "dfile": dfile,
                "password": password,
                "coding": coding,
            },
        )

    # ---- Shell 执行 ----
    #
    # 宝塔 shell 执行链 — 多版本自适应：
    #   v11+    : POST /files?action=ExecShell      {shell, path}
    #   v7–v10  : POST /files?action=ExecShellMsg   {shell, path}
    #   取回    : POST /files?action=GetExecShellMsg             （所有版本共用）
    #
    # 策略：按 panel_info.major 选主接口，失败自动回退另一个 — 零配置通吃宝塔 v7/v8/v9/v10/v11、aaPanel、
    # 宝塔 Windows（Windows 下 echo 标记语法一致，但部分 pm2/systemctl 之类的重启命令需用户自行改为 Windows 等价物）。
    END_MARKERS = ("__BT_DONE__",)

    def exec_shell(
        self,
        cmd: str,
        cwd: str = "/root",
        wait: int = 300,
        poll: float = 1.0,
        first_delay: float = 0.8,
    ) -> Dict[str, Any]:
        """执行远程 shell 命令，返回 {'status', 'msg', 'timeout', 'action'}。"""
        info = self.panel_info
        end = info.get("end_marker", "__BT_DONE__")
        wrapped = f"{cmd}\necho {end}"

        # 版本优先级：v11+ 先试 ExecShell；其他版本先试 ExecShellMsg
        if info.get("major", 11) >= 11:
            actions = ("ExecShell", "ExecShellMsg")
        else:
            actions = ("ExecShellMsg", "ExecShell")

        dispatch: Any = None
        used_action: Optional[str] = None
        for action in actions:
            dispatch = self.request(
                f"/files?action={action}",
                {"shell": wrapped, "path": cwd},
            )
            ok = isinstance(dispatch, dict) and dispatch.get("status") is not False
            if ok:
                used_action = action
                break
        if used_action is None:
            return {
                "status": False,
                "msg": (dispatch or {}).get("msg", "") if isinstance(dispatch, dict) else str(dispatch),
                "timeout": False,
                "action": None,
            }

        time.sleep(first_delay)
        deadline = time.time() + wait
        msg = ""
        while time.time() < deadline:
            r = self.request("/files?action=GetExecShellMsg", {})
            if isinstance(r, dict) and r.get("status") is True:
                msg = r.get("msg", "") or ""
                if end in msg:
                    clean = msg.replace(end, "").rstrip()
                    return {"status": True, "msg": clean, "timeout": False, "action": used_action}
            elif isinstance(r, str) and "FILE_SHELL_EMPTY" not in r and r:
                msg = r
                if end in msg:
                    return {
                        "status": True,
                        "msg": msg.replace(end, "").rstrip(),
                        "timeout": False,
                        "action": used_action,
                    }
            time.sleep(poll)
        return {"status": False, "msg": msg, "timeout": True, "action": used_action}

    # ---- 数据库 ----
    def get_databases(self, search: str = "", p: int = 1, limit: int = 200) -> Any:
        return self.request(
            "/data?action=getData&table=databases",
            {"search": search, "p": p, "limit": limit},
        )

    def _lookup_db_credentials(self, db_name: str) -> Tuple[str, str]:
        """从面板数据库列表中查出 db 的 username/password。"""
        r = self.get_databases(search=db_name)
        if not isinstance(r, dict):
            raise BtError(f"无法获取数据库列表：{r}")
        for d in r.get("data", []):
            if d.get("name") == db_name:
                return d.get("username", db_name), d.get("password", "")
        raise BtError(f"未找到数据库 {db_name}")

    def sql_execute(
        self,
        db_name: str,
        sql: str,
        user: Optional[str] = None,
        password: Optional[str] = None,
        force_shell: bool = False,
    ) -> Dict[str, Any]:
        """在指定数据库执行 SQL — 多变体自适应。

        执行策略（按顺序尝试，成功即返回）：
          1) 面板 API `/database?action=SqlExecute`（v7/v8/v9/v10 大多可用；v11 通常被拦截）
          2) shell + mysql CLI + heredoc（Linux/Mac 面板的通用兜底）
          3) （Windows 面板）shell + mysql.exe + 临时 .sql 文件（heredoc 在 cmd 下不工作）

        凭据自动从面板数据库列表读取（每个 db 携带 user/password）。
        密码通过 MYSQL_PWD 环境变量传递，不出现在进程列表。
        """
        info = self.panel_info

        # --- 通道 1：面板 API（老版本友好） ---
        if not force_shell:
            r = self.request(
                "/database?action=SqlExecute",
                {"name": db_name, "sql": sql},
            )
            if isinstance(r, dict) and r.get("status") is True:
                return {
                    "status": True,
                    "msg": str(r.get("data") or r.get("msg") or r),
                    "timeout": False,
                    "via": "panel_api",
                }

        # --- 通道 2/3：shell 兜底 ---
        if not (user and password):
            user, password = self._lookup_db_credentials(db_name)
        sql_body = sql.strip()
        if not sql_body.rstrip().endswith(";"):
            sql_body += ";"

        if info.get("os") == "windows":
            # Windows cmd 不支持 heredoc，改用临时文件 + type 重定向
            # Windows 面板允许写到站点目录下的 .bt_tmp 子目录（避开 sticky bit 的等价问题）
            tmp = f"C:/BtSoft/temp/bt_skill_sql_{uuid.uuid4().hex[:10]}.sql"
            self.write_file(tmp.replace("/", "\\"), sql_body)
            # mysql.exe 路径由面板安装决定，这里用通配（shell 会展开）
            cmd = (
                r'for /f "delims=" %i in (\'dir /b /s "C:\BtSoft\WebSoft\mysql\MySQL*\bin\mysql.exe" 2^>nul\') do set MBIN=%i' "\r\n"
                f'set MYSQL_PWD={password}' "\r\n"
                f'"%MBIN%" -u{user} {db_name} < "{tmp.replace("/", chr(92))}"' "\r\n"
                f'del /q "{tmp.replace("/", chr(92))}"'
            )
            r2 = self.exec_shell(cmd, cwd="C:\\BtSoft", wait=180)
        else:
            # Linux / macOS / aaPanel：heredoc 方案
            delim = f"__BT_SQL_{uuid.uuid4().hex[:12]}__"
            while delim in sql_body:
                delim = f"__BT_SQL_{uuid.uuid4().hex[:12]}__"
            # 常见 mysql 路径候选（宝塔 / aaPanel / 系统）
            candidates = [
                "/www/server/mysql/bin/mysql",      # 宝塔 Linux / aaPanel 默认
                "/www/server/mariadb/bin/mysql",    # 宝塔装的是 MariaDB
                "/usr/local/mysql/bin/mysql",       # 某些 aaPanel 版本
            ]
            # for 循环 + break 保证真 if-elif-else 语义
            cand_list = " ".join(f'"{c}"' for c in candidates)
            cmd = (
                f'BIN=""; for c in {cand_list}; do '
                f'  if [ -x "$c" ]; then BIN="$c"; break; fi; '
                f'done; '
                f'[ -z "$BIN" ] && BIN=$(command -v mysql 2>/dev/null) || true; '
                f'[ -z "$BIN" ] && BIN=mysql; '
                f"MYSQL_PWD={shlex_quote(password)} \"$BIN\" "
                f"-u{shlex_quote(user)} {shlex_quote(db_name)} 2>&1 <<'{delim}'\n"
                f"{sql_body}\n"
                f"{delim}"
            )
            r2 = self.exec_shell(cmd, cwd="/tmp", wait=180)

        r2["via"] = "shell"
        return r2

    def db_backup(self, db_id: int) -> Any:
        return self.request("/database?action=ToBackup", {"id": db_id})

    def db_import_sql_file(
        self,
        db_name: str,
        sql_file_remote: str,
        user: Optional[str] = None,
        password: Optional[str] = None,
    ) -> Dict[str, Any]:
        """导入一个已经在远端的 SQL 文件。"""
        if not (user and password):
            user, password = self._lookup_db_credentials(db_name)
        cmd = (
            f"BIN=/www/server/mysql/bin/mysql; "
            f"[ -x \"$BIN\" ] || BIN=mysql; "
            f"MYSQL_PWD={shlex_quote(password)} \"$BIN\" "
            f"-u{shlex_quote(user)} {shlex_quote(db_name)} "
            f"< {shlex_quote(sql_file_remote)} 2>&1"
        )
        return self.exec_shell(cmd, cwd="/tmp", wait=600)


# --------------------------------------------------------------------------- #
# 工具函数
# --------------------------------------------------------------------------- #
def load_site_alias(alias: str) -> Dict[str, Any]:
    """从 sites.json / sites.example.json 加载站点别名配置。"""
    candidates = [
        Path(os.environ.get("BT_SITES_JSON", "")),
        Path.home() / ".claude" / "skills" / "bt-panel" / "sites.json",
        Path.home() / ".bt-sites.json",
    ]
    for cand in candidates:
        if cand and cand.is_file():
            data = json.loads(cand.read_text("utf-8"))
            if alias in data:
                return data[alias]
    raise BtError(f"未找到站点别名：{alias}")


def build_client(args: argparse.Namespace) -> BtClient:
    panel = args.panel or os.environ.get("BT_URL") or os.environ.get("BT_PANEL")
    key = args.key or os.environ.get("BT_KEY") or os.environ.get("BT_API_KEY")
    if args.alias:
        cfg = load_site_alias(args.alias)
        panel = panel or cfg.get("panel")
        key = key or cfg.get("key")
    if not panel or not key:
        raise BtError(
            "缺少 panel / key。请通过 --panel / --key / 环境变量 BT_URL,BT_KEY "
            "或 --alias 指定站点别名。"
        )
    return BtClient(panel, key, verify_ssl=args.verify_ssl, timeout=args.timeout)


def pretty(obj: Any) -> str:
    if isinstance(obj, (dict, list)):
        return json.dumps(obj, indent=2, ensure_ascii=False)
    return str(obj)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _cmd_test(c: BtClient, a: argparse.Namespace) -> Any:
    return c.test()


def _cmd_sites(c: BtClient, a: argparse.Namespace) -> Any:
    return c.get_sites(search=a.search or "", p=a.page, limit=a.limit)


def _cmd_dbs(c: BtClient, a: argparse.Namespace) -> Any:
    return c.get_databases(search=a.search or "", p=a.page, limit=a.limit)


def _cmd_ls(c: BtClient, a: argparse.Namespace) -> Any:
    return c.list_dir(a.path, p=a.page)


def _cmd_cat(c: BtClient, a: argparse.Namespace) -> Any:
    r = c.read_file(a.path)
    # GetFileBody 成功时返回 {status, data, encoding, ...}，直接输出 data
    if isinstance(r, dict) and r.get("status") is True and "data" in r:
        return r["data"]
    return r


def _cmd_write(c: BtClient, a: argparse.Namespace) -> Any:
    content = a.content
    if a.from_file:
        content = Path(a.from_file).read_text(encoding="utf-8")
    return c.write_file(a.path, content)


def _cmd_put(c: BtClient, a: argparse.Namespace) -> Any:
    return c.upload(a.local, a.remote_dir, a.rename)


def _cmd_get(c: BtClient, a: argparse.Namespace) -> Any:
    return str(c.download(a.remote, a.local))


def _cmd_rm(c: BtClient, a: argparse.Namespace) -> Any:
    return c.delete_file(a.path)


def _cmd_rmdir(c: BtClient, a: argparse.Namespace) -> Any:
    return c.delete_dir(a.path)


def _cmd_mkdir(c: BtClient, a: argparse.Namespace) -> Any:
    return c.create_dir(a.path)


def _cmd_mv(c: BtClient, a: argparse.Namespace) -> Any:
    return c.move(a.src, a.dst)


def _cmd_exec(c: BtClient, a: argparse.Namespace) -> Any:
    return c.exec_shell(a.command, cwd=a.cwd, wait=a.wait)


def _cmd_zip(c: BtClient, a: argparse.Namespace) -> Any:
    return c.zip_path(a.src, a.dst, z_type=a.type)


def _cmd_unzip(c: BtClient, a: argparse.Namespace) -> Any:
    return c.unzip(a.src, a.dst)


def _cmd_sql(c: BtClient, a: argparse.Namespace) -> Any:
    sql = a.sql
    if a.from_file:
        sql = Path(a.from_file).read_text(encoding="utf-8")
    return c.sql_execute(a.db, sql)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="bt_client.py",
        description="宝塔面板 API 通用 CLI（skill: bt-panel）",
    )
    p.add_argument("--panel", help="面板地址 https://ip:port")
    p.add_argument("--key", help="API 密钥")
    p.add_argument("--alias", help="sites.json 站点别名")
    p.add_argument("--verify-ssl", action="store_true", help="校验 TLS 证书")
    p.add_argument("--timeout", type=int, default=60, help="请求超时秒")

    sub = p.add_subparsers(dest="subcmd", required=True)

    sub.add_parser("test", help="测试连通性 + 系统信息")

    for cmd, helpmsg in [("sites", "站点列表"), ("dbs", "数据库列表")]:
        sp = sub.add_parser(cmd, help=helpmsg)
        sp.add_argument("--search", default="")
        sp.add_argument("--page", type=int, default=1)
        sp.add_argument("--limit", type=int, default=200)

    sp = sub.add_parser("ls", help="列远程目录")
    sp.add_argument("path")
    sp.add_argument("--page", type=int, default=1)

    sp = sub.add_parser("cat", help="读取远程文件")
    sp.add_argument("path")

    sp = sub.add_parser("write", help="写入远程文件（文本）")
    sp.add_argument("path")
    sp.add_argument("content", nargs="?", default="")
    sp.add_argument("--from-file", help="从本地文件读取内容")

    sp = sub.add_parser("put", help="上传文件到远程目录")
    sp.add_argument("local", help="本地文件")
    sp.add_argument("remote_dir", help="远程目录")
    sp.add_argument("--rename", help="远程文件名（默认保留原名）")

    sp = sub.add_parser("get", help="下载远程文件到本地")
    sp.add_argument("remote")
    sp.add_argument("local")

    sp = sub.add_parser("rm", help="删除远程文件")
    sp.add_argument("path")

    sp = sub.add_parser("rmdir", help="删除远程目录")
    sp.add_argument("path")

    sp = sub.add_parser("mkdir", help="创建远程目录")
    sp.add_argument("path")

    sp = sub.add_parser("mv", help="移动/重命名")
    sp.add_argument("src")
    sp.add_argument("dst")

    sp = sub.add_parser("exec", help="在远程执行 shell 命令（异步，带输出）")
    sp.add_argument("command")
    sp.add_argument("--cwd", default="/root")
    sp.add_argument("--wait", type=int, default=300, help="最长等待秒")

    sp = sub.add_parser("zip", help="远程压缩")
    sp.add_argument("src")
    sp.add_argument("dst")
    sp.add_argument("--type", default="zip", choices=["zip", "tar.gz", "tar"])

    sp = sub.add_parser("unzip", help="远程解压")
    sp.add_argument("src")
    sp.add_argument("dst")

    sp = sub.add_parser("sql", help="在数据库执行 SQL")
    sp.add_argument("db", help="数据库名")
    sp.add_argument("sql", nargs="?", default="")
    sp.add_argument("--from-file", help="从本地 SQL 文件读取")

    return p


HANDLERS = {
    "test": _cmd_test,
    "sites": _cmd_sites,
    "dbs": _cmd_dbs,
    "ls": _cmd_ls,
    "cat": _cmd_cat,
    "write": _cmd_write,
    "put": _cmd_put,
    "get": _cmd_get,
    "rm": _cmd_rm,
    "rmdir": _cmd_rmdir,
    "mkdir": _cmd_mkdir,
    "mv": _cmd_mv,
    "exec": _cmd_exec,
    "zip": _cmd_zip,
    "unzip": _cmd_unzip,
    "sql": _cmd_sql,
}


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        client = build_client(args)
        result = HANDLERS[args.subcmd](client, args)
    except BtError as e:
        print(f"[bt] ERROR: {e}", file=sys.stderr)
        return 2
    print(pretty(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
