"""赤外線送信。

irrp.py (joan2937/pigpio のサンプル) の再生処理を移植したもの。
毎回 python プロセスを起動せず、pigpiod に常時接続して送信する。
"""
import logging
import threading
import time
from typing import Dict, List, Protocol

log = logging.getLogger("smartroom.ir")


class IRError(RuntimeError):
    pass


class Transmitter(Protocol):
    def send(self, code: List[int]) -> None: ...


class MockTransmitter:
    """実機なしで動かすためのダミー。送ったコードを記録するだけ。"""

    def __init__(self) -> None:
        self.sent: List[List[int]] = []

    def send(self, code: List[int]) -> None:
        log.info("mock send: %d pulses", len(code))
        self.sent.append(list(code))


class PigpioTransmitter:
    def __init__(self, gpio: int, carrier_khz: float = 38.0, host: str = "localhost") -> None:
        import pigpio  # ラズパイ上でのみ必要

        self._pigpio = pigpio
        self.gpio = gpio
        self.freq = carrier_khz
        self.pi = pigpio.pi(host)
        if not self.pi.connected:
            raise IRError("pigpiod に接続できません（sudo systemctl start pigpiod）")
        self.pi.set_mode(gpio, pigpio.OUTPUT)

    def _carrier(self, micros: int):
        pulse = self._pigpio.pulse
        wf = []
        cycle = 1000.0 / self.freq
        cycles = int(round(micros / cycle))
        on = int(round(cycle / 2.0))
        sofar = 0
        for c in range(cycles):
            target = int(round((c + 1) * cycle))
            sofar += on
            off = target - sofar
            sofar += off
            wf.append(pulse(1 << self.gpio, 0, on))
            wf.append(pulse(0, 1 << self.gpio, off))
        return wf

    def send(self, code: List[int]) -> None:
        pi = self.pi
        pi.wave_add_new()
        marks: Dict[int, int] = {}
        spaces: Dict[int, int] = {}
        chain = []
        try:
            for i, length in enumerate(code):
                if i & 1:  # space
                    if length not in spaces:
                        pi.wave_add_generic([self._pigpio.pulse(0, 0, length)])
                        spaces[length] = pi.wave_create()
                    chain.append(spaces[length])
                else:  # mark
                    if length not in marks:
                        pi.wave_add_generic(self._carrier(length))
                        marks[length] = pi.wave_create()
                    chain.append(marks[length])
            pi.wave_chain(chain)
            deadline = time.monotonic() + 5
            while pi.wave_tx_busy():
                if time.monotonic() > deadline:
                    pi.wave_tx_stop()
                    raise IRError("送信がタイムアウトしました")
                time.sleep(0.002)
        finally:
            for wid in list(marks.values()) + list(spaces.values()):
                pi.wave_delete(wid)


class IRSender:
    """送信を1本ずつ直列化し、連続送信の間隔を確保する。"""

    def __init__(self, tx: Transmitter, codes: Dict[str, List[int]], gap_ms: int = 100) -> None:
        self.tx = tx
        self.codes = codes
        self.gap = gap_ms / 1000.0
        self._lock = threading.Lock()
        self._next_at = 0.0

    def send(self, key: str) -> None:
        code = self.codes.get(key)
        if not code:
            raise IRError(f"codes.json にコード '{key}' がありません")
        with self._lock:
            wait = self._next_at - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                self.tx.send(code)
            finally:
                self._next_at = time.monotonic() + self.gap
