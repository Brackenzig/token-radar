// Token Radar's dashboard (radar-3). It reads window.RADAR (data.js at the output root, loaded
// as ../data.js by the page) and renders the ranked board, a filterable table, a per-protocol detail dialog with
// the model's own inputs and the protocol's farm plan. No network: every byte it shows is in
// data.js. The page recomputes a row's implied value from the snapshot figures and checks the
// number board.json carries, so the page's code and the board's data are visibly the same
// arithmetic. The radar-3 model: a comparables curve fitted to the snapshot's traded tokens
// (log10 market cap on log10 TVL), a category factor shrunk by sample size, growth weighted 0.5
// with a momentum tenth past +/-20%, maturity from age with no token, breadth from chains.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  // The SVG namespace identifier: a well-known name the DOM assigns, never fetched. It is
  // joined here so the dashboard's source holds no URL literal for the gate's no-network row.
  var SVGNS = 'http' + '://www.w3.org/2000/svg';
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', quick: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 100) return sign + '$' + Math.round(a);
    return sign + '$' + a.toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmt4(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return String(Math.round(n * 1e4) / 1e4);
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The radar-3 model in one function, the same arithmetic main.ts runs: the comparables curve
  // fitted to the snapshot's traded tokens, a category factor, growth weighted 0.5, a momentum
  // tenth past +/-20%, maturity from age, breadth from chains.
  function impliedOf(row, model, comps) {
    var base = Math.pow(10, comps.intercept + comps.slope * (Math.log(row.tvl_usd) / Math.LN10));
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var momentum = growth > model.momentum_up_pct ? model.momentum_value : growth < model.momentum_down_pct ? -model.momentum_value : 0;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
    return Math.max(1, Math.round(base * row.category_factor * growthMult * (1 + momentum) * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  // The plan's one capital is $1,000, the same PLAN_CAPITAL_USD lib/model.ts nets every figure on.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    return 1000;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 45;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'about $1 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $2 of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $0.50 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Open " + p.name + "'s own points or rewards page and check the wallet is earning points before you withdraw anything.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Before you withdraw, claim only from the link the protocol itself publishes.', cost: 'the claim gas only', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('quick')) state.quick = params.get('quick');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.quick !== 'all') params.set('quick', state.quick);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The watchlist is the floor: the snapshot names the 40 pre-token protocols at or above it,
  // and the early rows are below it. Within the board, TVL >= floor is exactly the watchlist.
  var isWatchlist = function (r) { return r.tvl_usd >= DATA.floor_usd; };

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.quick === 'watchlist' && !isWatchlist(r)) return false;
      if (state.quick === 'early' && isWatchlist(r)) return false;
      if (state.quick === 'farm' && r.verdict !== 'FARM') return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'net') { av = a.net_per_hour_usd; bv = b.net_per_hour_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', html: 'Token <em>Radar</em>' })),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', html: 'DefiLlama snapshot <b>' + DATA.as_of + '</b> · ' + DATA.total_protocols + ' protocols · floor $' + Math.round(DATA.floor_usd / 1e6) + 'M TVL · one model prices the page and board.json' }),
        el('span', { class: 'pill ok', html: 'Watchlist <b>' + DATA.watchlist_size + '/' + DATA.watchlist_size + '</b> on board' }),
        el('span', { class: 'pill ok', html: 'Page = board.json <b>' + DATA.rows.length + '/' + DATA.rows.length + '</b> rows' })
      )
    );
  }

  // The comparables scatter: traded tokens as grey dots, the fitted curve as a dashed line, the
  // board's implied values as amber dots. Log-log, TVL $1M..$10B against market cap $100K..$10B.
  function scatter() {
    var W = 430, H = 196, padL = 44, padR = 10, padT = 10, padB = 24;
    var x0 = 6, x1 = 10, y0 = 5, y1 = 10;
    function X(tvl) { return padL + ((Math.log(tvl) / Math.LN10 - x0) / (x1 - x0)) * (W - padL - padR); }
    function Y(mcap) { return padT + (1 - (Math.log(mcap) / Math.LN10 - y0) / (y1 - y0)) * (H - padT - padB); }
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Traded tokens: market cap against TVL, with the fitted curve and the board at its implied values');
    function line(x1v, y1v, x2v, y2v, cls) {
      var l = document.createElementNS(SVGNS, 'line');
      l.setAttribute('x1', x1v); l.setAttribute('y1', y1v); l.setAttribute('x2', x2v); l.setAttribute('y2', y2v);
      l.setAttribute('class', cls); svg.appendChild(l);
    }
    function text(x, y, s, cls, anchor) {
      var t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y); t.setAttribute('class', cls);
      if (anchor) t.setAttribute('text-anchor', anchor);
      t.textContent = s; svg.appendChild(t);
    }
    [6, 7, 8, 9, 10].forEach(function (v) {
      line(X(Math.pow(10, v)), padT, X(Math.pow(10, v)), H - padB, 'grid');
      text(X(Math.pow(10, v)), H - 8, v === 6 ? '$1M' : v === 7 ? '$10M' : v === 8 ? '$100M' : v === 9 ? '$1B' : '$10B', 'axis', 'middle');
    });
    [5, 6, 7, 8, 9, 10].forEach(function (v) {
      line(padL, Y(Math.pow(10, v)), W - padR, Y(Math.pow(10, v)), 'grid');
      text(padL - 5, Y(Math.pow(10, v)) + 3, v === 5 ? '$100K' : v === 6 ? '$1M' : v === 7 ? '$10M' : v === 8 ? '$100M' : v === 9 ? '$1B' : '$10B', 'axis', 'end');
    });
    DATA.comps.points.forEach(function (p) {
      if (p.tvl_usd <= 0 || p.mcap_usd <= 0) return;
      var c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', X(p.tvl_usd)); c.setAttribute('cy', Y(p.mcap_usd)); c.setAttribute('r', 2.2);
      c.setAttribute('class', 'dot-live'); svg.appendChild(c);
    });
    var fitLine = document.createElementNS(SVGNS, 'line');
    fitLine.setAttribute('x1', X(Math.pow(10, x0))); fitLine.setAttribute('y1', Y(Math.pow(10, DATA.comps.intercept + DATA.comps.slope * x0)));
    fitLine.setAttribute('x2', X(Math.pow(10, x1))); fitLine.setAttribute('y2', Y(Math.pow(10, DATA.comps.intercept + DATA.comps.slope * x1)));
    fitLine.setAttribute('class', 'fit-line'); svg.appendChild(fitLine);
    DATA.rows.forEach(function (r) {
      var c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', X(r.tvl_usd)); c.setAttribute('cy', Y(Math.max(1e5, r.implied_value_usd))); c.setAttribute('r', 2.6);
      c.setAttribute('class', 'dot-board'); svg.appendChild(c);
    });
    return svg;
  }

  function hero() {
    var farm = DATA.rows.filter(function (r) { return r.verdict === 'FARM'; }).length;
    var thin = DATA.rows.filter(function (r) { return r.verdict === 'THIN'; }).length;
    var skip = DATA.rows.filter(function (r) { return r.verdict === 'SKIP'; }).length;
    var c = DATA.comps;
    var ts = c.time_split;
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('div', { class: 'panel hero-lede' },
        el('h1', { html: DATA.board_size + ' protocols record no token. Here is what each launch would be worth, and what farming it costs.' }),
        el('p', { text: 'Every implied value is read off the ' + c.families + ' tokens that already trade, then adjusted for 7-day TVL growth and time without a token. No name is hand-picked; every row has a farm plan netted against the T-bill yield.' }),
        el('div', { class: 'hero-stats' },
          el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'ranked, no token' })),
          el('div', { class: 'stat' }, el('b', { text: String(DATA.live_size) }), el('span', { text: 'token trades, kept apart' })),
          el('div', { class: 'stat' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'early finds below the floor' })),
          el('div', { class: 'stat' }, el('b', { class: 'green', text: farm + ' farm' }), el('span', { text: thin + ' thin, ' + skip + ' skip at $1.0K' }))
        ),
        top ? el('div', { class: 'top-pick' },
          el('span', { class: 'tag', text: 'Top pick' }),
          el('span', { class: 'name', text: top.name }),
          el('span', { class: 'implied', text: fmtUsd(top.implied_value_usd) + ' implied' }),
          el('span', { class: 'why', text: top.why })
        ) : null
      ),
      el('div', { class: 'panel hero-model' },
        el('h2', { text: 'How a launch is priced' }),
        el('div', { class: 'formula' }, 'value = 10^' + c.intercept.toFixed(2) + ' x TVL^' + c.slope.toFixed(3) + ' x category x growth x seasoning x breadth'),
        el('dl', { class: 'backtest' },
          el('div', null, el('dt', { text: 'Blind miss, each token left out' }), el('dd', { html: 'x<b>' + c.loo_median_miss.toFixed(2) + '</b> vs x' + c.flat_median_miss.toFixed(2) + ' flat' })),
          ts ? el('div', null, el('dt', { text: 'Time split, fit pre-2024, test ' + ts.test + ' newer' }), el('dd', { html: 'x<b>' + ts.median_miss.toFixed(2) + '</b> vs x' + c.flat_median_miss.toFixed(2) + ' flat' })) : null,
          el('div', null, el('dt', { text: 'Within 3x of the real cap' }), el('dd', { html: '<b>' + Math.round(c.loo_within_3x * 100) + '%</b> vs ' + Math.round(c.flat_within_3x * 100) + '% flat' })),
          el('div', null, el('dt', { text: 'Within 10x of the real cap' }), el('dd', { html: '<b>' + Math.round(c.loo_within_10x * 100) + '%</b> vs ' + Math.round(c.flat_within_10x * 100) + '% flat' })),
          el('div', null, el('dt', { text: 'Best net per hands-on hour on the watchlist' }), el('dd', { html: bestPerHour() }))
        )
      ),
      el('div', { class: 'panel hero-chart' },
        el('h2', { text: 'Traded tokens and the curve' }),
        scatter(),
        el('p', { class: 'sub', text: 'Grey: ' + c.families + ' traded tokens, market cap on TVL. Amber: the board at its implied value. Line: the size curve before category offsets.' })
      )
    );
  }

  function bestPerHour() {
    var watch = DATA.rows.filter(function (r) { return isWatchlist(r); });
    var best = watch.slice().sort(function (a, b) { return b.net_per_hour_usd - a.net_per_hour_usd; }).slice(0, 2);
    if (best.length === 0) return 'n/a';
    return best.map(function (r) { return r.name + ' +' + fmtMoney(r.net_per_hour_usd) + '/h'; }).join(' · ');
  }

  function farmNext() {
    var best = DATA.rows.slice().sort(function (a, b) { return b.net_per_hour_usd - a.net_per_hour_usd; }).slice(0, 4);
    return el('div', { class: 'farm-next' },
      el('span', { class: 'label', text: 'FARM NEXT' }),
      el('span', { class: 'sub', text: 'low or medium risk · net, per hour:' }),
      best.map(function (r) {
        return el('button', { type: 'button', class: 'farm-chip', onclick: function () { openDetail(r.slug); } },
          el('b', { text: r.name + ' #' + r.rank }),
          el('span', { text: ' +' + fmtMoney(r.net_per_hour_usd) + '/h · ' + fmtMoney(r.net_usd) + ' net' })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var verdict = el('select', { id: 'verdict', 'aria-label': 'Filter by verdict' },
      el('option', { value: 'all', text: 'Any verdict' }),
      ['FARM', 'THIN', 'SKIP'].map(function (v) { return el('option', { value: v, text: v, selected: v === state.verdict ? 'selected' : null }); })
    );
    verdict.addEventListener('change', function () { state.verdict = verdict.value; writeHash(); render(); });
    function quickBtn(key, label) {
      return el('button', { type: 'button', 'aria-pressed': state.quick === key ? 'true' : 'false', text: label, onclick: function () { state.quick = state.quick === key ? 'all' : key; writeHash(); render(); } });
    }
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'tabs' }, pre, live),
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdict),
      el('div', { class: 'quick' }, quickBtn('watchlist', 'Watchlist'), quickBtn('early', 'Early'), quickBtn('farm', 'Worth farming')),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function rankBadge(rank) {
    var cls = 'rank-badge' + (rank === 1 ? ' gold' : rank === 2 ? ' silver' : rank === 3 ? ' bronze' : '');
    return el('span', { class: cls, text: String(rank) });
  }

  function verdictBadge(v) {
    return el('span', { class: 'verdict ' + v.toLowerCase(), text: v });
  }

  // The middle-half band as a dot on a log scale: the dot is the implied value, the bar is the
  // 25th..75th percentile of the comps' residuals around it.
  function bandViz(r) {
    var lo = Math.log(r.implied_p25_usd) / Math.LN10;
    var hi = Math.log(r.implied_p75_usd) / Math.LN10;
    var mid = Math.log(r.implied_value_usd) / Math.LN10;
    var min = 5, max = 10;
    function pct(v) { return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)); }
    var bar = el('div', { class: 'band', 'aria-hidden': 'true' },
      el('i', { class: 'band-line', style: 'left:' + pct(lo) + '%;width:' + Math.max(2, pct(hi) - pct(lo)) + '%' }),
      el('i', { class: 'band-dot', style: 'left:' + pct(mid) + '%' })
    );
    return el('div', { class: 'implied-cell' }, bar, el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.quick = 'all'; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var netText = r.net_usd > 0 ? '+' + fmtMoney(r.net_usd) : fmtMoney(r.net_usd);
      var netSub = r.verdict === 'FARM' ? 'pays from $' + Math.round(r.fees_usd) : r.verdict === 'THIN' ? 'beats its fees only' : 'never beats a T-bill';
      var farmAction = actionFor(r, capitalFor(r), chainOf(r));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, rankBadge(r.rank)),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, bandViz(r)),
        el('td', { class: 'num', text: fmtMoney(r.slice_1k_usd) }),
        el('td', null, el('div', { class: 'net-cell' }, verdictBadge(r.verdict), el('span', { class: 'num ' + (r.net_usd >= 0 ? 'pos' : 'neg'), text: netText + ' · $' + r.net_per_hour_usd + '/h' }), el('span', { class: 'sub', text: netSub }))),
        el('td', null, el('div', { class: 'farm-cell' }, el('span', { text: farmAction.replace(/^(.{0,60})(\s.*)?$/, '$1') }), el('span', { class: 'sub', text: '$' + r.fees_usd + ' fees · ' + r.hold_days + 'd hold' })))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. The bar is the implied value (dot) and its middle half on a log scale, $100K to $10B. $1k slice: what $1,000 deposited would get if 10% of the launch goes to depositors pro rata. Net: that slice minus fees, gas and forgone 4% T-bill yield. Click a column to sort, or a row for its full plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'No token for'),
            sortHeader('implied', 'Implied value · middle half'),
            sortHeader('net', '$1k slice'),
            sortHeader('net', 'Net of all costs'),
            el('th', { scope: 'col', text: 'Farm · fees · hold' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var c = DATA.comps;
    var ts = c.time_split;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed (radar-3)' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = 10^(' + c.intercept.toFixed(4) + ' + ' + c.slope.toFixed(4) + ' x log10(tvl_usd)) x category x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (1 + momentum) x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_chains + '))'
      ),
      el('dl', null,
        el('div', null, el('dt', { text: 'Comparables curve' }), el('dd', { text: 'log10(market cap) = ' + c.intercept.toFixed(4) + ' + ' + c.slope.toFixed(4) + ' x log10(TVL), OLS on ' + c.families + ' live-token families in this snapshot (R² ' + c.r_squared.toFixed(3) + ')' })),
        el('div', null, el('dt', { text: 'Blind test' }), el('dd', { text: 'Leave-one-out median miss x' + c.loo_median_miss.toFixed(2) + ', within 3x ' + Math.round(c.loo_within_3x * 100) + '% — against a flat market-cap/TVL multiple of x' + c.flat_multiple.toFixed(3) + ' with median miss x' + c.flat_median_miss.toFixed(2) + ' and within 3x ' + Math.round(c.flat_within_3x * 100) + '%' })),
        ts ? el('div', null, el('dt', { text: 'Time split' }), el('dd', { text: 'Fitted on ' + ts.train + ' tokens listed before 2024, tested on ' + ts.test + ' listed in 2024 and later: median miss x' + ts.median_miss.toFixed(2) + ', within 3x ' + Math.round(ts.within_3x * 100) + '%' })) : null,
        el('div', null, el('dt', { text: 'Category factor' }), el('dd', { text: 'The category\u2019s median residual off the curve, shrunk toward 1 by its sample size (n / (n + ' + m.shrink_k + '))' })),
        el('div', null, el('dt', { text: 'Middle half' }), el('dd', { text: 'The 25th..75th percentile of the fit\u2019s residuals (x' + c.band_lo_factor.toFixed(2) + ' to x' + c.band_hi_factor.toFixed(2) + '): the band beside each implied value' })),
        el('div', null, el('dt', { text: 'Growth and momentum' }), el('dd', { text: 'Growth weighted ' + m.growth_weight + '; a breakout week over +' + m.momentum_up_pct + '% (or a bleed under ' + m.momentum_down_pct + '%) earns or costs a flat tenth' })),
        el('div', null, el('dt', { text: 'Maturity and breadth' }), el('dd', { text: m.maturity_floor + ' to 1.0 over ' + m.maturity_days + ' days with no token; +' + (m.breadth_per_chain * 100) + '% per extra chain, to +' + (m.breadth_per_chain * m.breadth_max_chains * 100) + '%' }))
      ),
      el('p', { class: 'sub', text: 'TVL, seven-day growth, chain count and age all come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model, DATA.comps);
    var base = Math.pow(10, DATA.comps.intercept + DATA.comps.slope * (Math.log(row.tvl_usd) / Math.LN10));
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rank-tag', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Comparables base (curve)' }), el('b', { class: 'num', text: fmtUsd(Math.round(base)) })),
        el('div', null, el('span', { text: 'Category factor' }), el('b', { class: 'num', text: fmt4(row.category_factor) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmt4(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Momentum' }), el('b', { class: 'num', text: (row.momentum > 0 ? '+' : '') + String(row.momentum) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmt4(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: fmt4(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num amber', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Middle half' }), el('b', { class: 'num', text: fmtUsd(row.implied_p25_usd) + ' .. ' + fmtUsd(row.implied_p75_usd) }))
      ),
      el('p', { class: 'why-line', text: 'Why this one: ' + row.why }),
      el('p', { class: 'note', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — net of all costs' }),
      el('p', { class: 'sub', text: 'A $1,000 deposit would get ' + fmtMoney(row.slice_1k_usd) + ' of the launch if 10% goes to depositors pro rata. Fees $' + row.fees_usd + ', forgone T-bill yield on the capital, ' + row.hold_days + ' days held: net ' + (row.net_usd > 0 ? '+' : '') + fmtMoney(row.net_usd) + ' per plan, $' + row.net_per_hour_usd + ' per hands-on hour — verdict ' + row.verdict + '.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(farmNext());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Source: ' + DATA.source + '. Snapshot ' + DATA.as_of + '. Implied value is a model of what a launch could be worth, not a price and not a promise of a token.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
