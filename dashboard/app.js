// Token Radar — the dashboard.
//
// Renders the board that main.ts wrote into ../data.js. No network, no
// framework: the data is a global, the table is built by hand, and a click
// on a row opens the detail panel with the why, the model breakdown and
// the seven farm steps.

const data = window.TOKEN_RADAR_DATA || { rows: [], as_of: "", floor_usd: 0 };
const rows = data.rows || [];

const $ = (id) => document.getElementById(id);
const rowsEl = $("rows");
const detailEl = $("detail");

function fmtMoney(n) {
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "k";
  return "$" + n.toFixed(0);
}

function fmtSigned(n, decimals) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + Math.abs(n).toFixed(decimals);
}

function fmtPct(n) {
  if (n === null || n === undefined) return "—";
  return fmtSigned(n, 1) + "%";
}

function verdictClass(v) {
  return "verdict verdict-" + v.toLowerCase();
}

function rowHtml(r) {
  return (
    "<tr data-slug=\"" + r.slug + "\">" +
    "<td>" + r.rank + "</td>" +
    "<td><strong>" + escapeHtml(r.name) + "</strong></td>" +
    "<td>" + escapeHtml(r.category) + "</td>" +
    "<td>" + r.chains.length + " · " + escapeHtml(r.chains[0] || "") + "</td>" +
    "<td class=\"num\">" + fmtMoney(r.tvl_usd) + "</td>" +
    "<td class=\"num\">" + fmtPct(r.change_7d) + "</td>" +
    "<td class=\"num\">" + fmtMoney(r.implied_value_usd) + "</td>" +
    "<td class=\"num\">$" + r.slice_1k_usd.toFixed(2) + "</td>" +
    "<td class=\"num\">$" + r.net_usd.toFixed(2) + "</td>" +
    "<td class=\"num\">$" + r.net_per_hour_usd.toFixed(2) + "</td>" +
    "<td><span class=\"" + verdictClass(r.verdict) + "\">" + r.verdict + "</span></td>" +
    "</tr>"
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function filteredRows() {
  const q = ($("q").value || "").trim().toLowerCase();
  const verdict = $("verdict").value;
  const category = $("category").value;
  const sortKey = $("sort").value;
  let out = rows.filter((r) => {
    if (verdict && r.verdict !== verdict) return false;
    if (category && r.category !== category) return false;
    if (q) {
      const hay = (r.name + " " + r.category + " " + r.chains.join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  out = out.slice().sort((a, b) => b[sortKey] - a[sortKey]);
  return out;
}

function render() {
  const list = filteredRows();
  rowsEl.innerHTML = list.map(rowHtml).join("");
  $("count").textContent = list.length + " of " + rows.length + " protocols shown.";
}

function showDetail(slug) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  $("detail-name").textContent = r.name + " — " + r.verdict;
  $("detail-why").textContent = r.why;
  const m = r.model;
  $("detail-model").innerHTML =
    "<dt>Implied value</dt><dd>" + fmtMoney(r.implied_value_usd) +
    " (P25 " + fmtMoney(r.implied_p25_usd) + ", P75 " + fmtMoney(r.implied_p75_usd) + ")</dd>" +
    "<dt>Comparables base</dt><dd>" + fmtMoney(m.comps_base_usd) + "</dd>" +
    "<dt>Category factor</dt><dd>" + m.category_factor.toFixed(3) + "</dd>" +
    "<dt>Growth (7d)</dt><dd>" + fmtPct(m.growth_pct) + " → ×" + m.growth_multiplier.toFixed(3) + "</dd>" +
    "<dt>Momentum</dt><dd>" + fmtSigned(m.momentum * 100, 0) + "%</dd>" +
    "<dt>Maturity</dt><dd>×" + m.maturity_multiplier.toFixed(3) +
    (m.age_days === null ? " (no listing date on record)" : " (" + m.age_days + " days)") + "</dd>" +
    "<dt>Breadth</dt><dd>×" + m.breadth_multiplier.toFixed(2) + " (" + r.chains.length + " chains)</dd>" +
    "<dt>Slice on $1,000</dt><dd>$" + r.slice_1k_usd.toFixed(2) +
    " · fees $" + r.fees_usd.toFixed(2) + " · net $" + r.net_usd.toFixed(2) +
    " · $" + r.net_per_hour_usd.toFixed(2) + " per hour · hold " + r.hold_days + " days</dd>";
  $("detail-steps").innerHTML = r.farm_steps.map((s) => "<li>" + escapeHtml(s) + "</li>").join("");
  detailEl.hidden = false;
}

function hideDetail() {
  detailEl.hidden = true;
}

function init() {
  const counts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  $("meta").textContent =
    rows.length + " pre-token protocols · FARM " + counts.FARM +
    " · THIN " + counts.THIN + " · SKIP " + counts.SKIP +
    " · snapshot " + (data.as_of || "—") + " · floor " + fmtMoney(data.floor_usd || 0);

  const cats = [...new Set(rows.map((r) => r.category))].sort();
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    $("category").appendChild(opt);
  }

  for (const id of ["q", "verdict", "category", "sort"]) {
    $(id).addEventListener("input", render);
    $(id).addEventListener("change", render);
  }
  rowsEl.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-slug]");
    if (tr) showDetail(tr.dataset.slug);
  });
  $("close-detail").addEventListener("click", hideDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideDetail();
  });

  // Deep-link a state for screenshots and sharing: ?verdict=FARM or
  // ?detail=<slug> opens that view on load.
  const params = new URLSearchParams(window.location.search);
  const verdictParam = params.get("verdict");
  if (verdictParam && ["FARM", "THIN", "SKIP"].includes(verdictParam)) {
    $("verdict").value = verdictParam;
  }
  const detailParam = params.get("detail");
  if (detailParam) {
    showDetail(detailParam);
  }

  render();
}

init();
