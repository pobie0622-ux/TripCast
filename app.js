var MODELS = [
{ id: “ecmwf_ifs025”, label: “ECMWF” },
{ id: “gfs_seamless”, label: “GFS” },
{ id: “icon_seamless”, label: “ICON” },
{ id: “gem_seamless”, label: “GEM” },
{ id: “jma_seamless”, label: “JMA” },
{ id: “ukmo_seamless”, label: “UKMO” }
];

var state = { unit: “F”, legs: [], forecast: null };

document.addEventListener(“DOMContentLoaded”, function() {
bindUnitToggle();
document.getElementById(“add-leg”).addEventListener(“click”, function() { addLeg(); });
document.getElementById(“submit”).addEventListener(“click”, runForecast);
document.getElementById(“edit-btn”).addEventListener(“click”, editTrip);
document.getElementById(“share-btn”).addEventListener(“click”, copyShareLink);

var params = new URLSearchParams(location.search);
if (params.has(“trip”)) {
try {
state.legs = decodeTrip(params.get(“trip”));
renderLegs();
runForecast();
return;
} catch (e) { console.warn(e); }
}
addLeg();
});

function bindUnitToggle() {
document.querySelectorAll(”.unit-btn”).forEach(function(btn) {
btn.addEventListener(“click”, function() {
state.unit = btn.dataset.unit;
document.querySelectorAll(”.unit-btn”).forEach(function(b) {
b.classList.toggle(“active”, b === btn);
});
if (state.forecast) renderResults();
});
});
}

function addLeg(data) {
state.legs.push(data || { city: “”, lat: null, lon: null, start: “”, end: “” });
renderLegs();
}

function removeLeg(i) {
state.legs.splice(i, 1);
if (state.legs.length === 0) addLeg();
else renderLegs();
}

function renderLegs() {
var wrap = document.getElementById(“legs”);
wrap.innerHTML = “”;
state.legs.forEach(function(leg, i) {
var row = document.createElement(“div”);
row.className = “leg”;
row.innerHTML =
‘<div class="leg-num">’ + (i + 1) + ‘</div>’ +
‘<div class="field city-field">’ +
‘<label>City</label>’ +
‘<input type="text" placeholder="e.g. London" value="' + escapeAttr(leg.city) + '" data-i="' + i + '" data-k="city" autocomplete="off">’ +
‘<div class="suggestions" hidden></div>’ +
‘</div>’ +
‘<div class="field">’ +
‘<label>Start date</label>’ +
‘<input type=“date” value=”’ + (leg.start || “”) + ‘” data-i=”’ + i + ‘” data-k=“start”>’ +
‘</div>’ +
‘<div class="field">’ +
‘<label>End date</label>’ +
‘<input type=“date” value=”’ + (leg.end || “”) + ‘” data-i=”’ + i + ‘” data-k=“end”>’ +
‘</div>’ +
‘<button class="remove-leg" data-i="' + i + '">x</button>’;
wrap.appendChild(row);
});
bindLegInputs();
}

function escapeAttr(s) { return (s || “”).replace(/”/g, “"”); }

function bindLegInputs() {
document.querySelectorAll(”.leg input”).forEach(function(inp) {
inp.addEventListener(“input”, function(e) {
var i = +e.target.dataset.i;
var k = e.target.dataset.k;
state.legs[i][k] = e.target.value;
if (k === “city”) {
state.legs[i].lat = null;
state.legs[i].lon = null;
handleCityInput(e.target, i);
}
});
inp.addEventListener(“blur”, function(e) {
setTimeout(function() {
var box = e.target.parentElement.querySelector(”.suggestions”);
if (box) box.hidden = true;
}, 200);
});
});
document.querySelectorAll(”.remove-leg”).forEach(function(btn) {
btn.addEventListener(“click”, function() { removeLeg(+btn.dataset.i); });
});
}

var geocodeTimer = null;
function handleCityInput(input, i) {
clearTimeout(geocodeTimer);
var q = input.value.trim();
if (q.length < 2) {
input.parentElement.querySelector(”.suggestions”).hidden = true;
return;
}
geocodeTimer = setTimeout(function() {
var url = “https://geocoding-api.open-meteo.com/v1/search?name=” + encodeURIComponent(q) + “&count=5&language=en&format=json”;
fetch(url).then(function(r) { return r.json(); }).then(function(data) {
var box = input.parentElement.querySelector(”.suggestions”);
if (!data.results || data.results.length === 0) { box.hidden = true; return; }
box.innerHTML = data.results.map(function(r) {
var sub = [r.admin1, r.country].filter(Boolean).join(”, “);
return ‘<div class="suggestion" data-lat="' + r.latitude + '" data-lon="' + r.longitude + '" data-name="' + escapeAttr(r.name) + '"><div>’ + r.name + ‘</div><div class="suggestion-sub">’ + sub + ‘</div></div>’;
}).join(””);
box.hidden = false;
box.querySelectorAll(”.suggestion”).forEach(function(el) {
el.addEventListener(“mousedown”, function(e) {
e.preventDefault();
state.legs[i].city = el.dataset.name;
state.legs[i].lat = parseFloat(el.dataset.lat);
state.legs[i].lon = parseFloat(el.dataset.lon);
input.value = el.dataset.name;
box.hidden = true;
});
});
}).catch(function(err) { console.error(err); });
}, 250);
}

function runForecast() {
var err = document.getElementById(“form-error”);
err.hidden = true;

for (var j = 0; j < state.legs.length; j++) {
var leg = state.legs[j];
if (!leg.city || leg.lat == null || leg.lon == null) {
return showError(“Please pick a city from the dropdown for every leg.”);
}
if (!leg.start || !leg.end) {
return showError(“Every leg needs a start and end date.”);
}
if (leg.start > leg.end) {
return showError(“End date must be on or after start date for “ + leg.city);
}
}

document.getElementById(“form-section”).hidden = true;
document.getElementById(“loading”).hidden = false;
document.getElementById(“results”).hidden = true;

var days = expandLegs(state.legs);
var byLoc = {};
days.forEach(function(d) {
var key = d.lat.toFixed(3) + “,” + d.lon.toFixed(3);
if (!byLoc[key]) byLoc[key] = { lat: d.lat, lon: d.lon, days: [] };
byLoc[key].days.push(d);
});

var groups = Object.keys(byLoc).map(function(k) { return byLoc[k]; });
Promise.all(groups.map(function(group) {
var dates = group.days.map(function(d) { return d.date; }).sort();
var start = dates[0];
var end = dates[dates.length - 1];
return fetchEnsemble(group.lat, group.lon, start, end).then(function(data) {
group.days.forEach(function(d) { d.ensemble = extractDay(data, d.date); });
});
})).then(function() {
state.forecast = { days: days };
renderResults();
updateUrl();
}).catch(function(e) {
console.error(e);
document.getElementById(“loading”).hidden = true;
document.getElementById(“form-section”).hidden = false;
showError(“Could not fetch forecast. “ + (e.message || “”));
});
}

function expandLegs(legs) {
var out = [];
legs.forEach(function(leg) {
var start = new Date(leg.start + “T00:00:00”);
var end = new Date(leg.end + “T00:00:00”);
for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
out.push({ date: d.toISOString().slice(0, 10), city: leg.city, lat: leg.lat, lon: leg.lon });
}
});
return out;
}

function fetchEnsemble(lat, lon, start, end) {
var params = new URLSearchParams({
latitude: lat,
longitude: lon,
start_date: start,
end_date: end,
daily: “temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code”,
timezone: “auto”,
models: MODELS.map(function(m) { return m.id; }).join(”,”)
});
return fetch(“https://api.open-meteo.com/v1/forecast?” + params.toString()).then(function(res) {
if (!res.ok) throw new Error(“API “ + res.status);
return res.json();
});
}

function extractDay(data, dateStr) {
var idx = data.daily.time.indexOf(dateStr);
if (idx < 0) return null;
var perModel = MODELS.map(function(m) {
return {
hi: data.daily[“temperature_2m_max_” + m.id] ? data.daily[“temperature_2m_max_” + m.id][idx] : null,
lo: data.daily[“temperature_2m_min_” + m.id] ? data.daily[“temperature_2m_min_” + m.id][idx] : null,
pop: data.daily[“precipitation_probability_max_” + m.id] ? data.daily[“precipitation_probability_max_” + m.id][idx] : null,
code: data.daily[“weather_code_” + m.id] ? data.daily[“weather_code_” + m.id][idx] : null
};
}).filter(function(d) { return d.hi != null && d.lo != null; });
if (perModel.length === 0) return null;
var his = perModel.map(function(d) { return d.hi; });
var los = perModel.map(function(d) { return d.lo; });
var pops = perModel.map(function(d) { return d.pop; }).filter(function(v) { return v != null; });
var codes = perModel.map(function(d) { return d.code; }).filter(function(v) { return v != null; });
return {
hi: mean(his),
lo: mean(los),
hiSpread: Math.max.apply(null, his) - Math.min.apply(null, his),
pop: mean(pops),
code: mode(codes)
};
}

function mean(arr) { if (!arr.length) return null; var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }
function mode(arr) {
if (!arr.length) return null;
var counts = {}; var best = arr[0]; var bestN = 0;
for (var i = 0; i < arr.length; i++) {
counts[arr[i]] = (counts[arr[i]] || 0) + 1;
if (counts[arr[i]] > bestN) { bestN = counts[arr[i]]; best = arr[i]; }
}
return best;
}

function renderResults() {
document.getElementById(“loading”).hidden = true;
document.getElementById(“form-section”).hidden = true;
document.getElementById(“results”).hidden = false;
var cities = [];
state.legs.forEach(function(l) { if (cities.indexOf(l.city) < 0) cities.push(l.city); });
document.getElementById(“results-title”).textContent = cities.join(” - “);
var grid = document.getElementById(“grid”);
grid.innerHTML = “”;
state.forecast.days.forEach(function(d) { grid.appendChild(renderDayCard(d)); });
}

function renderDayCard(day) {
var card = document.createElement(“div”);
card.className = “day”;
var e = day.ensemble;
if (!e) {
card.innerHTML = ‘<div class="dow">’ + dowFor(day.date) + ‘</div><div class="date">’ + shortDate(day.date) + ‘</div><div class="city">’ + day.city + ‘</div><div style="margin:30px 0; font-size: 12px;">No data</div>’;
return card;
}
var conf = “high”;
if (e.hiSpread > 5) conf = “low”;
else if (e.hiSpread > 2.5) conf = “med”;
var iconId = weatherCodeToIcon(e.code);
var hi = formatTemp(e.hi);
var lo = formatTemp(e.lo);
var pop = e.pop != null ? Math.round(e.pop) : null;
var spread = formatSpread(e.hiSpread);
card.innerHTML =
‘<div class="conf-dot-day conf-' + conf + '"></div>’ +
‘<div class="dow">’ + dowFor(day.date) + ‘</div>’ +
‘<div class="date">’ + shortDate(day.date) + ‘</div>’ +
‘<div class="city">’ + day.city + ‘</div>’ +
‘<div class="icon"><svg width="42" height="42"><use href="#' + iconId + '"/></svg></div>’ +
‘<div class="pop"><svg class="drop"><use href="#drop"/></svg>’ + (pop != null ? pop + “%” : “-”) + ‘</div>’ +
‘<div class="temps"><div class="hi">’ + hi + ‘</div><div class="bar"></div><div class="lo">’ + lo + ‘</div></div>’ +
‘<div class="spread">+/-’ + spread + ‘</div>’;
return card;
}

function dowFor(s) { return new Date(s + “T12:00:00”).toLocaleDateString(“en-US”, { weekday: “short” }).toUpperCase(); }
function shortDate(s) { return new Date(s + “T12:00:00”).toLocaleDateString(“en-US”, { month: “short”, day: “numeric” }); }
function formatTemp(c) { if (c == null) return “-”; if (state.unit === “F”) return Math.round(c * 9 / 5 + 32); return Math.round(c); }
function formatSpread(c) { if (c == null) return “0”; if (state.unit === “F”) return Math.round(c * 9 / 5); return Math.round(c); }

function weatherCodeToIcon(code) {
if (code == null) return “i-cloud”;
if (code === 0) return “i-sun”;
if (code === 1 || code === 2) return “i-partly”;
if (code === 3) return “i-cloud”;
if (code >= 45 && code <= 48) return “i-cloud”;
if (code >= 51 && code <= 57) return “i-rain”;
if (code >= 61 && code <= 65) return code >= 65 ? “i-heavy” : “i-rain”;
if (code >= 66 && code <= 67) return “i-rain”;
if (code >= 71 && code <= 77) return “i-snow”;
if (code >= 80 && code <= 82) return code === 82 ? “i-heavy” : “i-rain”;
if (code >= 85 && code <= 86) return “i-snow”;
if (code >= 95) return “i-heavy”;
return “i-cloud”;
}

function editTrip() {
document.getElementById(“results”).hidden = true;
document.getElementById(“form-section”).hidden = false;
renderLegs();
}

function showError(msg) {
var err = document.getElementById(“form-error”);
err.textContent = msg;
err.hidden = false;
}

function copyShareLink() {
var url = updateUrl();
navigator.clipboard.writeText(url).then(function() {
var btn = document.getElementById(“share-btn”);
var old = btn.textContent;
btn.textContent = “Copied”;
setTimeout(function() { btn.textContent = old; }, 1500);
});
}

function updateUrl() {
var encoded = encodeTrip(state.legs);
var url = location.origin + location.pathname + “?trip=” + encoded;
history.replaceState(null, “”, url);
return url;
}

function encodeTrip(legs) {
return encodeURIComponent(legs.map(function(l) {
return [l.city, l.lat, l.lon, l.start, l.end].join(”|”);
}).join(”;”));
}

function decodeTrip(s) {
return decodeURIComponent(s).split(”;”).map(function(p) {
var parts = p.split(”|”);
return { city: parts[0], lat: parseFloat(parts[1]), lon: parseFloat(parts[2]), start: parts[3], end: parts[4] };
});
}