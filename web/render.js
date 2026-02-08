/**
 * Server-side HTML generation for the checkout UI.
 * Single inline page with all CSS + JS — no external files, no build step.
 *
 * Design: monochrome minimal — DM Serif Display headings, black/white palette,
 * vertical card list with radio selection, bottom progress line.
 */

export function renderCheckoutPage(session) {
  const { id, items, estimatedTotal } = session;
  const needsConfirmation = items.filter(i => !i.autoConfirmed);

  const sessionJSON = JSON.stringify({
    id,
    items: items.map((item, idx) => ({
      idx,
      name: item.name,
      qty: item.qty,
      autoConfirmed: item.autoConfirmed,
      selectedProductId: item.selectedProductId,
      strategyLabel: item.strategyLabel,
      confidence: item.confidence,
      candidates: item.candidates.map(c => ({
        id: c.id,
        nw_product_id: c.nw_product_id,
        name: c.name,
        brand: c.brand,
        price: c.price,
        unit_size: c.unit_size,
        image_url: c.image_url,
        in_stock: c.in_stock,
        on_special: c.on_special,
        previouslyBought: c.previouslyBought,
      })),
    })),
    estimatedTotal,
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#fafafa">
<title>Checkout</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #fafafa;
  --surface: #f0f0ef;
  --text: #1d1d1f;
  --text-mid: #6e6e73;
  --text-muted: #a1a1a6;
  --border: #e5e5e7;
  --border-strong: #d2d2d7;
  --primary: #1d1d1f;
  --radius: 12px;
  --radius-sm: 10px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  min-height: 100dvh;
  -webkit-font-smoothing: antialiased;
}

/* ── Views ── */
.selection-view, .confirm-view {
  padding: 24px 20px;
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.selection-view.fading, .confirm-view.fading {
  opacity: 0; transform: translateY(6px);
}

/* ── Selection: item header ── */
.item-header { margin-bottom: 14px; animation: fadeUp 0.3s ease both; }
.item-name {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 36px; font-weight: 400;
  line-height: 1.05; color: var(--text);
  margin-bottom: 14px;
}
.item-sub {
  display: flex; align-items: center; gap: 14px;
  font-size: 12px; color: var(--text-muted);
  letter-spacing: 0.04em; text-transform: uppercase; font-weight: 500;
}
.item-sub::before, .item-sub::after {
  content: ''; flex: 1; height: 1px; background: var(--border);
}

/* ── Vertical card list ── */
.card-list { display: flex; flex-direction: column; gap: 8px; }

.product-card {
  display: flex; align-items: center; gap: 14px;
  background: #fff; border-radius: var(--radius);
  border: 1.5px solid var(--border);
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.12s;
  animation: fadeUp 0.3s ease both;
}
.product-card:nth-child(1) { animation-delay: 0ms; }
.product-card:nth-child(2) { animation-delay: 40ms; }
.product-card:nth-child(3) { animation-delay: 80ms; }
.product-card:nth-child(4) { animation-delay: 120ms; }
.product-card:nth-child(n+5) { animation-delay: 160ms; }
.product-card:active { transform: scale(0.985); }
.product-card.selected {
  border-color: var(--primary);
}

.card-img-wrap {
  width: 64px; height: 64px; flex-shrink: 0;
  border-radius: 8px; background: var(--surface);
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.card-img { width: 100%; height: 100%; object-fit: contain; }
.card-img.broken { display: none; }

.card-body { flex: 1; min-width: 0; }
.card-name {
  font-size: 15px; font-weight: 600; line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-detail {
  font-size: 13px; color: var(--text-muted); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.card-price {
  font-size: 17px; font-weight: 700; margin-top: 4px;
  letter-spacing: -0.02em;
}
.card-unit { font-weight: 400; font-size: 13px; color: var(--text-muted); }
.card-badges { display: flex; gap: 5px; margin-top: 5px; flex-wrap: wrap; }
.badge {
  font-size: 11px; font-weight: 500; padding: 2px 7px;
  border-radius: 4px;
}
.badge-special { background: #fef9ef; color: #a07b2e; }
.badge-bought { background: var(--surface); color: var(--text-mid); }
.badge-oos { background: #fef0f0; color: #c53030; }
.badge-match {
  background: var(--primary); color: #fff;
  font-weight: 600; text-transform: uppercase; font-size: 9px;
  letter-spacing: 0.06em; padding: 3px 6px;
}

.card-radio {
  width: 22px; height: 22px; flex-shrink: 0;
  border: 2px solid var(--border-strong); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.2s, background 0.2s;
}
.product-card.selected .card-radio {
  border-color: var(--primary); background: var(--primary);
}
.card-radio-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: white; opacity: 0; transition: opacity 0.2s;
}
.product-card.selected .card-radio-dot { opacity: 1; }

.show-all-btn {
  display: block; width: 100%; margin-top: 8px;
  padding: 12px; background: none; border: 1.5px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-muted); font-size: 14px; font-weight: 500;
  cursor: pointer; transition: border-color 0.15s;
  animation: fadeUp 0.3s ease both; animation-delay: 140ms;
}
.show-all-btn:active { border-color: var(--text-muted); }

.nav-buttons {
  display: flex; gap: 10px; margin-top: 28px;
  animation: fadeUp 0.3s ease both; animation-delay: 180ms;
}
.nav-btn {
  flex: 1; padding: 15px; border: none; border-radius: var(--radius-sm);
  font-size: 16px; font-weight: 600; cursor: pointer;
  transition: opacity 0.15s, transform 0.12s;
}
.nav-btn:active { transform: scale(0.97); }
.btn-back { background: var(--surface); color: var(--text-mid); }
.btn-next { background: var(--primary); color: #fff; }
.btn-next:disabled { background: var(--border); color: var(--text-muted); }

/* ── Confirmation ── */
.confirm-view { padding-bottom: 110px; }
.confirm-header {
  margin-bottom: 20px;
  animation: fadeUp 0.3s ease both;
}
.confirm-title {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 32px; font-weight: 400;
}
.confirm-subtitle {
  font-size: 14px; color: var(--text-muted); margin-top: 4px;
}
.confirm-list { display: flex; flex-direction: column; gap: 6px; }
.confirm-item {
  display: flex; align-items: center; gap: 12px;
  background: #fff; border-radius: var(--radius-sm);
  padding: 10px 12px; cursor: pointer;
  border: 1.5px solid var(--border);
  transition: border-color 0.15s, transform 0.12s;
  animation: fadeUp 0.3s ease both;
}
.confirm-item:nth-child(1) { animation-delay: 30ms; }
.confirm-item:nth-child(2) { animation-delay: 60ms; }
.confirm-item:nth-child(3) { animation-delay: 90ms; }
.confirm-item:nth-child(4) { animation-delay: 120ms; }
.confirm-item:nth-child(5) { animation-delay: 150ms; }
.confirm-item:nth-child(n+6) { animation-delay: 180ms; }
.confirm-item:active { transform: scale(0.98); border-color: var(--primary); }

.confirm-img-wrap {
  width: 48px; height: 48px; flex-shrink: 0;
  border-radius: 6px; background: var(--surface); overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.confirm-img { width: 100%; height: 100%; object-fit: contain; }
.confirm-img.broken { display: none; }
.confirm-info { flex: 1; min-width: 0; }
.confirm-name {
  font-size: 14px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.confirm-orig { font-size: 12px; color: var(--text-muted); margin-top: 1px; }
.confirm-right { flex-shrink: 0; text-align: right; }
.confirm-price { font-size: 15px; font-weight: 700; }
.confirm-qty { font-size: 12px; color: var(--text-muted); }
.confirm-edit {
  font-size: 11px; color: var(--text-muted); font-weight: 500;
  margin-top: 2px;
}

.confirm-unresolved {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg); border-radius: var(--radius-sm); padding: 10px 12px;
  border: 1.5px dashed var(--border-strong);
  animation: fadeUp 0.3s ease both;
}
.confirm-unresolved-icon {
  width: 48px; height: 48px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; color: var(--text-muted);
  background: var(--surface); border-radius: 6px;
}

/* ── Bottom bar ── */
.bottom-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: #fff;
  border-top: 1px solid var(--border);
  padding: 12px 20px 0;
  z-index: 100;
  animation: slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: 250ms;
}
.submit-btn {
  width: 100%; padding: 16px; border: none; border-radius: var(--radius-sm);
  background: var(--primary); color: #fff;
  font-size: 16px; font-weight: 600; cursor: pointer;
  transition: opacity 0.15s, transform 0.12s;
}
.submit-btn:active { transform: scale(0.98); opacity: 0.85; }
.submit-btn:disabled {
  background: var(--border); color: var(--text-muted); cursor: default;
}
.bar-progress {
  height: 2px; background: var(--border);
  margin: 12px -20px 0; /* bleed to edges */
  margin-bottom: max(0px, env(safe-area-inset-bottom));
}
.bar-progress-fill {
  height: 100%; background: var(--primary);
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ── Standalone progress line (selection view) ── */
.progress-line {
  position: fixed; bottom: 0; left: 0; right: 0;
  height: 2px; background: var(--border);
  z-index: 100;
}
.progress-line-fill {
  height: 100%; background: var(--primary);
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ── Overlay ── */
.overlay {
  position: fixed; inset: 0;
  background: rgba(250,250,250,0.98);
  z-index: 200; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 32px;
  animation: fadeIn 0.3s ease;
}
.spinner {
  width: 40px; height: 40px;
  border: 2.5px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  margin-bottom: 24px;
}
.overlay-status {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 18px; font-weight: 400;
  color: var(--text); text-align: center;
}
.overlay-detail {
  font-size: 14px; color: var(--text-muted);
  margin-top: 6px; text-align: center;
}

.done-icon {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; margin-bottom: 20px;
  animation: scaleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.done-icon-ok { background: var(--surface); color: var(--primary); }
.done-icon-err { background: #fef0f0; color: #c53030; }
.done-title {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 28px; font-weight: 400; margin-bottom: 8px;
}
.done-detail {
  font-size: 15px; color: var(--text-mid);
  line-height: 1.5; text-align: center;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.5); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes spin { to { transform: rotate(360deg); } }

.hidden { display: none !important; }
</style>
</head>
<body>

<div id="selection-view" class="selection-view hidden"></div>
<div id="confirm-view" class="confirm-view hidden"></div>
<div id="progress-line" class="progress-line hidden">
  <div class="progress-line-fill" id="progress-fill" style="width:0"></div>
</div>
<div id="overlay" class="overlay hidden"></div>

<script>
var SESSION = ${sessionJSON};
var currentStep = 0;
var needsConfirmation = [];
var allItems = SESSION.items;
var transitioning = false;

for (var i = 0; i < allItems.length; i++) {
  if (!allItems[i].autoConfirmed) needsConfirmation.push(i);
}

function init() {
  if (needsConfirmation.length > 0) {
    showSelection(0);
  } else {
    showConfirmation();
  }
}

function setProgress(fraction) {
  var el = document.getElementById('progress-fill');
  if (el) el.style.width = (fraction * 100) + '%';
  var barEl = document.getElementById('bar-progress-fill');
  if (barEl) barEl.style.width = (fraction * 100) + '%';
}

function fadeSwap(el, buildFn) {
  if (transitioning) return;
  transitioning = true;
  el.classList.add('fading');
  setTimeout(function() {
    buildFn();
    window.scrollTo({ top: 0, behavior: 'instant' });
    el.classList.remove('fading');
    transitioning = false;
  }, 180);
}

function showSelection(stepIdx) {
  currentStep = stepIdx;
  if (stepIdx >= needsConfirmation.length) { showConfirmation(); return; }

  var itemIdx = needsConfirmation[stepIdx];
  var item = allItems[itemIdx];
  var el = document.getElementById('selection-view');
  var confirmEl = document.getElementById('confirm-view');
  confirmEl.classList.add('hidden');

  // Show standalone progress line during selection
  document.getElementById('progress-line').classList.remove('hidden');

  var build = function() {
    el.classList.remove('hidden');
    setProgress((stepIdx + 1) / needsConfirmation.length);

    var initialShow = 3;
    var hasMore = item.candidates.length > initialShow;
    var stepLabel = (stepIdx + 1) + ' / ' + needsConfirmation.length;

    var subText = 'Choose a product';
    if (item.strategyLabel === 'Previously bought' || item.strategyLabel === 'History match') subText = 'Based on your purchases';
    else if (item.strategyLabel === 'Lowest price') subText = 'Lowest price options';
    else if (item.strategyLabel === 'On special') subText = 'On special this week';
    else if (item.strategyLabel === 'Low confidence') subText = 'Best guesses';

    el.innerHTML = '<div class="item-header">' +
      '<div class="item-name">' + sentenceCase(esc(item.name)) + '</div>' +
      '<div class="item-sub">' + subText + '</div>' +
    '</div>' +
    '<div class="card-list" id="card-list">' +
      item.candidates.slice(0, initialShow).map(function(c, ci) { return productCard(c, item.selectedProductId, ci); }).join('') +
    '</div>' +
    (hasMore ? '<button class="show-all-btn" id="show-all">Show all ' + item.candidates.length + ' options</button>' : '') +
    '<div class="nav-buttons">' +
      (stepIdx > 0 ? '<button class="nav-btn btn-back" id="back-btn">Back</button>' : '') +
      '<button class="nav-btn btn-next" id="next-btn"' + (!item.selectedProductId ? ' disabled' : '') + '>Next</button>' +
    '</div>';

    bindCardClicks(el, itemIdx);

    if (hasMore) {
      document.getElementById('show-all').addEventListener('click', function() {
        var list = document.getElementById('card-list');
        list.innerHTML = item.candidates.map(function(c, ci) { return productCard(c, item.selectedProductId, ci); }).join('');
        bindCardClicks(el, itemIdx);
        this.remove();
      });
    }

    var backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.addEventListener('click', function() {
      fadeSwap(el, function() { showSelection(stepIdx - 1); });
    });
    document.getElementById('next-btn').addEventListener('click', function() { advanceStep(); });
  };

  if (!el.classList.contains('hidden')) {
    fadeSwap(el, build);
  } else {
    build();
  }
}

function bindCardClicks(container, itemIdx) {
  container.querySelectorAll('.product-card').forEach(function(card) {
    card.addEventListener('click', function() { selectCard(itemIdx, card.dataset.productId); });
  });
}

function selectCard(itemIdx, productId) {
  var item = allItems[itemIdx];
  item.selectedProductId = productId;
  item.autoConfirmed = true;

  document.querySelectorAll('.product-card').forEach(function(c) {
    c.classList.toggle('selected', c.dataset.productId === productId);
  });
  var nextBtn = document.getElementById('next-btn');
  if (nextBtn) nextBtn.disabled = false;

  fetch('/api/checkout/' + SESSION.id + '/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIndex: itemIdx, productId: productId }),
  }).catch(function() {});

  setTimeout(function() { advanceStep(); }, 300);
}

function advanceStep() {
  var el = document.getElementById('selection-view');
  if (currentStep + 1 < needsConfirmation.length) {
    fadeSwap(el, function() { showSelection(currentStep + 1); });
  } else {
    showConfirmation();
  }
}

function showConfirmation() {
  var selEl = document.getElementById('selection-view');
  selEl.classList.add('hidden');
  // Hide standalone progress line
  document.getElementById('progress-line').classList.add('hidden');

  var el = document.getElementById('confirm-view');
  el.classList.remove('hidden');

  var total = 0;
  var resolvedCount = 0;
  var allMatched = needsConfirmation.length === 0;

  var subtitle = allMatched
    ? 'Matched all ' + allItems.length + ' items'
    : 'Tap any item to change';

  var html = '<div class="confirm-header">' +
    '<div class="confirm-title">Your cart</div>' +
    '<div class="confirm-subtitle">' + subtitle + '</div>' +
  '</div><div class="confirm-list">';

  for (var i = 0; i < allItems.length; i++) {
    var item = allItems[i];
    var product = item.selectedProductId
      ? item.candidates.find(function(c) { return String(c.id) === String(item.selectedProductId); })
      : null;

    if (product) {
      resolvedCount++;
      var lineTotal = (product.price || 0) * item.qty;
      total += lineTotal;
      var imgHtml = product.image_url
        ? '<img class="confirm-img" src="' + esc(product.image_url) + '" loading="lazy" onerror="this.classList.add(\\'broken\\')">'
        : '';

      html += '<div class="confirm-item" data-item-idx="' + i + '">' +
        '<div class="confirm-img-wrap">' + imgHtml + '</div>' +
        '<div class="confirm-info">' +
          '<div class="confirm-name">' + esc(product.name) + '</div>' +
          '<div class="confirm-orig">' + esc(item.name) + (item.qty > 1 ? ' x' + item.qty : '') + '</div>' +
        '</div>' +
        '<div class="confirm-right">' +
          '<div class="confirm-price">$' + lineTotal.toFixed(2) + '</div>' +
          (item.qty > 1 ? '<div class="confirm-qty">$' + (product.price || 0).toFixed(2) + ' ea</div>' : '') +
          '<div class="confirm-edit">edit</div>' +
        '</div>' +
      '</div>';
    } else {
      html += '<div class="confirm-unresolved">' +
        '<div class="confirm-unresolved-icon">?</div>' +
        '<div class="confirm-info">' +
          '<div class="confirm-name">' + esc(item.name) + '</div>' +
          '<div class="confirm-orig">No match found</div>' +
        '</div>' +
      '</div>';
    }
  }

  html += '</div>';
  html += '<div class="bottom-bar">' +
    '<button class="submit-btn" id="submit-btn"' + (resolvedCount === 0 ? ' disabled' : '') + '>' +
      'Add to cart \\u2014 $' + total.toFixed(2) +
    '</button>' +
    '<div class="bar-progress"><div class="bar-progress-fill" id="bar-progress-fill" style="width:100%"></div></div>' +
  '</div>';

  el.innerHTML = html;

  el.querySelectorAll('.confirm-item').forEach(function(row) {
    row.addEventListener('click', function() {
      var idx = parseInt(row.dataset.itemIdx);
      var stepIdx = needsConfirmation.indexOf(idx);
      if (stepIdx === -1) {
        needsConfirmation.push(idx);
        stepIdx = needsConfirmation.length - 1;
      }
      el.classList.add('hidden');
      showSelection(stepIdx);
    });
  });

  var submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.addEventListener('click', submitCart);
}

function submitCart() {
  var overlay = document.getElementById('overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = '<div class="spinner"></div>' +
    '<div class="overlay-status" id="sse-status">Connecting...</div>' +
    '<div class="overlay-detail" id="sse-detail"></div>';

  var evtSource = new EventSource('/api/checkout/' + SESSION.id + '/events');
  evtSource.onmessage = function(e) {
    try {
      var data = JSON.parse(e.data);
      var statusEl = document.getElementById('sse-status');
      var detailEl = document.getElementById('sse-detail');
      if (data.type === 'progress') {
        statusEl.textContent = data.message || 'Working...';
        if (data.detail) detailEl.textContent = data.detail;
      } else if (data.type === 'done') {
        evtSource.close();
        showDone(data);
      } else if (data.type === 'error') {
        evtSource.close();
        showError(data.message || 'Something went wrong');
      }
    } catch(ex) {}
  };
  evtSource.onerror = function() { evtSource.close(); };

  fetch('/api/checkout/' + SESSION.id + '/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }).catch(function() {});
}

function showDone(data) {
  var overlay = document.getElementById('overlay');
  overlay.innerHTML = '<div class="done-icon done-icon-ok">&#10003;</div>' +
    '<div class="done-title">Added to cart</div>' +
    '<div class="done-detail">' +
      (data.added || 0) + ' item' + ((data.added || 0) !== 1 ? 's' : '') + ' added' +
      (data.failed ? ', ' + data.failed + ' failed' : '') +
      (data.total ? '<br>~$' + data.total : '') +
    '</div>';
}

function showError(msg) {
  var overlay = document.getElementById('overlay');
  overlay.innerHTML = '<div class="done-icon done-icon-err">&#10007;</div>' +
    '<div class="done-title">Error</div>' +
    '<div class="done-detail">' + esc(msg) + '</div>';
}

function productCard(product, selectedId, index) {
  var selected = String(product.id) === String(selectedId);
  var isWeight = product.nw_product_id && product.nw_product_id.indexOf('_kgm_') !== -1;
  var unitLabel = isWeight ? '/kg' : '';

  var imgHtml = product.image_url
    ? '<img class="card-img" src="' + esc(product.image_url) + '" loading="lazy" onerror="this.classList.add(\\'broken\\')">'
    : '';

  var detailParts = [];
  if (product.brand) detailParts.push(esc(product.brand));
  if (product.unit_size) detailParts.push(esc(product.unit_size));
  var detail = detailParts.join(' \\u00b7 ');

  var matchLabel = (index === 0 && selected)
    ? '<div style="margin-bottom:3px"><span class="badge badge-match">Best match</span></div>'
    : '';

  var badges = '';
  if (product.on_special) badges += '<span class="badge badge-special">Special</span>';
  if (product.previouslyBought) badges += '<span class="badge badge-bought">Bought before</span>';
  if (!product.in_stock) badges += '<span class="badge badge-oos">Out of stock</span>';

  return '<div class="product-card' + (selected ? ' selected' : '') + '" data-product-id="' + product.id + '">' +
    '<div class="card-img-wrap">' + imgHtml + '</div>' +
    '<div class="card-body">' +
      matchLabel +
      '<div class="card-name">' + esc(product.name) + '</div>' +
      (detail ? '<div class="card-detail">' + detail + '</div>' : '') +
      '<div class="card-price">$' + (product.price || 0).toFixed(2) +
        (unitLabel ? '<span class="card-unit"> ' + unitLabel + '</span>' : '') +
      '</div>' +
      (badges ? '<div class="card-badges">' + badges + '</div>' : '') +
    '</div>' +
    '<div class="card-radio"><div class="card-radio-dot"></div></div>' +
  '</div>';
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sentenceCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

init();
</script>
</body>
</html>`;
}

export function renderNotFound() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#fafafa">
<title>Not Found</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  background: #fafafa; color: #1d1d1f;
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; min-height: 100dvh;
}
.c { text-align: center; animation: fadeUp 0.4s ease both; }
.icon {
  width: 64px; height: 64px; border-radius: 50%;
  background: #f0f0ef; color: #a1a1a6;
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; margin: 0 auto 16px;
}
.t {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 24px; font-weight: 400; margin-bottom: 6px;
}
.m { font-size: 15px; color: #a1a1a6; }
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
</head>
<body>
<div class="c">
  <div class="icon">?</div>
  <div class="t">Session not found</div>
  <div class="m">This link has expired or is invalid</div>
</div>
</body>
</html>`;
}
