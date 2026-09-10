"""Self-update from the git repository the box was installed from.

check()  : fetch and compare HEAD with origin/<branch>
start()  : run system/update.sh as a transient systemd unit (survives our restart)
status() : is the unit running, its recent log, and the last result
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from . import sysinfo

log = logging.getLogger("pioneertv.updater")

REPO_FILE = Path("/etc/pioneer-tv/repo")
LAST_FILE = Path("/var/lib/pioneer-tv/last-update.json")
UNIT = "pioneer-tv-update"


def repo_path() -> Path | None:
    try:
        p = Path(REPO_FILE.read_text().strip())
        return p if (p / ".git").exists() else None
    except OSError:
        return None


async def _git(repo: Path, *args: str, timeout: float = 30) -> tuple[int, str]:
    return await sysinfo.run("git", "-C", str(repo), *args, timeout=timeout)


async def version() -> dict:
    repo = repo_path()
    if not repo:
        return {"available": False}
    rc, head = await _git(repo, "rev-parse", "--short", "HEAD")
    _, branch = await _git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    _, date = await _git(repo, "log", "-1", "--format=%cs")
    _, subject = await _git(repo, "log", "-1", "--format=%s")
    return {
        "available": rc == 0,
        "repo": str(repo),
        "commit": head.strip(),
        "branch": branch.strip(),
        "date": date.strip(),
        "subject": subject.strip(),
    }


async def check(fetch: bool = True) -> dict:
    info = await version()
    if not info.get("available"):
        return {**info, "error": "no git checkout recorded in /etc/pioneer-tv/repo"}
    repo = Path(info["repo"])
    branch = info["branch"]
    if fetch:
        rc, out = await _git(repo, "fetch", "--quiet", "origin", branch, timeout=60)
        if rc != 0:
            return {**info, "error": f"fetch failed: {out.strip()[-300:]}"}
    _, remote = await _git(repo, "rev-parse", "--short", f"origin/{branch}")
    _, count = await _git(repo, "rev-list", "--count", f"HEAD..origin/{branch}")
    _, log_out = await _git(repo, "log", "--format=%h %cs %s", f"HEAD..origin/{branch}")
    _, dirty = await _git(repo, "status", "--porcelain")
    try:
        behind = int(count.strip())
    except ValueError:
        behind = 0
    return {
        **info,
        "remote": remote.strip(),
        "behind": behind,
        "commits": [line for line in log_out.strip().splitlines() if line][:30],
        "dirty": bool(dirty.strip()),
        "checked": int(time.time()),
    }


async def running() -> bool:
    rc, out = await sysinfo.run("systemctl", "is-active", UNIT, timeout=5)
    return out.strip() in ("active", "activating")


async def start(force: bool = False) -> tuple[bool, str]:
    if await running():
        return True, "update already running"
    repo = repo_path()
    if not repo:
        return False, "no git checkout recorded in /etc/pioneer-tv/repo"
    script = "/opt/pioneer-tv/system/update.sh"
    if not Path(script).exists():
        script = str(repo / "system" / "update.sh")
    cmd = ["systemd-run", "--unit", UNIT, "--collect", "--description", "Pioneer TV update"]
    if force:
        cmd += ["--setenv", "PIONEER_TV_FORCE=1"]
    cmd += [script]
    rc, out = await sysinfo.run(*cmd, timeout=15)
    log.info("update started rc=%s %s", rc, out.strip())
    return rc == 0, out.strip()[-300:]


def last_result() -> dict | None:
    try:
        return json.loads(LAST_FILE.read_text())
    except (OSError, ValueError):
        return None


async def status() -> dict:
    active = await running()
    _, out = await sysinfo.run("journalctl", "-u", UNIT, "-n", "40", "--no-pager", "-o", "cat", timeout=8)
    return {"running": active, "log": out.strip()[-4000:], "last": last_result()}
