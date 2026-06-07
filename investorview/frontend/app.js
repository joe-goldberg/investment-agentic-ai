// InvestorView PWA — vanilla JS. Talks to the Python analysis backend.
(function () {
  "use strict";

  // ---------- state ----------
  const LS = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  };
  let lang = LS.get("iv_lang", "id");
  let backend = LS.get("iv_backend", "");
  let portfolio = LS.get("iv_portfolio", []);
  let techIndicators = { sma20: true, sma50: true, bb: true };
  let chart, candleSeries, overlays = [];

  const t = (k) => (window.I18N[lang] && window.I18N[lang][k]) || k;
  const $ = (id) => document.getElementById(id);
  const fmt = (n, cur) => {
    if (n == null || isNaN(n)) return "–";
    const s = Number(n).toLocaleString(lang === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 2 });
    return cur ? `${cur === "IDR" ? "Rp" : cur + " "}${s}` : s;
  };
  const pct = (n) => (n == null ? "–" : (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%");

  async function api(path, body) {
    if (!backend) throw new Error("no-backend");
    const res = await fetch(backend.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("http " + res.status);
    return res.json();
  }

  // ---------- i18n labels ----------
  function applyLabels() {
    document.documentElement.lang = lang;
    $("appTitle").textContent = t("app_title");
    $("tagline").textContent = t("tagline");
    const nav = { dashboard: "nav_dashboard", technical: "nav_technical", projection: "nav_projection", signals: "nav_signals", settings: "nav_settings" };
    document.querySelectorAll("#nav button").forEach((b) => (b.textContent = t(nav[b.dataset.page])));
    $("portfolioTitle").textContent = t("portfolio");
    $("addBtn").textContent = "+ " + t("add_holding");
    $("techBtn").textContent = t("analyze");
    $("candleGuideTitle").textContent = t("candle_guide_title");
    $("candleGuide").textContent = t("candle_guide");
    $("projBtn").textContent = t("project");
    $("projNote").textContent = t("projection_note");
    $("signalsTitle").textContent = t("nav_signals");
    $("lblBackend").textContent = t("backend_url");
    $("saveBackend").textContent = t("save");
    $("lblLang").textContent = t("language");
    $("notifBtn").textContent = t("enable_notif");
    $("installBtn").textContent = t("install_app");
    $("modalTitle").textContent = t("add_holding");
    $("mLblTicker").textContent = t("ticker");
    $("mLblMarket").textContent = t("market");
    $("mLblShares").textContent = t("shares");
    $("mLblAvg").textContent = t("avg_price");
    $("mCancel").textContent = t("cancel");
    $("mSave").textContent = t("save");
    renderTechPills();
  }

  // ---------- navigation ----------
  document.querySelectorAll("#nav button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#nav button").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
      b.classList.add("active");
      $("page-" + b.dataset.page).classList.add("active");
    })
  );

  // ---------- dashboard ----------
  async function renderDashboard() {
    const area = $("portfolioArea");
    if (!portfolio.length) {
      area.innerHTML = `<p class="muted">${t("no_portfolio")}</p>`;
      $("statGrid").innerHTML = "";
      return;
    }
    area.innerHTML = `<p class="muted">${t("loading")}</p>`;
    let rows = "", totalVal = 0, totalCost = 0;
    for (const h of portfolio) {
      let last = h.avg_price, cur = "IDR", sig = "hold";
      try {
        const a = await api("/analyze", { ticker: h.ticker, market: h.market });
        last = a.last_price; cur = a.currency; sig = (a.signal || "hold").toLowerCase();
      } catch (_) {}
      const val = last * h.shares, cost = h.avg_price * h.shares;
      const pnl = val - cost, pnlp = cost ? (pnl / cost) * 100 : 0;
      totalVal += val; totalCost += cost;
      rows += `<tr>
        <td>${h.ticker}<span class="muted"> ${h.market}</span></td>
        <td class="mono">${fmt(last, cur)}</td>
        <td class="mono">${h.shares}</td>
        <td class="mono">${fmt(val, cur)}</td>
        <td class="mono ${pnl >= 0 ? "pos" : "neg"}">${pct(pnlp)}</td>
        <td><span class="badge ${sig}">${t(sig)}</span></td>
        <td><button class="ghost" data-rm="${h.ticker}">×</button></td>
      </tr>`;
    }
    area.innerHTML = `<table><thead><tr>
      <th>${t("ticker")}</th><th>${t("last_price")}</th><th>${t("shares")}</th>
      <th>${t("value")}</th><th>${t("pnl")}</th><th>${t("signal")}</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table>`;
    area.querySelectorAll("[data-rm]").forEach((b) =>
      b.addEventListener("click", () => {
        portfolio = portfolio.filter((x) => x.ticker !== b.dataset.rm);
        LS.set("iv_portfolio", portfolio); renderDashboard();
      })
    );
    const totalPnl = totalVal - totalCost;
    $("statGrid").innerHTML = `
      <div class="stat"><div class="label">${t("total_value")}</div><div class="num mono">${fmt(totalVal)}</div></div>
      <div class="stat"><div class="label">${t("total_pnl")}</div><div class="num mono ${totalPnl >= 0 ? "pos" : "neg"}">${fmt(totalPnl)}</div></div>
      <div class="stat"><div class="label">${t("portfolio")}</div><div class="num mono">${portfolio.length}</div></div>`;
  }

  // ---------- add holding modal ----------
  $("addBtn").addEventListener("click", () => $("modal").classList.add("show"));
  $("mCancel").addEventListener("click", () => $("modal").classList.remove("show"));
  $("mSave").addEventListener("click", () => {
    const tk = $("mTicker").value.trim().toUpperCase();
    if (!tk) return;
    portfolio.push({
      ticker: tk, market: $("mMarket").value,
      shares: Number($("mShares").value) || 0, avg_price: Number($("mAvg").value) || 0,
    });
    LS.set("iv_portfolio", portfolio);
    $("mTicker").value = $("mShares").value = $("mAvg").value = "";
    $("modal").classList.remove("show");
    renderDashboard();
  });

  // ---------- technical ----------
  function renderTechPills() {
    const p = $("techPills");
    const defs = [["sma20", "SMA 20"], ["sma50", "SMA 50"], ["bb", "Bollinger"]];
    p.innerHTML = defs.map(([k, lbl]) =>
      `<span class="pill ${techIndicators[k] ? "active" : ""}" data-ind="${k}">${lbl}</span>`).join("");
    p.querySelectorAll("[data-ind]").forEach((el) =>
      el.addEventListener("click", () => {
        techIndicators[el.dataset.ind] = !techIndicators[el.dataset.ind];
        renderTechPills(); if (lastChartData) drawChart(lastChartData);
      })
    );
  }
  let lastChartData = null;
  function ensureChart() {
    if (chart) return;
    chart = LightweightCharts.createChart($("chart"), {
      layout: { background: { color: "transparent" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      timeScale: { borderColor: "#1e293b" }, rightPriceScale: { borderColor: "#1e293b" },
      autoSize: true,
    });
    candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444", borderVisible: false,
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
    });
  }
  function lineData(dates, arr) {
    const out = [];
    for (let i = 0; i < dates.length; i++) if (arr[i] != null) out.push({ time: dates[i], value: arr[i] });
    return out;
  }
  function drawChart(d) {
    ensureChart();
    overlays.forEach((s) => chart.removeSeries(s)); overlays = [];
    candleSeries.setData(d.dates.map((dt, i) => ({
      time: dt, open: d.open[i], high: d.high[i], low: d.low[i], close: d.close[i],
    })));
    const add = (arr, color) => { const s = chart.addLineSeries({ color, lineWidth: 1 }); s.setData(lineData(d.dates, arr)); overlays.push(s); };
    if (techIndicators.sma20) add(d.sma20, "#60a5fa");
    if (techIndicators.sma50) add(d.sma50, "#f59e0b");
    if (techIndicators.bb) { add(d.bb_upper, "#64748b"); add(d.bb_lower, "#64748b"); }
    chart.timeScale().fitContent();
  }
  async function loadTechnical() {
    const tk = $("techTicker").value.trim() || "BBRI";
    $("techWarn").textContent = t("loading");
    try {
      const d = await api("/chart", { ticker: tk, market: $("techMarket").value });
      lastChartData = d;
      $("techWarn").textContent = d.synthetic ? t("synthetic_warn") : "";
      drawChart(d);
    } catch (e) {
      $("techWarn").textContent = e.message === "no-backend"
        ? (lang === "id" ? "Atur URL Backend di Pengaturan." : "Set Backend URL in Settings.")
        : t("error");
    }
  }
  $("techBtn").addEventListener("click", loadTechnical);

  // ---------- projection ----------
  $("projBtn").addEventListener("click", async () => {
    const tk = $("projTicker").value.trim() || "BBRI";
    const el = $("projResult");
    el.innerHTML = `<p class="muted">${t("loading")}</p>`;
    try {
      const d = await api("/project", {
        ticker: tk, market: $("projMarket").value, horizon: Number($("projHorizon").value) || 30,
      });
      const cur = d.currency;
      const block = (name, exp, lo, hi) => `<div class="proj-method">
        <div class="mname">${name}</div>
        <div>${t("expected")}: <span class="mono">${fmt(exp, cur)}</span></div>
        ${lo != null ? `<div class="muted">${t("range")}: <span class="mono">${fmt(lo, cur)} – ${fmt(hi, cur)}</span></div>` : ""}
      </div>`;
      let html = `<div class="stat" style="margin-bottom:12px"><div class="label">${t("consensus")} (${d.horizon} ${t("days")})</div>
        <div class="num mono">${fmt(d.consensus_expected_price, cur)}</div></div>`;
      html += block("Monte Carlo (GBM)", d.monte_carlo.expected_price, d.monte_carlo.p05, d.monte_carlo.p95);
      html += block("Markov Chain", d.markov.expected_price);
      if (d.prophet) html += block("Prophet", d.prophet.expected_price);
      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = `<p class="warn">${e.message === "no-backend" ? (lang === "id" ? "Atur URL Backend di Pengaturan." : "Set Backend URL in Settings.") : t("error")}</p>`;
    }
  });

  // ---------- signals ----------
  async function renderSignals() {
    const el = $("signalsArea");
    if (!portfolio.length) { el.innerHTML = `<p class="muted">${t("no_portfolio")}</p>`; return; }
    el.innerHTML = `<p class="muted">${t("loading")}</p>`;
    let rows = "";
    for (const h of portfolio) {
      let sig = "hold", rsi = null;
      try { const a = await api("/analyze", { ticker: h.ticker, market: h.market }); sig = (a.signal || "hold").toLowerCase(); rsi = a.indicators?.rsi14; } catch (_) {}
      rows += `<tr><td>${h.ticker}<span class="muted"> ${h.market}</span></td>
        <td class="mono">${rsi != null ? rsi.toFixed(1) : "–"}</td>
        <td><span class="badge ${sig}">${t(sig)}</span></td></tr>`;
    }
    el.innerHTML = `<table><thead><tr><th>${t("ticker")}</th><th>RSI</th><th>${t("signal")}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ---------- settings ----------
  $("backendInput").value = backend;
  $("saveBackend").addEventListener("click", async () => {
    backend = $("backendInput").value.trim(); LS.set("iv_backend", backend);
    try { const h = await api("/health", {}).catch(() => fetch(backend.replace(/\/$/, "") + "/health").then((r) => r.json()));
      $("healthInfo").textContent = "✓ " + JSON.stringify(h);
    } catch { $("healthInfo").textContent = "✗ " + t("error"); }
    renderDashboard();
  });
  $("notifBtn").addEventListener("click", async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    $("notifBtn").textContent = p === "granted" ? "✓ " + t("enable_notif") : t("enable_notif");
  });

  // ---------- language ----------
  function setLang(l) { lang = l; LS.set("iv_lang", l); $("langSel").value = l; $("langSel2").value = l; applyLabels(); renderDashboard(); }
  $("langSel").addEventListener("change", (e) => setLang(e.target.value));
  $("langSel2").addEventListener("change", (e) => setLang(e.target.value));

  // ---------- PWA install + SW ----------
  let deferredPrompt;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; $("installBtn").style.display = "inline-block"; });
  $("installBtn").addEventListener("click", async () => { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; $("installBtn").style.display = "none"; } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- init ----------
  $("langSel").value = lang; $("langSel2").value = lang;
  applyLabels();
  renderDashboard();
  // lazy-load signals/dashboard when navigated
  document.querySelector('[data-page="signals"]').addEventListener("click", renderSignals);
})();
