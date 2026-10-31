"""設定ファイル (config.yaml) と学習済みコード (codes.json) の読み込み。"""
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import yaml

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Command:
    device: str
    name: str
    label: str
    code: str
    icon: Optional[str] = None


@dataclass
class Group:
    layout: str
    commands: List[Command]


@dataclass
class Device:
    name: str
    label: str
    icon: Optional[str]
    groups: List[Group]

    def command(self, name: str) -> Optional[Command]:
        for g in self.groups:
            for c in g.commands:
                if c.name == name:
                    return c
        return None


@dataclass
class Scene:
    name: str
    label: str
    icon: Optional[str]
    steps: List[Command]


@dataclass
class Settings:
    gpio: int
    carrier_khz: float
    gap_ms: int
    devices: Dict[str, Device]
    scenes: Dict[str, Scene]
    codes: Dict[str, List[int]] = field(default_factory=dict)
    state_file: Path = ROOT / "state.json"


class ConfigError(ValueError):
    pass


class _Loader(yaml.SafeLoader):
    """YAML 1.1 では on/off/yes/no が真偽値になるので、true/false だけを真偽値として扱う。"""


_Loader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:bool"]
    for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
_Loader.add_implicit_resolver(
    "tag:yaml.org,2002:bool", re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"), list("tTfF")
)


def load_settings(
    config_path: Optional[Path] = None, codes_path: Optional[Path] = None
) -> Settings:
    config_path = Path(config_path or os.environ.get("SMARTROOM_CONFIG", ROOT / "config.yaml"))
    codes_path = Path(codes_path or os.environ.get("SMARTROOM_CODES", ROOT / "codes.json"))

    raw = yaml.load(config_path.read_text(encoding="utf-8"), Loader=_Loader) or {}

    codes: Dict[str, List[int]] = {}
    if codes_path.exists():
        codes = json.loads(codes_path.read_text(encoding="utf-8"))

    devices: Dict[str, Device] = {}
    for dname, d in (raw.get("devices") or {}).items():
        groups = []
        for g in d.get("groups") or []:
            cmds = [
                Command(device=dname, name=cname, label=c["label"], code=c["code"], icon=c.get("icon"))
                for cname, c in (g.get("commands") or {}).items()
            ]
            groups.append(Group(layout=g.get("layout", "tiles"), commands=cmds))
        devices[dname] = Device(name=dname, label=d.get("label", dname), icon=d.get("icon"), groups=groups)

    scenes: Dict[str, Scene] = {}
    for sname, s in (raw.get("scenes") or {}).items():
        steps = []
        for ref in s.get("steps") or []:
            dname, _, cname = ref.partition(".")
            dev = devices.get(dname)
            cmd = dev.command(cname) if dev else None
            if cmd is None:
                raise ConfigError(f"scene '{sname}': unknown step '{ref}'")
            steps.append(cmd)
        scenes[sname] = Scene(name=sname, label=s.get("label", sname), icon=s.get("icon"), steps=steps)

    state_file = Path(os.environ.get("SMARTROOM_STATE", ROOT / "state.json"))

    return Settings(
        gpio=int(raw.get("gpio", 22)),
        carrier_khz=float(raw.get("carrier_khz", 38.0)),
        gap_ms=int(raw.get("gap_ms", 100)),
        devices=devices,
        scenes=scenes,
        codes=codes,
        state_file=state_file,
    )
