/**
 * Grab n Go — Vendor Portal & Kitchen Display System (KDS)
 * Role: Food Court Outlet Kitchen Staff & Counter Operators
 * Connects with /api/v1/orders and /api/v1/vendor/orders
 */

const VendorState = {
  vendorSession: null, // { outletId, outletName, staffRole }
  kdsOrders: [],
  searchQuery: '',
  currentView: 'active', // 'active' | 'completed'
  rushModeActive: false,
  outOfStockItemIds: new Set(),
  menuCategories: [],
  pollIntervalId: null,
  audioEnabled: true
};

document.addEventListener('DOMContentLoaded', () => {
  initAuthForm();
  initClock();
  renderKDS();
  checkVendorSession();
});

// Live KDS Clock
function initClock() {
  function tick() {
    const clockEl = document.getElementById('kds-live-clock');
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }
  tick();
  setInterval(tick, 1000);
}

async function checkVendorSession() {
  const saved = localStorage.getItem('grabngo_vendor_session');
  if (!saved) { showAuth(); return; }
  try {
    const cached = JSON.parse(saved);
    if (!cached?.token) throw new Error('Vendor session has no API token');
    const response = await fetch('/api/v1/vendor/auth/me', {
      headers: { Authorization: `Bearer ${cached.token}` }
    });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.message || 'Vendor session expired');
    VendorState.vendorSession = { ...json.data.session, token: cached.token };
    localStorage.setItem('grabngo_vendor_session', JSON.stringify(VendorState.vendorSession));
    showMainKDS();
    startLivePolling();
  } catch (err) {
    localStorage.removeItem('grabngo_vendor_session');
    VendorState.vendorSession = null;
    showAuth();
    showToast('Please sign in to the vendor terminal again.', '⚠️');
  }
}

function vendorAuthHeaders(extra = {}) {
  const token = VendorState.vendorSession?.token;
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}


async function fetchVendorMenu() {
  if (!VendorState.vendorSession?.outletId) return;
  try {
    const response = await fetch(
      `/api/v1/outlets/${encodeURIComponent(VendorState.vendorSession.outletId)}/menu`
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.success) {
      throw new Error(json.message || 'Could not load outlet menu');
    }

    VendorState.menuCategories = Array.isArray(json.data.categories)
      ? json.data.categories
      : [];
    VendorState.outOfStockItemIds = new Set(
      VendorState.menuCategories.flatMap(category =>
        (category.items || [])
          .filter(item => item.isAvailable === false)
          .map(item => item.name)
      )
    );
    render86List();
  } catch (error) {
    console.error('Vendor menu load failed:', error);
    showToast(error.message || 'Could not load stock list.', '⚠️');
  }
}


function showAuth() {
  const authView = document.getElementById('vendor-auth-view');
  const mainView = document.getElementById('vendor-main-view');
  if (authView) authView.style.display = 'flex';
  if (mainView) mainView.style.display = 'none';
}

function showMainKDS() {
  const authView = document.getElementById('vendor-auth-view');
  const mainView = document.getElementById('vendor-main-view');
  if (authView) authView.style.display = 'none';
  if (mainView) mainView.style.display = 'block';

  if (VendorState.vendorSession) {
    const titleEl = document.getElementById('kds-outlet-title');
    const tagEl = document.getElementById('kds-outlet-tag');
    if (titleEl) titleEl.textContent = `${VendorState.vendorSession.outletName} — Kitchen Display System (KDS)`;
    if (tagEl) tagEl.textContent = `Outlet: ${VendorState.vendorSession.outletName}`;
  }
  renderKDS();
  fetchLiveOrders();
  fetchVendorMenu();
}


function initAuthForm() {
  const form = document.getElementById('vendor-login-form');

  if (form) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const email = document.getElementById('vendor-input-email').value.trim();
      const password = document.getElementById('vendor-input-password').value;
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        await loginVendor(email, password);
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  const logoutBtn = document.getElementById('btn-vendor-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('grabngo_vendor_session');
      VendorState.vendorSession = null;
      VendorState.kdsOrders = [];
      stopLivePolling();
      renderKDS();
      showToast('Logged out of Vendor KDS', '👋');
      showAuth();
    });
  }
}

async function loginVendor(email, password) {
  try {
    const response = await fetch('/api/v1/vendor/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.success) {
      throw new Error(json.message || 'Vendor sign-in failed');
    }

    VendorState.vendorSession = {
      ...json.data.session,
      token: json.data.token
    };
    localStorage.setItem('grabngo_vendor_session', JSON.stringify(VendorState.vendorSession));
    showToast(`Signed in to ${VendorState.vendorSession.outletName} KDS`, '🍳');
    showMainKDS();
    startLivePolling();
  } catch (error) {
    showToast(error.message || 'Could not sign in to vendor terminal.', '⚠️');
  }
}

function escapeVendorHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\"': '&quot;',
    "'": '&#39;'
  }[char]));
}

// Toast System
function showToast(message, icon = '🍳') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.innerHTML = `<span>${escapeVendorHtml(icon)}</span> <span></span>`;
  toast.lastElementChild.textContent = String(message);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Kitchen Audio Chime
function playKitchenChime() {
  if (!VendorState.audioEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.45);
  } catch(e) {}
}

function toggleAudioChime() {
  VendorState.audioEnabled = !VendorState.audioEnabled;
  const btn = document.getElementById('btn-toggle-sound');
  if (btn) {
    btn.innerHTML = VendorState.audioEnabled ? '🔔 Sound ON' : '🔕 Sound MUTED';
    btn.style.color = VendorState.audioEnabled ? '#fbbf24' : '#94a3b8';
  }
  showToast(VendorState.audioEnabled ? 'Audio chime alerts enabled' : 'Audio chime alerts muted', '🔔');
}

// Live Polling
function startLivePolling() {
  if (VendorState.pollIntervalId) clearInterval(VendorState.pollIntervalId);
  VendorState.pollIntervalId = setInterval(fetchLiveOrders, 3000);
}

function stopLivePolling() {
  if (VendorState.pollIntervalId) {
    clearInterval(VendorState.pollIntervalId);
    VendorState.pollIntervalId = null;
  }
}

async function fetchLiveOrders() {
  if (!VendorState.vendorSession) return;
  try {
    const res = await fetch(`/api/v1/vendor/orders?outletId=${encodeURIComponent(VendorState.vendorSession.outletId)}`, {
      headers: vendorAuthHeaders()
    });
    const json = await res.json();
    if (res.status === 401) {
      stopLivePolling();
      localStorage.removeItem('grabngo_vendor_session');
      VendorState.vendorSession = null;
      showAuth();
      showToast('Vendor session expired. Please sign in again.', '⚠️');
      return;
    }
    if (!res.ok || !json.success) throw new Error(json.message || 'Could not load orders');
    const incoming = Array.isArray(json.data) ? json.data : [];
    const oldIds = new Set(VendorState.kdsOrders.map(o => o.id));
    if (incoming.some(o => !oldIds.has(o.id))) playKitchenChime();
    VendorState.kdsOrders = incoming;
    renderKDS();
  } catch (err) {
    console.error('KDS refresh failed:', err);
    showToast('Unable to sync with the server. Check connection.', '⚠️');
  }
}

// Helper: Diet classification
function isItemVeg(name) {
  if (!name) return true;
  const lower = name.toLowerCase();
  if (lower.includes('chicken') || lower.includes('egg') || lower.includes('mutton') || lower.includes('fish') || lower.includes('prawn')) {
    return false;
  }
  return true;
}

// Helper: Elapsed Cooking Time Badge
function getElapsedBadge(order) {
  let placedDate;
  if (order.placedAt && order.placedAt.includes('T')) {
    placedDate = new Date(order.placedAt);
  } else {
    placedDate = new Date(); // fallback
  }

  const elapsedMins = Math.max(0, Math.floor((Date.now() - placedDate.getTime()) / 60000));
  
  if (elapsedMins < 5) {
    return `<span class="ticket-time-chip chip-fresh">🟢 ${elapsedMins}m in kitchen</span>`;
  } else if (elapsedMins <= 12) {
    return `<span class="ticket-time-chip chip-normal">🟡 ${elapsedMins}m in kitchen</span>`;
  } else {
    return `<span class="ticket-time-chip chip-urgent">🔥 ${elapsedMins}m in kitchen (RUSH)</span>`;
  }
}

// Filter and View Switching
function filterKDSTickets() {
  const input = document.getElementById('kds-search-input');
  VendorState.searchQuery = input ? input.value.trim().toLowerCase() : '';
  renderKDS();
}

function switchKDSView(viewName) {
  VendorState.currentView = viewName;
  const tabActive = document.getElementById('tab-btn-active');
  const tabCompleted = document.getElementById('tab-btn-completed');
  if (tabActive) tabActive.classList.toggle('active', viewName === 'active');
  if (tabCompleted) tabCompleted.classList.toggle('active', viewName === 'completed');

  const pipelineView = document.getElementById('kds-pipeline-view');
  const completedView = document.getElementById('kds-completed-view');

  if (viewName === 'active') {
    if (pipelineView) pipelineView.style.display = 'grid';
    if (completedView) completedView.style.display = 'none';
  } else {
    if (pipelineView) pipelineView.style.display = 'none';
    if (completedView) completedView.style.display = 'block';
  }
  renderKDS();
}

// Render KDS Board
function renderKDS() {
  // 1. Update Stats Strip
  const allOrders = VendorState.kdsOrders;
  const activeOrders = allOrders.filter(o => o.status === 'PLACED' || o.status === 'PREPARING' || o.status === 'CONFIRMED' || o.status === 'READY_FOR_PICKUP');
  const byQueueOrder = (a, b) => {
    if (Number.isInteger(a.queuePosition) && Number.isInteger(b.queuePosition)) return a.queuePosition - b.queuePosition;
    const aSequence = Number(String(a.token || '').match(/-(\d+)$/)?.[1] || Number.MAX_SAFE_INTEGER);
    const bSequence = Number(String(b.token || '').match(/-(\d+)$/)?.[1] || Number.MAX_SAFE_INTEGER);
    return aSequence - bSequence;
  };
  const incoming = allOrders.filter(o => o.status === 'PLACED').sort(byQueueOrder);
  const cooking = allOrders.filter(o => o.status === 'PREPARING' || o.status === 'CONFIRMED').sort(byQueueOrder);
  const ready = allOrders.filter(o => o.status === 'READY_FOR_PICKUP').sort(byQueueOrder);
  const completed = allOrders.filter(o => o.status === 'COMPLETED');

  const activeStatEl = document.getElementById('kds-stat-active-count');
  const cookingStatEl = document.getElementById('kds-stat-cooking-count');
  const readyStatEl = document.getElementById('kds-stat-ready-count');
  const completedStatEl = document.getElementById('kds-stat-completed-count');

  if (activeStatEl) activeStatEl.textContent = activeOrders.length;
  if (cookingStatEl) cookingStatEl.textContent = cooking.length;
  if (readyStatEl) readyStatEl.textContent = ready.length;
  if (completedStatEl) completedStatEl.textContent = completed.length;

  const countIncomingEl = document.getElementById('kds-count-incoming');
  const countCookingEl = document.getElementById('kds-count-cooking');
  const countReadyEl = document.getElementById('kds-count-ready');

  if (countIncomingEl) countIncomingEl.textContent = incoming.length;
  if (countCookingEl) countCookingEl.textContent = cooking.length;
  if (countReadyEl) countReadyEl.textContent = ready.length;

  // Apply Search Filter if any
  const applyFilter = (ordersList) => {
    if (!VendorState.searchQuery) return ordersList;
    const q = VendorState.searchQuery;
    return ordersList.filter(o => {
      const matchToken = (o.token || '').toLowerCase().includes(q);
      const matchStudent = (o.studentName || '').toLowerCase().includes(q) || (o.studentRoll || '').toLowerCase().includes(q);
      let items = o.items || [];
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch(e) { items = []; }
      }
      const matchItems = Array.isArray(items) && items.some(i => ((i.name || i.dishName || '').toLowerCase().includes(q)));
      return matchToken || matchStudent || matchItems;
    });
  };

  const filteredIncoming = applyFilter(incoming);
  const filteredCooking = applyFilter(cooking);
  const filteredReady = applyFilter(ready);
  const filteredCompleted = applyFilter(completed);

  // 2. Render Pipeline Columns
  const colIncoming = document.getElementById('kds-incoming-list');
  const colCooking = document.getElementById('kds-cooking-list');
  const colReady = document.getElementById('kds-ready-list');

  if (colIncoming) {
    colIncoming.innerHTML = filteredIncoming.map(order => createKDSTicketHtml(order, 'incoming')).join('') || 
      '<div class="kds-empty-column"><div style="font-size: 2rem; margin-bottom: 0.5rem;">📥</div><strong style="color: #cbd5e1;">No incoming tickets</strong><p style="font-size: 0.78rem; color: #64748b; margin-top: 0.25rem;">New pre-orders will pop in here instantly with kitchen chime</p></div>';
  }

  if (colCooking) {
    colCooking.innerHTML = filteredCooking.map(order => createKDSTicketHtml(order, 'cooking')).join('') || 
      '<div class="kds-empty-column"><div style="font-size: 2rem; margin-bottom: 0.5rem;">🍳</div><strong style="color: #cbd5e1;">All caught up on stoves</strong><p style="font-size: 0.78rem; color: #64748b; margin-top: 0.25rem;">Accept tickets from incoming to move dishes here</p></div>';
  }

  if (colReady) {
    colReady.innerHTML = filteredReady.map(order => createKDSTicketHtml(order, 'ready')).join('') || 
      '<div class="kds-empty-column"><div style="font-size: 2rem; margin-bottom: 0.5rem;">🔔</div><strong style="color: #cbd5e1;">Express pickup lane is clear</strong><p style="font-size: 0.78rem; color: #64748b; margin-top: 0.25rem;">Cooked meals waiting for student collection will appear here</p></div>';
  }

  // 3. Render Completed View
  const completedList = document.getElementById('kds-completed-list');
  if (completedList) {
    completedList.innerHTML = filteredCompleted.map(order => createKDSTicketHtml(order, 'completed')).join('') || 
      '<div style="color: #64748b; font-size: 0.88rem; text-align: center; grid-column: 1/-1; padding: 3rem;">No orders completed yet today</div>';
  }
}

function createKDSTicketHtml(order, stage) {
  let actionButton = '';
  const orderIdentifier = order.id || order.token;

  if (stage === 'incoming') {
    actionButton = `<button class="ticket-action-btn btn-start-cooking" onclick="transitionKDSOrder('${orderIdentifier}', 'PREPARING')">🍳 Accept & Start Cooking ➔</button>`;
  } else if (stage === 'cooking') {
    actionButton = `<button class="ticket-action-btn btn-mark-ready" onclick="transitionKDSOrder('${orderIdentifier}', 'READY_FOR_PICKUP')">🔔 Notify Ready for Pickup ➔</button>`;
  } else if (stage === 'ready') {
    actionButton = `<button class="ticket-action-btn btn-mark-handover" onclick="openPickupVerification('${orderIdentifier}')">🔐 Verify PIN & Hand Over</button>`;
  } else if (stage === 'completed') {
    actionButton = `<div style="text-align: center; color: #34d399; font-weight: 800; font-size: 0.82rem; padding: 0.55rem; background: rgba(16, 185, 129, 0.15); border: 1.5px solid rgba(16, 185, 129, 0.35); border-radius: 8px;">✓ Handed Over & Collected</div>`;
  }

  const placedTimeStr = order.placedAt ? (order.placedAt.includes('T') ? new Date(order.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : order.placedAt) : 'Just now';
  const targetPickupStr = order.targetPickup || (order.estimatedReadyAt ? new Date(order.estimatedReadyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Next Break Slot');
  const elapsedBadge = getElapsedBadge(order);

  // Parse items safely
  let items = order.items || [];
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch(e) { items = []; }
  }
  if (!Array.isArray(items)) items = [];

  const totalDishes = items.reduce((sum, it) => sum + (Number(it.qty || it.quantity) || 1), 0);
  const totalAmount = order.total || order.subtotal || items.reduce((s, it) => s + ((Number(it.price || it.unitPrice) || 0) * (Number(it.qty || it.quantity) || 1)), 0);
  const paymentLabel = order.paymentStatus === 'DUE_ON_PICKUP' ? 'Due at pickup' : (order.paymentMethod || 'Due at pickup');

  return `
    <div class="kds-ticket-card ${stage === 'ready' ? 'ticket-ready-stage' : ''}" id="ticket-${orderIdentifier}">
      
      <!-- Top Row: Token, Elapsed Time, PIN -->
      <div class="ticket-top-row">
        <span class="ticket-token-badge">🎫 #${escapeVendorHtml(order.token)}</span>
        <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;">
          ${['incoming', 'cooking'].includes(stage) && Number.isInteger(order.queuePosition) ? `<span class="ticket-time-chip">Queue #${order.queuePosition} · ${order.ordersAhead} ahead</span>` : ''}
          ${elapsedBadge}
        </div>
      </div>

      <!-- Student & Target Info -->
      <div class="ticket-student-info">
        <div>👤 <strong>${escapeVendorHtml(order.studentName || 'Campus Student')}</strong> • Roll: <strong>${escapeVendorHtml(order.studentRoll || 'IITP')}</strong> ${order.studentPhone ? `• 📞 ${escapeVendorHtml(order.studentPhone)}` : ''}</div>
        <div class="ticket-target-slot">🎯 Target: <strong>${escapeVendorHtml(targetPickupStr)}</strong> (Placed at ${escapeVendorHtml(placedTimeStr)})</div>
      </div>

      <!-- High-Contrast Dish Items Breakdown with Explicit Item Details -->
      <div class="ticket-items-container">
        <div class="ticket-items-header">
          <span>🍽️ ORDER DISHES (${totalDishes} items)</span>
          <span style="font-size: 0.72rem; color: #94a3b8; font-weight: 600;">Kitchen Breakdown</span>
        </div>
        
        <div class="ticket-items-list">
          ${items.length > 0 ? items.map(i => {
            const itemName = i.name || i.dishName || i.title || 'Selected Meal';
            const itemQty = Number(i.qty || i.quantity) || 1;
            const itemPrice = (Number(i.price || i.unitPrice) || 0) * itemQty;
            const isVeg = isItemVeg(itemName);
            const variant = i.variant || null;
            return `
              <div class="ticket-item-line">
                <div class="ticket-item-left">
                  <span class="zomato-diet-icon ${isVeg ? 'veg' : 'nonveg'}" title="${isVeg ? 'Vegetarian' : 'Non-Vegetarian'}"></span>
                  <span class="ticket-item-qty">${itemQty}×</span>
                  <div class="ticket-item-details">
                    <span class="ticket-item-name">${escapeVendorHtml(itemName)}</span>
                    ${variant ? `<span class="ticket-variant-pill">${escapeVendorHtml(variant)}</span>` : ''}
                  </div>
                </div>
                <span class="ticket-item-price">₹${itemPrice}</span>
              </div>
            `;
          }).join('') : `
            <div style="text-align: center; color: #94a3b8; font-size: 0.8rem; padding: 0.75rem;">
              Express Meal • Plated as per counter token
            </div>
          `}
        </div>
      </div>

      <!-- Special Cooking Notes -->
      ${order.notes ? `
        <div class="ticket-notes">
          👨‍🍳 <strong>Special Request:</strong> "${order.notes}"
        </div>
      ` : ''}

      <!-- Order Summary Footer -->
      <div class="ticket-summary-footer">
        <span>Total Bill: <strong>₹${totalAmount}</strong></span>
        <span>Payment: <strong style="color: #34d399;">${escapeVendorHtml(paymentLabel)}</strong></span>
      </div>

      <!-- Action Button -->
      ${actionButton}
    </div>
  `;
}

function openPickupVerification(orderIdentifier) {
  const order = VendorState.kdsOrders.find(
    item => item.id === orderIdentifier || item.token === orderIdentifier
  );
  if (!order) {
    showToast('Order not found. Refresh the kitchen display.', '⚠️');
    return;
  }

  // Create a small, accessible PIN dialog without exposing the PIN on the KDS ticket.
  let modal = document.getElementById('pickup-pin-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pickup-pin-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.72);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <form id="pickup-pin-form" style="width:min(420px,100%);background:#fff;color:#0f172a;border-radius:18px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.35);">
        <div style="font-size:2rem;margin-bottom:8px;">🔐</div>
        <h2 style="font-size:1.2rem;margin:0 0 6px;">Verify student pickup</h2>
        <p id="pickup-pin-order-label" style="color:#64748b;margin:0 0 16px;font-size:.9rem;"></p>
        <label for="pickup-pin-input" style="display:block;font-weight:700;font-size:.85rem;margin-bottom:7px;">Enter the 4-digit pickup PIN</label>
        <input id="pickup-pin-input" inputmode="numeric" autocomplete="one-time-code" maxlength="4" pattern="[0-9]{4}" required placeholder="••••" style="box-sizing:border-box;width:100%;padding:13px;border:1px solid #cbd5e1;border-radius:10px;font-size:1.4rem;letter-spacing:.5rem;text-align:center;">
        <p id="pickup-pin-error" role="alert" style="min-height:20px;color:#dc2626;font-size:.82rem;margin:8px 0 14px;"></p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" id="pickup-pin-cancel" style="padding:10px 16px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-weight:700;cursor:pointer;">Cancel</button>
          <button type="submit" id="pickup-pin-submit" style="padding:10px 16px;border:0;border-radius:9px;background:#059669;color:#fff;font-weight:800;cursor:pointer;">Verify & hand over</button>
        </div>
      </form>`;
    document.body.appendChild(modal);
  }

  const form = document.getElementById('pickup-pin-form');
  const input = document.getElementById('pickup-pin-input');
  const error = document.getElementById('pickup-pin-error');
  const submit = document.getElementById('pickup-pin-submit');
  document.getElementById('pickup-pin-order-label').textContent = `Order #${order.token} • ${order.studentName || 'Student'}`;
  input.value = '';
  error.textContent = '';
  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 0);

  document.getElementById('pickup-pin-cancel').onclick = () => {
    modal.style.display = 'none';
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    const pin = input.value.trim();
    if (!/^\d{4}$/.test(pin)) {
      error.textContent = 'Enter the 4-digit PIN shown on the student\'s tracking screen.';
      input.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Verifying…';
    error.textContent = '';
    try {
      await transitionKDSOrder(order.id, 'COMPLETED', pin);
      modal.style.display = 'none';
    } catch (err) {
      error.textContent = err.message || 'PIN verification failed. Try again.';
      input.select();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Verify & hand over';
    }
  };
}

async function transitionKDSOrder(orderIdentifier, newStatus, pickupPin = null) {
  if (!VendorState.vendorSession?.token) {
    showToast('Vendor session expired. Please sign in again.', '⚠️');
    showAuth();
    throw new Error('Vendor session expired');
  }

  try {
    const response = await fetch(
      `/api/v1/vendor/orders/${encodeURIComponent(orderIdentifier)}/status`,
      {
        method: 'PATCH',
        headers: vendorAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: newStatus, ...(pickupPin ? { pickupPin } : {}) })
      }
    );
    const result = await response.json().catch(() => ({}));

    if (response.status === 401) {
      stopLivePolling();
      localStorage.removeItem('grabngo_vendor_session');
      VendorState.vendorSession = null;
      showAuth();
      throw new Error('Vendor session expired. Please sign in again.');
    }

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Could not update order status');
    }

    playKitchenChime();
    await fetchLiveOrders();
    const order = result.data;
    const token = order?.token || orderIdentifier;

    if (newStatus === 'READY_FOR_PICKUP') {
      showToast(`Ticket #${token} marked READY! Student can now see the pickup update in the app.`, '🎉');
    } else if (newStatus === 'COMPLETED') {
      showToast(`Pickup PIN verified. Order #${token} handed over.`, '👍');
    } else {
      showToast(`Ticket #${token} status changed to ${newStatus}`);
    }
    return result.data;
  } catch (err) {
    console.error('Order status update failed:', err);
    showToast(err.message || 'Could not update order status.', '⚠️');
    await fetchLiveOrders();
    throw err;
  }
}


async function toggleRushMode() {
  if (!VendorState.vendorSession?.token) {
    showToast('Please sign in again to manage rush mode.', '⚠️');
    showAuth();
    return;
  }

  const nextRushMode = !VendorState.rushModeActive;
  const surgeMinutes = nextRushMode ? 8 : 0;

  try {
    const response = await fetch(
      `/api/v1/outlets/${encodeURIComponent(VendorState.vendorSession.outletId)}/surge`,
      {
        method: 'POST',
        headers: vendorAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ surgeMinutes })
      }
    );
    const result = await response.json().catch(() => ({}));

    if (response.status === 401) {
      stopLivePolling();
      localStorage.removeItem('grabngo_vendor_session');
      VendorState.vendorSession = null;
      showAuth();
      throw new Error('Vendor session expired. Please sign in again.');
    }
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Could not update rush mode');
    }

    VendorState.rushModeActive = nextRushMode;
    const button = document.getElementById('btn-kds-rush-mode');
    if (button) {
      button.classList.toggle('rush-active', nextRushMode);
      button.innerHTML = nextRushMode
        ? '🔥 Rush Mode Active (+8m Buffer)'
        : '⚡ Standard Queue Mode';
    }

    showToast(
      nextRushMode
        ? 'Rush Mode ON: +8m buffer added to customer ETAs'
        : 'Rush Mode OFF: Standard prep times restored',
      '⏱️'
    );
  } catch (error) {
    console.error('Rush mode update failed:', error);
    showToast(error.message || 'Could not update rush mode.', '⚠️');
  }
}

function toggle86Modal() {
  const modal = document.getElementById('modal-86-manager');
  if (!modal) return;
  modal.classList.toggle('active');
  render86List();
}



function render86List() {
  const container = document.getElementById('86-items-list');
  if (!container) return;

  const allDishes = [];
  (VendorState.menuCategories || []).forEach(category => {
    (category.items || []).forEach(item => {
      allDishes.push({ name: item.name, category: category.name });
    });
  });

  if (!allDishes.length) {
    container.innerHTML = '<p style="padding:1rem;color:#64748b;">No digital menu is configured for this outlet yet.</p>';
    return;
  }

  container.innerHTML = allDishes.map(item => {
    const isOut = VendorState.outOfStockItemIds.has(item.name);
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.65rem .75rem;border-bottom:1px solid var(--border-color);">
        <div>
          <div style="font-size:.85rem;font-weight:700;color:var(--secondary);">${escapeVendorHtml(item.name)}</div>
          <div style="font-size:.72rem;color:var(--text-muted);">${escapeVendorHtml(item.category)}</div>
        </div>
        <button type="button" class="btn-sim-action" data-stock-item="${escapeVendorHtml(item.name)}"
          style="${isOut ? 'background:#fef2f2;color:#ef4444;border-color:#ef4444;' : 'background:#ecfdf5;color:#059669;'}">
          ${isOut ? '❌ Sold Out (86)' : '✓ In Stock'}
        </button>
      </div>`;
  }).join('');

  container.querySelectorAll('[data-stock-item]').forEach(button => {
    button.addEventListener('click', () => toggleItemStock(button.getAttribute('data-stock-item')));
  });
}

async function toggleItemStock(itemName) {
  if (!VendorState.vendorSession?.token) {
    showToast('Please sign in again to manage stock.', '⚠️');
    showAuth();
    return;
  }

  const isCurrentlyOut = VendorState.outOfStockItemIds.has(itemName);
  const nextAvailable = isCurrentlyOut;

  try {
    const response = await fetch(
      `/api/v1/outlets/${encodeURIComponent(VendorState.vendorSession.outletId)}/stock`,
      {
        method: 'PATCH',
        headers: vendorAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          itemName,
          isAvailable: nextAvailable
        })
      }
    );
    const result = await response.json().catch(() => ({}));

    if (response.status === 401) {
      stopLivePolling();
      localStorage.removeItem('grabngo_vendor_session');
      VendorState.vendorSession = null;
      showAuth();
      throw new Error('Vendor session expired. Please sign in again.');
    }
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Could not update item availability');
    }

    if (nextAvailable) {
      VendorState.outOfStockItemIds.delete(itemName);
      showToast(`${itemName} marked back in stock`, '✅');
    } else {
      VendorState.outOfStockItemIds.add(itemName);
      showToast(`${itemName} marked as SOLD OUT (86)`, '⚠️');
    }

    // Refresh menu availability from the backend as the source of truth.
    await fetchVendorMenu();
    render86List();
  } catch (error) {
    console.error('Stock update failed:', error);
    showToast(error.message || 'Could not update item availability.', '⚠️');
  }
}

// Cross-tab synchronization
window.addEventListener('storage', (e) => {
  if (e.key === 'grabngo_active_order' || e.key === 'grabngo_kds_orders') {
    fetchLiveOrders();
  }
});
