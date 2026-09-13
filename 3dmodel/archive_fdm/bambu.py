#!/usr/bin/env python3
"""
拓竹打印机局域网控制器（H2S / 通用 Bambu Lab）

协议依据：社区反向工程文档 OpenBambuAPI，以及拓竹官方对 Developer Mode 的说明。
    MQTT over TLS : {IP}:8883   用户名 bblp / 密码 = 打印机访问码
                    订阅 device/{SN}/report   发布 device/{SN}/request
    FTPS implicit : {IP}:990    同一套凭据，用于上传 3mf

前置条件（必须在打印机触摸屏上手动开启）：
    设置 → 网络 → LAN Only Mode 打开
    其下方 Developer Mode 打开
不开 Developer Mode，8883 与 990 都不会监听，本脚本会连接超时。

安全设计：
    · 下发打印必须显式带 --confirm，杜绝手滑启动一台会加热到 220℃ 的设备
    · 已有任务在跑时拒绝再次下发
    · 访问码只从环境变量 / .env 读取，任何输出都不回显它
"""

from __future__ import annotations

import argparse
import ftplib
import json
import os
import re
import ssl
import sys
import threading
import time
import zipfile
from pathlib import Path

try:
    import paho.mqtt.client as mqtt
except ImportError:
    sys.exit("缺少依赖：pip install paho-mqtt")

MQTT_PORT = 8883
FTPS_PORT = 990
MQTT_USER = "bblp"

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------


def load_env(path: Path | None = None) -> None:
    """极简 .env 读取；已存在的环境变量优先，不覆盖。"""
    path = path or Path(__file__).resolve().parent / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("'\""))


class Config:
    def __init__(self):
        load_env()
        self.host = os.environ.get("BAMBU_HOST", "").strip()
        self.code = os.environ.get("BAMBU_ACCESS_CODE", "").strip()
        self.serial = os.environ.get("BAMBU_SERIAL", "").strip()

    def require(self):
        missing = [
            n
            for n, v in (
                ("BAMBU_HOST", self.host),
                ("BAMBU_ACCESS_CODE", self.code),
                ("BAMBU_SERIAL", self.serial),
            )
            if not v
        ]
        if missing:
            sys.exit(
                "缺少配置: " + ", ".join(missing) + "\n"
                "请在 3dprint/.env 中填写（参考 .env.example）：\n"
                "  BAMBU_HOST=192.168.x.x\n"
                "  BAMBU_ACCESS_CODE=<屏幕上的访问码>\n"
                "  BAMBU_SERIAL=<机器序列号>"
            )
        return self

    def redacted(self):
        return f"host={self.host} serial={self.serial[:4]}…{self.serial[-3:]} code=<已隐藏>"


# ---------------------------------------------------------------------------
# FTPS：拓竹用的是 implicit TLS（990），Python 标准库只原生支持 explicit
# ---------------------------------------------------------------------------


class ImplicitFTPS(ftplib.FTP_TLS):
    """
    拓竹 FTPS 有两个必须同时处理的特性，缺一个都连不上：

    1. implicit TLS：连接建立的瞬间就必须是 TLS，没有 AUTH TLS 协商阶段。
       标准 FTP_TLS 会先明文握手，因此要在 socket 赋值时立刻包一层 SSL。

    2. TLS 会话复用：数据通道必须复用控制通道的 SSL session，否则服务器
       拒绝并返回 `522 SSL connection failed: session reuse required`。
       ftplib 默认每条数据连接重新握手，因此必须重写 ntransfercmd。
    """

    def __init__(self, *args, **kwargs):
        self._sock = None
        super().__init__(*args, **kwargs)

    @property
    def sock(self):
        return self._sock

    @sock.setter
    def sock(self, value):
        if value is not None and not isinstance(value, ssl.SSLSocket):
            value = self.context.wrap_socket(value)
        self._sock = value

    def ntransfercmd(self, cmd, rest=None):
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            # session=... 是关键：把控制通道的 TLS 会话带到数据通道
            conn = self.context.wrap_socket(conn, session=self.sock.session)
        return conn, size


def ftps_connect(cfg: Config, timeout: int = 30) -> ImplicitFTPS:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    # 打印机用自签证书，且无法安装 CA；关闭校验是本地直连的既定做法
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ftp = ImplicitFTPS(context=ctx, timeout=timeout)
    ftp.connect(cfg.host, FTPS_PORT)
    ftp.login(MQTT_USER, cfg.code)
    ftp.prot_p()  # 数据通道也加密
    ftp.set_pasv(True)
    return ftp


def upload(cfg: Config, local: Path, remote_name: str | None = None) -> str:
    remote = remote_name or local.name
    size = local.stat().st_size
    ftp = ftps_connect(cfg)
    try:
        sent = 0
        last = [time.time()]

        def cb(block):
            nonlocal sent
            sent += len(block)
            if time.time() - last[0] > 0.5:
                pct = 100.0 * sent / size
                print(f"\r  上传 {pct:5.1f}%  ({sent/1e6:.1f}/{size/1e6:.1f} MB)", end="")
                last[0] = time.time()

        with local.open("rb") as fh:
            ftp.storbinary(f"STOR {remote}", fh, blocksize=256 * 1024, callback=cb)
        print(f"\r  上传 100.0%  ({size/1e6:.1f} MB) 完成      ")
        return remote
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


def ftps_list(cfg: Config) -> list[str]:
    ftp = ftps_connect(cfg)
    try:
        return sorted(ftp.nlst())
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


# ---------------------------------------------------------------------------
# MQTT
# ---------------------------------------------------------------------------


class Printer:
    def __init__(self, cfg: Config, verbose: bool = False):
        self.cfg = cfg
        self.verbose = verbose
        self.state: dict = {}
        self._seq = 0
        self._ready = threading.Event()
        self._got_status = threading.Event()
        self._lock = threading.Lock()

        self.topic_report = f"device/{cfg.serial}/report"
        self.topic_request = f"device/{cfg.serial}/request"

        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, protocol=mqtt.MQTTv311
        )
        self.client.username_pw_set(MQTT_USER, cfg.code)
        self.client.tls_set(cert_reqs=ssl.CERT_NONE, tls_version=ssl.PROTOCOL_TLS_CLIENT)
        self.client.tls_insecure_set(True)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    # -- 生命周期 ----------------------------------------------------------

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            print(f"MQTT 连接被拒绝: {reason_code}", file=sys.stderr)
            return
        client.subscribe(self.topic_report, qos=0)
        self._ready.set()

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8", "replace"))
        except Exception:
            return
        with self._lock:
            # P1/A1 只推变化字段，H2/X1 推全量 —— 因此必须做递归合并
            for section, body in payload.items():
                if isinstance(body, dict):
                    self.state.setdefault(section, {}).update(body)
                else:
                    self.state[section] = body
        if "print" in payload:
            self._got_status.set()
        if self.verbose:
            print(json.dumps(payload, ensure_ascii=False)[:400])

    def connect(self, timeout: int = 15):
        self.client.connect(self.cfg.host, MQTT_PORT, keepalive=60)
        self.client.loop_start()
        if not self._ready.wait(timeout):
            self.close()
            sys.exit(
                f"MQTT 连接超时 {self.cfg.host}:{MQTT_PORT}\n"
                "排查顺序：\n"
                "  1. 打印机屏幕 → 网络 → LAN Only Mode 是否开启\n"
                "  2. 其下方 Developer Mode 是否开启（不开则 8883 不监听）\n"
                "  3. IP 是否正确、是否与本机在同一网段\n"
                "  4. 访问码是否与屏幕上一致（重启路由或改网络后会变）"
            )
        return self

    def close(self):
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass

    # -- 指令 --------------------------------------------------------------

    def send(self, payload: dict, qos: int = 1):
        self._seq += 1
        for body in payload.values():
            if isinstance(body, dict):
                body.setdefault("sequence_id", str(self._seq))
        self.client.publish(self.topic_request, json.dumps(payload), qos=qos)

    def pushall(self, timeout: int = 12) -> dict:
        """拉全量状态。注意 P1 系列不宜 5 分钟内重复调用，H2 无此限制。"""
        self._got_status.clear()
        self.send(
            {
                "pushing": {
                    "command": "pushall",
                    "version": 1,
                    "push_target": 1,
                }
            }
        )
        self._got_status.wait(timeout)
        with self._lock:
            return json.loads(json.dumps(self.state))

    def simple(self, command: str):
        self.send({"print": {"command": command, "param": ""}})

    def set_light(self, on: bool):
        self.send(
            {
                "system": {
                    "command": "ledctrl",
                    "led_node": "chamber_light",
                    "led_mode": "on" if on else "off",
                    "led_on_time": 500,
                    "led_off_time": 500,
                    "loop_times": 0,
                    "interval_time": 0,
                }
            }
        )

    def start_print(
        self,
        remote_file: str,
        plate: int = 1,
        use_ams: bool = True,
        ams_slot: int = 0,
        bed_leveling: bool = True,
        flow_cali: bool = False,
        timelapse: bool = False,
    ):
        """
        下发 3mf 打印。remote_file 必须已通过 FTPS 上传到打印机根目录。
        url 用 ftp:/// 前缀指向 SD 卡根目录（三个斜杠是协议要求，非笔误）。
        """
        payload = {
            "print": {
                "command": "project_file",
                "param": f"Metadata/plate_{plate}.gcode",
                "url": f"ftp:///{remote_file}",
                "subtask_name": Path(remote_file).stem,
                "project_id": "0",
                "profile_id": "0",
                "task_id": "0",
                "subtask_id": "0",
                "use_ams": bool(use_ams),
                "timelapse": bool(timelapse),
                "bed_leveling": bool(bed_leveling),
                "flow_cali": bool(flow_cali),
                "vibration_cali": True,
                "layer_inspect": False,
            }
        }
        if use_ams:
            payload["print"]["ams_mapping"] = [int(ams_slot)]
        self.send(payload, qos=1)


# ---------------------------------------------------------------------------
# 状态呈现
# ---------------------------------------------------------------------------

GCODE_STATE_CN = {
    "IDLE": "空闲",
    "PREPARE": "准备中",
    "RUNNING": "打印中",
    "PAUSE": "已暂停",
    "FINISH": "已完成",
    "FAILED": "失败",
    "SLICING": "切片中",
}


def describe(state: dict) -> str:
    p = state.get("print", {})
    if not p:
        return "（尚未收到状态）"
    gs = p.get("gcode_state", "?")
    lines = [
        f"状态      : {GCODE_STATE_CN.get(gs, gs)}",
        f"任务      : {p.get('subtask_name') or '—'}",
        f"进度      : {p.get('mc_percent', '—')}%   剩余 {p.get('mc_remaining_time', '—')} 分钟",
        f"层        : {p.get('layer_num', '—')} / {p.get('total_layer_num', '—')}",
        f"喷嘴      : {p.get('nozzle_temper', '—')}℃ → {p.get('nozzle_target_temper', '—')}℃",
        f"热床      : {p.get('bed_temper', '—')}℃ → {p.get('bed_target_temper', '—')}℃",
        f"风扇/速度 : 冷却 {p.get('cooling_fan_speed', '—')}   档位 {p.get('spd_lvl', '—')}",
    ]
    for h in p.get("hms") or []:
        code = hms_code(h)
        note = HMS_BENIGN.get(code)
        lines.append(f"HMS       : {code}" + (f"  —— {note}" if note else "  —— 需查证"))
    return "\n".join(lines)


def is_busy(state: dict) -> bool:
    gs = (state.get("print") or {}).get("gcode_state", "")
    return gs in ("RUNNING", "PAUSE", "PREPARE", "SLICING")


def hms_code(h: dict) -> str:
    """把 MQTT 里的 attr/code 整数对还原成拓竹官方的 HMS 编号写法。"""
    a, c = int(h.get("attr", 0)), int(h.get("code", 0))
    return f"HMS_{a >> 16:04X}_{a & 0xFFFF:04X}_{c >> 16:04X}_{c & 0xFFFF:04X}"


# 已确认无害、不应阻塞打印的 HMS 码
HMS_BENIGN = {
    # 通信层校验失败：由第三方下发未授权的特权指令（如 gcode_line）触发。
    # 与硬件无关，机器空闲、目标温度为 0、无运动。重启打印机后自动清除。
    "HMS_0500_0500_0001_0007": "MQTT 指令校验失败（通信层，非硬件故障）",
}


# ---------------------------------------------------------------------------
# 预检：把物理层面的阻塞在下发前拦住
# ---------------------------------------------------------------------------


def read_3mf_filament(three_mf: Path) -> dict:
    """读出 3mf 切片时假定的耗材，用于和 AMS 实装料比对。"""
    info = {}
    try:
        with zipfile.ZipFile(three_mf) as z:
            raw = z.read("Metadata/slice_info.config").decode("utf-8", "replace")
    except Exception:
        return info
    for key, pat in (
        # 必须写 \stype= —— 同一个 <filament> 标签里还有 volume_type="Standard"，
        # 用 type=" 会因 [^>]* 贪婪回溯匹配到它，解析出 "Standard" 这种假材料名。
        ("type", r'<filament[^>]*\stype="([^"]*)"'),
        ("used_m", r'<filament[^>]*\sused_m="([^"]*)"'),
        ("prediction", r'key="prediction" value="(\d+)"'),
    ):
        m = re.search(pat, raw)
        if m:
            info[key] = m.group(1)
    return info


def ams_trays(state: dict) -> list[dict]:
    ams = (state.get("print") or {}).get("ams") or {}
    out = []
    for unit in ams.get("ams") or []:
        for t in unit.get("tray") or []:
            out.append(
                {
                    "unit": unit.get("id"),
                    "slot": int(t.get("id", -1)),
                    "type": (t.get("tray_type") or "").strip(),
                    "brand": (t.get("tray_sub_brands") or "").strip(),
                    "color": t.get("tray_color"),
                    "remain": t.get("remain"),
                }
            )
    return out


def preflight(
    state: dict, three_mf: Path | None, ams_slot: int, use_ams: bool
) -> list[str]:
    """返回阻塞项清单；空列表代表可以下发。"""
    pr = state.get("print") or {}
    if not pr:
        return ["无法读取打印机状态"]

    problems = []

    if is_busy(state):
        gs = pr.get("gcode_state")
        problems.append(f"打印机正忙（{GCODE_STATE_CN.get(gs, gs)}）")

    # 无存储卡时 FTPS 能登录、列目录为空，直到 STOR 才报 553 —— 必须提前拦
    if pr.get("sdcard") is False:
        problems.append(
            "无存储卡（sdcard=False）。拓竹要先把 3mf 存进机内存储卡才能打印；\n"
            "       无卡时 FTPS 能登录、列目录为空，直到上传才报 553。\n"
            "       → 需插入 microSD 卡"
        )

    for h in pr.get("hms") or []:
        code = hms_code(h)
        if code in HMS_BENIGN:
            print(f"⚠️  HMS {code}：{HMS_BENIGN[code]}（不阻塞打印）")
        else:
            problems.append(f"HMS 报警 {code} —— 含义未知，请在 Studio 的助手(HMS) 里查看")

    # 耗材比对：切片假定的材料必须和 AMS 实装一致，否则温度差会导致失败
    if three_mf and three_mf.is_file() and use_ams:
        want = read_3mf_filament(three_mf).get("type", "")
        tray = next((t for t in ams_trays(state) if t["slot"] == ams_slot), None)
        if want:
            if tray is None or not tray["type"]:
                problems.append(f"AMS 槽 {ams_slot} 为空，但 3mf 需要 {want}")
            elif tray["type"].upper() != want.upper():
                problems.append(
                    f"耗材不符：3mf 按 {want} 切片，AMS 槽 {ams_slot} 实装 "
                    f"{tray['type']}（{tray['brand']}）。\n"
                    "       两者喷嘴温度差别很大（PLA 220℃ / PETG 245℃），\n"
                    "       直接打印会挤出不足或层间不粘。\n"
                    f"       → 换料，或用 slice.py --filament 按 {tray['type']} 重切"
                )
    return problems


def report_preflight(problems: list[str]) -> bool:
    if not problems:
        print("✅ 预检通过，可以下发打印")
        return True
    print(f"❌ 预检发现 {len(problems)} 项阻塞：")
    for i, p in enumerate(problems, 1):
        print(f"  {i}. {p}")
    return False


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(
        description="拓竹打印机局域网控制器（需先开启 Developer Mode）"
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check", help="仅检查配置与端口连通性，不下发任何指令")
    sub.add_parser("status", help="拉取并显示当前状态")
    sub.add_parser("files", help="列出打印机 SD 卡根目录文件")
    sub.add_parser("ams", help="显示 AMS 各槽实装耗材")

    pf = sub.add_parser("preflight", help="打印前预检（只读，不下发）")
    pf.add_argument("file", nargs="?", help="要打印的 3mf，用于比对耗材")
    pf.add_argument("--ams-slot", type=int, default=0)
    pf.add_argument("--no-ams", action="store_true")
    sub.add_parser("pause", help="暂停")
    sub.add_parser("resume", help="恢复")
    sub.add_parser("stop", help="停止（不可撤销）")

    w = sub.add_parser("watch", help="持续监看状态")
    w.add_argument("--interval", type=float, default=5.0)
    w.add_argument("--raw", action="store_true", help="打印原始 MQTT 报文")

    l = sub.add_parser("light", help="腔体灯")
    l.add_argument("mode", choices=["on", "off"])

    u = sub.add_parser("upload", help="上传文件到打印机")
    u.add_argument("file")

    pr = sub.add_parser("print", help="上传并开始打印（需 --confirm）")
    pr.add_argument("file")
    pr.add_argument("--plate", type=int, default=1)
    pr.add_argument("--no-ams", action="store_true", help="用外置料架而非 AMS")
    pr.add_argument("--ams-slot", type=int, default=0, help="AMS 槽位，0 起算")
    pr.add_argument("--no-leveling", action="store_true")
    pr.add_argument("--timelapse", action="store_true")
    pr.add_argument("--skip-upload", action="store_true", help="文件已在机器上")
    pr.add_argument(
        "--confirm",
        action="store_true",
        help="确认下发。这会让设备加热到 200℃ 以上并开始动作。",
    )

    args = ap.parse_args()
    cfg = Config().require()

    # -- check：只测连通，不碰打印机状态 --------------------------------
    if args.cmd == "check":
        import socket

        print(f"配置    : {cfg.redacted()}")
        for name, port in (("MQTT", MQTT_PORT), ("FTPS", FTPS_PORT)):
            s = socket.socket()
            s.settimeout(5)
            try:
                s.connect((cfg.host, port))
                print(f"{name:5s} {cfg.host}:{port}  ✅ 端口开放")
            except Exception as e:
                print(f"{name:5s} {cfg.host}:{port}  ❌ {e}")
            finally:
                s.close()
        print("\n若两个端口都不通，最可能是 Developer Mode 未开启。")
        return

    if args.cmd == "files":
        for n in ftps_list(cfg):
            print(" ", n)
        return

    if args.cmd == "upload":
        f = Path(args.file).expanduser().resolve()
        if not f.is_file():
            sys.exit(f"文件不存在: {f}")
        print(f"上传 {f.name} → {cfg.host}")
        upload(cfg, f)
        return

    p = Printer(cfg, verbose=getattr(args, "raw", False)).connect()
    try:
        if args.cmd == "status":
            print(describe(p.pushall()))

        elif args.cmd == "ams":
            st = p.pushall()
            trays = ams_trays(st)
            if not trays:
                print("未检测到 AMS")
            else:
                cur = (st.get("print", {}).get("ams") or {}).get("tray_now")
                print(f"{'槽':<4}{'材料':<10}{'品牌':<18}{'颜色':<11}{'剩余':<7}")
                print("-" * 52)
                for t in trays:
                    mark = " ←当前" if str(t["slot"]) == str(cur) else ""
                    kind = t["type"] or "(空)"
                    rem = f"{t['remain']}%" if t["remain"] not in (None, -1) else "—"
                    print(
                        f"{t['slot']:<4}{kind:<10}{t['brand'] or '—':<18}"
                        f"{t['color'] or '—':<11}{rem:<7}{mark}"
                    )

        elif args.cmd == "preflight":
            st = p.pushall()
            print(describe(st))
            print()
            f = Path(args.file).expanduser().resolve() if args.file else None
            if f and not f.is_file():
                print(f"（指定的文件不存在，跳过耗材比对: {f}）\n")
                f = None
            if f:
                fi = read_3mf_filament(f)
                print(
                    f"待打印  : {f.name}  材料={fi.get('type','?')}  "
                    f"用料={fi.get('used_m','?')}m\n"
                )
            report_preflight(
                preflight(st, f, ams_slot=args.ams_slot, use_ams=not args.no_ams)
            )

        elif args.cmd == "watch":
            p.pushall()
            try:
                while True:
                    print("\033[2J\033[H" + time.strftime("%H:%M:%S"))
                    with p._lock:
                        snap = json.loads(json.dumps(p.state))
                    print(describe(snap))
                    time.sleep(args.interval)
            except KeyboardInterrupt:
                print("\n停止监看")

        elif args.cmd in ("pause", "resume", "stop"):
            if args.cmd == "stop":
                st = p.pushall()
                if not is_busy(st):
                    print("当前没有正在进行的任务，无需停止。")
                    return
            p.simple(args.cmd)
            time.sleep(2)
            print(f"已发送 {args.cmd}")
            print(describe(p.pushall()))

        elif args.cmd == "light":
            p.set_light(args.mode == "on")
            print(f"腔体灯 → {args.mode}")

        elif args.cmd == "print":
            f = Path(args.file).expanduser().resolve()
            if not args.skip_upload and not f.is_file():
                sys.exit(f"文件不存在: {f}")

            st = p.pushall()
            print(describe(st))
            print()
            problems = preflight(
                st,
                f if f.is_file() else None,
                ams_slot=args.ams_slot,
                use_ams=not args.no_ams,
            )
            ok = report_preflight(problems)
            if not ok:
                sys.exit("\n拒绝下发。请先处理上述问题。")

            if not args.confirm:
                print(
                    "\n以上为预检结果。确认无误后加 --confirm 再次执行以真正开始打印。\n"
                    "打印机将开始加热并动作，首件请留人在旁看完首层。"
                )
                return

            remote = f.name
            if not args.skip_upload:
                print(f"上传 {remote} …")
                upload(cfg, f)

            p.start_print(
                remote,
                plate=args.plate,
                use_ams=not args.no_ams,
                ams_slot=args.ams_slot,
                bed_leveling=not args.no_leveling,
                timelapse=args.timelapse,
            )
            print("已下发打印指令，等待打印机响应 …")
            for _ in range(10):
                time.sleep(3)
                st = p.pushall(timeout=6)
                if is_busy(st):
                    break
            print(describe(st))
            print("\n用 `bambu.py watch` 持续监看，`bambu.py stop` 中止。")
    finally:
        p.close()


if __name__ == "__main__":
    main()
