/* ============================================================
   Dashboard seslabs — app.js
   Lee data/latest.json (generado por scripts/fetch_data.py) y
   dibuja una gráfica Chart.js por sensor dentro de tarjetas
   "liquid glass". Sin dependencias de build, todo vanilla JS.
   ============================================================ */

(function () {
  "use strict";

  const DATA_URL = "data/latest.json";

  // Orden fijo + color fijo por sensor (paleta categórica validada, paso oscuro).
  const SENSOR_META = [
    { key: "piranometro",        color: "var(--series-blue)" },
    { key: "spektron",           color: "var(--series-orange)" },
    { key: "sp722",              color: "var(--series-aqua)" },
    { key: "sq_calibrador",      color: "var(--series-yellow)" },
    { key: "promedio_bajo_costo",color: "var(--series-magenta)" },
    { key: "celda_1",            color: "var(--series-green)" },
    { key: "celda_2",            color: "var(--series-violet)" },
    { key: "celda_3",            color: "var(--series-red)" },
    { key: "celda_4",            color: "var(--series-blue)" },
    { key: "celda_5",            color: "var(--series-orange)" },
    { key: "celda_6",            color: "var(--series-aqua)" },
  ];

  const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const DIAS = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

  const COLAB_URL = "https://colab.research.google.com/drive/1hgJy_P-Jwq0YHZA1fwT7yOOgHO49kT2W";

  let state = {
    raw: null,          // json completo
    parsed: {},         // key -> [{date, hh, mm, label, value, epoch}]
    charts: {},         // key -> Chart instance (tarjetas individuales)
    compareChart: null, // Chart instance (comparativa)
  };

  // -------------------- Colab: link + QR --------------------

  (function initColab() {
    const link = document.getElementById("colabLink");
    if (link) link.href = COLAB_URL;
    const canvas = document.getElementById("colabQrCanvas");
    if (canvas && window.QRCode) {
      QRCode.toCanvas(canvas, COLAB_URL, { width: 104, margin: 1, color: { dark: "#0b0b0b", light: "#ffffff" } }, (err) => {
        if (err) console.error("No se pudo generar el QR del Colab:", err);
      });
    }
  })();

  // -------------------- drawer de detalle por sensor --------------------

  document.getElementById("drawerClose").addEventListener("click", closeDrawer);
  document.getElementById("drawerBackdrop").addEventListener("click", closeDrawer);

  // -------------------- reloj en vivo --------------------

  function tickClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    document.getElementById("clockTime").textContent = `${hh}:${mm}:${ss}`;
    document.getElementById("clockDay").textContent =
      `${DIAS[now.getDay()]}, ${now.getDate()} de ${MESES[now.getMonth()]} de ${now.getFullYear()}`;
  }
  setInterval(tickClock, 1000);
  tickClock();

  // -------------------- parseo de timestamps --------------------

  // Acepta "YYYY-MM-DD HH:MM:SS", "YYYY-MM-DDTHH:MM:SSZ", etc.
  // Extrae directo con regex para no arrastrar problemas de zona horaria
  // entre las 3 fuentes de datos (Drive vs ThingSpeak).
  function parseTs(ts) {
    const m = /(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(ts || "");
    if (!m) return null;
    return { date: m[1], hh: parseInt(m[2], 10), mm: m[3] };
  }

  // Epoch en ms, solo para poder alinear en el tiempo series de distintas
  // fuentes en la gráfica comparativa (un eje lineal numérico, sin libreria
  // de fechas extra). Puede haber un corrimiento leve de zona horaria entre
  // Drive (hora local sin offset) y ThingSpeak (UTC con 'Z'); para comparar
  // la FORMA de las curvas entre sensores es suficiente.
  function tsToEpochMs(ts) {
    if (!ts) return null;
    const iso = /Z$/.test(ts) ? ts : ts.replace(" ", "T");
    const d = new Date(iso);
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
  }

  function updatedPillState(generatedAt) {
    const pill = document.getElementById("updatedPill");
    const dot = document.getElementById("updatedDot");
    const text = document.getElementById("updatedText");
    if (!generatedAt) {
      pill.className = "status-pill error";
      text.textContent = "No se pudo leer data/latest.json";
      return;
    }
    const gen = new Date(generatedAt);
    const diffMin = Math.round((Date.now() - gen.getTime()) / 60000);
    let cls = "ok", label = "al día";
    if (diffMin > 180) { cls = "error"; label = "sin actualizar hace tiempo"; }
    else if (diffMin > 40) { cls = "stale"; label = "un poco atrasado"; }
    pill.className = `status-pill ${cls}`;
    const when = gen.toLocaleString("es-CR", { dateStyle: "medium", timeStyle: "short" });
    text.textContent = `Última actualización: ${when} (${label}, hace ${diffMin} min)`;
  }

  // -------------------- carga de datos --------------------

  fetch(DATA_URL, { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((json) => {
      // A partir de aquí ya tenemos el JSON: si algo truena dibujando,
      // NO lo confundimos con un fallo de carga (eso ya pasó bien).
      state.raw = json;
      updatedPillState(json.generated_at);
      renderGaps(json.gaps_conocidos || []);
      try {
        indexSensors(json.sensors || {});
        buildDayHourControls();
        renderAllCards();
        buildComparePicker();
        renderCompareChart();
        wireControls();
      } catch (renderErr) {
        console.error("Error dibujando el dashboard:", renderErr);
        document.getElementById("sensorGrid").innerHTML =
          `<div class="glass card"><div class="card-empty">Los datos cargaron bien, pero hubo un error dibujando las gráficas.<br>Revisa la consola del navegador (F12) para el detalle.</div></div>`;
      }
    })
    .catch((err) => {
      updatedPillState(null);
      document.getElementById("sensorGrid").innerHTML =
        `<div class="glass card"><div class="card-empty">No se pudo cargar data/latest.json todavía.<br>Corre el workflow de GitHub Actions al menos una vez (ver README).</div></div>`;
      console.error(err);
    });

  function indexSensors(sensors) {
    Object.keys(sensors).forEach((key) => {
      const s = sensors[key];
      state.parsed[key] = (s.points || [])
        .map(([ts, val]) => {
          const p = parseTs(ts);
          if (!p) return null;
          return { ...p, label: `${p.hh.toString().padStart(2, "0")}:${p.mm}`, value: val, ts, epoch: tsToEpochMs(ts) };
        })
        .filter(Boolean);
    });
  }

  function renderGaps(gaps) {
    const panel = document.getElementById("gapsPanel");
    const list = document.getElementById("gapsList");
    if (!gaps.length) { panel.hidden = true; return; }
    panel.hidden = false;
    list.innerHTML = gaps.map((g) => `<li>${escapeHtml(g)}</li>`).join("");
  }

  // -------------------- controles día/hora --------------------

  function buildDayHourControls() {
    const days = new Set();
    Object.values(state.parsed).forEach((points) => points.forEach((p) => days.add(p.date)));
    const sortedDays = Array.from(days).sort();

    const daySelect = document.getElementById("daySelect");
    sortedDays.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      daySelect.appendChild(opt);
    });
    // Selecciona el día más reciente con datos por default, si existe.
    if (sortedDays.length) daySelect.value = sortedDays[sortedDays.length - 1];

    const hourFrom = document.getElementById("hourFromSelect");
    const hourTo = document.getElementById("hourToSelect");
    for (let h = 0; h < 24; h++) {
      const label = `${String(h).padStart(2, "0")}:00`;
      hourFrom.appendChild(new Option(label, h));
      hourTo.appendChild(new Option(label, h));
    }
    hourFrom.value = "0";
    hourTo.value = "23";
  }

  function wireControls() {
    ["daySelect", "hourFromSelect", "hourToSelect"].forEach((id) => {
      document.getElementById(id).addEventListener("change", () => {
        renderAllCards();
        renderCompareChart();
      });
    });
    document.getElementById("normalizeToggle").addEventListener("change", renderCompareChart);
  }

  function currentFilter() {
    const day = document.getElementById("daySelect").value;
    const hFrom = parseInt(document.getElementById("hourFromSelect").value, 10);
    const hTo = parseInt(document.getElementById("hourToSelect").value, 10);
    return { day, hFrom, hTo };
  }

  function filterPoints(points, filter) {
    return points.filter((p) => {
      if (filter.day !== "all" && p.date !== filter.day) return false;
      if (p.hh < filter.hFrom || p.hh > filter.hTo) return false;
      return true;
    });
  }

  // -------------------- tarjetas + gráficas --------------------

  function renderAllCards() {
    const grid = document.getElementById("sensorGrid");
    grid.innerHTML = "";
    const filter = currentFilter();

    SENSOR_META.forEach((meta) => {
      const sensor = state.raw.sensors[meta.key];
      if (!sensor) return;
      const allPoints = state.parsed[meta.key] || [];
      const points = filterPoints(allPoints, filter);
      grid.appendChild(buildCard(meta, sensor, points));
    });

    // Chart.js necesita los <canvas> ya en el DOM antes de instanciarse.
    SENSOR_META.forEach((meta) => {
      const sensor = state.raw.sensors[meta.key];
      if (!sensor) return;
      const allPoints = state.parsed[meta.key] || [];
      const points = filterPoints(allPoints, filter);
      if (!points.length) return;
      try {
        drawChart(meta, sensor, points);
      } catch (chartErr) {
        console.error(`No se pudo dibujar la gráfica de ${meta.key}:`, chartErr);
      }
    });
  }

  function buildCard(meta, sensor, points) {
    const card = document.createElement("div");
    card.className = "glass card card-clickable";
    card.dataset.key = meta.key;
    const last = points[points.length - 1];

    card.innerHTML = `
      <div class="card-head">
        <div class="card-title">
          <span class="name">${escapeHtml(sensor.label)}</span>
          <span class="source">${escapeHtml(sensor.source)}</span>
        </div>
        <div class="card-value">
          ${last
            ? `<span class="num">${formatNum(last.value)}</span><span class="unit">${escapeHtml(sensor.unit)}</span>`
            : `<span class="unit">sin datos</span>`}
        </div>
      </div>
      ${points.length
        ? `<div class="card-chart"><canvas id="chart-${meta.key}"></canvas></div>`
        : `<div class="card-empty">Sin datos para el rango seleccionado.</div>`}
      <div class="card-foot">
        <span>${points.length} puntos</span>
        ${points.length ? `<button class="table-toggle" data-key="${meta.key}">Ver tabla</button>` : ""}
      </div>
      <div class="table-wrap" id="table-${meta.key}" hidden></div>
    `;

    const btn = card.querySelector(".table-toggle");
    if (btn) {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleTable(meta.key, sensor, points, btn);
      });
    }
    card.addEventListener("click", (ev) => {
      if (ev.target.closest(".table-toggle") || ev.target.closest(".table-wrap")) return;
      openDrawer(meta.key);
    });
    return card;
  }

  // -------------------- panel de detalle por sensor --------------------

  function computeSensorDetail(key) {
    const points = state.parsed[key] || [];
    if (!points.length) return { empty: true };

    const dates = Array.from(new Set(points.map((p) => p.date))).sort();
    const months = Array.from(new Set(dates.map((d) => d.slice(0, 7)))).sort();
    const hours = points.map((p) => p.hh);
    const minHour = Math.min(...hours);
    const maxHour = Math.max(...hours);

    let missing = [];
    const win = state.raw && state.raw.window;
    if (win && win.start && win.end) {
      const present = new Set(dates);
      const d = new Date(win.start + "T00:00:00");
      const end = new Date(win.end + "T00:00:00");
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        if (!present.has(ds)) missing.push(ds);
        d.setDate(d.getDate() + 1);
      }
    }

    return {
      empty: false,
      totalPoints: points.length,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      daysWithData: dates.length,
      windowDays: win ? win.days : dates.length,
      months,
      minHour,
      maxHour,
      missing,
    };
  }

  function openDrawer(key) {
    const meta = SENSOR_META.find((m) => m.key === key);
    const sensor = state.raw && state.raw.sensors[key];
    if (!meta || !sensor) return;
    const color = resolveColor(meta.color);
    const detail = computeSensorDetail(key);
    const content = document.getElementById("drawerContent");

    const header = `
      <div class="drawer-title"><span class="drawer-dot" style="background:${color}"></span>${escapeHtml(sensor.label)}</div>
      <p class="muted small">${escapeHtml(sensor.source)}</p>
    `;

    if (detail.empty) {
      content.innerHTML = `${header}<p class="muted">Este sensor no tiene datos en la ventana actual.</p>`;
    } else {
      content.innerHTML = `
        ${header}
        <div class="drawer-stats">
          <div class="drawer-stat"><span class="stat-label">Puntos totales</span><span class="stat-value">${detail.totalPoints}</span></div>
          <div class="drawer-stat"><span class="stat-label">Rango de fechas</span><span class="stat-value">${detail.firstDate} → ${detail.lastDate}</span></div>
          <div class="drawer-stat"><span class="stat-label">Días con datos</span><span class="stat-value">${detail.daysWithData} de ${detail.windowDays}</span></div>
          <div class="drawer-stat"><span class="stat-label">Horas con datos</span><span class="stat-value">${String(detail.minHour).padStart(2, "0")}:00 – ${String(detail.maxHour).padStart(2, "0")}:59</span></div>
          <div class="drawer-stat"><span class="stat-label">Meses cubiertos</span><span class="stat-value">${detail.months.join(", ")}</span></div>
        </div>
        <h3 class="drawer-subtitle">Huecos de este sensor en la ventana</h3>
        ${detail.missing.length
          ? `<ul class="drawer-gaps">${detail.missing.map((d) => `<li>${d}</li>`).join("")}</ul>`
          : `<p class="muted small">Sin huecos — hay datos todos los días de la ventana.</p>`}
      `;
    }

    document.getElementById("drawerBackdrop").hidden = false;
    document.getElementById("detailDrawer").hidden = false;
    requestAnimationFrame(() => document.getElementById("detailDrawer").classList.add("open"));
  }

  function closeDrawer() {
    const drawer = document.getElementById("detailDrawer");
    drawer.classList.remove("open");
    setTimeout(() => {
      drawer.hidden = true;
      document.getElementById("drawerBackdrop").hidden = true;
    }, 200);
  }

  // -------------------- comparativa entre sensores --------------------

  function buildComparePicker() {
    const wrap = document.getElementById("comparePicker");
    wrap.innerHTML = SENSOR_META
      .filter((meta) => state.raw.sensors[meta.key])
      .map((meta) => {
        const sensor = state.raw.sensors[meta.key];
        const color = resolveColor(meta.color);
        return `
          <label class="compare-chip" style="--chip-color:${color}">
            <input type="checkbox" value="${meta.key}" class="compare-check" />
            <span>${escapeHtml(sensor.label)}</span>
          </label>
        `;
      })
      .join("");
    wrap.querySelectorAll(".compare-check").forEach((el) => el.addEventListener("change", renderCompareChart));
  }

  function renderCompareChart() {
    const canvas = document.getElementById("compareChart");
    const empty = document.getElementById("compareEmpty");
    if (!canvas || !state.raw) return;

    const selected = Array.from(document.querySelectorAll(".compare-check:checked")).map((el) => el.value);
    const normalize = document.getElementById("normalizeToggle").checked;
    const filter = currentFilter();

    if (state.compareChart) { state.compareChart.destroy(); state.compareChart = null; }

    if (selected.length < 2) {
      canvas.hidden = true;
      empty.hidden = false;
      empty.textContent = selected.length === 0
        ? "Selecciona 2 o más sensores arriba para compararlos."
        : "Selecciona al menos 1 sensor más para comparar.";
      return;
    }

    canvas.hidden = false;
    empty.hidden = true;

    const datasets = selected.map((key) => {
      const meta = SENSOR_META.find((m) => m.key === key);
      const sensor = state.raw.sensors[key];
      const color = resolveColor(meta.color);
      let pts = filterPoints(state.parsed[key] || [], filter)
        .filter((p) => p.epoch != null)
        .map((p) => ({ x: p.epoch, y: p.value }));

      if (normalize && pts.length) {
        const values = pts.map((p) => p.y);
        const min = Math.min(...values), max = Math.max(...values);
        const range = max - min;
        pts = pts.map((p) => ({ x: p.x, y: range ? ((p.y - min) / range) * 100 : 50 }));
      }

      return {
        label: sensor.label,
        unit: sensor.unit,
        data: pts,
        borderColor: color,
        backgroundColor: hexToRgba(color, 0.08),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.25,
        parsing: false,
      };
    });

    const ctx = canvas.getContext("2d");
    state.compareChart = new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { color: "#c3c2b7", usePointStyle: true, boxWidth: 8, font: { size: 11 } },
          },
          tooltip: {
            backgroundColor: "rgba(20,20,19,0.92)",
            borderColor: "rgba(255,255,255,0.14)",
            borderWidth: 1,
            titleColor: "#ffffff",
            bodyColor: "#c3c2b7",
            padding: 10,
            callbacks: {
              title: (items) => (items.length ? new Date(items[0].parsed.x).toLocaleString("es-CR", { dateStyle: "short", timeStyle: "short" }) : ""),
              label: (item) => {
                const ds = item.dataset;
                const suffix = normalize ? "%" : ` ${ds.unit}`;
                return `${ds.label}: ${formatNum(item.parsed.y)}${suffix}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            ticks: {
              color: "#898781",
              maxTicksLimit: 8,
              font: { size: 10 },
              callback: (value) => new Date(value).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" }),
            },
            grid: { color: "#2c2c2a", drawTicks: false },
            border: { color: "#383835" },
          },
          y: {
            ticks: { color: "#898781", maxTicksLimit: 6, font: { size: 10 } },
            grid: { color: "#2c2c2a", drawTicks: false },
            border: { display: false },
          },
        },
      },
    });
  }

  function toggleTable(key, sensor, points, btn) {
    const wrap = document.getElementById(`table-${key}`);
    if (!wrap.hidden) { wrap.hidden = true; btn.textContent = "Ver tabla"; return; }
    wrap.hidden = false;
    btn.textContent = "Ocultar tabla";
    if (!wrap.dataset.built) {
      const rows = points
        .slice(-500) // evita tablas gigantes en el DOM
        .map((p) => `<tr><td>${p.date} ${p.label}</td><td>${formatNum(p.value)}</td></tr>`)
        .join("");
      wrap.innerHTML = `<table><thead><tr><th>Fecha / hora</th><th>${escapeHtml(sensor.unit)}</th></tr></thead><tbody>${rows}</tbody></table>`;
      wrap.dataset.built = "1";
    }
  }

  function drawChart(meta, sensor, points) {
    const canvas = document.getElementById(`chart-${meta.key}`);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const color = resolveColor(meta.color);

    const multiDay = new Set(points.map((p) => p.date)).size > 1;
    const labels = points.map((p) => (multiDay ? `${p.date.slice(5)} ${p.label}` : p.label));
    const values = points.map((p) => p.value);

    if (state.charts[meta.key]) state.charts[meta.key].destroy();

    state.charts[meta.key] = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: color,
          backgroundColor: hexToRgba(color, 0.16),
          borderWidth: 2,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: color,
          tension: 0.25,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(20,20,19,0.92)",
            borderColor: "rgba(255,255,255,0.14)",
            borderWidth: 1,
            titleColor: "#ffffff",
            bodyColor: "#c3c2b7",
            padding: 10,
            displayColors: false,
            callbacks: {
              label: (item) => `${formatNum(item.parsed.y)} ${sensor.unit}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#898781", maxTicksLimit: 8, autoSkip: true, font: { size: 10 } },
            grid: { color: "#2c2c2a", drawTicks: false },
            border: { color: "#383835" },
          },
          y: {
            ticks: { color: "#898781", maxTicksLimit: 5, font: { size: 10 } },
            grid: { color: "#2c2c2a", drawTicks: false },
            border: { display: false },
          },
        },
      },
    });
  }

  // -------------------- utilidades --------------------

  function resolveColor(cssVar) {
    // cssVar viene como "var(--series-blue)"; lo resolvemos contra :root.
    const name = cssVar.match(/--[\w-]+/)[0];
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const bigint = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function formatNum(n) {
    if (typeof n !== "number" || Number.isNaN(n)) return "—";
    return n.toLocaleString("es-CR", { maximumFractionDigits: 2 });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
