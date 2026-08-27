#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bt_deploy.py — 宝塔项目一键部署/更新编排器

流程：
  1. 连通测试
  2. （可选）备份远程目录 → 压到 /www/backup/bt_skill/<ts>.tar.gz
  3. 本地打 tar.gz 包（支持 --exclude 排除）
  4. 上传到远程 /tmp/bt_skill_tmp/
  5. 解压到目标目录（默认保留目录结构；--clean 先清空目标）
  6. （可选）写入 .env / 额外文件
  7. （可选）执行 SQL 文件或单条 SQL
  8. （可选）执行重启命令（pm2 / systemctl / supervisorctl）
  9. 清理临时文件
 10. 报告结果

用法：
  # 凭据：环境变量 / CLI / sites.json 别名
  export BT_URL=https://1.2.3.4:41235
  export BT_KEY=xxxx

  # 方式 A：命令行参数
  python3 bt_deploy.py \\
      --local ~/projects/myapp \\
      --remote /www/wwwroot/myapp.example.com \\
      --exclude node_modules --exclude .git --exclude '*.log' \\
      --backup \\
      --restart 'cd /www/wwwroot/myapp.example.com && pm2 restart myapp'

  # 方式 B：sites.json 别名（推荐长期使用）
  python3 bt_deploy.py --alias myapp

  # 方式 C：只测试不执行
  python3 bt_deploy.py --alias myapp --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

sys.path.insert(0, str(Path(__file__).parent))
from bt_client import BtClient, BtError, load_site_alias  # noqa: E402


# --------------------------------------------------------------------------- #
# 工具
# --------------------------------------------------------------------------- #
def log(level: str, msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    prefix = {"info": "[·]", "ok": "[✓]", "warn": "[!]", "err": "[✗]", "run": "[→]"}.get(
        level, "[ ]"
    )
    print(f"{ts} {prefix} {msg}", flush=True)


def human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def make_tarball(
    src_dir: Path,
    exclude: Iterable[str],
    out_path: Path,
) -> int:
    """把 src_dir 打成 tar.gz，返回字节数。"""
    src_dir = src_dir.resolve()
    exclude_set = {e.rstrip("/") for e in exclude}

    def filt(tarinfo: tarfile.TarInfo) -> Optional[tarfile.TarInfo]:
        # tarinfo.name 是相对路径，例如 'myapp/node_modules/foo.js'
        parts = Path(tarinfo.name).parts
        for p in parts:
            if p in exclude_set:
                return None
        # 支持简单通配
        for pat in exclude_set:
            if "*" in pat:
                from fnmatch import fnmatch
                if any(fnmatch(p, pat) for p in parts):
                    return None
        return tarinfo

    with tarfile.open(out_path, "w:gz") as tar:
        tar.add(src_dir, arcname=src_dir.name, filter=filt)
    return out_path.stat().st_size


# --------------------------------------------------------------------------- #
# Deploy
# --------------------------------------------------------------------------- #
class Deployer:
    def __init__(self, client: BtClient, cfg: Dict[str, Any], dry_run: bool = False) -> None:
        self.c = client
        self.cfg = cfg
        self.dry = dry_run
        self.session_id = uuid.uuid4().hex[:10]
        self.remote_tmp = f"/tmp/bt_skill_tmp_{self.session_id}"

    # ---- 阶段 ----
    def test_connectivity(self) -> None:
        log("run", "测试面板连通")
        info = self.c.test()
        if isinstance(info, dict) and "version" in info:
            log("ok", f"面板 v{info['version']} / {info.get('system','?')} 已连通")
        else:
            raise BtError(f"连通失败：{info}")

    def backup_remote(self) -> Optional[str]:
        if not self.cfg.get("backup"):
            return None
        remote = self.cfg["remote"]
        ts = time.strftime("%Y%m%d_%H%M%S")
        backup_dir = self.cfg.get("backup_dir", "/www/backup/bt_skill")
        backup_file = f"{backup_dir}/{Path(remote).name}_{ts}.tar.gz"
        log("run", f"备份远端 {remote} → {backup_file}")
        if self.dry:
            return backup_file
        self.c.exec_shell(f"mkdir -p {backup_dir}", cwd="/")
        r = self.c.exec_shell(
            f"test -d {remote} && tar -czf {backup_file} -C "
            f"{Path(remote).parent} {Path(remote).name} && echo BACKUP_OK || echo NO_TARGET",
            cwd="/", wait=600,
        )
        if "BACKUP_OK" in (r.get("msg") or ""):
            log("ok", f"备份完成 → {backup_file}")
        else:
            log("warn", f"备份跳过（目标不存在）：{r.get('msg')}")
            return None
        return backup_file

    def pack_and_upload(self) -> str:
        local = Path(self.cfg["local"]).expanduser().resolve()
        if not local.is_dir():
            raise BtError(f"本地目录不存在：{local}")
        excludes = self.cfg.get("exclude", [])
        with tempfile.TemporaryDirectory(prefix="bt_skill_") as tdir:
            tar_path = Path(tdir) / f"{local.name}.tar.gz"
            log("run", f"打包 {local} → {tar_path.name}（exclude={excludes}）")
            size = make_tarball(local, excludes, tar_path)
            log("ok", f"打包完成 {human_size(size)}")

            if self.dry:
                return f"{self.remote_tmp}/{tar_path.name}"

            # 保证远端临时目录存在
            self.c.create_dir(self.remote_tmp)
            log("run", f"上传到 {self.remote_tmp}")
            r = self.c.upload(tar_path, self.remote_tmp)
            if isinstance(r, dict) and r.get("status") is False:
                raise BtError(f"上传失败：{r}")
            log("ok", "上传完成")
            return f"{self.remote_tmp}/{tar_path.name}"

    def extract(self, remote_tar: str) -> None:
        remote = self.cfg["remote"]
        clean = self.cfg.get("clean", False)
        local_name = Path(self.cfg["local"]).expanduser().resolve().name

        log("run", f"部署到 {remote}（clean={clean}）")
        if self.dry:
            return

        # 先保证目标目录存在
        self.c.exec_shell(f"mkdir -p {remote}", cwd="/")

        if clean:
            # 危险操作：清空目标目录（保留目录本身）
            log("warn", f"清空目标目录 {remote}")
            self.c.exec_shell(
                f"find {remote} -mindepth 1 -delete", cwd="/", wait=300
            )

        # 解压：tar 里的顶层是 <local_name>/，strip 一层后直接落到 remote/
        cmd = (
            f"tar -xzf {remote_tar} -C {remote} "
            f"--strip-components=1 && echo EXTRACT_OK"
        )
        r = self.c.exec_shell(cmd, cwd="/tmp", wait=600)
        if "EXTRACT_OK" not in (r.get("msg") or ""):
            raise BtError(f"解压失败：{r.get('msg')}")
        log("ok", "解压完成")

        # 修正 owner（默认 www:www，可以通过 cfg.owner 覆盖）
        owner = self.cfg.get("owner", "www:www")
        if owner:
            self.c.exec_shell(
                f"chown -R {owner} {remote}", cwd="/", wait=120
            )
            log("ok", f"chown {owner}")

    def apply_sql(self) -> None:
        sql = self.cfg.get("sql")
        if not sql:
            return
        db = self.cfg.get("database")
        if not db:
            raise BtError("配置了 sql 但未指定 database")
        log("run", f"执行 SQL 到数据库 {db}")
        if self.dry:
            return
        # sql 可以是字符串或文件路径
        if isinstance(sql, str) and sql.endswith(".sql") and Path(sql).is_file():
            sql = Path(sql).read_text(encoding="utf-8")
        r = self.c.sql_execute(db, sql)
        if r.get("status"):
            log("ok", "SQL 执行完成")
            if r.get("msg"):
                print("  " + "\n  ".join(str(r["msg"]).splitlines()[:20]))
        else:
            raise BtError(f"SQL 失败：{r}")

    def restart_service(self) -> None:
        cmds = self.cfg.get("restart")
        if not cmds:
            return
        if isinstance(cmds, str):
            cmds = [cmds]
        for cmd in cmds:
            log("run", f"重启命令：{cmd}")
            if self.dry:
                continue
            r = self.c.exec_shell(cmd, cwd=self.cfg.get("remote", "/"), wait=300)
            log("ok" if r.get("status") else "err", (r.get("msg") or "")[:400])

    def cleanup(self) -> None:
        if self.dry:
            return
        log("run", f"清理临时目录 {self.remote_tmp}")
        self.c.delete_dir(self.remote_tmp)
        log("ok", "清理完成")

    def run(self) -> None:
        log("info", f"session={self.session_id} dry={self.dry}")
        self.test_connectivity()
        self.backup_remote()
        tar_remote = self.pack_and_upload()
        self.extract(tar_remote)
        self.apply_sql()
        self.restart_service()
        self.cleanup()
        log("ok", "部署成功")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="bt_deploy.py",
        description="宝塔项目一键部署器（skill: bt-panel）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--alias", help="sites.json 站点别名")
    p.add_argument("--panel", help="面板地址（覆盖 BT_URL）")
    p.add_argument("--key", help="API 密钥（覆盖 BT_KEY）")
    p.add_argument("--verify-ssl", action="store_true")
    p.add_argument("--timeout", type=int, default=120)

    p.add_argument("--local", help="本地源目录")
    p.add_argument("--remote", help="远程目标目录，例如 /www/wwwroot/app")
    p.add_argument("--exclude", action="append", default=[], help="排除的文件/目录（可多次）")
    p.add_argument("--database", help="数据库名（如果需要跑 sql）")
    p.add_argument("--sql", help="SQL 字符串或 .sql 文件路径")
    p.add_argument("--restart", action="append", default=[], help="部署后执行的 shell（可多次）")
    p.add_argument("--owner", default="www:www", help="chown 的 owner:group（默认 www:www）")
    p.add_argument("--clean", action="store_true", help="部署前清空目标目录")
    p.add_argument("--backup", action="store_true", help="部署前备份远端目录")
    p.add_argument("--backup-dir", default="/www/backup/bt_skill", help="备份目录")
    p.add_argument("--dry-run", action="store_true", help="仅预览不执行")
    return p


def merge_cfg(args: argparse.Namespace) -> Dict[str, Any]:
    cfg: Dict[str, Any] = {}
    if args.alias:
        cfg.update(load_site_alias(args.alias))
    # CLI 覆盖别名
    for k in (
        "local", "remote", "database", "sql", "owner",
        "backup_dir",
    ):
        v = getattr(args, k, None)
        if v:
            cfg[k] = v
    if args.exclude:
        cfg["exclude"] = (cfg.get("exclude") or []) + args.exclude
    if args.restart:
        cfg["restart"] = (cfg.get("restart") or []) + args.restart
    if args.clean:
        cfg["clean"] = True
    if args.backup:
        cfg["backup"] = True
    # 默认 exclude
    if "exclude" not in cfg:
        cfg["exclude"] = ["node_modules", ".git", ".DS_Store", "*.log", "*.pyc", "__pycache__"]
    return cfg


def build_client(args: argparse.Namespace) -> BtClient:
    panel = args.panel or os.environ.get("BT_URL") or os.environ.get("BT_PANEL")
    key = args.key or os.environ.get("BT_KEY") or os.environ.get("BT_API_KEY")
    if args.alias:
        alias_cfg = load_site_alias(args.alias)
        panel = panel or alias_cfg.get("panel")
        key = key or alias_cfg.get("key")
    if not panel or not key:
        raise BtError(
            "缺少 panel/key。请指定 --panel/--key、BT_URL/BT_KEY 环境变量，或 --alias。"
        )
    return BtClient(panel, key, verify_ssl=args.verify_ssl, timeout=args.timeout)


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        client = build_client(args)
        cfg = merge_cfg(args)
        if not cfg.get("local") or not cfg.get("remote"):
            raise BtError("缺少 --local 和 --remote（或在 alias 中配置）")
        Deployer(client, cfg, dry_run=args.dry_run).run()
    except BtError as e:
        log("err", str(e))
        return 2
    except KeyboardInterrupt:
        log("warn", "用户中断")
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
