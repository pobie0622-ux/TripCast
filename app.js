// TripCast v2 — AM/PM/Evening slots, climatology fallback past 16 days, export image
// Models: ECMWF, GFS, ICON, GEM, JMA, UKMO via Open-Meteo

var MODELS = [
  { id: "ecmwf_ifs025", label: "ECMWF" },
  { id: "gfs_seamless", label: "GFS" },
  { id: "icon_seamless", label: "ICON" },
  { id: "gem_seamless", label: "GEM" },
  { id: "jma_seamless", label: "JMA" },
  { id: "ukmo_seamless", label: "UKMO" }
];

// Hour ranges (local time at location) for each slot
var SLOTS = [
  { id: "am", label: "AM", startHour: 6, endHour: 12 },
  { id: "pm", label: "PM", startHour: 12, endHour: 18 },
  { id: "eve", label: "EVE", startHour: 18, endHour: 24 }
];

var FORECAST_HORIZON_DAYS = 16;

var state = { unit: "F", legs: [], forecast: null };

document.addEventListener("DOMContentLoaded", function() {
  bindUnitToggle();
  document.getElementById("add-leg").addEventListener("click", function() { addLeg(); });
  document.getElementById("submit").addEventListener("click", runForecast);
  document.getElementById("edit-btn").addEventListener("click", editTrip);
  document.getElementById("share-btn").addEventListener("click", copyShareLink);
  document.getElementById("export-btn").addEventListener("click", exportImage);

  var params = new URLSearchParams(location.search);
  if (params.has("trip")) {
    try {
      state.legs = decodeTrip(params.get("trip"));
      renderLegs();
      runForecast();
      return;
    } catch (e) { console.warn(e); }
  }
  addLeg();
});

function bindUnitToggle() {
  document.querySelectorAll(".unit-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      state.unit = btn.dataset.unit;
      document.querySelectorAll(".unit-btn").forEach(function(b) {
        b.classList.toggle("active", b === btn);
      });
      if (state.forecast) renderResults();
    });
  });
}

function addLeg(data) {
  state.legs.push(data || { city: "", lat: null, lon: null, start: "", end: "" });
  renderLegs();
}

function removeLeg(i) {
  state.legs.splice(i, 1);
  if (state.legs.length === 0) addLeg();
  else renderLegs();
}

function renderLegs() {
  var wrap = document.getElementById("legs");
  wrap.innerHTML = "";
  state.legs.forEach(function(leg, i) {
    var row = document.createElement("div");
    row.className = "leg";
    row.innerHTML =
      '<div class="leg-num">' + (i + 1) + '</div>' +
      '<div class="field city-field">' +
        '<label>City</label>' +
        '<input type="text" placeholder="e.g. London" value="' + escapeAttr(leg.city) + '" data-i="' + i + '" data-k="city" autocomplete="off">' +
        '<div class="suggestions" hidden></div>' +
      '</div>' +
      '<div class="field">' +
        '<label>Start date</label>' +
        '<input type="date" value="' + (leg.start || "") + '" data-i="' + i + '" data-k="start">' +
      '</div>' +
      '<div class="field">' +
        '<label>End date</label>' +
        '<input type="date" value="' + (leg.end || "") + '" data-i="' + i + '" data-k="end">' +
      '</div>' +
      '<button class="remove-leg" data-i="' + i + '">x</button>';
    wrap.appendChild(row);
  });
  bindLegInputs();
}

function escapeAttr(s) { return (s || "").replace(/"/g, "&quot;"); }

function bindLegInputs() {
  document.querySelectorAll(".leg input").forEach(function(inp) {
    inp.addEventListener("input", function(e) {
      var i = +e.target.dataset.i;
      var k = e.target.dataset.k;
      state.legs[i][k] = e.target.value;
      if (k === "city") {
        state.legs[i].lat = null;
        state.legs[i].lon = null;
        handleCityInput(e.target, i);
      }
    });
    inp.addEventListener("blur", function(e) {
      setTimeout(function() {
        var box = e.target.parentElement.querySelector(".suggestions");
        if (box) box.hidden = true;
      }, 200);
    });
  });
  document.querySelectorAll(".remove-leg").forEach(function(btn) {
    btn.addEventListener("click", function() { removeLeg(+btn.dataset.i); });
  });
}

var geocodeTimer = null;
function handleCityInput(input, i) {
  clearTimeout(geocodeTimer);
  var q = input.value.trim();
  if (q.length < 2) {
    input.parentElement.querySelector(".suggestions").hidden = true;
    return;
  }
  geocodeTimer = setTimeout(function() {
    var url = "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=5&language=en&format=json";
    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      var box = input.parentElement.querySelector(".suggestions");
      if (!data.results || data.results.length === 0) { box.hidden = true; return; }
      box.innerHTML = data.results.map(function(r) {
        var sub = [r.admin1, r.country].filter(Boolean).join(", ");
        return '<div class="suggestion" data-lat="' + r.latitude + '" data-lon="' + r.longitude + '" data-name="' + escapeAttr(r.name) + '"><div>' + r.name + '</div><div class="suggestion-sub">' + sub + '</div></div>';
      }).join("");
      box.hidden = false;
      box.querySelectorAll(".suggestion").forEach(function(el) {
        el.addEventListener("mousedown", function(e) {
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
  var err = document.getElementById("form-error");
  err.hidden = true;

  for (var j = 0; j < state.legs.length; j++) {
    var leg = state.legs[j];
    if (!leg.city || leg.lat == null || leg.lon == null) {
      return showError("Please pick a city from the dropdown for every leg.");
    }
    if (!leg.start || !leg.end) {
      return showError("Every leg needs a start and end date.");
    }
    if (leg.start > leg.end) {
      return showError("End date must be on or after start date for " + leg.city);
    }
  }

  document.getElementById("form-section").hidden = true;
  document.getElementById("loading").hidden = false;
  document.getElementById("results").hidden = true;

  var days = expandLegs(state.legs);
  var todayStr = new Date().toISOString().slice(0, 10);
  // Open-Meteo allows up to ~16 days from today, but the exact boundary varies by
  // server timezone vs client timezone. Use 14 days as a safe forecast horizon;
  // dates beyond that fall back to climatology.
  var horizonDate = new Date();
  horizonDate.setDate(horizonDate.getDate() + 14);
  var horizonStr = horizonDate.toISOString().slice(0, 10);

  // Split days into "forecastable" and "beyond horizon"
  var forecastDays = days.filter(function(d) { return d.date <= horizonStr; });
  var climDays = days.filter(function(d) { return d.date > horizonStr; });

  // Group forecastable days by location
  var byLoc = {};
  forecastDays.forEach(function(d) {
    var key = d.lat.toFixed(3) + "," + d.lon.toFixed(3);
    if (!byLoc[key]) byLoc[key] = { lat: d.lat, lon: d.lon, days: [] };
    byLoc[key].days.push(d);
  });

  // Group climatology days by location
  var byLocClim = {};
  climDays.forEach(function(d) {
    var key = d.lat.toFixed(3) + "," + d.lon.toFixed(3);
    if (!byLocClim[key]) byLocClim[key] = { lat: d.lat, lon: d.lon, days: [] };
    byLocClim[key].days.push(d);
  });

  var groups = Object.keys(byLoc).map(function(k) { return byLoc[k]; });
  var climGroups = Object.keys(byLocClim).map(function(k) { return byLocClim[k]; });

  var fcPromises = groups.map(function(group) {
    var dates = group.days.map(function(d) { return d.date; }).sort();
    return fetchHourlyEnsemble(group.lat, group.lon, dates[0], dates[dates.length - 1]).then(function(data) {
      group.days.forEach(function(d) {
        d.slots = extractSlots(data, d.date);
        d.source = "forecast";
      });
    }).catch(function(e) {
      // If the forecast API rejects (likely date past its horizon by a day due
      // to timezone math), fall back to climatology for this group.
      console.warn("Forecast failed for group, falling back to climatology:", e.message);
      return fetchClimatology(group);
    });
  });

  var climPromises = climGroups.map(function(group) {
    return fetchClimatology(group).then(function() {
      // results attached inside fetchClimatology
    });
  });

  Promise.all(fcPromises.concat(climPromises)).then(function() {
    state.forecast = { days: days };
    renderResults();
    updateUrl();
  }).catch(function(e) {
    console.error(e);
    document.getElementById("loading").hidden = true;
    document.getElementById("form-section").hidden = false;
    showError("Could not fetch forecast. " + (e.message || ""));
  });
}

function expandLegs(legs) {
  var out = [];
  legs.forEach(function(leg) {
    var start = new Date(leg.start + "T00:00:00");
    var end = new Date(leg.end + "T00:00:00");
    for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push({ date: d.toISOString().slice(0, 10), city: leg.city, lat: leg.lat, lon: leg.lon });
    }
  });
  return out;
}

function fetchHourlyEnsemble(lat, lon, start, end) {
  var params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    start_date: start,
    end_date: end,
    hourly: "temperature_2m,precipitation_probability,weather_code",
    timezone: "auto",
    models: MODELS.map(function(m) { return m.id; }).join(",")
  });
  return fetch("https://api.open-meteo.com/v1/forecast?" + params.toString()).then(function(res) {
    if (!res.ok) {
      return res.text().then(function(t) { throw new Error("API " + res.status + " " + t.slice(0, 100)); });
    }
    return res.json();
  });
}

// Climatology: use historical averages from past 10 years for same date
function fetchClimatology(group) {
  var dates = group.days.map(function(d) { return d.date; }).sort();
  var monthDayStart = dates[0].slice(5); // "MM-DD"
  var monthDayEnd = dates[dates.length - 1].slice(5);

  // Pull last 10 years of historical data for the date range
  var currentYear = new Date().getFullYear();
  var startYear = currentYear - 10;
  var endYear = currentYear - 1;

  // For each historical year, build the date range. We'll fetch a wider window then filter.
  var promises = [];
  for (var y = startYear; y <= endYear; y++) {
    var ds = y + "-" + monthDayStart;
    var de = y + "-" + monthDayEnd;
    var params = new URLSearchParams({
      latitude: group.lat,
      longitude: group.lon,
      start_date: ds,
      end_date: de,
      hourly: "temperature_2m,precipitation,weather_code",
      timezone: "auto"
    });
    promises.push(
      fetch("https://archive-api.open-meteo.com/v1/archive?" + params.toString())
        .then(function(r) { if (!r.ok) return null; return r.json(); })
        .catch(function() { return null; })
    );
  }

  return Promise.all(promises).then(function(yearlyData) {
    yearlyData = yearlyData.filter(function(d) { return d && d.hourly; });
    group.days.forEach(function(day) {
      day.slots = computeClimSlots(yearlyData, day.date);
      day.source = "climatology";
    });
  });
}

function computeClimSlots(yearlyData, dateStr) {
  // For each slot, gather hourly temps and precips from all years for matching date+hour
  var monthDay = dateStr.slice(5); // "MM-DD"
  var slots = {};
  SLOTS.forEach(function(slot) {
    var temps = [];
    var precips = [];
    var codes = [];
    yearlyData.forEach(function(data) {
      data.hourly.time.forEach(function(ts, i) {
        // ts format: "YYYY-MM-DDTHH:MM"
        if (ts.slice(5, 10) !== monthDay) return;
        var hour = parseInt(ts.slice(11, 13), 10);
        if (hour < slot.startHour || hour >= slot.endHour) return;
        var t = data.hourly.temperature_2m[i];
        var p = data.hourly.precipitation[i];
        var c = data.hourly.weather_code[i];
        if (t != null) temps.push(t);
        if (p != null) precips.push(p);
        if (c != null) codes.push(c);
      });
    });
    if (temps.length === 0) { slots[slot.id] = null; return; }
    var avgT = mean(temps);
    var spread = stddev(temps) * 2; // proxy for variability
    var precipDays = precips.filter(function(p) { return p > 0.1; }).length;
    var pop = precips.length > 0 ? Math.round(precipDays / precips.length * 100) : 0;
    slots[slot.id] = {
      temp: avgT,
      tempSpread: spread,
      pop: pop,
      code: mode(codes),
      modelCount: 1 // single climatology pseudo-source
    };
  });
  return slots;
}

function extractSlots(data, dateStr) {
  // Returns { am: {...}, pm: {...}, eve: {...} } each with ensemble stats
  var slots = {};
  SLOTS.forEach(function(slot) {
    var perModel = MODELS.map(function(m) {
      var temps = [];
      var pops = [];
      var codes = [];
      var times = data.hourly.time;
      var tempArr = data.hourly["temperature_2m_" + m.id];
      var popArr = data.hourly["precipitation_probability_" + m.id];
      var codeArr = data.hourly["weather_code_" + m.id];
      if (!tempArr) return null;
      for (var i = 0; i < times.length; i++) {
        var ts = times[i];
        if (ts.slice(0, 10) !== dateStr) continue;
        var hour = parseInt(ts.slice(11, 13), 10);
        if (hour < slot.startHour || hour >= slot.endHour) continue;
        if (tempArr[i] != null) temps.push(tempArr[i]);
        if (popArr && popArr[i] != null) pops.push(popArr[i]);
        if (codeArr && codeArr[i] != null) codes.push(codeArr[i]);
      }
      if (temps.length === 0) return null;
      return { temp: mean(temps), pop: pops.length ? mean(pops) : null, code: mode(codes) };
    }).filter(function(d) { return d != null; });

    if (perModel.length === 0) { slots[slot.id] = null; return; }
    var temps = perModel.map(function(d) { return d.temp; });
    var pops = perModel.map(function(d) { return d.pop; }).filter(function(v) { return v != null; });
    var codes = perModel.map(function(d) { return d.code; }).filter(function(v) { return v != null; });
    slots[slot.id] = {
      temp: mean(temps),
      tempSpread: Math.max.apply(null, temps) - Math.min.apply(null, temps),
      pop: pops.length ? mean(pops) : null,
      code: mode(codes),
      modelCount: perModel.length
    };
  });
  return slots;
}

function mean(arr) { if (!arr.length) return null; var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  var m = mean(arr);
  var sq = 0;
  for (var i = 0; i < arr.length; i++) sq += (arr[i] - m) * (arr[i] - m);
  return Math.sqrt(sq / arr.length);
}
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
  document.getElementById("loading").hidden = true;
  document.getElementById("form-section").hidden = true;
  document.getElementById("results").hidden = false;
  var cities = [];
  state.legs.forEach(function(l) { if (cities.indexOf(l.city) < 0) cities.push(l.city); });
  document.getElementById("results-title").textContent = cities.join(" - ");
  var grid = document.getElementById("grid");
  grid.innerHTML = "";
  state.forecast.days.forEach(function(d) { grid.appendChild(renderDayCard(d)); });
}

function renderDayCard(day) {
  var card = document.createElement("div");
  card.className = "day";
  if (day.source === "climatology") card.className += " day-clim";

  var slots = day.slots || {};
  var hasAnyData = SLOTS.some(function(s) { return slots[s.id]; });

  var headerHtml =
    '<div class="dow">' + dowFor(day.date) + '</div>' +
    '<div class="date">' + shortDate(day.date) + '</div>' +
    '<div class="city">' + escapeText(day.city) + '</div>';

  if (!hasAnyData) {
    card.innerHTML = headerHtml + '<div style="margin:30px 0; font-size: 12px; color: var(--text-faint);">No data</div>';
    return card;
  }

  var badgeHtml = "";
  if (day.source === "climatology") {
    badgeHtml = '<div class="clim-badge" title="Beyond 16-day forecast - showing 10-yr historical average for this date">HIST AVG</div>';
  }

  var slotsHtml = SLOTS.map(function(slot) {
    var s = slots[slot.id];
    if (!s) return '<div class="slot slot-empty"><div class="slot-empty-text">' + slot.label + ' —</div></div>';
    var conf = confidenceLevel(s.tempSpread, day.source);
    var iconId = weatherCodeToIcon(s.code);
    var temp = formatTemp(s.temp);
    var pop = s.pop != null ? Math.round(s.pop) : null;
    var popHtml = pop != null
      ? '<svg class="drop-mini" width="6" height="8"><use href="#drop"/></svg>' + pop + '%'
      : '';
    return '<div class="slot">' +
      '<div class="slot-label">' + slot.label + ' <span class="conf-dot-day conf-' + conf + '"></span></div>' +
      '<div class="slot-icon"><svg width="26" height="26"><use href="#' + iconId + '"/></svg></div>' +
      '<div class="slot-temp">' + temp + '°</div>' +
      '<div class="slot-pop">' + popHtml + '</div>' +
    '</div>';
  }).join("");

  card.innerHTML = headerHtml + badgeHtml + '<div class="slots">' + slotsHtml + '</div>';
  return card;
}

function confidenceLevel(spread, source) {
  if (source === "climatology") return "low";
  if (spread == null) return "high";
  if (spread > 5) return "low";
  if (spread > 2.5) return "med";
  return "high";
}

function escapeText(s) { return (s || "").replace(/[<>&]/g, function(c) { return c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"; }); }
function dowFor(s) { return new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(); }
function shortDate(s) { return new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function formatTemp(c) { if (c == null) return "-"; if (state.unit === "F") return Math.round(c * 9 / 5 + 32); return Math.round(c); }

function weatherCodeToIcon(code) {
  if (code == null) return "i-cloud";
  if (code === 0) return "i-sun";
  if (code === 1 || code === 2) return "i-partly";
  if (code === 3) return "i-cloud";
  if (code >= 45 && code <= 48) return "i-cloud";
  if (code >= 51 && code <= 57) return "i-rain";
  if (code >= 61 && code <= 65) return code >= 65 ? "i-heavy" : "i-rain";
  if (code >= 66 && code <= 67) return "i-rain";
  if (code >= 71 && code <= 77) return "i-snow";
  if (code >= 80 && code <= 82) return code === 82 ? "i-heavy" : "i-rain";
  if (code >= 85 && code <= 86) return "i-snow";
  if (code >= 95) return "i-heavy";
  return "i-cloud";
}

function editTrip() {
  document.getElementById("results").hidden = true;
  document.getElementById("form-section").hidden = false;
  renderLegs();
}

function showError(msg) {
  var err = document.getElementById("form-error");
  err.textContent = msg;
  err.hidden = false;
}

function copyShareLink() {
  var url = updateUrl();
  navigator.clipboard.writeText(url).then(function() {
    var btn = document.getElementById("share-btn");
    var old = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(function() { btn.textContent = old; }, 1500);
  });
}

function updateUrl() {
  var encoded = encodeTrip(state.legs);
  var url = location.origin + location.pathname + "?trip=" + encoded;
  history.replaceState(null, "", url);
  return url;
}

function encodeTrip(legs) {
  return encodeURIComponent(legs.map(function(l) {
    return [l.city, l.lat, l.lon, l.start, l.end].join("|");
  }).join(";"));
}

function decodeTrip(s) {
  return decodeURIComponent(s).split(";").map(function(p) {
    var parts = p.split("|");
    return { city: parts[0], lat: parseFloat(parts[1]), lon: parseFloat(parts[2]), start: parts[3], end: parts[4] };
  });
}

// ----- EXPORT IMAGE -----
function exportImage() {
  if (!state.forecast) return;
  if (typeof htmlToImage === "undefined") {
    alert("Image library not loaded yet — try again in a moment.");
    return;
  }
  var btn = document.getElementById("export-btn");
  var oldLabel = btn.textContent;
  btn.textContent = "Rendering...";
  btn.disabled = true;

  var root = document.getElementById("export-root");
  var days = state.forecast.days;
  var cities = [];
  state.legs.forEach(function(l) { if (cities.indexOf(l.city) < 0) cities.push(l.city); });
  var dateRange = shortDate(days[0].date) + " - " + shortDate(days[days.length - 1].date);

  root.innerHTML = "";
  var card = document.createElement("div");
  card.className = "export-card";
  var cardWidth = 80 + days.length * 150 + (days.length - 1) * 10;
  card.style.width = cardWidth + "px";
  card.innerHTML =
    '<div class="export-header">' +
      '<div class="export-eyebrow">Multi-Model Trip Forecast</div>' +
      '<h1 class="export-title">' + escapeText(cities.join(" - ")) + '</h1>' +
      '<div class="export-subtitle">' + dateRange + ' &middot; Ensemble of ECMWF, GFS, ICON, GEM, JMA, UKMO</div>' +
    '</div>' +
    '<div class="export-grid" id="export-grid"></div>' +
    '<div class="export-brand">Trip<em>Cast</em></div>';
  root.appendChild(card);

  var exportGrid = card.querySelector("#export-grid");
  days.forEach(function(d) { exportGrid.appendChild(renderDayCard(d)); });

  var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  fontsReady.then(function() {
    return new Promise(function(r) { setTimeout(r, 150); });
  }).then(function() {
    return htmlToImage.toPng(card, { pixelRatio: 2, backgroundColor: "#0a1a3d", cacheBust: true });
  }).then(function(dataUrl) {
    var filename = "tripcast-" + cities.join("-").toLowerCase().replace(/[^a-z0-9-]/g, "") + "-" + days[0].date + ".png";
    var link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    root.innerHTML = "";
    btn.textContent = "Saved";
    setTimeout(function() { btn.textContent = oldLabel; btn.disabled = false; }, 1800);
  }).catch(function(e) {
    console.error("Export failed", e);
    btn.textContent = "Failed";
    setTimeout(function() { btn.textContent = oldLabel; btn.disabled = false; }, 2000);
  });
}
