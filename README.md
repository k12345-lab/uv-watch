# UV Watch

A weather monitoring website for Singapore, focused on the real-time **UV index**, with live temperature, humidity, rainfall and wind readings from weather stations across the island.

**Live site:** https://k12345-lab.github.io/uv-watch/

## Features

### UV index
- Current UV index with its WHO exposure level (Low, Moderate, High, Very High, Extreme)
- Sun-safety advice for the current level
- Hour-by-hour chart of today's readings, colour-coded by level, with hover details and a table view
- Guide to what each level means

### Weather across Singapore
- Summary cards for **temperature**, **humidity**, **rainfall** and **wind**, showing the island-wide average plus the lowest and highest stations
- Wind shows the prevailing direction (using a proper compass-angle average) with an arrow
- Interactive map of every weather station, switchable between Temperature, Humidity, Rainfall and Wind
  - **Temperature / Humidity:** each station's latest reading
  - **Rainfall:** total rain per station over the last 2 hours, drawn as blue bubbles that grow with the amount; the wettest stations are labelled, and a banner appears when it has been dry everywhere
  - **Wind:** speed at each station with an arrow showing where the wind is blowing

### General
- Refreshes automatically every 5 minutes, or on demand with the Refresh button
- If one data source fails, the rest of the page still loads
- Works on phones and desktops, with light and dark mode

## Data sources

All data comes from the [National Environment Agency (NEA)](https://www.nea.gov.sg/) through [data.gov.sg](https://data.gov.sg/). No API key is needed.

| Data | Endpoint | Updates |
|---|---|---|
| UV index | `https://api-open.data.gov.sg/v2/real-time/api/uv` | Hourly, 7am–7pm |
| Air temperature | `https://api-open.data.gov.sg/v2/real-time/api/air-temperature` | Every minute |
| Relative humidity | `https://api-open.data.gov.sg/v2/real-time/api/relative-humidity` | Every minute |
| Rainfall | `https://api-open.data.gov.sg/v2/real-time/api/rainfall?date=YYYY-MM-DD` | Every 5 minutes |
| Wind speed | `https://api-open.data.gov.sg/v2/real-time/api/wind-speed` | Every minute |
| Wind direction | `https://api-open.data.gov.sg/v2/real-time/api/wind-direction` | Every minute |

Map tiles are from [OpenStreetMap](https://www.openstreetmap.org/copyright), displayed with [Leaflet](https://leafletjs.com/).

## Running locally

It's a static site with no build step. Open `index.html` in a browser, or serve the folder with any static server:

```sh
npx serve .
```

## Project structure

| File | Purpose |
|---|---|
| `index.html` | Page layout |
| `style.css` | Styles, including dark mode and mobile layout |
| `script.js` | UV index: current reading, hourly chart, level guide |
| `weather.js` | Weather cards and the station map |

## Deployment

The site is hosted on GitHub Pages from the `main` branch. Pushing to `main` updates the live site within a minute or two.
