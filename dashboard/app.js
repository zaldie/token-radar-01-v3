// Token Radar dashboard (model radar-3). Reads window.RADAR from data.js and
// renders the board, filters, detail view and the separate live-token section.
// No network: every value shown comes from data.js. No randomness, no clock.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA || !DATA.rows) return;

  var model = DATA.model || {};
  var fit = DATA.fit || {};
  var state = { sort: 'rank', dir: 1, search: '', category: 'all', chain: 'all', status: 'pre', minTvl: 0, minImp: 0, selected: null };

  /* ---------- deep links: #detail=<slug>, #category=<name>, #chain=<name>, #status=<pre|live|all> ----------
     A link to one protocol's detail or one filtered view, so a row or a filter
     can be shared and screenshotted exactly. Hash changes never reload. */
  function readHash() {
    var h = (window.location.hash || '').replace(/^#/, '');
    var out = { detail: null };
    if (!h) return out;
    function hasOption(id, v) {
      var sel = document.getElementById(id);
      if (!sel) return false;
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === v) return true;
      return false;
    }
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length !== 2) return;
      var k = decodeURIComponent(kv[0]);
      var v = decodeURIComponent(kv[1]);
      if (k === 'detail' && v) out.detail = v;
      else if (k === 'category' && v && hasOption('f-category', v)) state.category = v;
      else if (k === 'chain' && v && hasOption('f-chain', v)) state.chain = v;
      else if (k === 'status' && (v === 'pre' || v === 'live' || v === 'all')) state.status = v;
    });
    return out;
  }
  function writeHash() {
    var parts = [];
    if (state.selected) parts.push('detail=' + encodeURIComponent(state.selected));
    if (state.category !== 'all') parts.push('category=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.status !== 'pre') parts.push('status=' + encodeURIComponent(state.status));
    var hash = parts.length ? '#' + parts.join('&') : '';
    try {
      if (window.history && window.history.replaceState) window.history.replaceState(null, '', hash || window.location.pathname + window.location.search);
    } catch (e) { /* file:// or restricted context: the link still works on load */ }
  }

  /* ---------- formatting ---------- */
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }
  function chainsText(row, max) {
    var c = row.chains || [];
    if (!c.length) return 'chain not listed';
    return max ? c.slice(0, max).join(', ') : c.join(', ');
  }

  /* ---------- radar-3 model, recomputed on the page ----------
     size base from the fitted curve, tilt from the row, then the same growth,
     maturity and reach the board was built with. */
  function clampGrowth(g) {
    if (g === null || g === undefined || !isFinite(g)) return 0;
    var floor = model.growth_floor !== undefined ? model.growth_floor : -60;
    var cap = model.growth_cap !== undefined ? model.growth_cap : 60;
    return Math.min(cap, Math.max(floor, g));
  }
  function growthMult(row) {
    var g = clampGrowth(row.change_7d);
    var w = g > 0 ? (model.growth_weight_up || 0.4) : (model.growth_weight_down || 0.5);
    return 1 + w * g / 100;
  }
  function ageFor(row) {
    if (row.age_days === null || row.age_days === undefined) return model.unknown_age_days || 180;
    return row.age_days;
  }
  function maturityMult(row) {
    var floor = model.maturity_floor !== undefined ? model.maturity_floor : 0.6;
    var range = model.maturity_range !== undefined ? model.maturity_range : 0.4;
    var days = model.maturity_days || 365;
    return floor + range * (1 - Math.exp(-Math.max(0, ageFor(row)) / days));
  }
  function reachMult(row) {
    var per = model.reach_per_chain || 0.02;
    var max = model.reach_max_chains !== undefined ? model.reach_max_chains : 5;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), max);
    return 1 + per * extra;
  }
  function sizeBaseOf(row) {
    var a = fit.intercept !== undefined ? fit.intercept : 6.965;
    var b = fit.slope !== undefined ? fit.slope : 0.522;
    return Math.exp(a + b * Math.log(Math.max(1, row.tvl_usd)));
  }
  function tiltOf(row) {
    var lm = fit.category_log_median ? fit.category_log_median[row.category || 'Other'] : undefined;
    if (lm === undefined) return 1;
    var g = fit.global_log_median !== undefined ? fit.global_log_median : -1.544;
    return Math.exp(lm - g);
  }
  // Same arithmetic the board was built with, from the same raw inputs and the
  // same unrounded fit; the detail panel shows the check.
  function impliedOf(row) {
    return Math.max(1, Math.round(sizeBaseOf(row) * tiltOf(row) * growthMult(row) * maturityMult(row) * reachMult(row)));
  }

  /* ---------- small DOM helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function setText(id, text) {
    var n = document.getElementById(id);
    if (n) n.textContent = text;
  }

  /* ---------- header stats + model constants ---------- */
  setText('stat-asof', DATA.as_of || 'n/a');
  setText('stat-floor', fmtUsd(DATA.floor_usd));
  setText('stat-board', String(DATA.board_size || DATA.rows.length) + ' rows');
  setText('stat-watch', String(DATA.watchlist_size || 0) + ' / ' + String(DATA.watchlist_size || 0));
  setText('stat-comps', String((fit.comparables !== undefined ? fit.comparables : 0)) + ' live');
  setText('foot-asof', DATA.as_of || 'n/a');
  var consts = document.getElementById('model-consts');
  if (consts) {
    var a = fit.intercept !== undefined ? fit.intercept : 6.965;
    var b = fit.slope !== undefined ? fit.slope : 0.522;
    var items = [
      ['Size curve', 'log(mcap) = ' + a.toFixed(3) + ' + ' + b.toFixed(3) + ' x log(TVL), fitted on ' + (fit.comparables || 0) + ' live tokens'],
      ['Category tilt', 'Median mcap/TVL of the category, winsorized 0.01-3.00, shrunk to the market median below 4 tokens'],
      ['Growth', 'clamp 7d to ' + (model.growth_floor || -60) + '% .. +' + (model.growth_cap || 60) + '%; down x' + (model.growth_weight_down || 0.5) + ', up x' + (model.growth_weight_up || 0.4)],
      ['Maturity & reach', (model.maturity_floor || 0.6) + ' + ' + (model.maturity_range || 0.4) + ' x (1 - e^(-age/' + (model.maturity_days || 365) + ')); 1 + ' + (model.reach_per_chain || 0.02) + ' per extra chain, max ' + (model.reach_max_chains || 5)]
    ];
    consts.textContent = '';
    items.forEach(function (it) {
      var d = el('div');
      d.appendChild(el('dt', null, it[0]));
      d.appendChild(el('dd', null, it[1]));
      consts.appendChild(d);
    });
  }

  /* ---------- validation stats + comparables table ---------- */
  var val = DATA.validation || {};
  var vstats = document.getElementById('validation-stats');
  if (vstats && val.loo) {
    var vitems = [
      ['Leave-one-out (n=' + val.loo.n + ')', 'Median error ' + val.loo.median_abs_pct_error + '%, ' + val.loo.within_2x_pct + '% predicted within 2x'],
      ['Flat 0.25x rule, same check', 'Median error ' + val.loo_flat.median_abs_pct_error + '%, ' + val.loo_flat.within_2x_pct + '% within 2x'],
      ['Walk-forward (fit before 2025, test after, n=' + val.walk_forward_test_n + ')', 'Median error ' + val.walk_forward.median_abs_pct_error + '%, ' + val.walk_forward.within_2x_pct + '% within 2x (flat rule: ' + val.walk_forward_flat.median_abs_pct_error + '%)'],
      ['Rank ranges (' + val.bootstrap_refits + ' refits)', 'Top 10 rows move a median of ' + val.top10_median_range_width + ' ranks across refits']
    ];
    vstats.textContent = '';
    vitems.forEach(function (it) {
      var d = el('div');
      d.appendChild(el('dt', null, it[0]));
      d.appendChild(el('dd', null, it[1]));
      vstats.appendChild(d);
    });
  }
  setText('validation-note', 'No point predictor is precise: one live token\u2019s market cap varies roughly 200x around its category\u2019s median (the 10th to 90th percentile of all live ratios runs 0.01x to 2.95x), so an implied value is an order-of-magnitude guide. The fit is kept because it prices the board the way the market prices size and category, and the walk-forward check, the closest analogue to pricing a future launch, is where it beats the flat rule. The rank range on each row shows how far its rank moves when the comparables are resampled.');
  var compBody = document.getElementById('comp-body');
  if (compBody && DATA.comparables) {
    DATA.comparables.slice(0, 12).forEach(function (c) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, c.category));
      tr.appendChild(el('td', 'num', String(c.n)));
      tr.appendChild(el('td', 'num', fmtMult(c.median_ratio)));
      tr.appendChild(el('td', 'num', fmtMult(c.tilt)));
      tr.appendChild(el('td', 'num', fmtMult(c.p25_ratio) + ' - ' + fmtMult(c.p75_ratio)));
      compBody.appendChild(tr);
    });
  }

  /* ---------- filters ---------- */
  function uniqueSorted(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) { if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort();
  }
  function fillSelect(id, values) {
    var sel = document.getElementById(id);
    if (!sel) return;
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
  }
  fillSelect('f-category', uniqueSorted(DATA.rows.map(function (r) { return r.category || 'Other'; })));
  fillSelect('f-chain', uniqueSorted(DATA.rows.concat(DATA.live || []).reduce(function (acc, r) { return acc.concat(r.chains || []); }, [])));

  var searchInput = document.getElementById('f-search');
  var catSel = document.getElementById('f-category');
  var chainSel = document.getElementById('f-chain');
  var statusSel = document.getElementById('f-status');
  var minTvlInput = document.getElementById('f-min-tvl');
  var minImpInput = document.getElementById('f-min-imp');
  searchInput.addEventListener('input', function () { state.search = searchInput.value.trim().toLowerCase(); renderBoard(); });
  catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); renderBoard(); });
  chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); renderBoard(); });
  statusSel.addEventListener('change', function () { state.status = statusSel.value; writeHash(); renderBoard(); });
  minTvlInput.addEventListener('input', function () {
    var v = parseFloat(minTvlInput.value);
    state.minTvl = isFinite(v) && v > 0 ? v : 0;
    renderBoard();
  });
  minImpInput.addEventListener('input', function () {
    var v = parseFloat(minImpInput.value);
    state.minImp = isFinite(v) && v > 0 ? v : 0;
    renderBoard();
  });
  document.getElementById('f-reset').addEventListener('click', function () {
    state.search = ''; state.category = 'all'; state.chain = 'all'; state.status = 'pre'; state.minTvl = 0; state.minImp = 0;
    searchInput.value = ''; catSel.value = 'all'; chainSel.value = 'all'; statusSel.value = 'pre'; minTvlInput.value = ''; minImpInput.value = '';
    state.selected = null; closeBtn.hidden = true;
    detailBody.textContent = '';
    detailBody.appendChild(el('p', 'muted', 'Select a row on the board to see its model breakdown and farm plan here.'));
    writeHash();
    renderBoard();
  });

  /* ---------- filtering + sorting ---------- */
  function matchSearch(row) {
    if (!state.search) return true;
    return (row.name || '').toLowerCase().indexOf(state.search) >= 0 || (row.slug || '').toLowerCase().indexOf(state.search) >= 0;
  }
  function visibleRows() {
    var pre = DATA.rows.filter(function (r) {
      if (!matchSearch(r)) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (r.implied_value_usd < state.minImp) return false;
      return true;
    });
    var live = (DATA.live || []).filter(function (r) {
      if (!matchSearch(r)) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      return true;
    });
    if (state.status === 'pre') return { kind: 'pre', list: pre };
    if (state.status === 'live') return { kind: 'live', list: live };
    return { kind: 'mixed', list: pre, live: live };
  }
  function sortKey(row, key) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d === null || row.change_7d === undefined ? -Infinity : row.change_7d;
    if (key === 'age') return row.age_days === null || row.age_days === undefined ? Infinity : row.age_days;
    if (key === 'implied') return row.implied_value_usd !== undefined ? row.implied_value_usd : (row.mcap_usd || 0);
    if (key === 'range') return row.rank_lo !== undefined ? (row.rank_hi - row.rank_lo) : 0;
    return row.rank !== undefined ? row.rank : 0;
  }
  function sortList(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = sortKey(a, key), bv = sortKey(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      var as = a.slug || '', bs = b.slug || '';
      return as < bs ? -1 : as > bs ? 1 : 0;
    });
  }

  /* ---------- board table ---------- */
  var tbody = document.getElementById('board-body');
  var emptyMsg = document.getElementById('board-empty');
  var countEl = document.getElementById('result-count');
  var boardTitle = document.getElementById('board-h');

  function growthCell(row) {
    var td = el('td', 'num');
    var v = row.change_7d;
    if (v === null || v === undefined) { td.textContent = 'n/a'; return td; }
    td.textContent = fmtPct(v);
    td.classList.add(v >= 0 ? 'up' : 'down');
    return td;
  }
  function valueCell(row, max) {
    var td = el('td');
    var wrap = el('span');
    if (max > 0) {
      var bar = el('span', 'bar');
      var fill = el('i');
      fill.style.width = Math.max(3, Math.round((row.implied_value_usd / max) * 100)) + '%';
      bar.appendChild(fill);
      wrap.appendChild(bar);
    }
    wrap.appendChild(el('span', 'num', fmtUsd(row.implied_value_usd)));
    td.appendChild(wrap);
    return td;
  }
  function nameCell(row) {
    var td = el('td');
    var box = el('div', 'name');
    box.appendChild(el('b', null, row.name));
    box.appendChild(el('span', 'sub', (row.category || 'Other') + ' on ' + chainsText(row, 2)));
    td.appendChild(box);
    return td;
  }
  function rangeCell(row) {
    var td = el('td', 'num');
    if (row.rank_lo !== undefined && row.rank_hi !== undefined) td.textContent = row.rank_lo + '-' + row.rank_hi;
    else td.textContent = 'n/a';
    return td;
  }
  function preRow(row, max) {
    var tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.setAttribute('aria-selected', state.selected === row.slug ? 'true' : 'false');
    tr.appendChild(el('td', 'num', String(row.rank)));
    tr.appendChild(nameCell(row));
    tr.appendChild(el('td', 'num', fmtUsd(row.tvl_usd)));
    tr.appendChild(growthCell(row));
    tr.appendChild(el('td', 'num', fmtAge(row.age_days)));
    tr.appendChild(valueCell(row, max));
    tr.appendChild(rangeCell(row));
    var badgeTd = el('td');
    badgeTd.appendChild(el('span', 'badge badge-pre', 'Pre-token'));
    if (row.watchlist) badgeTd.appendChild(document.createTextNode(' '));
    if (row.watchlist) badgeTd.appendChild(el('span', 'badge badge-watch', 'Watchlist'));
    tr.appendChild(badgeTd);
    tr.addEventListener('click', function () { openDetail(row.slug); });
    tr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(row.slug); }
    });
    return tr;
  }
  function liveRow(row, i) {
    var tr = document.createElement('tr');
    tr.appendChild(el('td', 'num', String(i + 1)));
    tr.appendChild(nameCell(row));
    tr.appendChild(el('td', 'num', fmtUsd(row.tvl_usd)));
    tr.appendChild(growthCell(row));
    tr.appendChild(el('td', 'num', '—'));
    var td = el('td');
    td.appendChild(el('span', 'num', fmtUsd(row.mcap_usd)));
    tr.appendChild(td);
    tr.appendChild(el('td', 'num', '—'));
    var badgeTd = el('td');
    badgeTd.appendChild(el('span', 'badge badge-live', 'Live token'));
    tr.appendChild(badgeTd);
    return tr;
  }

  function renderBoard() {
    var vis = visibleRows();
    tbody.textContent = '';
    var total = 0;
    if (vis.kind === 'mixed') {
      boardTitle.textContent = 'The board — pre-token and live';
      var preSorted = sortList(vis.list);
      var max = preSorted.length ? preSorted[0].implied_value_usd : 0;
      preSorted.forEach(function (r) { tbody.appendChild(preRow(r, max)); });
      var liveSorted = sortList(vis.live);
      liveSorted.forEach(function (r, i) { tbody.appendChild(liveRow(r, i)); });
      total = preSorted.length + liveSorted.length;
    } else if (vis.kind === 'live') {
      boardTitle.textContent = 'Live tokens — already trading';
      sortList(vis.list).forEach(function (r, i) { tbody.appendChild(liveRow(r, i)); });
      total = vis.list.length;
    } else {
      boardTitle.textContent = 'The board';
      var sorted = sortList(vis.list);
      var maxV = sorted.length ? sorted[0].implied_value_usd : 0;
      sorted.forEach(function (r) { tbody.appendChild(preRow(r, maxV)); });
      total = sorted.length;
    }
    emptyMsg.hidden = total !== 0;
    var all = state.status === 'pre' ? DATA.rows.length : state.status === 'live' ? (DATA.live || []).length : DATA.rows.length + (DATA.live || []).length;
    countEl.textContent = total + ' of ' + all + ' shown';
    document.querySelectorAll('#board thead button').forEach(function (b) {
      b.setAttribute('aria-sort', b.getAttribute('data-sort') === state.sort ? (state.dir === 1 ? 'ascending' : 'descending') : 'none');
    });
  }

  document.querySelectorAll('#board thead button').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      renderBoard();
    });
  });

  /* ---------- live-token section (separate, by market cap) ---------- */
  function renderLive() {
    var body = document.getElementById('live-body');
    body.textContent = '';
    var live = (DATA.live || []).slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    live.forEach(function (r, i) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', 'num', String(i + 1)));
      tr.appendChild(nameCell(r));
      tr.appendChild(el('td', 'num', fmtUsd(r.tvl_usd)));
      tr.appendChild(growthCell(r));
      tr.appendChild(el('td', 'num', fmtUsd(r.mcap_usd)));
      var badgeTd = el('td');
      badgeTd.appendChild(el('span', 'badge badge-live', 'Live token'));
      tr.appendChild(badgeTd);
      body.appendChild(tr);
    });
  }

  /* ---------- detail panel ---------- */
  var detailBody = document.getElementById('detail-body');
  var closeBtn = document.getElementById('detail-close');
  closeBtn.addEventListener('click', function () {
    state.selected = null;
    closeBtn.hidden = true;
    detailBody.textContent = '';
    detailBody.appendChild(el('p', 'muted', 'Select a row on the board to see its model breakdown and farm plan here.'));
    writeHash();
    renderBoard();
    document.getElementById('detail').scrollIntoView();
  });

  function kvRow(dt, dd, total) {
    var d = el('div');
    d.appendChild(el('dt', null, dt));
    d.appendChild(el('dd', total ? 'total' : null, dd));
    return d;
  }
  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    closeBtn.hidden = false;
    detailBody.textContent = '';

    var head = el('div');
    head.appendChild(el('p', 'muted', 'Rank ' + row.rank + ' of ' + (DATA.board_size || DATA.rows.length) + '  ·  ' + (row.category || 'Other') + ' on ' + chainsText(row, 0) + (row.watchlist ? '  ·  Watchlist' : '')));
    var h = el('h3', null, row.name);
    h.style.fontSize = '24px';
    h.style.margin = '8px 0';
    head.appendChild(h);
    head.appendChild(el('p', 'muted', 'Listed ' + (row.listed_at || 'date not recorded') + '  ·  age ' + fmtAge(row.age_days) + '  ·  slug ' + row.slug + '  ·  rank range ' + row.rank_lo + '-' + row.rank_hi + ' across ' + (val.bootstrap_refits || 200) + ' refits'));
    detailBody.appendChild(head);

    var grid = el('div', 'detail-grid');
    var left = el('div');
    left.appendChild(el('h3', null, 'Model breakdown — radar-3'));
    var kv = el('dl', 'kv');
    var g = row.growth_multiplier !== undefined ? row.growth_multiplier : growthMult(row);
    var m = row.maturity_multiplier !== undefined ? row.maturity_multiplier : maturityMult(row);
    var rc = row.reach_multiplier !== undefined ? row.reach_multiplier : reachMult(row);
    kv.appendChild(kvRow('TVL', fmtFull(row.tvl_usd)));
    kv.appendChild(kvRow('7-day change', fmtPct(row.change_7d) + ' (clamped ' + fmtPct(clampGrowth(row.change_7d)) + ')'));
    kv.appendChild(kvRow('Size base (fitted curve)', fmtFull(sizeBaseOf(row))));
    kv.appendChild(kvRow('Category tilt (' + (row.category || 'Other') + ')', fmtMult(tiltOf(row))));
    kv.appendChild(kvRow('Growth multiplier', fmtMult(g)));
    kv.appendChild(kvRow('Maturity multiplier', fmtMult(m)));
    kv.appendChild(kvRow('Reach multiplier (' + (row.chains || []).length + ' chains)', fmtMult(rc)));
    kv.appendChild(kvRow('Implied value', fmtFull(row.implied_value_usd), true));
    kv.appendChild(kvRow('Rank range (10th-90th pct)', row.rank_lo + ' - ' + row.rank_hi));
    left.appendChild(kv);
    var recomputed = impliedOf(row);
    var check = el('p', 'check');
    check.appendChild(document.createTextNode('Page recomputes this row as ' + fmtFull(recomputed) + ' — '));
    var verdict = el('b', null, recomputed === row.implied_value_usd ? 'matches the board.' : 'differs from the board; treat the board figure as stale.');
    check.appendChild(verdict);
    left.appendChild(check);
    grid.appendChild(left);

    var right = el('div');
    right.appendChild(el('h3', null, 'Farm plan — how to farm it'));
    var cost = el('p', 'cost-line', 'Whole plan: about $' + (row.total_cost_usd || 0) + ' in total (capital plus gas over the hold window).');
    right.appendChild(cost);
    var steps = row.farm_steps || [];
    if (steps.length) {
      var ol = el('ol', 'steps');
      steps.forEach(function (s) { ol.appendChild(el('li', null, s)); });
      right.appendChild(ol);
    } else {
      right.appendChild(el('p', 'muted', 'No farm steps were supplied for this protocol.'));
    }
    grid.appendChild(right);
    detailBody.appendChild(grid);
    renderBoard();
    document.getElementById('detail').scrollIntoView();
  }

  /* ---------- deep link on load: filters first, then the detail if named ---------- */
  var deep = readHash();
  if (deep.detail || state.category !== 'all' || state.chain !== 'all' || state.status !== 'pre') {
    if (catSel) catSel.value = state.category;
    if (chainSel) chainSel.value = state.chain;
    if (statusSel) statusSel.value = state.status;
  }

  renderBoard();
  renderLive();
  if (deep.detail) openDetail(deep.detail);
})();
