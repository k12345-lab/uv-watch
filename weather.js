// Realtime weather readings across Singapore (NEA, data.gov.sg collection 1459)
const WEATHER_BASE = "https://api-open.data.gov.sg/v2/real-time/api/";
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

// Rainfall is summed over this window, since a single 5-minute reading is
// almost always zero.
const RAIN_WINDOW_MIN = 120;
const RAIN_BINS = [
  { max: 1, label: "Under 1 mm", color: "#9cc9f5", radius: 6 },
  { max: 5, label: "1–5 mm", color: "#4f9be8", radius: 9 },
  { max: 20, label: "5–20 mm", color: "#1f6fd1", radius: 13 },
  { max: Infinity, label: "20 mm or more", color: "#0c3d8c", radius: 17 },
];
const RAIN_LABEL_LIMIT = 8; // only label the wettest few stations
const rainBin = (mm) => RAIN_BINS.find((b) => mm < b.max);

let map = null;
let markerLayer = null;
let currentLayer = "temperature";
let weather = {};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const round1 = (n) => Math.round(n * 10) / 10;

function compassFor(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// Angles can't be averaged directly (avg of 350° and 10° is 0°, not 180°),
// so average them as unit vectors.
function circularMean(degrees) {
  let x = 0, y = 0;
  for (const d of degrees) {
    x += Math.cos((d * Math.PI) / 180);
    y += Math.sin((d * Math.PI) / 180);
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

async function fetchApi(endpoint) {
  const res = await fetch(WEATHER_BASE + endpoint);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.errorMsg || "API error");
  const { stations = [], readings = [] } = json.data;
  // Newest reading first
  readings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (!readings.length) throw new Error("No readings");
  return { stations, readings };
}

async function fetchDataset(endpoint) {
  const { stations, readings } = await fetchApi(endpoint);
  const latest = readings[0];
  const byId = new Map(stations.map((s) => [s.id, s]));
  const values = (latest.data || [])
    .filter((d) => byId.has(d.stationId) && typeof d.value === "number")
    .map((d) => ({ station: byId.get(d.stationId), value: d.value }));
  return { values, timestamp: latest.timestamp };
}

// Asking for today's date returns the latest ~2 hours of 5-minute totals
// (25 readings per page), which we add up per station.
async function fetchRainfall() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const { stations, readings } = await fetchApi(`rainfall?date=${today}`);
  const latestTime = new Date(readings[0].timestamp);
  const inWindow = readings.filter((r) => latestTime - new Date(r.timestamp) < RAIN_WINDOW_MIN * 60000);

  const totals = new Map();
  for (const r of inWindow) {
    for (const d of r.data || []) {
      if (typeof d.value === "number") totals.set(d.stationId, (totals.get(d.stationId) || 0) + d.value);
    }
  }
  const latestById = new Map((readings[0].data || []).map((d) => [d.stationId, d.value]));
  const values = stations
    .filter((s) => totals.has(s.id))
    .map((s) => ({ station: s, value: round1(totals.get(s.id)), now: latestById.get(s.id) || 0 }));

  // Each reading covers the 5 minutes before its timestamp
  const windowMin = Math.round((latestTime - new Date(inWindow[inWindow.length - 1].timestamp)) / 60000) + 5;
  return { values, timestamp: readings[0].timestamp, windowMin };
}

function rainWindowLabel(minutes) {
  return minutes >= RAIN_WINDOW_MIN - 5 ? "last 2 hours" : `last ${minutes} min`;
}

function summarize(values) {
  if (!values.length) return null;
  let min = values[0], max = values[0], sum = 0;
  for (const v of values) {
    if (v.value < min.value) min = v;
    if (v.value > max.value) max = v;
    sum += v.value;
  }
  return { avg: sum / values.length, min, max, count: values.length };
}

function setStat(id, valueHtml, subText) {
  const el = document.getElementById(id);
  el.querySelector(".stat-value").innerHTML = valueHtml;
  el.querySelector(".stat-sub").textContent = subText;
}

function renderStats() {
  const t = weather.temperature && summarize(weather.temperature.values);
  if (t) {
    setStat("stat-temperature", `${round1(t.avg)}<span class="unit">°C</span>`,
      `${t.min.value}° at ${t.min.station.name} to ${t.max.value}° at ${t.max.station.name}`);
  } else setStat("stat-temperature", "–", "Unavailable right now");

  const h = weather.humidity && summarize(weather.humidity.values);
  if (h) {
    setStat("stat-humidity", `${Math.round(h.avg)}<span class="unit">%</span>`,
      `${round1(h.min.value)}% to ${round1(h.max.value)}% across ${h.count} stations`);
  } else setStat("stat-humidity", "–", "Unavailable right now");

  const rain = weather.rainfall;
  const r = rain && summarize(rain.values);
  if (r) {
    const span = rainWindowLabel(rain.windowMin);
    const wet = rain.values.filter((v) => v.value > 0);
    const wetNow = rain.values.filter((v) => v.now > 0);
    if (wet.length) {
      const nowText = wetNow.length ? `Still raining at ${wetNow.length}.` : "Dry right now.";
      setStat("stat-rainfall", `${r.max.value}<span class="unit">mm</span>`,
        `Most rain in the ${span}, at ${r.max.station.name}. Rain at ${wet.length} of ${r.count} stations. ${nowText}`);
    } else {
      setStat("stat-rainfall", "Dry", `No rain at any of ${r.count} stations in the ${span}`);
    }
  } else setStat("stat-rainfall", "–", "Unavailable right now");

  const s = weather.windSpeed && summarize(weather.windSpeed.values);
  if (s) {
    let valueHtml = `${round1(s.avg)}<span class="unit">kn</span>`;
    let sub = `${s.min.value} to ${s.max.value} kn across ${s.count} stations`;
    const dirs = weather.windDirection?.values.map((v) => v.value) || [];
    if (dirs.length) {
      const mean = circularMean(dirs);
      // Wind direction is where it blows FROM; the arrow points where it blows TO
      valueHtml += `<span class="wind-arrow" style="transform: rotate(${mean + 180}deg)" aria-hidden="true">↑</span>`;
      sub = `Mostly from the ${compassFor(mean)}, ${sub}`;
    }
    setStat("stat-wind", valueHtml, sub);
  } else setStat("stat-wind", "–", "Unavailable right now");

  const ts = weather.temperature?.timestamp || weather.windSpeed?.timestamp || weather.rainfall?.timestamp;
  document.getElementById("weather-time").textContent = ts
    ? `Readings at ${new Date(ts).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Singapore" })}`
    : "";
}

function initMap() {
  if (map) return true;
  const el = document.getElementById("map");
  if (typeof L === "undefined") {
    el.innerHTML = `<div class="map-fallback">Map couldn't load.</div>`;
    return false;
  }
  map = L.map(el, {
    center: [1.3521, 103.8198],
    zoom: 11,
    minZoom: 10,
    maxBounds: [[1.1, 103.5], [1.55, 104.15]],
    scrollWheelZoom: false,
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 16,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  // Rain labels are placed to avoid overlaps, which depends on zoom
  map.on("zoomend", () => { if (currentLayer === "rainfall") renderMap(); });
  map.fitBounds([[1.22, 103.62], [1.47, 104.03]]);
  return true;
}

function marker(station, html, tip) {
  const icon = L.divIcon({ className: "", html, iconSize: null });
  return L.marker([station.location.latitude, station.location.longitude], { icon, keyboard: true, title: tip })
    .bindTooltip(escapeHtml(tip), { direction: "top", offset: [0, -10] });
}

function renderRainLegend() {
  document.getElementById("rain-legend").innerHTML =
    RAIN_BINS.map((b) => `
      <li><span class="rain-swatch" style="width:${b.radius * 2}px;height:${b.radius * 2}px;background:${b.color}" aria-hidden="true"></span>${b.label}</li>`).join("") +
    `<li><span class="rain-swatch dry" aria-hidden="true"></span>No rain</li>`;
}

// Label the wettest stations, skipping any label that would overlap one
// already placed at the current zoom level.
function pickRainLabels(wet) {
  const placed = [];
  const chosen = new Set();
  for (const v of wet) {
    if (chosen.size >= RAIN_LABEL_LIMIT) break;
    const p = map.latLngToContainerPoint([v.station.location.latitude, v.station.location.longitude]);
    const left = p.x + rainBin(v.value).radius + 3;
    const box = { l: left, r: left + `${v.value} mm`.length * 6.5 + 10, t: p.y - 9, b: p.y + 9 };
    if (placed.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) continue;
    placed.push(box);
    chosen.add(v);
  }
  return chosen;
}

function renderRainfall(note, banner) {
  const data = weather.rainfall;
  if (!data) { note.textContent = "This data is unavailable right now."; return; }
  const span = rainWindowLabel(data.windowMin);
  const until = new Date(data.timestamp).toLocaleTimeString("en-SG", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Singapore",
  });
  const latLng = (s) => [s.location.latitude, s.location.longitude];

  for (const { station } of data.values.filter((v) => v.value === 0)) {
    L.circleMarker(latLng(station), { radius: 4, className: "rain-dry" })
      .bindTooltip(escapeHtml(`${station.name}: no rain in the ${span}`), { direction: "top" })
      .addTo(markerLayer);
  }

  // Draw biggest first so smaller bubbles stay on top and clickable
  const wet = data.values.filter((v) => v.value > 0).sort((a, b) => b.value - a.value);
  const labelled = pickRainLabels(wet);
  for (const v of wet) {
    const bin = rainBin(v.value);
    const nowText = v.now > 0 ? `, ${round1(v.now)} mm in the last 5 min` : "";
    L.circleMarker(latLng(v.station), {
      radius: bin.radius, fillColor: bin.color, fillOpacity: 0.85, color: "#fff", weight: 2,
    })
      .bindTooltip(escapeHtml(`${v.station.name}: ${v.value} mm in the ${span}${nowText}`), { direction: "top" })
      .addTo(markerLayer);
    if (labelled.has(v)) {
      const icon = L.divIcon({
        className: "",
        html: `<span class="rain-label" style="margin-left:${bin.radius + 3}px">${v.value} mm</span>`,
        iconSize: null,
      });
      L.marker(latLng(v.station), { icon, interactive: false, keyboard: false }).addTo(markerLayer);
    }
  }

  document.getElementById("rain-legend").hidden = false;
  if (wet.length) {
    note.textContent = `Total rain per station in the ${span}, up to ${until}. Hover or tap a circle for details.`;
  } else {
    banner.textContent = `No rain across Singapore in the ${span}`;
    banner.hidden = false;
    note.textContent = `All ${data.values.length} rain gauges were dry in the ${span}, up to ${until}.`;
  }
}

function renderMap() {
  if (!initMap()) return;
  markerLayer.clearLayers();
  const note = document.getElementById("map-note");
  const banner = document.getElementById("map-banner");
  banner.hidden = true;
  document.getElementById("rain-legend").hidden = true;
  const name = (s) => s.name;

  if (currentLayer === "temperature" || currentLayer === "humidity") {
    const data = weather[currentLayer];
    const unit = currentLayer === "temperature" ? "°C" : "%";
    if (!data) { note.textContent = "This data is unavailable right now."; return; }
    for (const { station, value } of data.values) {
      const v = currentLayer === "humidity" ? Math.round(value) : round1(value);
      marker(station, `<span class="station-pill">${v}${unit}</span>`, `${name(station)}: ${round1(value)}${unit}`)
        .addTo(markerLayer);
    }
    note.textContent = `${data.values.length} stations. Hover or tap a marker for the station name.`;
  } else if (currentLayer === "rainfall") {
    renderRainfall(note, banner);
  } else if (currentLayer === "wind") {
    const speed = weather.windSpeed;
    if (!speed) { note.textContent = "This data is unavailable right now."; return; }
    const dirById = new Map((weather.windDirection?.values || []).map((v) => [v.station.id, v.value]));
    for (const { station, value } of speed.values) {
      const dir = dirById.get(station.id);
      const arrow = dir === undefined ? "" :
        `<span class="arrow" style="transform: rotate(${dir + 180}deg)" aria-hidden="true">↑</span>`;
      const tip = `${name(station)}: ${round1(value)} kn` + (dir === undefined ? "" : ` from the ${compassFor(dir)} (${dir}°)`);
      marker(station, `<span class="station-pill">${arrow}${round1(value)} kn</span>`, tip).addTo(markerLayer);
    }
    note.textContent = `Average wind speed over 10 minutes. Arrows show where the wind is blowing to.`;
  }
}

const WEATHER_SOURCES = {
  temperature: () => fetchDataset("air-temperature"),
  humidity: () => fetchDataset("relative-humidity"),
  rainfall: fetchRainfall,
  windSpeed: () => fetchDataset("wind-speed"),
  windDirection: () => fetchDataset("wind-direction"),
};

async function loadWeather() {
  const keys = Object.keys(WEATHER_SOURCES);
  const results = await Promise.allSettled(keys.map((k) => WEATHER_SOURCES[k]()));
  weather = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") weather[keys[i]] = r.value;
    else console.error(`Weather ${keys[i]} failed:`, r.reason);
  });
  renderStats();
  renderMap();
}

document.getElementById("map-toggle").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-layer]");
  if (!btn) return;
  currentLayer = btn.dataset.layer;
  document.querySelectorAll("#map-toggle button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b === btn)));
  renderMap();
});

document.getElementById("refresh-btn").addEventListener("click", loadWeather);
renderRainLegend();
loadWeather();
setInterval(loadWeather, REFRESH_MS);
