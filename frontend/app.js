// InvestorView PWA — vanilla JS. Talks to the Python analysis backend.
(function () {
  "use strict";
  const LS = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  };
  let lang = LS.get("iv_lang", "id");
  let backend = LS.get("iv_backend", "");
  let portfolio = LS.get("iv_portfolio", []);
  let timeframe = "6M";
  let techInd = { sma20: false, sma50: false, bb: false };
  let chart, candleSeries, overlays = [], projChartObj, lastChartData = null;

  const t = (k) => (window.I18N[lang] && window.I18N[lang][k]) || k;
  const $ = (id) => document.getElementById(id);
  const loc = () => (lang === "id" ? "id-ID" : "en-US");
  const fmt = (n, cur) => {
    if (n == null || isNaN(n)) return "–";
    const s = Number(n).toLocaleString(loc(), { maximumFractionDigits: 2 });
    return cur ? `${cur === "IDR" ? "Rp" : cur + " "}${s}` : s;
  };
  const pct = (n) => (n == null || isNaN(n) ? "–" : (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%");
  const fmtBig = (n, cur) => {
    if (n == null) return "–";
    const a = Math.abs(n); const c = cur === "IDR" ? "Rp" : (cur ? cur + " " : "");
    if (a >= 1e12) return c + (n / 1e12).toFixed(2) + "T";
    if (a >= 1e9) return c + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return c + (n / 1e6).toFixed(2) + "M";
    return c + Number(n).toLocaleString(loc());
  };
  const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  async function api(path, body) {
    if (!backend) throw new Error("no-backend");
    const res = await fetch(backend.replace(/\/$/, "") + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("http " + res.status);
    return res.json();
  }
  const noBackendMsg = () => (lang === "id" ? "Atur URL Backend di Pengaturan." : "Set Backend URL in Settings.");

  // ---------------- i18n labels ----------------
  function applyLabels() {
    document.documentElement.lang = lang;
    $("appTitle").textContent = t("app_title"); $("tagline").textContent = t("tagline");
    const nav = { dashboard: "nav_dashboard", technical: "nav_technical", fundamental: "nav_fundamental",
      projection: "nav_projection", signals: "nav_signals", settings: "nav_settings" };
    document.querySelectorAll("#nav button").forEach((b) => (b.textContent = t(nav[b.dataset.page])));
    $("portfolioTitle").textContent = t("portfolio");
    $("addBtn").textContent = "+ " + t("add_holding");
    $("techBtn").textContent = t("analyze"); $("tfLabel").textContent = t("timeframe");
    $("fundBtn").textContent = t("analyze"); $("fundIntro").textContent = t("fund_intro");
    $("projBtn").textContent = t("project"); $("projNote").textContent = t("projection_note");
    $("projChartTitle").textContent = t("proj_chart_title");
    $("signalsTitle").textContent = t("nav_signals"); $("signalsIntro").textContent = t("signals_intro");
    $("rsiHelp").textContent = t("rsi_help");
    $("lblBackend").textContent = t("backend_url"); $("saveBackend").textContent = t("save");
    $("lblLang").textContent = t("language"); $("notifBtn").textContent = t("enable_notif");
    $("installBtn").textContent = t("install_app");
    $("modalTitle").textContent = t("add_holding"); $("mLblTicker").textContent = t("ticker");
    $("mLblMarket").textContent = t("market"); $("mLblAvg").textContent = t("avg_price");
    $("mCancel").textContent = t("cancel"); $("mSave").textContent = t("save");
    $("infoClose").textContent = t("info_close");
    renderTfPills(); renderTechPills(); updateQtyLabel();
  }

  // ---------------- navigation ----------------
  document.querySelectorAll("#nav button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#nav button").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
      b.classList.add("active"); $("page-" + b.dataset.page).classList.add("active");
      if (b.dataset.page === "signals") renderSignals();
    })
  );

  // ---------------- info modal ----------------
  const CANDLE_INTRO = {
    id: "Tiap candle menampilkan harga buka, tutup, tertinggi, dan terendah. Badan hijau = tutup di atas buka (naik), merah = turun. Ekor (wick) = rentang tertinggi–terendah. Berikut pola-pola penting:",
    en: "Each candle shows the open, close, high and low. A green body = close above open (up), red = down. Wicks = the high–low range. Key patterns:",
  };
  function openInfo(title, html) { $("infoTitle").textContent = title; $("infoBody").innerHTML = html; $("infoModal").classList.add("show"); }
  $("infoClose").addEventListener("click", () => $("infoModal").classList.remove("show"));
  function candleGuideHtml() {
    const p = window.CANDLE_PATTERNS[lang];
    let html = `<p style="margin-bottom:10px">${CANDLE_INTRO[lang]}</p>`;
    for (const k in p) html += `<div style="margin-bottom:8px"><b>${p[k][0]}</b><br>${p[k][1]}</div>`;
    return html;
  }

  // ---------------- dashboard ----------------
  function qtyDisplay(h) {
    if (h.market === "IDX") return `${(h.shares / 100).toLocaleString(loc())} lot`;
    return `${h.shares.toLocaleString(loc())}`;
  }
  async function renderDashboard() {
    const area = $("portfolioArea");
    if (!portfolio.length) {
      area.innerHTML = `<p class="muted">${t("no_portfolio")}</p>`; $("statGrid").innerHTML = ""; return;
    }
    area.innerHTML = `<p class="muted">${t("loading")}</p>`;
    let rows = "", totalVal = 0, totalCost = 0;
    for (const h of portfolio) {
      let last = h.avg_price, cur = h.market === "IDX" ? "IDR" : (h.market === "US" ? "USD" : "EUR"), sig = "hold";
      try { const a = await api("/analyze", { ticker: h.ticker, market: h.market });
        last = a.last_price; cur = a.currency; sig = (a.signal || "hold").toLowerCase(); } catch (_) {}
      const val = last * h.shares, cost = h.avg_price * h.shares;
      const pnl = val - cost, pnlp = cost ? (pnl / cost) * 100 : 0;
      totalVal += val; totalCost += cost;
      rows += `<tr>
        <td>${h.ticker}<span class="muted"> ${h.market}</span></td>
        <td class="mono">${qtyDisplay(h)}</td>
        <td class="mono">${fmt(h.avg_price, cur)}</td>
        <td class="mono">${fmt(last, cur)}</td>
        <td class="mono">${fmt(cost, cur)}</td>
        <td class="mono">${fmt(val, cur)}</td>
        <td class="mono ${pnl >= 0 ? "pos" : "neg"}">${fmt(pnl, cur)}<br><span style="font-size:11px">${pct(pnlp)}</span></td>
        <td><span class="badge ${sig}">${t(sig)}</span></td>
        <td><button class="ghost" data-rm="${h.ticker}" style="padding:4px 8px">×</button></td></tr>`;
    }
    area.innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>${t("ticker")}</th><th>${t("lot")}/${t("shares")}</th><th>${t("avg_price")}</th>
      <th>${t("last_price")}</th><th>${t("cost")}</th><th>${t("market_value")}</th>
      <th>${t("pnl")}</th><th>${t("signal")}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    area.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
      portfolio = portfolio.filter((x) => x.ticker !== b.dataset.rm); LS.set("iv_portfolio", portfolio); renderDashboard();
    }));
    const totalPnl = totalVal - totalCost;
    const stat = (label, num, help, cls) => `<div class="stat">
      <div class="label">${label} <span class="info" data-help="${help}">i</span></div>
      <div class="num mono ${cls || ""}">${num}</div></div>`;
    $("statGrid").innerHTML =
      stat(t("mv_total"), fmt(totalVal), t("mv_help")) +
      stat(t("cost_total"), fmt(totalCost), t("cost_help")) +
      stat(t("pnl_total"), fmt(totalPnl), t("pnl_help"), totalPnl >= 0 ? "pos" : "neg") +
      stat(t("holdings_count"), portfolio.length, t("mv_help"));
    $("statGrid").querySelectorAll(".info").forEach((el) =>
      el.addEventListener("click", () => openInfo(t("info_close") === "Close" ? "Info" : "Info", `<p>${el.dataset.help}</p>`)));
  }

  // ---------------- add holding modal ----------------
  function updateQtyLabel() {
    const mk = $("mMarket").value;
    $("mLblQty").textContent = mk === "IDX" ? t("lot") : t("shares");
    $("mQtyHint").textContent = mk === "IDX" ? t("lot_hint") : "";
  }
  $("mMarket").addEventListener("change", updateQtyLabel);
  $("addBtn").addEventListener("click", () => { updateQtyLabel(); $("modal").classList.add("show"); });
  $("mCancel").addEventListener("click", () => $("modal").classList.remove("show"));
  $("mSave").addEventListener("click", () => {
    const tk = $("mTicker").value.trim().toUpperCase(); if (!tk) return;
    const mk = $("mMarket").value; const qty = Number($("mQty").value) || 0;
    const shares = mk === "IDX" ? qty * 100 : qty; // 1 lot = 100 shares on IDX
    portfolio.push({ ticker: tk, market: mk, shares, avg_price: Number($("mAvg").value) || 0 });
    LS.set("iv_portfolio", portfolio);
    $("mTicker").value = $("mQty").value = $("mAvg").value = "";
    $("modal").classList.remove("show"); renderDashboard();
  });

  // ---------------- technical ----------------
  const TIMEFRAMES = ["1D", "5D", "1M", "3M", "6M", "1Y", "MAX"];
  function renderTfPills() {
    $("tfPills").innerHTML = TIMEFRAMES.map((tf) =>
      `<span class="pill ${tf === timeframe ? "active" : ""}" data-tf="${tf}">${tf}</span>`).join("");
    $("tfPills").querySelectorAll("[data-tf]").forEach((el) =>
      el.addEventListener("click", () => { timeframe = el.dataset.tf; renderTfPills(); loadTechnical(); }));
  }
  function renderTechPills() {
    const defs = [["sma20", "SMA 20"], ["sma50", "SMA 50"], ["bb", "Bollinger"]];
    $("techPills").innerHTML = defs.map(([k, lbl]) =>
      `<span class="pill ${techInd[k] ? "active" : ""}" data-ind="${k}">${lbl}</span>`).join("");
    $("techPills").querySelectorAll("[data-ind]").forEach((el) =>
      el.addEventListener("click", () => { techInd[el.dataset.ind] = !techInd[el.dataset.ind]; renderTechPills(); if (lastChartData) drawChart(lastChartData); }));
  }
  function ensureChart() {
    if (chart) return;
    chart = LightweightCharts.createChart($("chart"), {
      layout: { background: { color: "transparent" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      timeScale: { borderColor: "#1e293b", timeVisible: true }, rightPriceScale: { borderColor: "#1e293b" }, autoSize: true,
    });
    candleSeries = chart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444",
      borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#ef4444" });
  }
  function lineData(times, arr) {
    const out = [];
    for (let i = 0; i < times.length; i++) if (arr[i] != null) out.push({ time: times[i], value: arr[i] });
    return out;
  }
  function drawChart(d) {
    ensureChart();
    overlays.forEach((s) => chart.removeSeries(s)); overlays = [];
    candleSeries.setData(d.times.map((tm, i) => ({ time: tm, open: d.open[i], high: d.high[i], low: d.low[i], close: d.close[i] })));
    const add = (arr, color) => { const s = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false }); s.setData(lineData(d.times, arr)); overlays.push(s); };
    if (techInd.sma20) add(d.sma20, "#60a5fa");
    if (techInd.sma50) add(d.sma50, "#f59e0b");
    if (techInd.bb) { add(d.bb_upper, "#64748b"); add(d.bb_lower, "#64748b"); }
    chart.timeScale().fitContent();
  }
  function renderPattern(d) {
    const box = $("patternBox");
    const p = d.pattern || { pattern: null, direction: "neutral" };
    const dir = p.direction || "neutral";
    let name, meaning;
    if (p.pattern && window.CANDLE_PATTERNS[lang][p.pattern]) {
      [name, meaning] = window.CANDLE_PATTERNS[lang][p.pattern];
    } else { name = "—"; meaning = t("candle_none"); }
    box.innerHTML = `<div class="pattern-box">
      <span class="info" id="candleInfo" title="${t("candle_guide_title")}">i</span>
      <div><div class="pname">${t("candle_latest")}: ${name} <span class="badge ${dir}">${t(dir)}</span></div>
      <div class="muted" style="font-size:12px">${meaning}</div></div></div>`;
    $("candleInfo").addEventListener("click", () => openInfo(t("candle_guide_title"), candleGuideHtml()));
  }
  async function loadTechnical() {
    const tk = $("techTicker").value.trim() || "BBRI";
    $("techWarn").textContent = t("loading"); $("patternBox").innerHTML = "";
    try {
      const d = await api("/chart", { ticker: tk, market: $("techMarket").value, timeframe });
      lastChartData = d;
      $("techWarn").textContent = d.synthetic ? t("synthetic_warn") : "";
      renderPattern(d); drawChart(d);
    } catch (e) {
      $("techWarn").textContent = e.message === "no-backend" ? noBackendMsg() : t("error");
    }
  }
  $("techBtn").addEventListener("click", loadTechnical);

  // ---------------- fundamental ----------------
  function ratioVal(v, type, cur) {
    if (v == null) return "–";
    if (type === "pct") return (v * 100).toFixed(2) + "%";
    if (type === "x") return Number(v).toFixed(2) + "x";
    if (type === "big") return fmtBig(v, cur);
    return Number(v).toLocaleString(loc(), { maximumFractionDigits: 2 });
  }
  $("fundBtn").addEventListener("click", async () => {
    const tk = $("fundTicker").value.trim() || "BBRI";
    const el = $("fundResult"); $("fundWarn").textContent = ""; el.innerHTML = `<p class="muted">${t("loading")}</p>`;
    try {
      const d = await api("/fundamental", { ticker: tk, market: $("fundMarket").value });
      $("fundWarn").textContent = d.synthetic ? t("synthetic_warn") : "";
      const R = window.RATIOS[lang]; const recCls = d.recommendation === "BUY" ? "buy" : (d.recommendation === "SELL" ? "sell" : "hold");
      let html = `<div class="card" style="background:var(--bg-hover)">
        <div style="font-weight:600;font-size:15px">${d.name || d.ticker} <span class="muted">${d.market}</span></div>
        ${d.sector ? `<div class="muted" style="font-size:12px">${d.sector}${d.industry ? " · " + d.industry : ""}</div>` : ""}
        <div style="margin-top:8px">${t("verdict")}: <b>${d.verdict}</b> · ${t("recommendation")}: <span class="badge ${recCls}">${d.recommendation}</span></div></div>`;
      for (const k in R) {
        if (d[k] == null) continue;
        html += `<div class="ratio"><div class="rtop"><span class="rname">${R[k][0]}</span>
          <span class="rval">${ratioVal(d[k], R[k][2], d.currency)}</span></div>
          <div class="rdesc">${R[k][1]}</div></div>`;
      }
      el.innerHTML = html;
    } catch (e) { el.innerHTML = `<p class="warn">${e.message === "no-backend" ? noBackendMsg() : t("error")}</p>`; }
  });

  // ---------------- projection ----------------
  function ensureProjChart() {
    if (projChartObj) return;
    projChartObj = LightweightCharts.createChart($("projChart"), {
      layout: { background: { color: "transparent" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      timeScale: { borderColor: "#1e293b" }, rightPriceScale: { borderColor: "#1e293b" }, autoSize: true,
    });
  }
  let projSeries = [];
  function drawProjChart(d) {
    ensureProjChart();
    projSeries.forEach((s) => projChartObj.removeSeries(s)); projSeries = [];
    const hist = projChartObj.addLineSeries({ color: "#e2e8f0", lineWidth: 2 });
    hist.setData(d.recent_close.map((v, i) => ({ time: d.recent_times[i], value: v }))); projSeries.push(hist);
    const lastT = d.recent_times[d.recent_times.length - 1];
    const mp = (d.monte_carlo && d.monte_carlo.median_path) || [];
    const proj = projChartObj.addLineSeries({ color: "#60a5fa", lineWidth: 2, lineStyle: 2 });
    const pdata = [{ time: lastT, value: d.last_price }];
    for (let i = 0; i < mp.length; i++) pdata.push({ time: addDays(lastT, i + 1), value: mp[i] });
    proj.setData(pdata); projSeries.push(proj);
    projChartObj.timeScale().fitContent();
  }
  $("projBtn").addEventListener("click", async () => {
    const tk = $("projTicker").value.trim() || "BBRI";
    const el = $("projResult"); el.innerHTML = `<p class="muted">${t("loading")}</p>`;
    try {
      const d = await api("/project", { ticker: tk, market: $("projMarket").value, horizon: Number($("projHorizon").value) || 30 });
      drawProjChart(d);
      const cur = d.currency; const M = window.METHOD_INFO[lang];
      const block = (info, exp, lo, hi) => `<div class="proj-method"><div class="mname">${info[0]}</div>
        <div class="muted" style="font-size:12px;margin-bottom:6px">${info[1]}</div>
        <div>${t("expected")}: <span class="mono">${fmt(exp, cur)}</span></div>
        ${lo != null ? `<div class="muted">${t("range")}: <span class="mono">${fmt(lo, cur)} – ${fmt(hi, cur)}</span></div>` : ""}</div>`;
      let html = `<div class="stat" style="margin-bottom:12px"><div class="label">${t("consensus")} (${d.horizon} ${t("days")})</div>
        <div class="num mono">${fmt(d.consensus_expected_price, cur)}</div></div>`;
      html += block(M.monte_carlo, d.monte_carlo.expected_price, d.monte_carlo.p05, d.monte_carlo.p95);
      html += block(M.markov, d.markov.expected_price);
      if (d.prophet) html += block(M.prophet, d.prophet.expected_price);
      html += `<div class="legend">— ${t("proj_hist")} (putih) · ${t("proj_median")} (biru)</div>`;
      el.innerHTML = html;
    } catch (e) { el.innerHTML = `<p class="warn">${e.message === "no-backend" ? noBackendMsg() : t("error")}</p>`; }
  });

  // ---------------- signals ----------------
  async function renderSignals() {
    const el = $("signalsArea");
    if (!portfolio.length) { el.innerHTML = `<p class="muted">${t("no_portfolio")}</p>`; return; }
    el.innerHTML = `<p class="muted">${t("loading")}</p>`;
    let rows = "";
    for (const h of portfolio) {
      let sig = "hold", rsi = null, L = {}, cur = "";
      try { const a = await api("/analyze", { ticker: h.ticker, market: h.market }); sig = (a.signal || "hold").toLowerCase(); rsi = a.indicators?.rsi14; L = a.levels || {}; cur = a.currency; } catch (_) {}
      rows += `<tr><td>${h.ticker}<span class="muted"> ${h.market}</span></td>
        <td class="mono">${rsi != null ? rsi.toFixed(1) : "–"}</td>
        <td><span class="badge ${sig}">${t(sig)}</span></td>
        <td class="mono">${fmt(L.entry, cur)}</td>
        <td class="mono pos">${fmt(L.target, cur)}</td>
        <td class="mono neg">${fmt(L.stop, cur)}</td></tr>`;
    }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>${t("ticker")}</th><th>RSI</th>
      <th>${t("signal")}</th><th>${t("entry")}</th><th>${t("target")}</th><th>${t("stop")}</th>
      </tr></thead><tbody>${rows}</tbody></table></div><p class="legend">${t("levels_help")}</p>`;
  }

  // ---------------- settings ----------------
  $("backendInput").value = backend;
  $("saveBackend").addEventListener("click", async () => {
    backend = $("backendInput").value.trim(); LS.set("iv_backend", backend);
    try { const h = await fetch(backend.replace(/\/$/, "") + "/health").then((r) => r.json());
      $("healthInfo").textContent = "✓ " + JSON.stringify(h);
    } catch { $("healthInfo").textContent = "✗ " + t("error"); }
    renderDashboard();
  });
  $("notifBtn").addEventListener("click", async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    $("notifBtn").textContent = (p === "granted" ? "✓ " : "") + t("enable_notif");
  });

  // ---------------- language ----------------
  function setLang(l) { lang = l; LS.set("iv_lang", l); $("langSel").value = l; $("langSel2").value = l; applyLabels(); renderDashboard(); }
  $("langSel").addEventListener("change", (e) => setLang(e.target.value));
  $("langSel2").addEventListener("change", (e) => setLang(e.target.value));

  // ---------------- PWA ----------------
  let deferredPrompt;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; $("installBtn").style.display = "inline-block"; });
  $("installBtn").addEventListener("click", async () => { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; $("installBtn").style.display = "none"; } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------------- init ----------------
  $("langSel").value = lang; $("langSel2").value = lang;
  applyLabels(); renderDashboard();
})();
