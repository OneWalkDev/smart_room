(() => {
  "use strict";

  // 線画アイコン（config.yaml の icon 名と対応）
  const P = {
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    bulb: '<path d="M9 18h6M10 22h4"/><path d="M15.1 14c.2-1 .7-1.7 1.4-2.5A4.6 4.6 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>',
    fan: '<path d="M12 12c-3-2.5-3-7 0-9 2 0 3 2 3 4.5L12 12"/><path d="M12 12c3.5-1 7.5 1.5 7.5 5-1.3 1.5-3.5 1.3-5.5 0L12 12"/><path d="M12 12c-.5 3.5-4.5 6-7.5 4.5-.5-2 1-3.7 3.2-4.5L12 12"/><circle cx="12" cy="12" r="1"/>',
    snow: '<path d="M12 2v20M4.9 7l14.2 10M4.9 17 19.1 7"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>',
    flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6.5-4-10-2 2-3 3.5-3 6-1.5-1-2-2.5-2-4-2.5 2-5 5-5 8a7 7 0 0 0 7 7z"/>',
    droplet: '<path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0z"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  };
  const icon = (name) =>
    P[name] ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name]}</svg>` : "";

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const LAYOUTS = { tiles: "keys", stepper: "rocker", chips: "dial" };
  const KEY_CLASS = { keys: "key", rocker: "rock", dial: "num" };

  let state = {};
  let labels = {};   // device -> 表示名
  const faces = {};  // device -> {face, stateEl, buttons: {cmd: {btn, label}}}

  // ---- 送信窓（画面下の表示） ----
  const win = $("#window"), readout = $("#readout"), alertEl = $("#alert");
  let settleTimer;

  function show(mode, msg) {
    clearTimeout(settleTimer);
    win.dataset.mode = mode;
    if (mode === "err") {
      readout.textContent = "";
      alertEl.textContent = msg;
    } else {
      alertEl.textContent = "";
      readout.textContent = msg;
    }
    // 成功表示は少し残してから「最後の送信」に戻す。エラーは次の操作まで残す
    if (mode === "ok") settleTimer = setTimeout(showLatest, 2600);
  }

  function showLatest() {
    let latest = null;
    for (const [dev, s] of Object.entries(state)) {
      if (labels[dev] && (!latest || s.at > latest.s.at)) latest = { dev, s };
    }
    show("idle", latest ? `${ago(latest.s.at)}：${labels[latest.dev]}「${latest.s.label}」` : "まだ何も送信していません");
  }

  function ago(ts) {
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return "たった今";
    if (s < 3600) return `${Math.floor(s / 60)}分前`;
    if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
    return `${Math.floor(s / 86400)}日前`;
  }

  async function api(path, opts) {
    let r;
    try {
      r = await fetch(path, opts);
    } catch {
      throw new Error("Raspberry Pi に接続できません。電源とネットワークを確認してください");
    }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail || `サーバがエラーを返しました（HTTP ${r.status}）`);
    return body;
  }

  // ---- 状態の反映 ----
  function renderState() {
    for (const [dev, f] of Object.entries(faces)) {
      const s = state[dev];
      f.stateEl.textContent = s ? `${s.label}（${ago(s.at)}）` : "まだ操作していません";
      f.face.dataset.active = s && s.command !== "off" ? "1" : "0";
      for (const [name, k] of Object.entries(f.buttons)) {
        const cur = !!s && s.command === name;
        k.btn.classList.toggle("current", cur);
        k.btn.setAttribute("aria-label", k.label + (cur ? "（最後に送信）" : ""));
      }
    }
  }

  let sending = 0;
  async function press(btn, path, what) {
    if (btn.getAttribute("aria-disabled") === "true") return;
    btn.setAttribute("aria-disabled", "true");
    btn.classList.add("busy");
    sending++;
    win.dataset.tx = "1";
    show("busy", `送信中…　${what}`);
    try {
      const res = await api(path, { method: "POST", headers: { "X-SmartRoom": "1" } });
      state = res.state || state;
      renderState();
      replay(btn, "flash-ok");
      navigator.vibrate && navigator.vibrate(12);
      show("ok", `${what}を送信しました`);
    } catch (e) {
      replay(btn, "flash-err");
      navigator.vibrate && navigator.vibrate([30, 60, 30]);
      show("err", `${what}を送信できませんでした。${e.message}`);
      refreshState(); // シーンの途中で失敗した場合、送れた分だけ状態が進んでいる
    } finally {
      btn.classList.remove("busy");
      btn.removeAttribute("aria-disabled");
      if (--sending === 0) delete win.dataset.tx;
    }
  }
  function replay(node, cls) {
    node.classList.remove("flash-ok", "flash-err");
    void node.offsetWidth;
    node.classList.add(cls);
  }

  // ---- 画面の生成（/api/config から） ----
  function render(cfg) {
    const scenes = $("#scenes");
    scenes.innerHTML = "";
    for (const s of cfg.scenes) {
      const b = el("button", "scene press", `${icon(s.icon)}<span class="lbl">${esc(s.label)}</span>`);
      b.type = "button";
      b.dataset.scene = s.name;
      b.setAttribute("aria-label", `シーン「${s.label}」を送信`);
      b.onclick = () => press(b, `/api/scenes/${encodeURIComponent(s.name)}`, `「${s.label}」`);
      scenes.append(b);
    }
    scenes.hidden = !cfg.scenes.length;

    const root = $("#devices");
    root.innerHTML = "";
    labels = {};
    for (const d of cfg.devices) {
      labels[d.name] = d.label;
      const face = el("section", "face");
      face.dataset.device = d.name;
      const hid = `dev-${d.name}`;
      face.setAttribute("aria-labelledby", hid);
      face.append(el("div", "face-head",
        `<span class="led" aria-hidden="true"></span>${icon(d.icon)}` +
        `<h2 class="face-title" id="${esc(hid)}">${esc(d.label)}</h2>` +
        `<p class="face-state"></p>`));
      const entry = { face, stateEl: face.querySelector(".face-state"), buttons: {} };
      let missing = false;

      for (const g of d.groups) {
        const layout = LAYOUTS[g.layout] || "keys";
        const wrap = el("div", `group ${layout}`);
        wrap.style.setProperty("--n", g.commands.length);
        for (const c of g.commands) {
          const showIcon = layout !== "dial";
          const b = el("button", `${KEY_CLASS[layout]} press`, `${showIcon ? icon(c.icon) : ""}<span class="lbl">${esc(c.label)}</span>`);
          b.type = "button";
          b.dataset.cmd = c.name;
          if (c.name === "off") b.classList.add("is-off");
          if (/^heat/.test(c.name) || c.icon === "flame") b.classList.add("is-heat");
          if (/^cool/.test(c.name) || c.icon === "snow") b.classList.add("is-cool");
          const label = `${d.label} ${c.label}`;
          if (!c.available) {
            b.disabled = true;
            b.classList.add("unlearned");
            b.setAttribute("aria-label", `${label}（未学習）`);
            missing = true;
          } else {
            b.setAttribute("aria-label", label);
            b.onclick = () => press(b, `/api/devices/${encodeURIComponent(d.name)}/${encodeURIComponent(c.name)}`, `${d.label}「${c.label}」`);
            entry.buttons[c.name] = { btn: b, label };
          }
          wrap.append(b);
        }
        face.append(wrap);
      }
      if (missing) face.append(el("p", "face-note", "点線のボタンは信号が未学習です。irrp.py で codes.json に記録してから再起動してください。"));
      faces[d.name] = entry;
      root.append(face);
    }
    if (!cfg.devices.length) {
      root.append(el("p", "empty", "機器がありません。config.yaml の devices に追加して再起動してください。"));
    }
  }

  function renderOffline(msg) {
    const root = $("#devices");
    root.innerHTML = "";
    const box = el("div", "empty", `<p>${esc(msg)}</p>`);
    const retry = el("button", "retry press", "もう一度つなぐ");
    retry.type = "button";
    retry.onclick = () => { show("busy", "接続中…"); init(); };
    box.append(retry);
    root.append(box);
    $("#scenes").hidden = true;
    show("err", "画面を読み込めませんでした");
  }

  async function refreshState() {
    try { state = await api("/api/state"); } catch { /* 次回の更新で再取得 */ }
    renderState();
    if (win.dataset.mode === "idle") showLatest();
  }

  let started = false;
  async function init() {
    try {
      render(await api("/api/config"));
    } catch (e) {
      renderOffline(e.message);
      return;
    }
    await refreshState();
    showLatest();
    if (started) return;
    started = true;
    setInterval(refreshState, 15000);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshState());
  }

  init();
})();
