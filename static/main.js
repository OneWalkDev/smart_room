(() => {
  "use strict";

  // lucide 風のシンプルなアイコン
  const P = {
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    bulb: '<path d="M9 18h6M10 22h4"/><path d="M15.1 14c.2-1 .7-1.7 1.4-2.5A4.6 4.6 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>',
    fan: '<path d="M12 12c-3-2.5-3-7 0-9 2 0 3 2 3 4.5L12 12"/><path d="M12 12c3.5-1 7.5 1.5 7.5 5-1.3 1.5-3.5 1.3-5.5 0L12 12"/><path d="M12 12c-.5 3.5-4.5 6-7.5 4.5-.5-2 1-3.7 3.2-4.5L12 12"/><circle cx="12" cy="12" r="1"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  };
  const icon = (name) =>
    P[name] ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>` : "";

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let state = {};
  const cards = {}; // device -> {card, stateEl, buttons: {cmd: el}}

  // ---- utils ----
  let toastTimer;
  function toast(msg, isErr) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "toast"), 1800);
  }
  function ago(ts) {
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return "たった今";
    if (s < 3600) return `${Math.floor(s / 60)}分前`;
    if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
    return `${Math.floor(s / 86400)}日前`;
  }
  function setConn(ok) {
    $("#conn").className = "conn " + (ok ? "ok" : "err");
    $("#conn-label").textContent = ok ? "オンライン" : "オフライン";
  }
  function greet() {
    const h = new Date().getHours();
    $("#greet").textContent = h < 5 ? "こんばんは" : h < 11 ? "おはようございます" : h < 18 ? "こんにちは" : "こんばんは";
  }

  async function api(path, opts) {
    const r = await fetch(path, opts);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
    return body;
  }

  // ---- render ----
  function renderState() {
    for (const [dev, c] of Object.entries(cards)) {
      const s = state[dev];
      c.stateEl.textContent = s ? `${s.label} ・ ${ago(s.at)}` : "まだ操作していません";
      c.card.dataset.active = s && !["off"].includes(s.command) ? "1" : "0";
      for (const [name, b] of Object.entries(c.buttons)) b.classList.toggle("current", !!s && s.command === name);
    }
  }

  async function press(btn, path, okMsg) {
    btn.classList.add("busy");
    try {
      const res = await api(path, { method: "POST" });
      state = res.state || state;
      renderState();
      setConn(true);
      btn.classList.remove("flash-ok"); void btn.offsetWidth; btn.classList.add("flash-ok");
      navigator.vibrate && navigator.vibrate(12);
      toast(okMsg);
    } catch (e) {
      btn.classList.remove("flash-err"); void btn.offsetWidth; btn.classList.add("flash-err");
      if (e instanceof TypeError) setConn(false);
      toast(`送信失敗: ${e.message}`, true);
    } finally {
      btn.classList.remove("busy");
    }
  }

  function render(cfg) {
    const scenes = $("#scenes");
    scenes.innerHTML = "";
    for (const s of cfg.scenes) {
      const b = el("button", "scene press", `${icon(s.icon)}<div><div class="lbl">${esc(s.label)}</div><div class="sub">まとめて操作</div></div>`);
      b.querySelector("svg") && b.querySelector("svg").classList.add("ico");
      b.onclick = () => press(b, `/api/scenes/${s.name}`, `${s.label}：送信しました`);
      scenes.append(b);
    }
    if (!cfg.scenes.length) scenes.remove();

    const root = $("#devices");
    root.innerHTML = "";
    for (const d of cfg.devices) {
      const card = el("section", "card");
      card.dataset.device = d.name;
      const head = el("div", "card-head", `<div class="badge">${icon(d.icon)}</div><div><div class="card-title">${esc(d.label)}</div><div class="card-state"></div></div>`);
      card.append(head);
      const entry = { card, stateEl: head.querySelector(".card-state"), buttons: {} };

      for (const g of d.groups) {
        const layout = { tiles: "tiles", stepper: "stepper", chips: "chips" }[g.layout] || "tiles";
        const wrap = el("div", `group ${layout}`);
        const btnCls = { tiles: "tile", stepper: "step", chips: "chip" }[layout];
        for (const c of g.commands) {
          const b = el("button", `${btnCls} press`, `${layout === "chips" ? "" : icon(c.icon)}<span>${esc(c.label)}</span>`);
          if (c.name === "off") b.classList.add("is-off");
          if (!c.available) { b.disabled = true; b.title = "codes.json に未登録"; }
          b.onclick = () => press(b, `/api/devices/${d.name}/${c.name}`, `${d.label}：${c.label}`);
          entry.buttons[c.name] = b;
          wrap.append(b);
        }
        card.append(wrap);
      }
      cards[d.name] = entry;
      root.append(card);
    }
  }

  async function refreshState() {
    try { state = await api("/api/state"); setConn(true); }
    catch { setConn(false); }
    renderState();
  }

  async function init() {
    greet();
    try {
      render(await api("/api/config"));
      setConn(true);
    } catch (e) {
      setConn(false);
      toast("サーバに接続できません", true);
      return;
    }
    await refreshState();
    setInterval(refreshState, 15000);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshState());
  }

  init();
})();
