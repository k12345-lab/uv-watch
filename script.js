const API_URL = "https://api-open.data.gov.sg/v2/real-time/api/uv";
const REFRESH_MS = 5 * 60 * 1000;

// WHO UV index categories
const LEVELS = [
  { name: "Low", min: 0, max: 2, color: "--uv-low",
    advice: "Minimal risk. You can safely enjoy being outside." },
  { name: "Moderate", min: 3, max: 5, color: "--uv-moderate",
    advice: "Seek shade during midday. Wear sunglasses and use SPF 30+ sunscreen." },
  { name: "High", min: 6, max: 7, color: "--uv-high",
    advice: "Reduce time in the sun between 11am and 3pm. Cover up, wear a hat and sunscreen." },
  { name: "Very High", min: 8, max: 10, color: "--uv-very-high",
    advice: "Extra protection needed. Avoid the midday sun and seek shade." },
  { name: "Extreme", min: 11, max: Infinity, color: "--uv-extreme",
    advice: "Unprotected skin can burn in minutes. Stay indoors around midday if you can." },
];

const $ = (id) => document.getElementById(id);

function levelFor(value) {
  return LEVELS.find((l) => value <= l.max) || LEVELS[LEVELS.length - 1];
}

function formatHour(iso) {
  return new Date(iso).toLocaleTimeString("en-SG", {
    hour: "numeric", hour12: true, timeZone: "Asia/Singapore",
  });
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString("en-SG", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    hour12: true, timeZone: "Asia/Singapore",
  });
}

async function fetchUV() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.errorMsg || "API error");
  const record = json.data?.records?.[0];
  if (!record) throw new Error("No UV data available yet");
  // API returns newest first; sort oldest → newest for the chart
  const readings = [...(record.index || [])].sort(
    (a, b) => new Date(a.hour) - new Date(b.hour)
  );
  return { readings, updated: record.updatedTimestamp };
}

function renderHero(readings) {
  const hero = $("hero");
  const latest = readings[readings.length - 1];
  if (!latest) {
    $("uv-value").textContent = "–";
    $("uv-level").textContent = "No readings yet today";
    $("uv-advice").textContent = "NEA starts publishing readings from 7am.";
    $("uv-time").textContent = "";
    return;
  }
  const level = levelFor(latest.value);
  hero.style.setProperty("--level-color", `var(${level.color})`);
  $("uv-value").textContent = latest.value;
  $("uv-level").innerHTML = `<span class="dot" aria-hidden="true"></span>${level.name}`;
  $("uv-advice").textContent = level.advice;
  $("uv-time").textContent = `Reading for ${formatHour(latest.hour)}`;
}

function renderChart(readings) {
  const chart = $("chart");
  const W = Math.max(280, chart.clientWidth || 640), H = 240;
  const m = { top: 20, right: 8, bottom: 28, left: 28 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const maxY = Math.max(12, ...readings.map((r) => r.value));
  const y = (v) => m.top + ih - (v / maxY) * ih;

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // Recessive gridlines at category boundaries
  svg += `<g class="grid axis">`;
  for (const t of [0, 3, 6, 8, 11]) {
    svg += `<line x1="${m.left}" x2="${W - m.right}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text x="${m.left - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  }
  svg += `</g>`;

  if (!readings.length) {
    svg += `<text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">No readings yet today</text>`;
  } else {
    const slot = iw / readings.length;
    const bw = Math.min(40, slot - 2); // 2px gap between bars
    const lastIdx = readings.length - 1;
    const peakIdx = readings.reduce((p, r, i) => (r.value > readings[p].value ? i : p), 0);

    readings.forEach((r, i) => {
      const level = levelFor(r.value);
      const cx = m.left + slot * i + slot / 2;
      const x = cx - bw / 2;
      const top = y(r.value);
      const h = Math.max(0, y(0) - top);
      const rad = Math.min(4, h, bw / 2);
      // Bar with rounded top corners, square at baseline
      const path = h > 0
        ? `M${x},${y(0)} V${top + rad} Q${x},${top} ${x + rad},${top} H${x + bw - rad} Q${x + bw},${top} ${x + bw},${top + rad} V${y(0)} Z`
        : "";
      const tip = `${formatHour(r.hour)} · UV ${r.value} (${level.name})`;
      svg += `<g class="bar-group" tabindex="0" data-tip="${tip}" data-x="${cx}" data-y="${top}" aria-label="${tip}">`;
      svg += `<rect class="hit" x="${m.left + slot * i}" y="${m.top}" width="${slot}" height="${ih}"/>`;
      if (path) svg += `<path class="bar" d="${path}" fill="var(${level.color})"/>`;
      // Direct labels only on the latest and peak readings
      if (i === lastIdx || i === peakIdx) {
        svg += `<text class="bar-label" x="${cx}" y="${top - 6}" text-anchor="middle">${r.value}</text>`;
      }
      svg += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle"><tspan>${formatHour(r.hour)}</tspan></text>`;
      svg += `</g>`;
    });
  }

  svg += `</svg>`;
  chart.innerHTML = svg;
  attachTooltips(chart);
}

function attachTooltips(chart) {
  const tooltip = $("tooltip");
  const svg = chart.querySelector("svg");
  const show = (g) => {
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const card = chart.parentElement.getBoundingClientRect();
    const svgBox = svg.getBoundingClientRect();
    tooltip.textContent = g.dataset.tip;
    tooltip.style.left = `${svgBox.left - card.left + g.dataset.x * scale}px`;
    tooltip.style.top = `${svgBox.top - card.top + g.dataset.y * scale - 10}px`;
    tooltip.hidden = false;
  };
  const hide = () => { tooltip.hidden = true; };
  chart.querySelectorAll(".bar-group").forEach((g) => {
    g.addEventListener("mouseenter", () => show(g));
    g.addEventListener("focus", () => show(g));
    g.addEventListener("mouseleave", hide);
    g.addEventListener("blur", hide);
  });
}

function renderTable(readings) {
  $("table-body").innerHTML = [...readings].reverse().map((r) =>
    `<tr><td>${formatHour(r.hour)}</td><td>${r.value}</td><td>${levelFor(r.value).name}</td></tr>`
  ).join("") || `<tr><td colspan="3">No readings yet today</td></tr>`;
}

function renderScale() {
  $("scale").innerHTML = LEVELS.map((l) => `
    <li>
      <span class="swatch" style="background: var(${l.color})" aria-hidden="true"></span>
      <span class="name">${l.name}<span class="range">${l.max === Infinity ? `${l.min}+` : `${l.min}–${l.max}`}</span></span>
      <span class="desc">${l.advice}</span>
    </li>`).join("");
}

let lastReadings = [];
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderChart(lastReadings), 150);
});

async function load() {
  const btn = $("refresh-btn");
  btn.disabled = true;
  try {
    const { readings, updated } = await fetchUV();
    renderHero(readings);
    lastReadings = readings;
    renderChart(readings);
    renderTable(readings);
    $("updated").textContent = `Last updated by NEA: ${formatDateTime(updated)}`;
  } catch (err) {
    $("uv-level").innerHTML = `<span class="error">Couldn't load UV data</span>`;
    $("uv-advice").textContent = `${err.message}. Try refreshing in a moment.`;
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

renderScale();
load();
setInterval(load, REFRESH_MS);
$("refresh-btn").addEventListener("click", load);
