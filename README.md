# SmartRoom

Raspberry Pi + 赤外線LED で、部屋の照明とエアコンをスマホから操作するリモコンです。
FastAPI で動き、家の中からは `http://192.168.1.11:3000/`、外からは Tailscale 経由でアクセスします。

```
スマホ（家のWi-Fi）  ──> http://192.168.1.11:3000 ─┐
スマホ（外出先）     ──> Tailscale ────────────────┴─> uvicorn 0.0.0.0:3000
                                                        └─ pigpiod ──> GPIO22 赤外線LED
```

> 認証はありません。ポート 3000 をルーターでポート開放（インターネットに公開）しないでください。

## 必要なもの

- Raspberry Pi（pigpio が動くモデル。※ Pi 5 は pigpio 非対応）
- 赤外線LED（送信）、赤外線受光モジュール（学習時のみ）
- `pigpiod`、Tailscale

## セットアップ（Raspberry Pi）

```bash
sudo apt install -y pigpio python3-venv   # Bookworm は python3.11-venv
sudo systemctl enable --now pigpiod

git clone https://github.com/OneWalkDev/smart_room.git ~/workspace/smart_room
cd ~/workspace/smart_room
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 学習済みコードを置く（旧 WebIOPi 版から移行する場合）
cp ~/webiopi/html/script/codes ./codes.json

sudo cp deploy/smartroom.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now smartroom
```

- 家の中: `http://192.168.1.11:3000/`
- 外出先: Tailscale をオンにして `http://<ラズパイのTailscale IP>:3000/`（`tailscale ip -4` で確認）

スマホで開いて「ホーム画面に追加」するとアプリのように使えます。
ラズパイの IP が変わらないよう、ルーターの DHCP 固定割り当てで 192.168.1.11 を予約しておくと安心です。

## ボタンを追加・変更する

`config.yaml` を編集して `sudo systemctl restart smartroom` するだけです。
`code` は `codes.json` のキー名で、未登録のコードのボタンはグレーアウトします。

```yaml
devices:
  air:
    groups:
      - layout: chips          # tiles / stepper / chips
        commands:
          cool: { label: 冷房, code: "air:cool" }
scenes:
  all_on: { label: ただいま, icon: home, steps: [light.p30, air.on] }
```

## 赤外線コードの学習

pigpio 公式サンプルの [`irrp.py`](https://abyz.me.uk/rpi/pigpio/examples.html#Python_irrp_py) を使います（受光モジュールが GPIO 18 の例）:

```bash
python3 irrp.py -r -g18 -f codes.json air:cool --no-confirm --post 130
```

## API

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/config` | デバイス・ボタン・シーン一覧 |
| GET | `/api/state` | 各デバイスに最後に送った操作 |
| POST | `/api/devices/{device}/{command}` | 赤外線送信 |
| POST | `/api/scenes/{scene}` | シーン（複数送信）実行 |

赤外線は一方向通信なので、状態は「最後に送った操作」です（リモコン本体の操作は反映されません）。

## 開発（実機なし）

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
SMARTROOM_BACKEND=mock .venv/bin/uvicorn --factory app.main:create_app --port 3000 --reload
.venv/bin/pytest
```

環境変数: `SMARTROOM_BACKEND`（`pigpio`/`mock`）, `SMARTROOM_CONFIG`, `SMARTROOM_CODES`, `SMARTROOM_STATE`, `PIGPIO_HOST`
