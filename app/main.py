"""SmartRoom API サーバ。

起動: uvicorn --factory app.main:create_app --host 0.0.0.0 --port 3000
実機なしで試す: SMARTROOM_BACKEND=mock uvicorn --factory app.main:create_app --port 3000 --reload
"""
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import ROOT, Command, Settings, load_settings
from .ir import IRError, IRSender, MockTransmitter, PigpioTransmitter, Transmitter

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("smartroom")


class StateStore:
    """各デバイスに「最後に送ったコマンド」を保存する（IRは一方向なので実際の状態ではない）。"""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self.data: Dict[str, dict] = {}
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            pass

    def record(self, cmd: Command) -> None:
        with self._lock:
            self.data[cmd.device] = {"command": cmd.name, "label": cmd.label, "at": time.time()}
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.path)


def make_transmitter(settings: Settings) -> Transmitter:
    backend = os.environ.get("SMARTROOM_BACKEND", "pigpio")
    if backend == "mock":
        log.warning("mock バックエンドで起動（赤外線は送信されません）")
        return MockTransmitter()
    return PigpioTransmitter(settings.gpio, settings.carrier_khz, os.environ.get("PIGPIO_HOST", "localhost"))


def create_app(settings: Optional[Settings] = None, tx: Optional[Transmitter] = None) -> FastAPI:
    settings = settings or load_settings()
    if not settings.codes:
        log.warning("codes.json が空か見つかりません")
    sender = IRSender(tx or make_transmitter(settings), settings.codes, settings.gap_ms)
    state = StateStore(settings.state_file)

    app = FastAPI(title="SmartRoom")

    @app.middleware("http")
    async def no_stale_cache(request, call_next):
        # 更新後に古い JS/CSS が残って画面が壊れないよう、毎回再検証させる（ETag で 304 になるので軽い）
        resp = await call_next(request)
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    def run(cmds: List[Command]) -> dict:
        try:
            for c in cmds:
                sender.send(c.code)
                state.record(c)
        except IRError as e:
            log.error("send failed: %s", e)
            raise HTTPException(status_code=503, detail=str(e))
        return {"ok": True, "sent": [f"{c.device}.{c.name}" for c in cmds], "state": state.data}

    @app.get("/api/config")
    def get_config():
        return {
            "devices": [
                {
                    "name": d.name,
                    "label": d.label,
                    "icon": d.icon,
                    "groups": [
                        {
                            "layout": g.layout,
                            "commands": [
                                {"name": c.name, "label": c.label, "icon": c.icon,
                                 "available": c.code in settings.codes}
                                for c in g.commands
                            ],
                        }
                        for g in d.groups
                    ],
                }
                for d in settings.devices.values()
            ],
            "scenes": [{"name": s.name, "label": s.label, "icon": s.icon} for s in settings.scenes.values()],
        }

    @app.get("/api/state")
    def get_state():
        return state.data

    @app.post("/api/devices/{device}/{command}")
    def send_command(device: str, command: str):
        dev = settings.devices.get(device)
        cmd = dev.command(command) if dev else None
        if cmd is None:
            raise HTTPException(status_code=404, detail="unknown command")
        return run([cmd])

    @app.post("/api/scenes/{scene}")
    def run_scene(scene: str):
        sc = settings.scenes.get(scene)
        if sc is None:
            raise HTTPException(status_code=404, detail="unknown scene")
        return run(sc.steps)

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    static_dir = ROOT / "static"
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/")
    def index():
        return FileResponse(static_dir / "index.html")

    return app
