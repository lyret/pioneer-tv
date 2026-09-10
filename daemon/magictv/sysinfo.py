"""System status: network, Tailscale, Bluetooth, thermals, gamepads."""
from __future__ import annotations

import asyncio
import glob
import json
import logging
import os
import re
import shutil
import time
from urllib.parse import urlparse

log = logging.getLogger("magictv.sysinfo")


async def run(*cmd: str, timeout: float = 8.0, stdin: str | None = None) -> tuple[int, str]:
    """Run a command, return (rc, stdout+stderr). Missing binaries give rc 127."""
    if shutil.which(cmd[0]) is None:
        return 127, f"{cmd[0]}: not installed"
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE if stdin is not None else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(stdin.encode() if stdin is not None else None), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "timeout"
    return proc.returncode or 0, out.decode(errors="replace")


# ------------------------------------------------------------------ network

async def interfaces() -> list[dict]:
    rc, out = await run("ip", "-j", "-4", "addr")
    if rc != 0:
        return []
    result = []
    try:
        for it in json.loads(out):
            if it.get("ifname") == "lo":
                continue
            addrs = [a["local"] for a in it.get("addr_info", []) if a.get("family") == "inet"]
            result.append({"name": it.get("ifname"), "up": "UP" in it.get("flags", []), "addresses": addrs})
    except (ValueError, KeyError):
        pass
    return result


async def wifi_status() -> dict:
    """Active Wi-Fi connection according to NetworkManager."""
    rc, out = await run("nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device")
    info = {"available": rc == 0, "device": None, "state": "unknown", "ssid": None, "signal": None}
    if rc != 0:
        return info
    for line in out.splitlines():
        parts = line.split(":")
        if len(parts) >= 4 and parts[1] == "wifi":
            info.update(device=parts[0], state=parts[2], ssid=parts[3] or None)
            break
    if info["state"] == "connected":
        rc, out = await run("nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "device", "wifi", "list")
        for line in out.splitlines():
            parts = line.split(":")
            if len(parts) >= 3 and parts[0] == "yes":
                info["ssid"] = parts[1]
                try:
                    info["signal"] = int(parts[2])
                except ValueError:
                    pass
                break
    return info


async def wifi_networks(rescan: bool = False) -> list[dict]:
    if rescan:
        await run("nmcli", "device", "wifi", "rescan", timeout=15)
        await asyncio.sleep(2)
    rc, out = await run("nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL,SECURITY", "device", "wifi", "list")
    nets: dict[str, dict] = {}
    if rc != 0:
        return []
    for line in out.splitlines():
        parts = line.split(":")
        if len(parts) < 4 or not parts[1]:
            continue
        ssid = parts[1]
        try:
            signal = int(parts[2])
        except ValueError:
            signal = 0
        cur = nets.get(ssid)
        if cur is None or signal > cur["signal"]:
            nets[ssid] = {"ssid": ssid, "signal": signal, "security": parts[3], "active": parts[0] == "yes"}
    return sorted(nets.values(), key=lambda n: (-int(n["active"]), -n["signal"]))


async def wifi_connect(ssid: str, password: str | None) -> tuple[bool, str]:
    cmd = ["nmcli", "device", "wifi", "connect", ssid]
    if password:
        cmd += ["password", password]
    rc, out = await run(*cmd, timeout=45)
    return rc == 0, out.strip()


async def wifi_forget(ssid: str) -> tuple[bool, str]:
    rc, out = await run("nmcli", "connection", "delete", "id", ssid, timeout=15)
    return rc == 0, out.strip()


async def tailscale_status(plex_url: str | None = None) -> dict:
    rc, out = await run("tailscale", "status", "--json")
    info = {"installed": rc != 127, "state": "unknown", "ips": [], "dns_name": None, "peers": [], "plex_online": None}
    if rc != 0:
        info["state"] = "stopped" if rc != 127 else "not installed"
        return info
    try:
        data = json.loads(out)
    except ValueError:
        return info
    info["state"] = str(data.get("BackendState", "unknown")).lower()
    self_ = data.get("Self") or {}
    info["ips"] = self_.get("TailscaleIPs") or []
    info["dns_name"] = (self_.get("DNSName") or "").rstrip(".") or None
    plex_host = urlparse(plex_url).hostname.lower().split(".")[0] if plex_url else None
    for peer in (data.get("Peer") or {}).values():
        host = peer.get("HostName") or ""
        online = bool(peer.get("Online"))
        info["peers"].append({"host": host, "online": online, "ips": peer.get("TailscaleIPs") or []})
        if plex_host and host.lower() == plex_host:
            info["plex_online"] = online
    info["peers"].sort(key=lambda p: (not p["online"], p["host"]))
    return info


# ------------------------------------------------------------------ bluetooth

RE_DEVICE = re.compile(r"^Device ([0-9A-F:]{17}) (.*)$", re.M)


async def bluetooth_devices() -> list[dict]:
    rc, out = await run("bluetoothctl", "devices")
    if rc != 0:
        return []
    devices = []
    for mac, name in RE_DEVICE.findall(out):
        _, info = await run("bluetoothctl", "info", mac, timeout=5)
        flags = {k: ("yes" in v) for k, v in re.findall(r"^\s*(Connected|Paired|Trusted): (\w+)$", info, re.M)}
        batt = re.search(r"Battery Percentage: 0x[0-9a-f]+ \((\d+)\)", info)
        icon = re.search(r"^\s*Icon: (\S+)$", info, re.M)
        devices.append({
            "mac": mac, "name": name,
            "connected": flags.get("Connected", False),
            "paired": flags.get("Paired", False),
            "trusted": flags.get("Trusted", False),
            "battery": int(batt.group(1)) if batt else None,
            "icon": icon.group(1) if icon else None,
        })
    devices.sort(key=lambda d: (not d["connected"], not d["paired"], d["name"]))
    return devices


async def bluetooth_scan(seconds: int = 8) -> list[dict]:
    await run("bluetoothctl", "--timeout", str(seconds), "scan", "on", timeout=seconds + 5)
    return await bluetooth_devices()


async def bluetooth_pair(mac: str) -> tuple[bool, str]:
    """Pair, trust and connect. Gamepads need no PIN, so a NoInputNoOutput agent suffices."""
    script = f"agent NoInputNoOutput\ndefault-agent\npair {mac}\n"
    rc, out = await run("bluetoothctl", "--timeout", "25", stdin=script, timeout=30)
    ok = "Pairing successful" in out or "AlreadyExists" in out
    if not ok:
        return False, out.strip()[-400:]
    await run("bluetoothctl", "trust", mac, timeout=10)
    rc, out2 = await run("bluetoothctl", "connect", mac, timeout=20)
    return "Connection successful" in out2 or rc == 0, (out + out2).strip()[-400:]


async def bluetooth_simple(action: str, mac: str) -> tuple[bool, str]:
    assert action in ("connect", "disconnect", "remove", "trust")
    rc, out = await run("bluetoothctl", action, mac, timeout=20)
    return rc == 0, out.strip()[-400:]


# ------------------------------------------------------------------ system

def _read(path: str) -> str | None:
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


async def system_status() -> dict:
    temp = _read("/sys/class/thermal/thermal_zone0/temp")
    rc, thr = await run("vcgencmd", "get_throttled", timeout=3)
    throttled = None
    if rc == 0 and "=" in thr:
        try:
            throttled = int(thr.split("=")[1], 16)
        except ValueError:
            pass
    mem = {}
    for line in (_read("/proc/meminfo") or "").splitlines():
        k, _, v = line.partition(":")
        if k in ("MemTotal", "MemAvailable"):
            mem[k] = int(v.split()[0]) // 1024
    uptime = _read("/proc/uptime")
    load = os.getloadavg()[0] if hasattr(os, "getloadavg") else None
    try:
        st = os.statvfs("/")
        disk = {"total_mb": st.f_blocks * st.f_frsize // 2**20, "free_mb": st.f_bavail * st.f_frsize // 2**20}
    except OSError:
        disk = {}
    return {
        "hostname": os.uname().nodename,
        "temp_c": round(int(temp) / 1000, 1) if temp and temp.isdigit() else None,
        "throttled": throttled,
        "throttled_now": bool(throttled & 0x7) if throttled is not None else None,
        "throttled_ever": bool(throttled & 0x70000) if throttled is not None else None,
        "mem_total_mb": mem.get("MemTotal"),
        "mem_available_mb": mem.get("MemAvailable"),
        "uptime_s": int(float(uptime.split()[0])) if uptime else None,
        "load1": load,
        "disk": disk,
        "time": int(time.time()),
    }


def gamepad_batteries() -> dict[str, int]:
    """Battery levels the kernel exposes for controllers (hid-playstation, xpadneo, ...)."""
    out = {}
    for path in glob.glob("/sys/class/power_supply/*/uevent"):
        data = dict(line.split("=", 1) for line in (_read(path) or "").splitlines() if "=" in line)
        if data.get("POWER_SUPPLY_TYPE", "").lower() != "battery":
            continue
        cap = data.get("POWER_SUPPLY_CAPACITY")
        if cap and cap.isdigit():
            out[data.get("POWER_SUPPLY_MODEL_NAME") or os.path.basename(os.path.dirname(path))] = int(cap)
    return out
