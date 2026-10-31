#!/usr/bin/env bash
# smartroom を systemd サービスとして登録する。
# ユーザー名・配置先はこのスクリプトを実行した環境から自動で決まる。
#
#   ./deploy/install.sh                 # ポート 3000 で登録・起動
#   PORT=8080 ./deploy/install.sh       # ポートを変える
#   ./deploy/install.sh --dry-run       # 生成される unit を表示するだけ
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
UNIT=/etc/systemd/system/smartroom.service

render() {
  sed -e "s|@USER@|${RUN_USER}|g" \
      -e "s|@APP_DIR@|${APP_DIR}|g" \
      -e "s|@PORT@|${PORT}|g" \
      -e "s|@HOST@|${HOST}|g" \
      "${APP_DIR}/deploy/smartroom.service.in"
}

if [[ "${1:-}" == "--dry-run" ]]; then
  render
  exit 0
fi

if [[ ! -x "${APP_DIR}/.venv/bin/uvicorn" ]]; then
  echo "error: ${APP_DIR}/.venv がありません。先に以下を実行してください:" >&2
  echo "  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

render | sudo tee "${UNIT}" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable smartroom >/dev/null
sudo systemctl restart smartroom

echo "installed: ${UNIT} (user=${RUN_USER}, dir=${APP_DIR}, ${HOST}:${PORT})"
for _ in $(seq 1 15); do
  if curl -fsS "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
    echo "ok: http://$(hostname -I | awk '{print $1}'):${PORT}/"
    exit 0
  fi
  sleep 1
done
echo "起動確認に失敗しました: journalctl -u smartroom -n 50" >&2
exit 1
