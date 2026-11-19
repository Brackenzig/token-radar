// Token Radar — the dashboard script, v4.
//
// Renders the board from window.TOKEN_RADAR_DATA, the object main.ts
// wrote into ../data.js. No fetch, no network, no framework: the
// script reads the data, builds the tables, draws the scatter plots
// and the band bars as inline SVG, and re-renders whenever a filter,
// the sort, the tab or the capital changes.
//
// The capital control re-nets every plan on the page at the chosen
// deposit. The re-netting here is the same arithmetic as
// renetAtCapital in lib/model.ts: the slice scales with the capital,
// the forgone yield scales with the capital, the fees and the hours
// are fixed. The board counts FARM at each capital from that same
// arithmetic, so the page and the program cannot disagree.
//
// The state lives in the address bar (?tab=, ?verdict=, ?capital=,
// ?sort=, ?q=, ?detail=), so a link opens a view directly — and so
// the screenshots are taken of exactly the view they name.

(function () {
  "use strict";

  // -- The data ------------------------------------------------------------
  // data.js assigns window.TOKEN_RADAR_DATA. Without it there is no
  // board: the page says so instead of rendering an empty table.
  var D = window.TOKEN_RADAR_DATA;
  if (!D || !Array.isArray(D.rows)) {
    document.getElementById("kpis").textContent =
      "No data: ../data.js did not load.";
    return;
  }
  var rows = D.rows;
  var traded = D.traded || [];
  var setAside = D.set_aside || [];
  var validation = D.validation;
  var counts = D.counts;

  // -- Constants: the farm model, as in lib/model.ts ------------------------
  // Keep these in step with the model: the T-bill rate, the fees, the
  // minutes and the FARM floor are the model's constants, not the
  // page's own numbers. The page reuses them so its re-netting matches
  // the program's.
  var TBILL_RATE = 0.04;
  var FARM_MIN_NET_PER_HOUR = 5;
  var PLAN_CAPITALS = [1000, 2500, 5000, 10000];

  // -- The state -------------------------------------------------------------
  var params = new URLSearchParams(window.location.search);
  var state = {
    tab: params.get("tab") || "board",
    capital: parseInt(params.get("capital") || "1000", 10) || 1000,
    sort: params.get("sort") || "implied_value_usd",
    verdict: params.get("verdict") || "",
    category: params.get("category") || "",
    q: params.get("q") || "",
    detail: params.get("detail") || "",
  };
  if (PLAN_CAPITALS.indexOf(state.capital) < 0) state.capital = 1000;

  // -- Small helpers ---------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function round2(x) { return Math.round(x * 100) / 100; }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtMoney(v) {
    if (v == null) return "—";
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + Math.round(v).toLocaleString("en-US");
    return "$" + v.toFixed(2);
  }
  function fmtSigned(v) {
    if (v == null) return "—";
    var sign = v >= 0 ? "+" : "−";
    return sign + "$" + Math.abs(v).toFixed(2);
  }
  function fmtPct(v) {
    if (v == null) return "—";
    return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + "%";
  }
  function fmtAge(days) {
    if (days == null) return "—";
    if (days < 365) return days + "d";
    return (days / 365).toFixed(1) + "y";
  }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    if (n === 0) return 0;
    return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // -- Re-netting: the same arithmetic as model.ts ---------------------------
  // The slice is a tenth of the launch value, pro-rated to the deposit
  // against the protocol's TVL; the fees are fixed; the forgone yield
  // is the T-bill rate pro-rated to the hold and to the capital. The
  // net is the rounded slice minus the rounded fees minus the forgone
  // yield, rounded to cents once; the net per hour divides by the
  // hands-on hours. A plan that nets $5 an hour or more is FARM.
  function renet(row, capital) {
    var slice = round2((row.slice_1k_usd * capital) / 1000);
    var fees = round2(row.fees_usd);
    var forgone = (capital * TBILL_RATE * row.hold_days) / 365;
    var net = round2(slice - fees - forgone);
    var hours = (40 + (5 * row.hold_days) / 7) / 60;
    var perHour = round2(net / hours);
    var verdict = perHour >= FARM_MIN_NET_PER_HOUR ? "FARM"
      : perHour >= 0 ? "THIN" : "SKIP";
    return { slice: slice, fees: fees, net: net, perHour: perHour, verdict: verdict };
  }
  function hoursFor(row) { return (40 + (5 * row.hold_days) / 7) / 60; }

  // -- The band bar ----------------------------------------------------------
  // One row's bootstrap band on a log axis from $1M to $1B: a bar from
  // P10 to P90, a dot at the implied value. A narrow band is a row the
  // refits agree on; a wide one is a row they do not.
  function bandSvg(row) {
    var lo = 6, hi = 9, w = 110, h = 14, y = h / 2;
    var p10 = Math.max(lo, Math.log10(row.implied_p10_usd));
    var p90 = Math.min(hi, Math.log10(row.implied_p90_usd));
    var v = Math.log10(row.implied_value_usd);
    var bx = ((p10 - lo) / (hi - lo)) * w;
    var bw = Math.max(1, ((p90 - p10) / (hi - lo)) * w);
    var dx = Math.min(w - 2, Math.max(2, ((v - lo) / (hi - lo)) * w));
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h +
      '" role="img" aria-label="band ' + fmtMoney(row.implied_p10_usd) + ' to ' +
      fmtMoney(row.implied_p90_usd) + '"><line x1="0" y1="' + y + '" x2="' + w +
      '" y2="' + y + '" stroke="#ddd3bd" stroke-width="1"/><rect x="' + bx.toFixed(1) +
      '" y="' + (y - 3) + '" width="' + bw.toFixed(1) + '" height="6" rx="3" fill="#1f6b3a" opacity="0.35"/>' +
      '<circle cx="' + dx.toFixed(1) + '" cy="' + y + '" r="3.5" fill="#1f6b3a"/></svg>';
  }

  // -- The scatter plot ------------------------------------------------------
  // The traded comparables on log-log axes, with the fitted line: the
  // market line the whole board hangs on. The same generator draws the
  // sidebar plot and the larger one on the method tab.
  function scatterSvg(w, h) {
    var padL = 34, padB = 20, padT = 8, padR = 8;
    var x0 = 7, x1 = 10.5, y0 = 5, y1 = 10.5;
    function px(v) { return padL + ((v - x0) / (x1 - x0)) * (w - padL - padR); }
    function py(v) { return h - padB - ((v - y0) / (y1 - y0)) * (h - padT - padB); }
    var fit = validation.fit;
    var out = '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h +
      '" role="img" aria-label="scatter of traded tokens against the fitted market line">';
    // Gridlines, at $10M, $1B and $100B of TVL; $1M, $100M and $10B of mcap.
    [7, 9, 11].forEach(function (gx) {
      if (gx < x1) out += '<line x1="' + px(gx).toFixed(1) + '" y1="' + py(y0) + '" x2="' + px(gx).toFixed(1) + '" y2="' + py(y1) + '" stroke="#e7dfc9" stroke-width="1"/>';
    });
    [6, 8, 10].forEach(function (gy) {
      out += '<line x1="' + px(x0) + '" y1="' + py(gy).toFixed(1) + '" x2="' + px(x1) + '" y2="' + py(gy).toFixed(1) + '" stroke="#e7dfc9" stroke-width="1"/>';
    });
    // The fitted line, across the comparables' TVL range.
    var lx0 = 7, lx1 = 10.3;
    out += '<line x1="' + px(lx0).toFixed(1) + '" y1="' + py(fit.intercept + fit.slope * lx0).toFixed(1) +
      '" x2="' + px(lx1).toFixed(1) + '" y2="' + py(fit.intercept + fit.slope * lx1).toFixed(1) +
      '" stroke="#1f6b3a" stroke-width="2"/>';
    // The comparables: the traded tokens with TVL of $10M or more.
    traded.forEach(function (t) {
      if (!t.in_fit || !t.mcap_usd || !t.tvl_usd) return;
      var cx = px(Math.log10(t.tvl_usd)), cy = py(Math.log10(t.mcap_usd));
      if (cx < padL || cx > w - padR || cy < padT || cy > h - padB) return;
      out += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2.5" fill="#0f766e" opacity="0.7"/>';
    });
    // Axis labels.
    out += '<text x="' + px(7) + '" y="' + (h - 6) + '" font-size="9" fill="#6b6455">$10M TVL</text>' +
      '<text x="' + px(9) + '" y="' + (h - 6) + '" font-size="9" fill="#6b6455">$1B</text>' +
      '<text x="' + (w - padR - 34) + '" y="' + (h - 6) + '" font-size="9" fill="#6b6455">$100B</text>' +
      '<text x="2" y="' + py(6).toFixed(1) + '" font-size="9" fill="#6b6455">$1M</text>' +
      '<text x="2" y="' + py(8).toFixed(1) + '" font-size="9" fill="#6b6455">$100M</text>' +
      '<text x="2" y="' + py(10).toFixed(1) + '" font-size="9" fill="#6b6455">$10B</text>' +
      '<text x="' + px(7.1) + '" y="' + py(10.3).toFixed(1) + '" font-size="9" fill="#1f6b3a">fitted line</text>' +
      '</svg>';
    return out;
  }

  // -- The header ------------------------------------------------------------
  function renderKpis() {
    var farm = rows.filter(function (r) { return renet(r, state.capital).verdict === "FARM"; }).length;
    $("kpis").innerHTML =
      "<strong>" + counts.ranked + " ranked</strong> · <strong>" + counts.watchlist + "/" +
      counts.watchlist + " watchlist</strong> · <strong>" + counts.early_finds +
      " early finds</strong> · <strong>" + farm + " worth farming at $" +
      state.capital.toLocaleString("en-US") + "</strong> · " + counts.traded +
      " traded, kept apart · " + counts.set_aside + " set aside";
    $("count-board").textContent = counts.ranked;
    $("count-traded").textContent = counts.traded;
    $("count-setaside").textContent = counts.set_aside;
  }

  // -- The board table ---------------------------------------------------------
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.verdict && renet(r, state.capital).verdict !== state.verdict) return false;
      if (state.category && r.category !== state.category) return false;
      if (q) {
        var hay = (r.name + " " + r.category + " " + r.chains.join(" ")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      if (key === "net_per_hour_usd") return renet(b, state.capital).perHour - renet(a, state.capital).perHour;
      if (key === "net_usd") return renet(b, state.capital).net - renet(a, state.capital).net;
      if (key === "tvl_usd") return b.tvl_usd - a.tvl_usd;
      return b.implied_value_usd - a.implied_value_usd;
    });
    return list;
  }
  function renderBoard() {
    var list = filteredRows();
    var html = "";
    list.forEach(function (r) {
      var n = renet(r, state.capital);
      html += '<tr data-slug="' + esc(r.slug) + '" tabindex="0">' +
        '<td class="num">' + r.rank + "</td>" +
        '<td><button type="button" class="rowlink" data-slug="' + esc(r.slug) + '">' + esc(r.name) + "</button>" +
        '<div class="subline">' + esc(r.category) + " · " + esc(r.chains.join(", ")) + "</div></td>" +
        '<td class="num">' + fmtMoney(r.tvl_usd) + "</td>" +
        '<td class="num">' + fmtPct(r.change_7d) + "</td>" +
        '<td>' + fmtAge(r.age_days) + "</td>" +
        '<td class="num strong">' + fmtMoney(r.implied_value_usd) + "</td>" +
        "<td>" + bandSvg(r) + "</td>" +
        '<td class="num">' + fmtMoney(n.slice) + "</td>" +
        '<td class="num">' + fmtSigned(n.net) + "</td>" +
        '<td class="num">' + fmtSigned(n.perHour) + "</td>" +
        '<td><span class="verdict ' + n.verdict.toLowerCase() + '">' + n.verdict + "</span></td>" +
        "</tr>";
    });
    $("rows").innerHTML = html;
    $("count").textContent = "Showing " + list.length + " of " + rows.length + " ranked protocols.";
    // The verdict summary: the board's verdicts at this capital, each
    // a button that filters the table to that verdict.
    var vc = { FARM: 0, THIN: 0, SKIP: 0 };
    rows.forEach(function (r) { vc[renet(r, state.capital).verdict] += 1; });
    $("verdict-summary").innerHTML =
      ["FARM", "THIN", "SKIP"].map(function (v) {
        return '<button type="button" data-verdict="' + v + '" class="' +
          (state.verdict === v ? "active" : "") + '">' + v + " " + vc[v] + "</button>";
      }).join(" ") +
      (state.verdict ? ' <button type="button" data-verdict="">Show all</button>' : "") +
      " at $" + state.capital.toLocaleString("en-US") + ".";
  }

  // -- The traded and set-aside tabs -------------------------------------------
  function renderTraded() {
    var html = "";
    traded.forEach(function (t, i) {
      html += "<tr><td class='num'>" + (i + 1) + "</td>" +
        "<td>" + esc(t.name) + "</td>" +
        "<td>" + esc(t.category) + "</td>" +
        '<td class="num">' + fmtMoney(t.tvl_usd) + "</td>" +
        '<td class="num">' + fmtMoney(t.mcap_usd) + "</td>" +
        "<td>" + (t.listed_at ? esc(t.listed_at.slice(0, 10)) : "—") + "</td>" +
        "<td>" + (t.in_fit ? '<span class="badge">prices the curve</span>' : "—") + "</td></tr>";
    });
    $("traded-rows").innerHTML = html;
    $("traded-count").textContent = traded.length + " traded protocols, kept apart from the board.";
  }
  function renderSetAside() {
    var html = "";
    setAside.forEach(function (s) {
      html += "<tr><td>" + esc(s.name) + "</td><td>" + esc(s.category) +
        "</td><td>" + esc(s.reason) + "</td></tr>";
    });
    $("setaside-rows").innerHTML = html;
    $("setaside-count").textContent = setAside.length + " pre-token protocols set aside, each with its reason.";
  }

  // -- The method tab ------------------------------------------------------------
  function overlapCount(rank) {
    var row = rows.filter(function (r) { return r.rank === rank; })[0];
    if (!row) return 0;
    return rows.filter(function (r) {
      return r.implied_p10_usd <= row.implied_p90_usd && r.implied_p90_usd >= row.implied_p10_usd;
    }).length;
  }
  function renderMethod() {
    var fit = validation.fit, loo = validation.loo, ts = validation.time_split;
    $("method-fit").innerHTML =
      "log10(market cap) = <strong>" + fit.intercept.toFixed(3) + " + " + fit.slope.toFixed(3) +
      " × log10(TVL)</strong>, fitted at build time from the " + fit.n +
      " traded tokens with TVL of $10M or more (R² " + fit.r2.toFixed(2) +
      "). A protocol's implied value is its curve prediction × its category factor " +
      "(median per category, shrunk toward 1 where the category has few traded tokens) " +
      "× its week's growth × momentum × maturity × breadth. Nothing is hardcoded: the " +
      "same program on another snapshot fits another line, and the numbers on this page " +
      "are the ones the program computed from this snapshot.";
    $("method-scatter").innerHTML = scatterSvg(640, 300);
    $("method-scatter-note").textContent =
      "The " + fit.n + " comparables the line is fitted on, market cap against TVL, log-log. " +
      "Tokens that sit far above the line are the ones the market values beyond their size.";
    var dl = "";
    function testRow(label, curve, flat) {
      return "<dt>" + label + "</dt><dd>curve: median miss ×" + curve[0].toFixed(2) +
        ", within 3× " + Math.round(curve[1] * 100) + "%, within 10× " + Math.round(curve[2] * 100) +
        "% — flat multiple: ×" + flat[0].toFixed(2) + ", " + Math.round(flat[1] * 100) +
        "% / " + Math.round(flat[2] * 100) + "%.</dd>";
    }
    dl += testRow("Leave-one-out (" + loo.n + " comparables, each held out and refit)",
      [loo.curve_median_miss, loo.curve_within_3x, loo.curve_within_10x],
      [loo.flat_median_miss, loo.flat_within_3x, loo.flat_within_10x]);
    dl += testRow("Time split (fit the " + ts.train_n + " listed before 2024, test the " + ts.test_n + " listed since; " + ts.unlisted_n + " have no listing date and are not tested)",
      [ts.curve_median_miss, ts.curve_within_3x, ts.curve_within_10x],
      [ts.flat_median_miss, ts.flat_within_3x, ts.flat_within_10x]);
    $("method-tests").innerHTML = dl;
    var medWidth = median(rows.map(function (r) { return r.rank_hi - r.rank_lo; }));
    var skipAt10k = rows.filter(function (r) { return renet(r, 10000).verdict === "SKIP"; }).length;
    $("method-bands").textContent =
      "Each row's band is the P10–P90 of " + validation.bootstrap.refits +
      " bootstrap refits (seed " + validation.bootstrap.seed + "): the comparables are " +
      "resampled, the line is refit, the category factors are recalibrated, and every row " +
      "is repriced. The median rank range is " + medWidth + " places wide; " +
      overlapCount(1) + " rows overlap the top row's band and " + overlapCount(40) +
      " overlap rank 40's — so a row's rank is a claim about its size, not a certainty.";
    var farmAt = counts.farm_at;
    $("method-plan").textContent =
      "A plan costs $1 to open the wallet, $2 to deposit, $1 to claim and the weekly " +
      "gas — $0.50 a week on Ethereum and Bitcoin, $0.05 elsewhere — for a hold of 45, " +
      "60 or 90 days by age. The hands-on time is 40 minutes plus 5 a week. FARM means " +
      "$5 or more net per hands-on hour. At $1,000 the board farms " + farmAt[1000] +
      " rows, at $2,500 it farms " + farmAt[2500] + ", at $5,000 " + farmAt[5000] +
      ", at $10,000 " + farmAt[10000] + " — and " + skipAt10k +
      " rows stay SKIP even at $10,000: the biggest protocols, where the slice is too " +
      "thin next to the yield given up to hold it.";
  }

  // -- The sidebar ------------------------------------------------------------------
  function renderSidebar() {
    $("side-scatter").innerHTML = scatterSvg(340, 190);
    $("side-scatter-note").textContent =
      "The " + validation.fit.n + " comparables against the fitted line. " +
      "R² " + validation.fit.r2.toFixed(2) + " — size explains some of value, not most.";
    // Farm next: the five highest net per hour at the chosen capital.
    var best = rows.slice().sort(function (a, b) {
      return renet(b, state.capital).perHour - renet(a, state.capital).perHour;
    }).slice(0, 5);
    $("farm-next-note").textContent =
      "The five highest net per hour at $" + state.capital.toLocaleString("en-US") + ":";
    $("farm-next").innerHTML = best.map(function (r) {
      var n = renet(r, state.capital);
      return '<li><button type="button" class="rowlink" data-slug="' + esc(r.slug) + '">' +
        esc(r.name) + "</button> — " + fmtSigned(n.perHour) + "/hr · " + esc(r.chains[0] || "") +
        "</li>";
    }).join("");
    var loo = validation.loo, ts = validation.time_split;
    $("side-validation").innerHTML =
      "<dt>Fit</dt><dd>log10(mcap) = " + validation.fit.intercept.toFixed(3) + " + " +
      validation.fit.slope.toFixed(3) + " × log10(TVL), n=" + validation.fit.n +
      ", R² " + validation.fit.r2.toFixed(2) + ".</dd>" +
      "<dt>Leave-one-out</dt><dd>curve ×" + loo.curve_median_miss.toFixed(2) +
      " (within 3× " + Math.round(loo.curve_within_3x * 100) + "%) vs flat ×" +
      loo.flat_median_miss.toFixed(2) + " (" + Math.round(loo.flat_within_3x * 100) + "%).</dd>" +
      "<dt>Time split</dt><dd>curve ×" + ts.curve_median_miss.toFixed(2) +
      " (within 3× " + Math.round(ts.curve_within_3x * 100) + "%) vs flat ×" +
      ts.flat_median_miss.toFixed(2) + " (" + Math.round(ts.flat_within_3x * 100) + "%).</dd>" +
      "<dt>Bands</dt><dd>P10–P90 of " + validation.bootstrap.refits + " refits, seed " +
      validation.bootstrap.seed + ".</dd>";
  }

  // -- The detail panel ---------------------------------------------------------------
  function renderDetail() {
    var panel = $("detail");
    var row = rows.filter(function (r) { return r.slug === state.detail; })[0];
    if (!row) { panel.hidden = true; return; }
    var n = renet(row, state.capital);
    var m = row.model;
    $("detail-name").textContent = "#" + row.rank + " · " + row.name;
    $("detail-why").textContent = row.why;
    $("detail-build").textContent =
      "Implied value " + fmtMoney(row.implied_value_usd) + " (P10 " + fmtMoney(row.implied_p10_usd) +
      " – P90 " + fmtMoney(row.implied_p90_usd) + ", rank " + row.rank_lo + "–" + row.rank_hi + ").";
    $("detail-model").innerHTML =
      "<dt>Curve base</dt><dd>" + fmtMoney(m.comps_base_usd) + " (from TVL " + fmtMoney(row.tvl_usd) + ")</dd>" +
      "<dt>Category factor</dt><dd>×" + m.category_factor.toFixed(2) + " (" + esc(row.category) + ")</dd>" +
      "<dt>Growth</dt><dd>×" + m.growth_multiplier.toFixed(3) + " (7-day " + fmtPct(row.change_7d) + ")</dd>" +
      "<dt>Momentum</dt><dd>×" + (1 + m.momentum).toFixed(2) + "</dd>" +
      "<dt>Maturity</dt><dd>×" + m.maturity_multiplier.toFixed(2) + " (" + fmtAge(row.age_days) + " with no token)</dd>" +
      "<dt>Breadth</dt><dd>×" + m.breadth_multiplier.toFixed(2) + " (" + row.chains.length + (row.chains.length === 1 ? " chain" : " chains") + ")</dd>" +
      "<dt>Hold</dt><dd>" + row.hold_days + " days</dd>" +
      "<dt>Slice at $" + state.capital.toLocaleString("en-US") + "</dt><dd>" + fmtMoney(n.slice) + "</dd>" +
      "<dt>Fees</dt><dd>" + fmtSigned(-n.fees) + "</dd>" +
      "<dt>Net</dt><dd>" + fmtSigned(n.net) + " (" + fmtSigned(n.perHour) + "/hr over " + hoursFor(row).toFixed(1) + " hands-on hours) — " + n.verdict + "</dd>";
    $("detail-capital-note").textContent =
      "at $" + state.capital.toLocaleString("en-US") + " — the steps are written for the $1,000 plan; only the deposit amount scales.";
    $("detail-steps").innerHTML = row.farm_steps.map(function (s) {
      return "<li>" + esc(s) + "</li>";
    }).join("");
    panel.hidden = false;
  }

  // -- Tabs, filters, capital ---------------------------------------------------------
  function setTab(tab) {
    state.tab = tab;
    ["board", "traded", "setaside", "method"].forEach(function (t) {
      $("view-" + t).hidden = t !== tab;
      $("tab-" + t).classList.toggle("active", t === tab);
    });
    $("filters").style.display = tab === "board" ? "" : "none";
    if (tab === "traded") renderTraded();
    if (tab === "setaside") renderSetAside();
    if (tab === "method") renderMethod();
  }
  function syncUrl() {
    var p = new URLSearchParams();
    p.set("tab", state.tab);
    p.set("capital", String(state.capital));
    p.set("sort", state.sort);
    if (state.verdict) p.set("verdict", state.verdict);
    if (state.category) p.set("category", state.category);
    if (state.q) p.set("q", state.q);
    if (state.detail) p.set("detail", state.detail);
    history.replaceState(null, "", "?" + p.toString());
  }
  function render() {
    renderKpis();
    renderBoard();
    renderSidebar();
    renderDetail();
    setTab(state.tab);
    syncUrl();
    document.querySelectorAll("#capital-field button").forEach(function (b) {
      b.classList.toggle("active", parseInt(b.getAttribute("data-capital"), 10) === state.capital);
    });
  }

  // -- Wiring -----------------------------------------------------------------------
  // The category list: every category on the board, in alphabetical
  // order, each with its count.
  var cats = {};
  rows.forEach(function (r) { cats[r.category] = (cats[r.category] || 0) + 1; });
  Object.keys(cats).sort().forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c + " (" + cats[c] + ")";
    $("category").appendChild(opt);
  });
  $("q").value = state.q;
  $("verdict").value = state.verdict;
  $("category").value = state.category;
  $("sort").value = state.sort;

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); syncUrl(); });
  });
  $("q").addEventListener("input", function () { state.q = $("q").value; renderBoard(); syncUrl(); });
  $("verdict").addEventListener("change", function () { state.verdict = $("verdict").value; renderBoard(); syncUrl(); });
  $("category").addEventListener("change", function () { state.category = $("category").value; renderBoard(); syncUrl(); });
  $("sort").addEventListener("change", function () { state.sort = $("sort").value; renderBoard(); syncUrl(); });
  $("verdict-summary").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-verdict]");
    if (!b) return;
    state.verdict = b.getAttribute("data-verdict");
    $("verdict").value = state.verdict;
    renderBoard();
    syncUrl();
  });
  document.querySelectorAll("#capital-field button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.capital = parseInt(b.getAttribute("data-capital"), 10);
      render();
    });
  });
  // A row's name, a farm-next name: open that protocol's detail.
  document.addEventListener("click", function (e) {
    var link = e.target.closest(".rowlink");
    if (link) {
      state.detail = link.getAttribute("data-slug");
      renderDetail();
      syncUrl();
    }
  });
  $("rows").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var tr = e.target.closest("tr[data-slug]");
      if (tr) { state.detail = tr.getAttribute("data-slug"); renderDetail(); syncUrl(); }
    }
  });
  $("close-detail").addEventListener("click", function () {
    state.detail = "";
    renderDetail();
    syncUrl();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.detail) {
      state.detail = "";
      renderDetail();
      syncUrl();
    }
  });

  render();
})();
