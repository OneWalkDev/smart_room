import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import ROOT, ConfigError, load_settings
from app.ir import IRSender, MockTransmitter
from app.main import create_app

CODES = {
    "power:on": [9000, 4500, 560, 560],
    "power:off": [9000, 4500, 560, 1690],
    "power:half": [1, 2, 3],
    "light:up": [1, 2, 3],
    "light:down": [1, 2, 3],
    "light:30": [1, 2, 3],
    "light:60": [1, 2, 3],
    "light:80": [1, 2, 3],
    "air:cool22": [4, 5, 6],
    "air:cool26": [4, 5, 7],
    "air:heat22": [7, 8, 8],
    "air:heat26": [7, 8, 9],
    "air:dry": [1, 1, 1],
    # air:off は意図的に欠落させる
}


@pytest.fixture
def env(tmp_path: Path):
    codes = tmp_path / "codes.json"
    codes.write_text(json.dumps(CODES))
    settings = load_settings(ROOT / "config.yaml", codes)
    settings.state_file = tmp_path / "state.json"
    settings.gap_ms = 0
    tx = MockTransmitter()
    client = TestClient(create_app(settings, tx))
    return client, tx, settings


def test_config_lists_devices_and_availability(env):
    client, _, _ = env
    cfg = client.get("/api/config").json()
    names = [d["name"] for d in cfg["devices"]]
    assert names == ["light", "air"]
    air = cfg["devices"][1]
    avail = {c["name"]: c["available"] for g in air["groups"] for c in g["commands"]}
    assert avail == {"off": False, "dry": True, "cool22": True, "cool26": True, "heat22": True, "heat26": True}
    assert [s["name"] for s in cfg["scenes"]] == ["all_on", "all_off"]


def test_send_command_transmits_and_records_state(env):
    client, tx, settings = env
    r = client.post("/api/devices/light/full")
    assert r.status_code == 200
    assert tx.sent == [CODES["power:on"]]
    assert r.json()["state"]["light"]["command"] == "full"
    saved = json.loads(settings.state_file.read_text())
    assert saved["light"]["label"] == "全灯"


def test_unknown_command_is_404(env):
    client, tx, _ = env
    assert client.post("/api/devices/light/nope").status_code == 404
    assert client.post("/api/devices/tv/on").status_code == 404
    assert client.post("/api/scenes/nope").status_code == 404
    assert tx.sent == []


def test_missing_code_is_503(env):
    client, tx, _ = env
    r = client.post("/api/devices/air/off")
    assert r.status_code == 503
    assert "air:off" in r.json()["detail"]


def test_scene_runs_steps_in_order(env):
    client, tx, _ = env
    r = client.post("/api/scenes/all_on")
    assert r.status_code == 200
    assert tx.sent == [CODES["light:30"], CODES["air:heat26"]]
    st = client.get("/api/state").json()
    assert st["light"]["command"] == "p30" and st["air"]["command"] == "heat26"


def test_index_served(env):
    client, _, _ = env
    r = client.get("/")
    assert r.status_code == 200 and "お部屋" in r.text


def test_bad_scene_step_rejected(tmp_path):
    cfg = tmp_path / "c.yaml"
    cfg.write_text("devices: {}\nscenes:\n  x: {steps: [light.on]}\n")
    with pytest.raises(ConfigError):
        load_settings(cfg, tmp_path / "none.json")


def test_sender_enforces_gap(monkeypatch):
    import app.ir as ir

    clock = {"t": 100.0}
    slept = []
    monkeypatch.setattr(ir.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(ir.time, "sleep", lambda s: slept.append(s))
    s = IRSender(MockTransmitter(), {"a": [1]}, gap_ms=100)
    s.send("a")
    s.send("a")
    assert slept and abs(slept[0] - 0.1) < 1e-9


def test_yaml_on_off_keys_stay_strings(tmp_path):
    cfg = tmp_path / "c.yaml"
    cfg.write_text("devices:\n  d:\n    groups:\n      - commands:\n          on: {label: a, code: x}\n          off: {label: b, code: y}\n")
    s = load_settings(cfg, tmp_path / "none.json")
    assert [c.name for c in s.devices["d"].groups[0].commands] == ["on", "off"]
