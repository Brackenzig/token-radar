// Token Radar — the dashboard.
//
// Renders the board that main.ts wrote into ../data.js. No network, no
// framework: the data is a global, the table is built by hand, and a
// click on a row opens the detail panel with the why, the model
// breakdown and the seven farm steps.
//
// The page keeps its state in the controls themselves (the search box,
// the verdict and category selects, the sort select) and re-renders the
// table whenever any of them changes. The address bar can set the
// state on load: ?verdict=FARM shows only the farmable rows, and
// ?detail=<slug> opens that protocol's detail panel. The screenshots
// are taken through those links.
//
// ---------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------

/** The board data, assigned by ../data.js. When the page is opened
// without it (a stray copy of the dashboard), the board is empty and
// the page says so instead of throwing. */
const data = window.TOKEN_RADAR_DATA || { rows: [], as_of: "", floor_usd: 0 };
const rows = Array.isArray(data.rows) ? data.rows : [];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Get an element by id. Every id this file uses is in index.html. */
const $ = (id) => document.getElementById(id);

const rowsEl = $("rows");
const detailEl = $("detail");

/** Escape text for HTML, so a protocol name can never break the table
// or inject markup. Names come from the snapshot, and the snapshot is
// data, not code. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format a dollar amount: billions with two decimals, millions and
// thousands with one, anything smaller as a whole number. */
function fmtMoney(n) {
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "k";
  return "$" + n.toFixed(0);
}

/** Format a signed number with a fixed count of decimals: a leading +
// when positive, a minus sign (U+2212, the typographic one) when
// negative, nothing when zero. */
function fmtSigned(n, decimals) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + Math.abs(n).toFixed(decimals);
}

/** Format a percent change: a dash when the snapshot reports none,
// otherwise the signed value with one decimal and a % sign. */
function fmtPct(n) {
  if (n === null || n === undefined) return "—";
  return fmtSigned(n, 1) + "%";
}

/** Format a plain dollar amount with two decimals, for the slice, the
// net and the net per hour. Negative values keep their minus sign. */
function fmtDollars(n) {
  return "$" + n.toFixed(2);
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** The CSS class for a verdict pill: "verdict verdict-farm" and so on,
// which app.css colours green, amber and red. */
function verdictClass(v) {
  return "verdict verdict-" + String(v).toLowerCase();
}

/** One table row, as HTML. The rank, the name, the category, the chain
// count and first chain, the TVL, the week's move, the implied value,
// the slice, the net, the net per hour and the verdict pill. The slug
// rides on the row as a data attribute, so a click can find the row. */
function rowHtml(r) {
  const chains = r.chains.length + " · " + escapeHtml(r.chains[0] || "");
  return (
    '<tr data-slug="' + escapeHtml(r.slug) + '">' +
    "<td>" + r.rank + "</td>" +
    "<td><strong>" + escapeHtml(r.name) + "</strong></td>" +
    "<td>" + escapeHtml(r.category) + "</td>" +
    "<td>" + chains + "</td>" +
    '<td class="num">' + fmtMoney(r.tvl_usd) + "</td>" +
    '<td class="num">' + fmtPct(r.change_7d) + "</td>" +
    '<td class="num imp">' + fmtMoney(r.implied_value_usd) + "</td>" +
    '<td class="num">' + fmtDollars(r.slice_1k_usd) + "</td>" +
    '<td class="num">' + fmtDollars(r.net_usd) + "</td>" +
    '<td class="num">' + fmtDollars(r.net_per_hour_usd) + "</td>" +
    '<td><span class="' + verdictClass(r.verdict) + '">' + r.verdict + "</span></td>" +
    "</tr>"
  );
}

/** The sort keys the Sort control offers, and what each one sorts by.
// Every key is a number on the row, sorted largest first. The default
// is the implied value, which is also the board's rank order. */
const SORT_KEYS = ["implied_value_usd", "net_per_hour_usd", "net_usd", "tvl_usd"];

/** The rows after the filters and the sort: the verdict filter, the
// category filter, the search text (matched against the name, the
// category and the chains, case-insensitively), then the sort. A copy
// is sorted, never the board itself, so the rank order is untouched. */
function filteredRows() {
  const q = ($("q").value || "").trim().toLowerCase();
  const verdict = $("verdict").value;
  const category = $("category").value;
  const sortKey = SORT_KEYS.includes($("sort").value) ? $("sort").value : "implied_value_usd";

  let out = rows.filter((r) => {
    if (verdict !== "" && r.verdict !== verdict) return false;
    if (category !== "" && r.category !== category) return false;
    if (q !== "") {
      const hay = (r.name + " " + r.category + " " + r.chains.join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  out = out.slice().sort((a, b) => b[sortKey] - a[sortKey]);
  return out;
}

/** Re-render the table from the filters, and update the count line
// underneath it: how many rows are shown, out of how many on the board. */
function render() {
  const list = filteredRows();
  rowsEl.innerHTML = list.map(rowHtml).join("");
  $("count").textContent = list.length + " of " + rows.length + " protocols shown.";
  renderVerdictSummary();
}

// ---------------------------------------------------------------------------
// The verdict summary
// ---------------------------------------------------------------------------

/** The verdicts in the order the summary shows them. */
const VERDICTS = ["FARM", "THIN", "SKIP"];

/** Rebuild the verdict summary pills: one button per verdict, showing
// the verdict and how many rows hold it. The button for the verdict
// the filter is currently set to is marked pressed, so the reader can
// see which filter is active. */
function renderVerdictSummary() {
  const counts = verdictCounts();
  const current = $("verdict").value;
  const summary = $("verdict-summary");
  summary.innerHTML = VERDICTS.map((v) => {
    const pressed = current === v ? ' aria-pressed="true"' : ' aria-pressed="false"';
    return (
      '<button type="button" data-verdict="' + v + '"' + pressed + ">" +
      '<span class="count-' + v.toLowerCase() + '">' + v + "</span> " +
      counts[v] +
      "</button>"
    );
  }).join("");
}

/** A click on a summary pill: set the verdict filter to that verdict,
// or clear it when the pill is already the active filter, then
// re-render. The pill is a shortcut for the verdict select, not a
// second filter: the select and the pill always agree. */
function onVerdictSummaryClick(e) {
  const button = e.target.closest("button[data-verdict]");
  if (!button) return;
  const v = button.dataset.verdict;
  $("verdict").value = $("verdict").value === v ? "" : v;
  render();
}

// ---------------------------------------------------------------------------
// The detail panel
// ---------------------------------------------------------------------------

/** One row of the model breakdown: a term and its value, as a <dt>/<dd>
// pair. The definition list in the panel is built from these. */
function modelRow(term, value) {
  return "<dt>" + escapeHtml(term) + "</dt><dd>" + value + "</dd>";
}

/** The model breakdown for a row: the implied value with its P25/P75
// band, the comparables base, the category factor, the week's growth
// and its multiplier, the momentum, the maturity with the age, the
// breadth with the chain count, and the slice, fees, net, net per hour
// and hold of the plan. */
function modelHtml(r) {
  const m = r.model;
  const ageNote =
    m.age_days === null
      ? " (no listing date on record)"
      : " (" + m.age_days + " days)";
  return (
    modelRow(
      "Implied value",
      fmtMoney(r.implied_value_usd) +
        " (P25 " + fmtMoney(r.implied_p25_usd) +
        ", P75 " + fmtMoney(r.implied_p75_usd) + ")",
    ) +
    modelRow("Comparables base", fmtMoney(m.comps_base_usd)) +
    modelRow("Category factor", "×" + m.category_factor.toFixed(3)) +
    modelRow(
      "Growth (7d)",
      fmtPct(m.growth_pct) + " → ×" + m.growth_multiplier.toFixed(3),
    ) +
    modelRow("Momentum", fmtSigned(m.momentum * 100, 0) + "%") +
    modelRow(
      "Maturity",
      "×" + m.maturity_multiplier.toFixed(3) + ageNote,
    ) +
    modelRow(
      "Breadth",
      "×" + m.breadth_multiplier.toFixed(2) + " (" + r.chains.length + " chains)",
    ) +
    modelRow(
      "Slice on $1,000",
      fmtDollars(r.slice_1k_usd) +
        " · fees " + fmtDollars(r.fees_usd) +
        " · net " + fmtDollars(r.net_usd) +
        " · " + fmtDollars(r.net_per_hour_usd) + " per hour" +
        " · hold " + r.hold_days + " days",
    )
  );
}

/** The value build for a row, as one line: the comparables base times
// each factor in turn, approximately the implied value. Approximately,
// because the base is the rounded whole-dollar figure the detail
// records while the value itself is computed from the exact curve
// prediction — the product of the rounded figures lands within a
// percent of the value. The line is the derivation made visible: the
// reader can see every factor that built the number. */
function valueBuildText(r) {
  const m = r.model;
  return (
    "Value builds as base × category × growth × momentum × maturity × breadth: " +
    fmtMoney(m.comps_base_usd) +
    " × " + m.category_factor.toFixed(3) +
    " × " + m.growth_multiplier.toFixed(3) +
    " × " + (1 + m.momentum).toFixed(2) +
    " × " + m.maturity_multiplier.toFixed(3) +
    " × " + m.breadth_multiplier.toFixed(2) +
    " ≈ " + fmtMoney(r.implied_value_usd)
  );
}

/** Open the detail panel for a slug: the name and verdict as the
// heading, the why line, the model breakdown, and the seven farm
// steps as a numbered list. A slug with no row does nothing, so a bad
// ?detail= link opens the board, not an empty panel. */
function showDetail(slug) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  $("detail-name").textContent = r.name + " — " + r.verdict;
  $("detail-why").textContent = r.why;
  $("detail-build").textContent = valueBuildText(r);
  $("detail-model").innerHTML = modelHtml(r);
  $("detail-steps").innerHTML = r.farm_steps
    .map((s) => "<li>" + escapeHtml(s) + "</li>")
    .join("");
  detailEl.hidden = false;
}

/** Hide the detail panel. */
function hideDetail() {
  detailEl.hidden = true;
}

// ---------------------------------------------------------------------------
// Starting up
// ---------------------------------------------------------------------------

/** Count the verdicts on the board, for the header's summary line. */
function verdictCounts() {
  const counts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) {
    if (counts[r.verdict] !== undefined) counts[r.verdict] += 1;
  }
  return counts;
}

/** Fill the category select with the categories on the board, sorted,
// one option each. The "All categories" option is already in the HTML. */
function fillCategoryOptions() {
  const cats = [...new Set(rows.map((r) => r.category))].sort();
  const select = $("category");
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  }
}

/** The header's summary line: how many protocols, how many of each
// verdict, the snapshot date and the TVL floor. */
function fillMeta() {
  const counts = verdictCounts();
  $("meta").textContent =
    rows.length + " pre-token protocols" +
    " · FARM " + counts.FARM +
    " · THIN " + counts.THIN +
    " · SKIP " + counts.SKIP +
    " · snapshot " + (data.as_of || "—") +
    " · floor " + fmtMoney(data.floor_usd || 0);
}

/** Read a deep-link from the address bar. ?verdict=FARM (or THIN, or
// SKIP) sets the verdict filter before the first render, and
// ?detail=<slug> opens that protocol's panel. Anything else is
// ignored, so a mistyped link still shows the whole board. */
function applyDeepLinks() {
  const params = new URLSearchParams(window.location.search);
  const verdictParam = params.get("verdict");
  if (verdictParam && ["FARM", "THIN", "SKIP"].includes(verdictParam)) {
    $("verdict").value = verdictParam;
  }
  const detailParam = params.get("detail");
  if (detailParam) {
    showDetail(detailParam);
  }
}

/** Wire the controls up and render the first table:
//   * the search box, the verdict, category and sort controls all
//     re-render on input and on change, so typing and choosing both work;
//   * a click on a table row opens that row's detail panel;
//   * the close button and the Escape key hide the panel again. */
function init() {
  fillMeta();
  fillCategoryOptions();

  for (const id of ["q", "verdict", "category", "sort"]) {
    $(id).addEventListener("input", render);
    $(id).addEventListener("change", render);
  }

  rowsEl.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-slug]");
    if (tr) showDetail(tr.dataset.slug);
  });

  $("verdict-summary").addEventListener("click", onVerdictSummaryClick);

  $("close-detail").addEventListener("click", hideDetail);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideDetail();
  });

  applyDeepLinks();
  render();
}

init();
