// TripCast — multi-model trip forecast
// Data: Open-Meteo (free, no key). Models blended: ECMWF, GFS, ICON, GEM, JMA, UK Met Office.

const MODELS = [
{ id: ‘ecmwf_ifs025’, label: ‘ECMWF’ },
{ id: ‘gfs_seamless’, label: ‘GFS’ },
{ id: ‘icon_seamless’, label: ‘ICON’ },
{ id: ‘gem_seamless’, label: ‘GEM’ },
{ id: ‘jma_seamless’, label: ‘JMA’ },
{ id: ‘ukmo_seamless’, label: ‘UKMO’ }
];

const state = {
unit: ‘F’,
legs: [],
forecast: null
};

// ––––– INIT –––––
document.addEventListener(‘DOMContentLoaded’, () => {
bindUnitToggle();
document.getElementById(‘add-leg’).addEventListener(‘click’, () => addLeg());
document.getElementById(‘submit’).addEventListener(‘click’, runForecast);
document.getElementById(‘edit-btn’).addEventListener(‘click’, editTrip);
document.getElementById(‘share-btn’).addEventListener(‘click’, copyShareLink);
document.getElementById(‘export-btn’).addEventListener(‘click’, exportImage);

// Load from URL or default to one empty leg
const params = new URLSearchParams(location.search);
if (params.has(‘trip’)) {
try {
const parsed = decodeTrip(params.get(‘trip’));
state.legs = parsed;
renderLegs();
runForecast();
return;
} catch (e) { console.warn(‘Bad trip param’, e); }
}
addLeg();
});

// ––––– UNIT TOGGLE –––––
function bindUnitToggle() {
document.querySelectorAll(’.unit-btn’).forEach(btn => {
btn.addEventListener(‘click’, () => {
state.unit = btn.dataset.unit;
document.querySelectorAll(’.unit-btn’).forEach(b => b.classList.toggle(‘active’, b === btn));
if (state.forecast) renderResults();
});
});
}

// ––––– LEG MANAGEMENT –––––
function addLeg(data) {
state.legs.push(data || { city: ‘’, lat: null, lon: null, start: ‘’, end: ‘’ });
renderLegs();
}

function removeLeg(i) {
state.legs.splice(i, 1);
if (state.legs.length === 0) addLeg();
else renderLegs();
}

function renderLegs() {
const wrap = document.getElementById(‘legs’);
wrap.innerHTML = ‘’;
state.legs.forEach((leg, i) => {
const row = document.createElement(‘div’);
row.className = ‘leg’;
row.innerHTML = `<div class="leg-num">${i + 1}</div> <div class="field city-field"> <label>City</label> <input type="text" placeholder="e.g. London" value="${escape(leg.city)}" data-i="${i}" data-k="city" autocomplete="off"> <div class="suggestions" hidden></div> </div> <div class="field"> <label>Start date</label> <input type="date" value="${leg.start || ''}" data-i="${i}" data-k="start"> </div> <div class="field"> <label>End date</label> <input type="date" value="${leg.end || ''}" data-i="${i}" data-k="end"> </div> <button class="remove-leg" data-i="${i}" title="Remove leg">×</button>`;
wrap.appendChild(row);
});
bindLegInputs();
}

function escape(s) { return (s || ‘’).replace(/”/g, ‘"’); }

function bindLegInputs() {
document.querySelectorAll(’.leg input’).forEach(inp => {
inp.addEventListener(‘input’, e => {
const i = +e.target.dataset.i;
const k = e.target.dataset.k;
state.legs[i][k] = e.target.value;
if (k === ‘city’) {
// clear lat/lon since city text changed
state.legs[i].lat = null;
state.legs[i].lon = null;
handleCityInput(e.target, i);
}
});
inp.addEventListener(‘blur’, e => {
// delay so click on suggestion can register
setTimeout(() => {
const box = e.target.parentElement.querySelector(’.suggestions’);
if (box) box.hidden = true;
}, 200);
});
});
document.querySelectorAll(’.remove-leg’).forEach(btn => {
btn.addEventListener(‘click’, () => removeLeg(+btn.dataset.i));
});
}

// ––––– GEOCODING (Open-Meteo) –––––
let geocodeTimer = null;
function handleCityInput(input, i) {
clearTimeout(geocodeTimer);
const q = input.value.trim();
if (q.length < 2) {
input.parentElement.querySelector(’.suggestions’).hidden = true;
return;
}
geocodeTimer = setTimeout(async () => {
try {
const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
const res = await fetch(url);
const data = await res.json();
const box = input.parentElement.querySelector(’.suggestions’);
if (!data.results || data.results.length === 0) {
box.hidden = true;
return;
}
box.innerHTML = data.results.map(r => `<div class="suggestion" data-lat="${r.latitude}" data-lon="${r.longitude}" data-name="${escape(r.name)}"> <div>${r.name}</div> <div class="suggestion-sub">${[r.admin1, r.country].filter(Boolean).join(', ')}</div> </div>`).join(’’);
box.hidden = false;
box.querySelectorAll(’.suggestion’).forEach(el => {
el.addEventListener(‘mousedown’, e => {
e.preventDefault();
state.legs[i].city = el.dataset.name;
state.legs[i].lat = parseFloat(el.dataset.lat);
state.legs[i].lon = parseFloat(el.dataset.lon);
input.value = el.dataset.name;
box.hidden = true;
});
});
} catch (err) {
console.error(‘Geocode error’, err);
}
}, 250);
}

// ––––– FORECAST –––––
async function runForecast() {
const err = document.getElementById(‘form-error’);
err.hidden = true;

// validate
for (const leg of state.legs) {
if (!leg.city || leg.lat == null || leg.lon == null) {
return showError(‘Please pick a city from the dropdown for every leg.’);
}
if (!leg.start || !leg.end) {
return showError(‘Every leg needs a start and end date.’);
}
if (leg.start > leg.end) {
return showError(`Leg "${leg.city}": end date must be on or after start date.`);
}
}

const minDate = state.legs.map(l => l.start).sort()[0];
const maxDate = state.legs.map(l => l.end).sort().reverse()[0];
const today = new Date().toISOString().slice(0, 10);
if (maxDate < today) {
return showError(‘All dates are in the past. Pick future dates to see forecasts.’);
}

// show loading
document.getElementById(‘form-section’).hidden = true;
document.getElementById(‘loading’).hidden = false;
document.getElementById(‘results’).hidden = true;

try {
// build day list from legs
const days = expandLegs(state.legs);
// group by unique location to minimize API calls
const byLoc = new Map();
for (const d of days) {
const key = `${d.lat.toFixed(3)},${d.lon.toFixed(3)}`;
if (!byLoc.has(key)) byLoc.set(key, { lat: d.lat, lon: d.lon, days: [] });
byLoc.get(key).days.push(d);
}

```
// fetch each location once with full date range
await Promise.all([...byLoc.values()].map(async group => {
  const start = group.days.map(d => d.date).sort()[0];
  const end = group.days.map(d => d.date).sort().reverse()[0];
  const data = await fetchEnsemble(group.lat, group.lon, start, end);
  // attach data to each day
  for (const d of group.days) {
    d.ensemble = extractDay(data, d.date);
  }
}));

state.forecast = { days, generatedAt: new Date() };
renderResults();
updateUrl();
```

} catch (e) {
console.error(e);
document.getElementById(‘loading’).hidden = true;
document.getElementById(‘form-section’).hidden = false;
showError(’Could not fetch forecast. ’ + (e.message || ‘Please try again.’));
}
}

function expandLegs(legs) {
const out = [];
for (const leg of legs) {
const start = new Date(leg.start + ‘T00:00:00’);
const end = new Date(leg.end + ‘T00:00:00’);
for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
out.push({
date: d.toISOString().slice(0, 10),
city: leg.city,
lat: leg.lat,
lon: leg.lon
});
}
}
return out;
}

async function fetchEnsemble(lat, lon, start, end) {
// Open-Meteo allows requesting multiple models at once
const params = new URLSearchParams({
latitude: lat,
longitude: lon,
start_date: start,
end_date: end,
daily: ‘temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code’,
timezone: ‘auto’,
models: MODELS.map(m => m.id).join(’,’)
});
const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
const res = await fetch(url);
if (!res.ok) throw new Error(`Forecast API returned ${res.status}`);
return res.json();
}

function extractDay(data, dateStr) {
// data.daily.time is array of date strings; for each model, variables come back as `name_model`
const idx = data.daily.time.indexOf(dateStr);
if (idx < 0) return null;
const perModel = MODELS.map(m => {
const hi = data.daily[`temperature_2m_max_${m.id}`]?.[idx];
const lo = data.daily[`temperature_2m_min_${m.id}`]?.[idx];
const pop = data.daily[`precipitation_probability_max_${m.id}`]?.[idx];
const precip = data.daily[`precipitation_sum_${m.id}`]?.[idx];
const code = data.daily[`weather_code_${m.id}`]?.[idx];
return { model: m.label, hi, lo, pop, precip, code };
}).filter(d => d.hi != null && d.lo != null);

if (perModel.length === 0) return null;

const hi = mean(perModel.map(d => d.hi));
const lo = mean(perModel.map(d => d.lo));
const hiSpread = range(perModel.map(d => d.hi));
const pop = mean(perModel.map(d => d.pop).filter(v => v != null));
const precip = mean(perModel.map(d => d.precip).filter(v => v != null));
const code = mode(perModel.map(d => d.code).filter(v => v != null));

return { perModel, hi, lo, hiSpread, pop, precip, code };
}

function mean(arr) {
if (!arr || arr.length === 0) return null;
return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function range(arr) {
if (!arr || arr.length === 0) return 0;
return Math.max(…arr) - Math.min(…arr);
}
function mode(arr) {
if (!arr || arr.length === 0) return null;
const counts = {};
let best = arr[0], bestN = 0;
for (const v of arr) {
counts[v] = (counts[v] || 0) + 1;
if (counts[v] > bestN) { bestN = counts[v]; best = v; }
}
return best;
}

// ––––– RENDER RESULTS –––––
function renderResults() {
document.getElementById(‘loading’).hidden = true;
document.getElementById(‘form-section’).hidden = true;
document.getElementById(‘results’).hidden = false;

// title
const cities = […new Set(state.legs.map(l => l.city))];
document.getElementById(‘results-title’).textContent = cities.join(’ → ’);

// grid
const grid = document.getElementById(‘grid’);
grid.innerHTML = ‘’;
state.forecast.days.forEach(d => grid.appendChild(renderDayCard(d)));
}

function renderDayCard(day) {
const card = document.createElement(‘div’);
card.className = ‘day’;

const e = day.ensemble;
if (!e) {
card.innerHTML = `<div class="dow">${dowFor(day.date)}</div> <div class="date">${shortDate(day.date)}</div> <div class="city">${day.city}</div> <div style="margin:30px 0; color: var(--text-faint); font-size: 12px;">No data</div>`;
return card;
}

// confidence: based on temperature spread across models (in C)
const spreadC = e.hiSpread;
let conf = ‘high’;
if (spreadC > 5) conf = ‘low’;
else if (spreadC > 2.5) conf = ‘med’;

const iconId = weatherCodeToIcon(e.code, e.pop);
const hi = formatTemp(e.hi);
const lo = formatTemp(e.lo);
const pop = e.pop != null ? Math.round(e.pop) : null;
const spread = formatSpread(spreadC);

card.innerHTML = `<div class="conf-dot-day conf-${conf}" title="Model agreement: ${conf === 'high' ? 'high' : conf === 'med' ? 'some spread' : 'models disagree'} (Δ${spread})"></div> <div class="dow">${dowFor(day.date)}</div> <div class="date">${shortDate(day.date)}</div> <div class="city" title="${day.city}">${day.city}</div> <div class="icon"><svg width="42" height="42"><use href="#${iconId}"/></svg></div> <div class="pop"><svg class="drop"><use href="#drop"/></svg>${pop != null ? pop + '%' : '—'}</div> <div class="temps"> <div class="hi">${hi}°</div> <div class="bar"></div> <div class="lo">${lo}°</div> </div> <div class="spread">±${spread}</div>`;
return card;
}

function dowFor(dateStr) {
return new Date(dateStr + ‘T12:00:00’).toLocaleDateString(‘en-US’, { weekday: ‘short’ }).toUpperCase();
}
function shortDate(dateStr) {
return new Date(dateStr + ‘T12:00:00’).toLocaleDateString(‘en-US’, { month: ‘short’, day: ‘numeric’ });
}

function formatTemp(c) {
if (c == null) return ‘—’;
if (state.unit === ‘F’) return Math.round(c * 9 / 5 + 32);
return Math.round(c);
}
function formatSpread(c) {
if (c == null) return ‘0’;
// spread is a delta — convert magnitude only
if (state.unit === ‘F’) return Math.round(c * 9 / 5);
return Math.round(c);
}

function weatherCodeToIcon(code, pop) {
// WMO weather codes: https://open-meteo.com/en/docs
if (code == null) return ‘i-cloud’;
if (code === 0) return ‘i-sun’;                          // clear
if (code === 1 || code === 2) return ‘i-partly’;         // mainly clear / partly cloudy
if (code === 3) return ‘i-cloud’;                        // overcast
if (code >= 45 && code <= 48) return ‘i-cloud’;          // fog
if (code >= 51 && code <= 57) return ‘i-rain’;           // drizzle
if (code >= 61 && code <= 65) return code >= 65 ? ‘i-heavy’ : ‘i-rain’; // rain
if (code >= 66 && code <= 67) return ‘i-rain’;           // freezing rain
if (code >= 71 && code <= 77) return ‘i-snow’;           // snow
if (code >= 80 && code <= 82) return code === 82 ? ‘i-heavy’ : ‘i-rain’; // rain showers
if (code >= 85 && code <= 86) return ‘i-snow’;           // snow showers
if (code >= 95) return ‘i-heavy’;                        // thunderstorm
return ‘i-cloud’;
}

// ––––– EDIT / SHARE –––––
function editTrip() {
document.getElementById(‘results’).hidden = true;
document.getElementById(‘form-section’).hidden = false;
renderLegs();
}

function showError(msg) {
const err = document.getElementById(‘form-error’);
err.textContent = msg;
err.hidden = false;
}

function copyShareLink() {
const url = updateUrl();
navigator.clipboard.writeText(url).then(() => {
const btn = document.getElementById(‘share-btn’);
const old = btn.textContent;
btn.textContent = ‘✓ Copied’;
setTimeout(() => btn.textContent = old, 1500);
});
}

function updateUrl() {
const encoded = encodeTrip(state.legs);
const url = `${location.origin}${location.pathname}?trip=${encoded}`;
history.replaceState(null, ‘’, url);
return url;
}

function encodeTrip(legs) {
// city|lat|lon|start|end ; semicolons between legs
return encodeURIComponent(legs.map(l =>
[l.city, l.lat, l.lon, l.start, l.end].join(’|’)
).join(’;’));
}

function decodeTrip(s) {
return decodeURIComponent(s).split(’;’).map(p => {
const [city, lat, lon, start, end] = p.split(’|’);
return { city, lat: parseFloat(lat), lon: parseFloat(lon), start, end };
});
}

// ––––– EXPORT IMAGE –––––
async function exportImage() {
if (!state.forecast) return;
const btn = document.getElementById(‘export-btn’);
const oldLabel = btn.textContent;
btn.textContent = ‘Rendering…’;
btn.disabled = true;

try {
const root = document.getElementById(‘export-root’);
const days = state.forecast.days;
const cities = […new Set(state.legs.map(l => l.city))];
const dateRange = `${shortDate(days[0].date)} – ${shortDate(days[days.length - 1].date)}`;

```
// Build the export card
root.innerHTML = '';
const card = document.createElement('div');
card.className = 'export-card';
// width = padding(72) + days*130 + gaps*10
const cardWidth = 72 + days.length * 130 + (days.length - 1) * 10;
card.style.width = cardWidth + 'px';

card.innerHTML = `
  <div class="export-header">
    <div class="export-eyebrow">Multi-Model Trip Forecast</div>
    <h1 class="export-title">${cities.join(' → ')}</h1>
    <div class="export-subtitle">${dateRange} · Ensemble of ECMWF, GFS, ICON, GEM, JMA, UKMO</div>
  </div>
  <div class="export-grid" id="export-grid"></div>
  <div class="export-footer">
    <div><span class="conf-dot conf-high"></span> high agreement · <span class="conf-dot conf-med"></span> some spread · <span class="conf-dot conf-low"></span> models disagree</div>
  </div>
  <div class="export-brand">Trip<em>Cast</em></div>
`;
root.appendChild(card);

const exportGrid = card.querySelector('#export-grid');
days.forEach(d => exportGrid.appendChild(renderDayCard(d)));

// Wait for fonts to be ready (mobile Safari fonts are async)
if (document.fonts && document.fonts.ready) {
  await document.fonts.ready;
}
// small extra wait to let layout settle
await new Promise(r => setTimeout(r, 100));

const dataUrl = await htmlToImage.toPng(card, {
  pixelRatio: 2,
  backgroundColor: '#0a1a3d',
  cacheBust: true
});

// Trigger download
const filename = `tripcast-${cities.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '')}-${days[0].date}.png`;
const link = document.createElement('a');
link.download = filename;
link.href = dataUrl;
document.body.appendChild(link);
link.click();
document.body.removeChild(link);

// On iOS Safari, downloads sometimes open in new tab instead; offer share if available
if (navigator.share && /iPhone|iPad/.test(navigator.userAgent)) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Trip Forecast' });
    }
  } catch (e) { /* share cancelled, ignore */ }
}

// Cleanup
root.innerHTML = '';
btn.textContent = '✓ Saved';
setTimeout(() => { btn.textContent = oldLabel; btn.disabled = false; }, 1800);
```

} catch (e) {
console.error(‘Export failed’, e);
btn.textContent = ‘✗ Failed’;
setTimeout(() => { btn.textContent = oldLabel; btn.disabled = false; }, 2000);
}
}