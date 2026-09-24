// Realtime weather readings across Singapore (NEA, data.gov.sg collection 1459)
const WEATHER_BASE = "https://api-open.data.gov.sg/v2/real-time/api/";
const WEATHER_ENDPOINTS = {
  temperature: "air-temperature",
  humidity: "relative-humidity",
  rainfall: "rainfall",
  windSpeed: "wind-speed",
  windDirection: "wind-direction",
};
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

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

async function fetchDataset(endpoint) {
  const res = await fetch(WEATHER_BASE + endpoint);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.errorMsg || "API error");
  const { stations = [], readings = [], readingUnit } = json.data;
  const latest = readings[0];
  if (!latest) throw new Error("No readings");
  const byId = new Map(stations.map((s) => [s.id, s]));
  const values = (latest.data || [])
    .filter((d) => byId.has(d.stationId) && typeof d.value === "number")
    .map((d) => ({ station: byId.get(d.stationId), value: d.value }));
  return { values, unit: readingUnit, timestamp: latest.timestamp };
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

  const r = weather.rainfall && summarize(weather.rainfall.values);
  if (r) {
    const wet = weather.rainfall.values.filter((v) => v.value > 0);
    if (wet.length) {
      setStat("stat-rainfall", `${round1(r.max.value)}<span class="unit">mm</span>`,
        `Raining at ${wet.length} of ${r.count} stations. Heaviest at ${r.max.station.name} (last 5 min)`);
    } else {
      setStat("stat-rainfall", "Dry", `No rain at any of ${r.count} stations in the last 5 min`);
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
  map.fitBounds([[1.22, 103.62], [1.47, 104.03]]);
  return true;
}

function marker(station, html, tip) {
  const icon = L.divIcon({ className: "", html, iconSize: null });
  return L.marker([station.location.latitude, station.location.longitude], { icon, keyboard: true, title: tip })
    .bindTooltip(escapeHtml(tip), { direction: "top", offset: [0, -10] });
}

function renderMap() {
  if (!initMap()) return;
  markerLayer.clearLayers();
  const note = document.getElementById("map-note");
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
    const data = weather.rainfall;
    if (!data) { note.textContent = "This data is unavailable right now."; return; }
    let wet = 0;
    for (const { station, value } of data.values) {
      if (value > 0) {
        wet++;
        marker(station, `<span class="station-pill wet">${round1(value)} mm</span>`, `${name(station)}: ${round1(value)} mm in the last 5 min`)
          .setZIndexOffset(1000).addTo(markerLayer);
      } else {
        marker(station, `<span class="station-dot"></span>`, `${name(station)}: no rain`).addTo(markerLayer);
      }
    }
    note.textContent = wet
      ? `Rain in the last 5 minutes at ${wet} of ${data.values.length} stations. Dots are stations with no rain.`
      : `No rain in the last 5 minutes at any of the ${data.values.length} stations.`;
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

async function loadWeather() {
  const keys = Object.keys(WEATHER_ENDPOINTS);
  const results = await Promise.allSettled(keys.map((k) => fetchDataset(WEATHER_ENDPOINTS[k])));
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
loadWeather();
setInterval(loadWeather, REFRESH_MS);
