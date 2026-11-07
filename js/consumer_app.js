/**
 * Grab n Go — Consumer Web App Logic
 * Real-world food pre-ordering & express queue tracking
 */

const AppState = {
  user: null,
  selectedOutletId: 'outlet-arya-services-01',
  selectedCategory: 'all',
  searchQuery: '',
  dietFilter: 'all',
  cart: [],
  selectedPickupSlot: 'instant',
  cookingNotes: '',
  hasStudentPass: false,
  activeOrder: null,
  activeOrders: [],
  orderHistory: [],
  completedDialogOrderIds: new Set(),
  orderCounter: 105,
  countdownInterval: null,
  authToken: localStorage.getItem('grabngo_token') || null,
  menuLoaded: false
};

// Keep these values aligned with the backend CART_LIMITS configuration.
const CART_LIMITS = Object.freeze({
  maxQuantityPerDish: 10,
  maxTotalQuantity: 30,
  maxDistinctDishes: 15
});

document.addEventListener('DOMContentLoaded', async () => {
  initAuth();
  initCart();
  initPass();
  await validateSavedSession();
  await loadCampusData();
  initOutlets();
  initCategoryPills();
  renderMenuItems();
  await initOrderHistory();
  await refreshPassStatus();
  await restoreActiveOrder();
});

async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (AppState.authToken) headers.Authorization = `Bearer ${AppState.authToken}`;
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    if (response.status === 401) clearLocalSession();
    throw new Error(payload.message || `Request failed (${response.status})`);
  }
  return payload.data;
}

function clearLocalSession() {
  AppState.authToken = null;
  AppState.user = null;
  AppState.hasStudentPass = false;
  localStorage.removeItem('grabngo_token');
  localStorage.removeItem('grabngo_user');
  updateUserUI();
}

async function validateSavedSession() {
  if (!AppState.authToken) return;
  try {
    const session = await apiRequest('/api/v1/auth/me');
    AppState.user = session.user;
    localStorage.setItem('grabngo_user', JSON.stringify(session.user));
    updateUserUI();
  } catch (err) {
    clearLocalSession();
  }
}

async function loadCampusData() {
  try {
    const liveOutlets = await apiRequest('/api/v1/outlets');
    if (Array.isArray(liveOutlets)) CAMPUS_OUTLETS.splice(0, CAMPUS_OUTLETS.length, ...liveOutlets);
    const selectedOutlet = CAMPUS_OUTLETS.find(outlet => outlet.id === AppState.selectedOutletId);
    if (selectedOutlet) {
      const name = document.getElementById('showcase-outlet-name');
      const sub = document.getElementById('showcase-outlet-sub');
      const phone = document.getElementById('showcase-outlet-phone');
      const eta = document.getElementById('showcase-outlet-eta');
      if (name) name.textContent = selectedOutlet.name;
      if (sub) sub.textContent = `${selectedOutlet.subtitle} • ${selectedOutlet.location}`;
      if (phone) phone.textContent = selectedOutlet.contacts?.length ? `📞 ${selectedOutlet.contacts.join(' / ')}` : '📞 Contact details unavailable';
      if (eta) eta.textContent = `⚡ ~${selectedOutlet.averageWaitMinutes || calculateEstimatedWait(selectedOutlet)} mins pickup`;
    }
    await loadMenuForOutlet(AppState.selectedOutletId);
  } catch (err) {
    ARYA_SERVICES_MENU.splice(0, ARYA_SERVICES_MENU.length);
    console.error('Could not load campus data:', err);
    showToast(`Unable to load campus data: ${err.message}`, '⚠️');
  }
}

async function loadMenuForOutlet(outletId) {
  const data = await apiRequest(`/api/v1/outlets/${encodeURIComponent(outletId)}/menu`);
  if (!data || !Array.isArray(data.categories)) throw new Error('This outlet has not published a digital menu yet.');
  ARYA_SERVICES_MENU.splice(0, ARYA_SERVICES_MENU.length, ...data.categories.map(cat => ({
    ...cat,
    items: (cat.items || []).map((item, idx) => ({
      ...item,
      id: item.id || `${cat.id}_item_${idx}`,
      is_veg: item.is_veg !== false
    }))
  })));
  AppState.menuLoaded = true;
  AppState.selectedCategory = 'all';
}

async function restoreActiveOrder() {
  if (!AppState.authToken) return;
  try {
    // The API history is authoritative and may contain several active orders.
    if (!AppState.orderHistory.length) {
      AppState.orderHistory = await apiRequest('/api/v1/orders') || [];
    }
    AppState.activeOrders = AppState.orderHistory.filter(order =>
      ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'].includes(order.status)
    );
    updateActiveOrderBanner();

    const saved = localStorage.getItem('grabngo_active_order');
    const cached = saved ? JSON.parse(saved) : null;
    const selected = AppState.activeOrders.find(order => order.id === cached?.id)
      || AppState.activeOrders[0];
    if (!selected) {
      AppState.activeOrder = null;
      localStorage.removeItem('grabngo_active_order');
      return;
    }

    const live = await apiRequest(`/api/v1/orders/${encodeURIComponent(selected.id)}/track`);
    AppState.activeOrder = { ...selected, ...live, id: live.orderId || selected.id };
    localStorage.setItem('grabngo_active_order', JSON.stringify(AppState.activeOrder));
    updateActiveOrderBanner();
    startCountdownTimer();
  } catch (e) {
    console.warn('Could not restore active orders:', e.message);
    updateActiveOrderBanner();
  }
}

// Toast System
function showToast(message, icon = '🛍️') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.innerHTML = `<span>${escapeOrderHtml(icon)}</span> <span></span>`;
  toast.lastElementChild.textContent = String(message);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
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

// Authentication & Profile Setup

function initAuth() {
  AppState.user = null;
  const authForm = document.getElementById('auth-login-form');
  const requestButton = document.getElementById('auth-request-otp');
  const otpStep = document.getElementById('auth-otp-step');

  if (requestButton) {
    requestButton.addEventListener('click', async () => {
      const name = document.getElementById('auth-input-name').value.trim();
      const roll = document.getElementById('auth-input-id').value.trim().toUpperCase();
      const email = document.getElementById('auth-input-email').value.trim().toLowerCase();

      if (!name || !roll || !email) {
        showToast('Enter your name, roll number and IITP email.', '⚠️');
        return;
      }

      requestButton.disabled = true;
      requestButton.textContent = 'Sending code…';
      try {
        await apiRequest('/api/v1/auth/otp/request', {
          method: 'POST',
          body: JSON.stringify({ name, studentRoll: roll, email })
        });
        if (otpStep) otpStep.style.display = 'block';
        document.getElementById('auth-input-otp')?.focus();
        requestButton.textContent = 'Send another code';
        showToast('Verification code sent to your IITP email.', '📧');
      } catch (err) {
        showToast(err.message, '⚠️');
      } finally {
        requestButton.disabled = false;
      }
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async event => {
      event.preventDefault();
      const name = document.getElementById('auth-input-name').value.trim();
      const roll = document.getElementById('auth-input-id').value.trim().toUpperCase();
      const email = document.getElementById('auth-input-email').value.trim().toLowerCase();
      const otp = document.getElementById('auth-input-otp').value.trim();
      if (!/^\d{6}$/.test(otp)) {
        showToast('Enter the 6-digit code sent to your email.', '⚠️');
        return;
      }

      const submit = authForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const result = await apiRequest('/api/v1/auth/otp/verify', {
          method: 'POST',
          body: JSON.stringify({ name, studentRoll: roll, email, otp })
        });
        AppState.authToken = result.token;
        AppState.user = result.user;
        localStorage.setItem('grabngo_token', result.token);
        localStorage.setItem('grabngo_user', JSON.stringify(result.user));
        updateUserUI();
        closeAuthModal();
        await initOrderHistory();
        await refreshPassStatus();
        await restoreActiveOrder();
        showToast('IITP email verified. Signed in successfully.', '👋');
        authForm.reset();
        if (otpStep) otpStep.style.display = 'none';
      } catch (err) {
        showToast(err.message, '⚠️');
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }
}

function updateUserUI() {
  const headerName = document.getElementById('header-user-name');
  const loggedInState = document.getElementById('auth-logged-in-state');
  const loggedOutState = document.getElementById('auth-logged-out-state');
  const profileName = document.getElementById('auth-profile-name');
  const profileId = document.getElementById('auth-profile-id');

  // Sidebar Header & Account Elements
  const sidebarName = document.getElementById('sidebar-user-name');
  const sidebarRoll = document.getElementById('sidebar-user-roll');
  const sidebarEmail = document.getElementById('sidebar-user-email');
  const sidebarInitials = document.getElementById('sidebar-avatar-initials');
  const accountDetailName = document.getElementById('account-detail-name');
  const accountDetailRoll = document.getElementById('account-detail-roll');
  const accountDetailPass = document.getElementById('account-detail-pass');

  if (AppState.user) {
    const firstName = AppState.user.name.split(' ')[0];
    if (headerName) headerName.textContent = firstName;
    if (loggedInState) loggedInState.style.display = 'block';
    if (loggedOutState) loggedOutState.style.display = 'none';
    if (profileName) profileName.textContent = AppState.user.name;
    if (profileId) profileId.textContent = `${AppState.user.roll} • IIT Patna`;

    if (sidebarName) sidebarName.textContent = AppState.user.name;
    if (sidebarRoll) sidebarRoll.textContent = `${AppState.user.roll} • ${AppState.user.dept || 'IIT Patna Student'}`;
    if (sidebarEmail) sidebarEmail.textContent = AppState.user.email || `${AppState.user.roll.toLowerCase()}@iitp.ac.in`;

    if (sidebarInitials) {
      const parts = AppState.user.name.trim().split(' ');
      const initials = parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
      sidebarInitials.textContent = initials;
    }

    if (accountDetailName) accountDetailName.textContent = AppState.user.name;
    if (accountDetailRoll) accountDetailRoll.textContent = AppState.user.roll;
    if (accountDetailPass) {
      accountDetailPass.textContent = AppState.hasStudentPass ? 'Active (₹0 Fee Tier)' : 'Standard (₹5 Fee/Order)';
      accountDetailPass.style.color = AppState.hasStudentPass ? '#059669' : '#64748b';
    }
  } else {
    if (headerName) headerName.textContent = 'Sign In';
    if (loggedInState) loggedInState.style.display = 'none';
    if (loggedOutState) loggedOutState.style.display = 'block';

    if (sidebarName) sidebarName.textContent = 'Guest Student';
    if (sidebarRoll) sidebarRoll.textContent = 'Sign in for pre-orders & tokens';
    if (sidebarEmail) sidebarEmail.textContent = 'student@iitp.ac.in';
    if (sidebarInitials) sidebarInitials.textContent = '👤';
  }
}

function handleProfileButtonClick() {
  if (AppState.user) {
    openProfileSidebar('orders');
  } else {
    openAuthModal();
  }
}

function openAuthModal() {
  document.getElementById('modal-auth').classList.add('active');
}

function closeAuthModal() {
  document.getElementById('modal-auth').classList.remove('active');
}

function signOutUser() {
  clearLocalSession();
  AppState.orderHistory = [];
  AppState.activeOrder = null;
  localStorage.removeItem('grabngo_active_order');
  localStorage.removeItem('grabngo_order_history');
  updateUserUI();
  closeAuthModal();
  closeProfileSidebar();
  document.getElementById('auth-login-form')?.reset();
  const otpStep = document.getElementById('auth-otp-step');
  if (otpStep) otpStep.style.display = 'none';
  showToast('Signed out successfully. Click Sign In anytime.', '👋');
}

// ====================================================================
// PROFILE SIDEBAR & ZOMATO-STYLE PREVIOUS ORDERS
// ====================================================================

async function initOrderHistory() {
  const previouslyActive = AppState.activeOrders || [];
  if (AppState.authToken && AppState.user) {
    try {
      AppState.orderHistory = await apiRequest('/api/v1/orders') || [];
    } catch (err) {
      showToast(`Could not load order history: ${err.message}`, '⚠️');
    }
  } else {
    AppState.orderHistory = [];
  }

  // Detect pickup completion for every active order, not just the one currently open.
  previouslyActive.forEach(previous => {
    const latest = AppState.orderHistory.find(order => order.id === previous.id);
    if (latest?.status === 'COMPLETED' && !AppState.completedDialogOrderIds.has(latest.id)) {
      AppState.completedDialogOrderIds.add(latest.id);
      showPickupThankYouDialog({ ...previous, ...latest });
      if (AppState.activeOrder?.id === latest.id) {
        AppState.activeOrder = null;
        localStorage.removeItem('grabngo_active_order');
      }
    }
  });

  AppState.activeOrders = AppState.orderHistory.filter(order =>
    ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'].includes(order.status)
  );
  updateOrdersBadge();
  renderPreviousOrders();
  updateActiveOrderBanner();
}

function updateOrdersBadge() {
  const count = (AppState.orderHistory && AppState.orderHistory.length) || 0;
  
  const navBadge = document.getElementById('nav-orders-count');
  if (navBadge) {
    navBadge.textContent = count;
    navBadge.style.display = count > 0 ? 'inline-block' : 'none';
  }

  const profileCount = document.getElementById('profile-orders-count');
  if (profileCount) {
    profileCount.textContent = count;
  }
}

function openProfileSidebar(defaultTab = 'orders') {
  const drawer = document.getElementById('profile-drawer');
  const overlay = document.getElementById('profile-overlay');
  if (!drawer || !overlay) return;

  updateUserUI();
  renderPreviousOrders();
  updateOrdersBadge();
  switchProfileTab(defaultTab);

  overlay.classList.add('active');
  drawer.classList.add('active');
}

function closeProfileSidebar() {
  const drawer = document.getElementById('profile-drawer');
  const overlay = document.getElementById('profile-overlay');
  if (drawer) drawer.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
}

function switchProfileTab(tabName) {
  document.querySelectorAll('.profile-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.profile-panel').forEach(p => p.classList.remove('active'));

  const activeBtn = document.getElementById(`tab-btn-${tabName}`);
  const activePanel = document.getElementById(`panel-${tabName}`);

  if (activeBtn) activeBtn.classList.add('active');
  if (activePanel) activePanel.classList.add('active');
}

function openPassFromSidebar() {
  closeProfileSidebar();
  const passModal = document.getElementById('modal-pass');
  if (passModal) passModal.classList.add('active');
}

async function handleContactFeedback(event) {
  event.preventDefault();
  const category = document.getElementById('feedback-category')?.value || 'general';
  const message = document.getElementById('feedback-message')?.value.trim();
  if (!message) { showToast('Write a message before submitting.', '⚠️'); return; }
  try {
    await apiRequest('/api/v1/feedback', {
      method: 'POST',
      body: JSON.stringify({ category, message })
    });
    showToast('Your feedback has been saved. Thank you!', '📨');
    document.getElementById('contact-feedback-form')?.reset();
  } catch (err) {
    showToast(`Feedback was not sent: ${err.message}`, '⚠️');
  }
}

function renderPreviousOrders() {
  const container = document.getElementById('previous-orders-list');
  if (!container) return;

  if (!AppState.orderHistory || AppState.orderHistory.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
        <div style="font-size: 3rem; margin-bottom: 0.75rem;">🛍️</div>
        <h5 style="font-size: 1.1rem; font-weight: 800; color: var(--secondary); margin-bottom: 0.35rem;">No previous orders yet</h5>
        <p style="font-size: 0.82rem; margin-bottom: 1.25rem;">Your completed meal pickups will appear here for 1-click re-ordering.</p>
        <button class="btn-checkout-primary" onclick="closeProfileSidebar()" style="display: inline-block; width: auto; padding: 0.65rem 1.5rem; font-size: 0.85rem;">
          Explore Menu ➔
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = AppState.orderHistory.map(order => {
    const timeDisplay = order.completedAt || order.placedAt || 'Recently';
    const totalDishes = (order.items || []).reduce((sum, i) => sum + (i.qty || 1), 0);

    return `
      <div class="zomato-order-card" id="card-${order.id}">
        <!-- Outlet Header -->
        <div class="order-card-header">
          <div class="order-card-outlet">
            <div class="outlet-avatar-small">🍛</div>
            <div>
              <div class="order-outlet-name">${escapeOrderHtml(order.outletName || 'Arya Services')}</div>
              <div class="order-outlet-location">${escapeOrderHtml(order.location || 'Food Court • Express Counter')}</div>
            </div>
          </div>
          <div class="order-status-pill completed">
            <span>${escapeOrderHtml(order.status === 'COMPLETED' ? '✓ Delivered' : order.status === 'CANCELLED' ? 'Cancelled' : order.status.replaceAll('_',' '))}</span>
          </div>
        </div>

        <!-- Order Meta Row -->
        <div class="order-meta-row">
          <span class="order-token-tag">🎫 #${escapeOrderHtml(order.token)}</span>
          <span class="order-datetime">🕒 ${escapeOrderHtml(timeDisplay)}</span>
        </div>

        <!-- Dishes Items Summary -->
        <div class="order-dishes-summary">
          ${(order.items || []).map(item => {
            const isVeg = isItemVeg(item.name);
            const linePrice = (Number(item.price) || 0) * (Number(item.qty) || 1);
            return `
              <div class="order-dish-row">
                <div class="dish-name-cell">
                  <span class="zomato-diet-icon ${isVeg ? 'veg' : 'nonveg'}" title="${isVeg ? 'Vegetarian' : 'Non-Vegetarian'}"></span>
                  <span class="dish-qty">${item.qty || 1} ×</span>
                  <span class="dish-title">${escapeOrderHtml(item.name)}</span>
                  ${item.variant ? `<span class="dish-variant-tag">${escapeOrderHtml(item.variant)}</span>` : ''}
                </div>
                <span class="dish-price">₹${linePrice}</span>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Footer: Bill and 1-Click Reorder Button -->
        <div class="order-card-footer">
          <div class="order-total-block">
            <span class="order-total-label">Total Amount (${totalDishes} items)</span>
            <span class="order-total-val">₹${order.total || order.subtotal || 0}</span>
          </div>
          <button class="btn-reorder-zomato" onclick="reorderPreviousItems('${order.id}')">
            🔄 Reorder
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function reorderPreviousItems(orderId) {
  const order = AppState.orderHistory.find(o => o.id === orderId);
  if (!order || !order.items || order.items.length === 0) {
    showToast('Could not find items to reorder', '⚠️');
    return;
  }

  const reorderedCart = AppState.cart.map(item => ({ ...item }));
  for (const item of order.items) {
    const cartItem = {
      id: item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: item.name,
      variant: item.variant || null,
      unitPrice: Number(item.price) || 0,
      qty: Number(item.qty) || 1
    };
    const limitError = getCartAdditionError(cartItem, cartItem.qty, reorderedCart);
    if (limitError) {
      showToast(`Could not reorder: ${limitError}`, '⚠️');
      return;
    }
    mergeCartLine(reorderedCart, cartItem);
  }
  AppState.cart = reorderedCart;

  updateCartBadges();
  renderMenuItems();
  renderCart();

  closeProfileSidebar();
  openCart();

  showToast(`Added ${order.items.length} items from #${order.token} to your Cart! 🛒`, '🔄');
}

// Outlets Section & Rush Indicator logic

function initOutlets() {
  const container = document.getElementById('outlets-grid');
  if (!container) return;

  container.innerHTML = '';

  CAMPUS_OUTLETS.forEach(outlet => {
    const card = document.createElement('div');
    const isComingSoon = outlet.id !== 'outlet-arya-services-01';

    card.className = `outlet-card ${
      outlet.id === AppState.selectedOutletId ? 'active-outlet' : ''
    } ${isComingSoon ? 'coming-soon' : ''}`;

    card.dataset.id = outlet.id;

    const badgeClass = {
      LOW: 'badge-low',
      MODERATE: 'badge-moderate',
      BUSY: 'badge-busy',
      HIGH: 'badge-busy',
      CONGESTED: 'badge-congested',
      SEVERELY_CONGESTED: 'badge-congested'
    }[outlet.queueStatus] || 'badge-moderate';

    const queueLabel = {
      LOW: '🟢 Fast (<10m)',
      MODERATE: '🟡 Moderate Rush',
      BUSY: '🟠 High Rush',
      HIGH: '🟠 High Rush',
      CONGESTED: '🔴 Congested',
      SEVERELY_CONGESTED: '🔴 Congested'
    }[outlet.queueStatus] || 'Moderate';

    const estWait = calculateEstimatedWait(outlet);

    card.innerHTML = `
      <div class="outlet-card-content">
        <div class="outlet-card-top">
          <div class="outlet-icon-title">
            <div class="outlet-avatar">${outlet.icon}</div>
            <div class="outlet-title-box">
              <h4>${outlet.name}</h4>
              <p>${outlet.location}</p>
            </div>
          </div>

          <span class="congestion-badge ${badgeClass}">
            ${queueLabel}
          </span>
        </div>

        <div class="outlet-stats-row">
          <div class="stat-item">
            <span class="stat-label">Active Queue</span>
            <span class="stat-val">${outlet.activeOrderCount} orders</span>
          </div>

          <div class="stat-item">
            <span class="stat-label">Pickup ETA</span>
            <span class="stat-val">~${estWait} mins</span>
          </div>

          <div class="stat-item">
            <span class="stat-label">Rating</span>
            <span class="stat-val">★ ${outlet.rating}</span>
          </div>
        </div>

        <div class="outlet-tags">
          ${outlet.tags.map(t =>
            `<span class="outlet-tag-pill">${t}</span>`
          ).join('')}
        </div>
      </div>

      ${isComingSoon ? `
        <div class="coming-soon-overlay">
          <span class="coming-soon-label">COMING SOON</span>
        </div>
      ` : ''}
    `;

    card.addEventListener('click', () => {
      if (isComingSoon) {
        showToast(
          `${outlet.name} is coming soon! Online ordering is currently available at Arya Services.`,
          '🚀'
        );
        return;
      }

      selectOutlet(outlet.id);
    });

    container.appendChild(card);
  });
}


async function selectOutlet(outletId) {
  if (outletId !== 'outlet-arya-services-01') {
  showToast('This outlet is coming soon!');
  return;
}
  AppState.selectedOutletId = outletId;
  AppState.cart = [];
  updateCartBadges();
  renderCart();
  document.querySelectorAll('.outlet-card').forEach(c => c.classList.toggle('active-outlet', c.dataset.id === outletId));

  const outlet = CAMPUS_OUTLETS.find(o => o.id === outletId);
  if (outlet) {
    const name = document.getElementById('showcase-outlet-name');
    const sub = document.getElementById('showcase-outlet-sub');
    const phone = document.getElementById('showcase-outlet-phone');
    const eta = document.getElementById('showcase-outlet-eta');
    if (name) name.textContent = outlet.name;
    if (sub) sub.textContent = `${outlet.subtitle} • ${outlet.location}`;
    if (phone) phone.textContent = outlet.contacts?.length ? `📞 ${outlet.contacts.join(' / ')}` : '📞 Contact details unavailable';
    if (eta) eta.textContent = `⚡ ~${outlet.averageWaitMinutes || calculateEstimatedWait(outlet)} mins pickup`;
  }

  try {
    await loadMenuForOutlet(outletId);
    initCategoryPills();
    renderMenuItems();
  } catch (err) {
    ARYA_SERVICES_MENU.splice(0, ARYA_SERVICES_MENU.length);
    initCategoryPills();
    renderMenuItems();
    showToast(err.message || 'This outlet has not published a digital menu yet.', 'ℹ️');
  }
}

function calculateEstimatedWait(outlet) {
  const base = outlet.basePrepTime || 12;
  return Math.round(base + (outlet.activeOrderCount * 0.85));
}

// Cuisine Quick Filter Bubble
function filterByCuisine(catId, el) {
  document.querySelectorAll('.cuisine-bubble').forEach(b => b.classList.remove('active'));
  el.classList.add('active');

  AppState.selectedCategory = catId;
  // Also sync with pills row
  document.querySelectorAll('.category-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === catId);
  });

  renderMenuItems();
  const menuCard = document.getElementById('menu-section');
  if (menuCard) {
    menuCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Category Pills & Filter Toolbar
function initCategoryPills() {
  const listContainer = document.getElementById('category-pills-list');
  if (!listContainer) return;

  const totalItems = ARYA_SERVICES_MENU.reduce((acc, cat) => acc + cat.items.length, 0);

  let html = `
    <button class="category-pill-btn active" data-cat="all">
      All Dishes <span class="cat-count">${totalItems}</span>
    </button>
  `;

  ARYA_SERVICES_MENU.forEach(cat => {
    html += `
      <button class="category-pill-btn" data-cat="${cat.id}">
        ${cat.name} <span class="cat-count">${cat.items.length}</span>
      </button>
    `;
  });

  listContainer.innerHTML = html;

  listContainer.querySelectorAll('.category-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      listContainer.querySelectorAll('.category-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.selectedCategory = btn.dataset.cat;
      renderMenuItems();
    });
  });

  const searchInput = document.getElementById('menu-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      AppState.searchQuery = e.target.value.toLowerCase().trim();
      renderMenuItems();
    });
  }

  const dietBtns = document.querySelectorAll('.diet-btn');
  dietBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      dietBtns.forEach(b => b.classList.remove('active', 'veg-active', 'nonveg-active'));
      btn.classList.add('active');
      AppState.dietFilter = btn.dataset.diet;
      if (AppState.dietFilter === 'veg') btn.classList.add('veg-active');
      if (AppState.dietFilter === 'nonveg') btn.classList.add('nonveg-active');
      renderMenuItems();
    });
  });
}

const DISH_IMAGE_MAP = {
  cat_rice: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=320&auto=format&fit=crop&q=80',
  cat_tandoor: 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?w=320&auto=format&fit=crop&q=80',
  cat_chicken_egg: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=320&auto=format&fit=crop&q=80',
  cat_paneer: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=320&auto=format&fit=crop&q=80',
  cat_mushrooms: 'https://images.unsplash.com/photo-1541832676-9b763b0239ab?w=320&auto=format&fit=crop&q=80',
  cat_rotis_rolls: 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=320&auto=format&fit=crop&q=80',
  cat_noodles_maggi: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=320&auto=format&fit=crop&q=80',
  cat_chilly_dishes: 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=320&auto=format&fit=crop&q=80',
  cat_burgers_pizzas: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=320&auto=format&fit=crop&q=80',
  cat_sweets: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=320&auto=format&fit=crop&q=80',
  cat_dal: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=320&auto=format&fit=crop&q=80',
  cat_paratha: 'https://images.unsplash.com/photo-1626074353765-517a681e40be?w=320&auto=format&fit=crop&q=80'
};

const CATEGORY_EMOJIS = {
  cat_rice: '🍗',
  cat_tandoor: '🫓',
  cat_chicken_egg: '🍛',
  cat_paneer: '🧀',
  cat_mushrooms: '🍄',
  cat_rotis_rolls: '🌯',
  cat_noodles_maggi: '🍜',
  cat_chilly_dishes: '🌶️',
  cat_burgers_pizzas: '🍔',
  cat_sweets: '🍨',
  cat_dal: '🍲',
  cat_paratha: '🥞'
};

function getDishDescription(item, categoryId) {
  const name = item.name.toLowerCase();
  if (name.includes('biryani')) return 'Aromatic basmati rice cooked with whole spices, caramelized onions, and slow-dum preparation.';
  if (name.includes('tandoori roti')) return 'Crisp, wholesome flatbread baked fresh inside a traditional charcoal clay tandoor.';
  if (name.includes('naan')) return 'Soft and fluffy refined flour bread brushed with fresh farm butter or roasted garlic.';
  if (name.includes('butter masala') || name.includes('makhani')) return 'Cooked in a rich velvety butter and cashew-tomato gravy, finished with fresh cream and kasuri methi.';
  if (name.includes('tikka')) return 'Succulent chunks marinated in spiced hung curd, skewered and char-grilled with smoky aromas.';
  if (name.includes('tandoori chicken')) return 'Whole or half spring chicken marinated in Kashmiri red chilies and yogurt, roasted to perfection.';
  if (name.includes('roll')) return 'Golden flaky paratha wrapped with seasoned filling, crunchy sliced onions, and tangy mint chutney.';
  if (name.includes('noodles') || name.includes('chowmein')) return 'Wok-tossed noodles with crunchy bell peppers, shredded cabbage, spring onions, and garlic-soy sauce.';
  if (name.includes('maggi')) return 'Classic campus favorite 2-minute comfort noodles tossed with butter and aromatic masala seasoning.';
  if (name.includes('chilly') || name.includes('manchurian')) return 'Crisp fried bites tossed in a fiery soy-garlic chili glaze with diced capsicum and scallions.';
  if (name.includes('paratha')) return 'Tawa-toasted crispy flatbread generously stuffed with spiced filling, served hot with tangy pickle.';
  if (name.includes('kheer') || name.includes('gulab') || name.includes('rasgulla') || name.includes('rasmalai')) return 'Authentic traditional sweet delicacy prepared with rich condensed milk, pure ghee, and saffron.';
  if (name.includes('dal')) return 'Slow-simmered yellow or black lentils tempered with golden cumin, garlic, ghee, and fresh coriander.';
  if (name.includes('burger') || name.includes('sandwich')) return 'Crispy seasoned patty layered with fresh tomatoes, crisp lettuce, creamy mayo, and toasted buns.';
  return 'Freshly prepared to order using quality ingredients and authentic campus kitchen spices.';
}

function getDishPrepTime(item) {
  const name = item.name.toLowerCase();
  if (name.includes('maggi') || name.includes('burger')) return 8;
  if (name.includes('roti') || name.includes('naan')) return 6;
  if (name.includes('biryani') || name.includes('tandoori')) return 16;
  return 12;
}

// Zomato Category Section Accordion Toggle
function toggleZomatoSection(catId) {
  const section = document.getElementById(`section-${catId}`);
  if (section) {
    section.classList.toggle('collapsed');
  }
}

// Variant Selection
function selectDishVariant(itemId, variantLabel, price) {
  if (!AppState.selectedVariants) AppState.selectedVariants = {};
  AppState.selectedVariants[itemId] = { label: variantLabel, price: price };

  const dishEl = document.getElementById(`dish-${itemId}`);
  if (dishEl) {
    dishEl.querySelectorAll('.zomato-variant-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.variant === variantLabel);
    });
    const priceDisplay = document.getElementById(`price-val-${itemId}`);
    if (priceDisplay) priceDisplay.textContent = `₹${price}`;
  }
}

function addZomatoItemToCart(itemId) {
  const item = findMenuItemById(itemId);
  if (!item) return;

  let selectedVariant = null;
  let unitPrice = item.price;

  if (item.variants && item.variants.length > 0) {
    if (AppState.selectedVariants && AppState.selectedVariants[itemId]) {
      selectedVariant = AppState.selectedVariants[itemId].label;
      unitPrice = AppState.selectedVariants[itemId].price;
    } else {
      selectedVariant = item.variants[0].label;
      unitPrice = item.variants[0].price;
    }
  }

  const cartItem = {
    id: itemId,
    name: item.name,
    variant: selectedVariant,
    unitPrice: unitPrice,
    qty: 1
  };
  const limitError = getCartAdditionError(cartItem, 1);
  if (limitError) {
    showToast(limitError, '⚠️');
    return;
  }
  mergeCartLine(AppState.cart, cartItem);

  updateCartBadges();
  renderMenuItems();
  renderCart();
  showToast(`Added ${item.name} ${selectedVariant ? `(${selectedVariant})` : ''} to order`);
}

function renderMenuItems() {
  const container = document.getElementById('zomato-menu-container');
  if (!container) return;

  let totalMatched = 0;
  let sectionsHtml = '';

  ARYA_SERVICES_MENU.forEach(cat => {
    if (AppState.selectedCategory !== 'all' && cat.id !== AppState.selectedCategory) {
      return;
    }

    // Filter items inside this category
    const matchedItems = [];
    cat.items.forEach((item, idx) => {
      const itemId = `${cat.id}_item_${idx}`;
      if (AppState.searchQuery && !item.name.toLowerCase().includes(AppState.searchQuery) && !cat.name.toLowerCase().includes(AppState.searchQuery)) {
        return;
      }
      if (AppState.dietFilter === 'veg' && !item.is_veg) return;
      if (AppState.dietFilter === 'nonveg' && item.is_veg) return;

      matchedItems.push({
        ...item,
        id: itemId,
        categoryName: cat.name,
        categoryId: cat.id
      });
    });

    if (matchedItems.length === 0) return;
    totalMatched += matchedItems.length;

    const imgUrl = DISH_IMAGE_MAP[cat.id] || 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=320&auto=format&fit=crop&q=80';
    const catEmoji = CATEGORY_EMOJIS[cat.id] || '🍽️';

    sectionsHtml += `
      <div class="zomato-category-section" id="section-${cat.id}">
        <div class="zomato-category-header" onclick="toggleZomatoSection('${cat.id}')">
          <h3>
            <span>${catEmoji}</span>
            <span>${cat.name}</span>
            <span class="zomato-cat-count-badge">${matchedItems.length}</span>
          </h3>
          <span class="zomato-accordion-chevron" id="chevron-${cat.id}">▼</span>
        </div>

        <div class="zomato-dishes-list" id="list-${cat.id}">
          ${matchedItems.map((item, itemIdx) => {
            const dishKey = getDishKey(item);
            const cartItem = AppState.cart.find(c => getDishKey(c) === dishKey);
            const dishQuantity = getCartDishQuantity(item);
            const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
            
            let activeVariantLabel = null;
            let currentPrice = item.price;
            if (hasVariants) {
              if (AppState.selectedVariants && AppState.selectedVariants[item.id]) {
                activeVariantLabel = AppState.selectedVariants[item.id].label;
                currentPrice = AppState.selectedVariants[item.id].price;
              } else {
                activeVariantLabel = item.variants[0].label;
                currentPrice = item.variants[0].price;
              }
            }

            const isBestseller = (itemIdx % 4 === 0) || item.name.toLowerCase().includes('biryani') || item.name.toLowerCase().includes('butter masala');

            return `
              <div class="zomato-dish-item" id="dish-${item.id}">
                <div class="zomato-dish-info">
                  <div class="zomato-tag-row">
                    <span class="zomato-diet-icon ${item.is_veg ? 'veg' : 'nonveg'}" title="${item.is_veg ? 'Vegetarian' : 'Non-Vegetarian'}"></span>
                    ${isBestseller ? '<span class="zomato-bestseller-tag">★ Bestseller</span>' : ''}
                  </div>
                  <h4 class="zomato-dish-name">${escapeOrderHtml(item.name)}</h4>
                  <div class="zomato-dish-price-row">
                    <span class="zomato-price-val" id="price-val-${item.id}">₹${currentPrice}</span>
                    <span class="zomato-prep-time">⏱️ ~${getDishPrepTime(item)} mins</span>
                  </div>
                  <p class="zomato-dish-desc">${getDishDescription(item, cat.id)}</p>

                  ${hasVariants ? `
                    <div class="zomato-variant-group">
                      ${item.variants.map(v => `
                        <button type="button" 
                                class="zomato-variant-chip ${v.label === activeVariantLabel ? 'active' : ''}" 
                                data-variant="${v.label}"
                                onclick="selectDishVariant('${item.id}', '${v.label}', ${v.price})">
                          ${v.label} • ₹${v.price}
                        </button>
                      `).join('')}
                    </div>
                  ` : ''}
                </div>

                <div class="zomato-dish-media">
                  <div class="zomato-dish-photo-box">
                    <img src="${imgUrl}" alt="${escapeOrderHtml(item.name)}" class="zomato-dish-img" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                    <div class="zomato-photo-placeholder" style="display: none;">${catEmoji}</div>
                  </div>
                  <div class="zomato-btn-container">
                    ${item.isAvailable === false ? `
                      <button class="zomato-add-button" disabled style="opacity:.55;cursor:not-allowed;">SOLD OUT</button>
                    ` : cartItem ? `
                      <div class="zomato-qty-stepper">
                        <button class="zomato-stepper-btn" onclick="modifyCartQty('${item.id}', -1)">−</button>
                        <span class="zomato-stepper-val">${dishQuantity}</span>
                        <button class="zomato-stepper-btn" onclick="modifyCartQty('${item.id}', 1)" ${dishQuantity >= CART_LIMITS.maxQuantityPerDish || getCartTotalQuantity() >= CART_LIMITS.maxTotalQuantity ? 'disabled title="Cart quantity limit reached"' : ''}>+</button>
                      </div>
                    ` : `
                      <button class="zomato-add-button" onclick="addZomatoItemToCart('${item.id}')" ${getCartDishCount() >= CART_LIMITS.maxDistinctDishes ? `disabled title="Maximum ${CART_LIMITS.maxDistinctDishes} different dishes per cart"` : ''}>
                        ADD <span style="font-size: 1.1rem; line-height: 1;">+</span>
                      </button>
                    `}
                  </div>
                  ${hasVariants ? '<span class="zomato-customisable-tag">customisable</span>' : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });

  if (totalMatched === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
        <p style="font-size: 3rem; margin-bottom: 0.5rem;">🔍</p>
        <p style="font-size: 1.25rem; font-weight: 800; color: var(--secondary); margin-bottom: 0.25rem;">No dishes match your filter</p>
        <p style="font-size: 0.88rem;">Try clearing your search query or selecting "All Dishes"</p>
      </div>
    `;
    return;
  }

  container.innerHTML = sectionsHtml;
}

// Cart Logic
function initCart() {
  const toggleBtn = document.getElementById('header-cart-toggle');
  const closeBtn = document.getElementById('btn-close-cart');
  const overlay = document.getElementById('cart-overlay');

  if (toggleBtn) toggleBtn.addEventListener('click', openCart);
  if (closeBtn) closeBtn.addEventListener('click', closeCart);
  if (overlay) overlay.addEventListener('click', closeCart);

  document.querySelectorAll('.slot-pill-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.slot-pill-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      const radio = opt.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      AppState.selectedPickupSlot = radio ? radio.value : 'instant';
    });
  });

  const notes = document.getElementById('cart-cooking-notes');
  if (notes) {
    notes.addEventListener('input', (e) => {
      AppState.cookingNotes = e.target.value;
    });
  }

  const checkoutBtn = document.getElementById('btn-checkout-primary');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', openCheckoutModal);
  }

  // Checkout form submit
  const checkoutForm = document.getElementById('checkout-form');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', (e) => {
      e.preventDefault();
      placeOrder();
    });
  }

  const closeCheckoutBtn = document.getElementById('btn-close-checkout');
  if (closeCheckoutBtn) {
    closeCheckoutBtn.addEventListener('click', () => document.getElementById('modal-checkout').classList.remove('active'));
  }

  const closeTrackingBtn = document.getElementById('btn-close-tracking');
  if (closeTrackingBtn) {
    closeTrackingBtn.addEventListener('click', () => document.getElementById('modal-tracking').classList.remove('active'));
  }
}

function openCart() {
  document.getElementById('cart-overlay').classList.add('active');
  document.getElementById('cart-drawer').classList.add('active');
  renderCart();
}

function closeCart() {
  document.getElementById('cart-overlay').classList.remove('active');
  document.getElementById('cart-drawer').classList.remove('active');
}

function findMenuItemById(itemId) {
  for (const cat of ARYA_SERVICES_MENU) {
    for (let idx = 0; idx < cat.items.length; idx++) {
      if (`${cat.id}_item_${idx}` === itemId) {
        return { ...cat.items[idx], id: itemId, categoryName: cat.name };
      }
    }
  }
  return null;
}

function getDishKey(item) {
  return String(item?.name || '').trim().toLowerCase();
}

function getCartTotalQuantity(cart = AppState.cart) {
  return cart.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
}

function getCartDishCount(cart = AppState.cart) {
  return new Set(cart.map(getDishKey).filter(Boolean)).size;
}

function getCartDishQuantity(item, cart = AppState.cart) {
  const dishKey = getDishKey(item);
  return cart.reduce((sum, cartItem) => sum + (getDishKey(cartItem) === dishKey ? (Number(cartItem.qty) || 0) : 0), 0);
}

function getCartAdditionError(item, quantity, cart = AppState.cart) {
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 1) return 'Dish quantity must be a positive whole number.';
  const dishKey = getDishKey(item);
  const currentDishQuantity = getCartDishQuantity(item, cart);
  if (currentDishQuantity + amount > CART_LIMITS.maxQuantityPerDish) {
    return `Maximum ${CART_LIMITS.maxQuantityPerDish} units allowed per dish.`;
  }
  if (getCartTotalQuantity(cart) + amount > CART_LIMITS.maxTotalQuantity) {
    return `Your cart can contain at most ${CART_LIMITS.maxTotalQuantity} items.`;
  }
  if (!cart.some(cartItem => getDishKey(cartItem) === dishKey) && getCartDishCount(cart) >= CART_LIMITS.maxDistinctDishes) {
    return `Your cart can contain at most ${CART_LIMITS.maxDistinctDishes} different dishes.`;
  }
  return null;
}

function mergeCartLine(cart, item) {
  const existing = cart.find(cartItem => getDishKey(cartItem) === getDishKey(item) && (cartItem.variant || null) === (item.variant || null));
  if (existing) existing.qty += Number(item.qty) || 0;
  else cart.push({ ...item, qty: Number(item.qty) || 0 });
}

function getCartLimitViolation(cart = AppState.cart) {
  const dishQuantities = new Map();
  let totalQuantity = 0;
  for (const item of cart) {
    const quantity = Number(item.qty);
    if (!Number.isInteger(quantity) || quantity < 1) return 'Each dish quantity must be a positive whole number.';
    const dishKey = getDishKey(item);
    const dishQuantity = (dishQuantities.get(dishKey) || 0) + quantity;
    if (dishQuantity > CART_LIMITS.maxQuantityPerDish) return `Maximum ${CART_LIMITS.maxQuantityPerDish} units allowed per dish.`;
    dishQuantities.set(dishKey, dishQuantity);
    totalQuantity += quantity;
  }
  if (totalQuantity > CART_LIMITS.maxTotalQuantity) return `Your cart can contain at most ${CART_LIMITS.maxTotalQuantity} items.`;
  if (dishQuantities.size > CART_LIMITS.maxDistinctDishes) return `Your cart can contain at most ${CART_LIMITS.maxDistinctDishes} different dishes.`;
  return null;
}

function addItemToCart(itemId) {
  const item = findMenuItemById(itemId);
  if (!item) return;

  let selectedVariant = null;
  let unitPrice = item.price;

  const variantSelect = document.querySelector(`.item-variant-select[data-id="${itemId}"]`);
  if (variantSelect) {
    const [label, price] = variantSelect.value.split('|');
    selectedVariant = label;
    unitPrice = Number(price);
  }

  const cartItem = {
    id: itemId,
    name: item.name,
    variant: selectedVariant,
    unitPrice: unitPrice,
    qty: 1
  };
  const limitError = getCartAdditionError(cartItem, 1);
  if (limitError) {
    showToast(limitError, '⚠️');
    return;
  }
  mergeCartLine(AppState.cart, cartItem);

  updateCartBadges();
  renderMenuItems();
  renderCart();
  showToast(`Added ${item.name} to order`);
}

function modifyCartQty(itemId, delta) {
  const menuItem = findMenuItemById(itemId);
  const dishKey = menuItem ? getDishKey(menuItem) : '';
  const index = AppState.cart.findIndex(c => c.id === itemId || (dishKey && getDishKey(c) === dishKey));
  if (index === -1) return;

  if (delta > 0) {
    const limitError = getCartAdditionError(AppState.cart[index], delta);
    if (limitError) {
      showToast(limitError, '⚠️');
      return;
    }
  }
  applyCartQuantityChange(index, delta);
}

function modifyCartQtyByIndex(index, delta) {
  if (!AppState.cart[index]) return;
  if (delta > 0) {
    const limitError = getCartAdditionError(AppState.cart[index], delta);
    if (limitError) {
      showToast(limitError, '⚠️');
      return;
    }
  }
  applyCartQuantityChange(index, delta);
}

function applyCartQuantityChange(index, delta) {
  AppState.cart[index].qty += delta;
  if (AppState.cart[index].qty <= 0) {
    const removedName = AppState.cart[index].name;
    AppState.cart.splice(index, 1);
    showToast(`Removed ${removedName} from order`, '🗑️');
  }

  updateCartBadges();
  renderMenuItems();
  renderCart();
}

function updateCartBadges() {
  const count = AppState.cart.reduce((sum, item) => sum + item.qty, 0);
  const bubble = document.getElementById('cart-counter-bubble');
  if (bubble) {
    bubble.textContent = count;
    bubble.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

function renderCart() {
  const itemsContainer = document.getElementById('cart-items-container');
  const emptyState = document.getElementById('cart-empty-state');
  const footer = document.getElementById('cart-footer');

  if (!itemsContainer || !emptyState || !footer) return;

  const totalQuantity = getCartTotalQuantity();
  const dishCount = getCartDishCount();
  const itemsCount = document.getElementById('cart-items-count');
  const dishesCount = document.getElementById('cart-dishes-count');
  const limitMessage = document.getElementById('cart-limit-message');
  if (itemsCount) itemsCount.textContent = `Items in cart: ${totalQuantity} / ${CART_LIMITS.maxTotalQuantity}`;
  if (dishesCount) dishesCount.textContent = `Different dishes: ${dishCount} / ${CART_LIMITS.maxDistinctDishes}`;
  if (limitMessage) {
    limitMessage.textContent = totalQuantity >= CART_LIMITS.maxTotalQuantity
      ? `Cart limit reached (${CART_LIMITS.maxTotalQuantity} items). Decrease a quantity or remove a dish to add more.`
      : dishCount >= CART_LIMITS.maxDistinctDishes
        ? `Dish limit reached (${CART_LIMITS.maxDistinctDishes} dishes). Remove a dish before adding another.`
        : AppState.cart.some(item => getCartDishQuantity(item) >= CART_LIMITS.maxQuantityPerDish)
          ? `A dish is at its maximum of ${CART_LIMITS.maxQuantityPerDish} units.`
          : '';
  }

  if (AppState.cart.length === 0) {
    emptyState.style.display = 'block';
    itemsContainer.style.display = 'none';
    footer.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  itemsContainer.style.display = 'block';
  footer.style.display = 'block';

  itemsContainer.innerHTML = AppState.cart.map((item, index) => `
    <div class="cart-item-row">
      <div class="cart-item-info">
        <h5 class="cart-item-title">${escapeOrderHtml(item.name)}</h5>
        ${item.variant ? `<span class="cart-item-variant">${escapeOrderHtml(item.variant)}</span>` : ''}
        <div class="cart-item-price">₹${item.unitPrice * item.qty}</div>
      </div>
      <div class="cart-item-controls">
        <div class="item-qty-stepper">
          <button class="stepper-btn" onclick="modifyCartQtyByIndex(${index}, -1)">−</button>
          <span class="stepper-val">${item.qty}</span>
          <button class="stepper-btn" onclick="modifyCartQtyByIndex(${index}, 1)" ${getCartDishQuantity(item) >= CART_LIMITS.maxQuantityPerDish || totalQuantity >= CART_LIMITS.maxTotalQuantity ? 'disabled title="Cart quantity limit reached"' : ''}>+</button>
        </div>
        <button class="btn-remove-cart-item" onclick="modifyCartQtyByIndex(${index}, -999)" title="Remove item">✕</button>
      </div>
    </div>
  `).join('');

  const subtotal = AppState.cart.reduce((sum, i) => sum + (i.unitPrice * i.qty), 0);
  const convenienceFee = AppState.hasStudentPass ? 0 : CAMPUS_CONFIG.defaultConvenienceFee;
  const studentDiscount = 0;
  const total = subtotal + convenienceFee;

  document.getElementById('bill-subtotal').textContent = `₹${subtotal}`;
  document.getElementById('bill-conv-fee').textContent = AppState.hasStudentPass ? '₹0 (Pass Waived)' : `₹${convenienceFee}`;
  
  const discountRow = document.getElementById('bill-discount-row');
  if (discountRow) {
    if (studentDiscount > 0) {
      discountRow.style.display = 'flex';
      document.getElementById('bill-discount-val').textContent = `-₹${studentDiscount}`;
    } else {
      discountRow.style.display = 'none';
    }
  }

  document.getElementById('bill-total-amount').textContent = `₹${total}`;
}

async function openCheckoutModal() {
  if (AppState.cart.length === 0) {
    showToast('Your cart is empty!', '⚠️');
    return;
  }
  const limitError = getCartLimitViolation();
  if (limitError) {
    showToast(limitError, '⚠️');
    return;
  }
  closeCart();

  if (AppState.user) {
    document.getElementById('input-student-name').value = AppState.user.name;
    document.getElementById('input-student-roll').value = AppState.user.roll;
  }

  document.getElementById('modal-checkout').classList.add('active');
  if (AppState.authToken) {
    try {
      const quote = await apiRequest('/api/v1/orders/quote', {
        method: 'POST',
        body: JSON.stringify({
          outletId: AppState.selectedOutletId,
          items: AppState.cart.map(item => ({ name:item.name, variant:item.variant, qty:item.qty }))
        })
      });
      const subtotalEl = document.getElementById('bill-subtotal');
      const feeEl = document.getElementById('bill-conv-fee');
      const totalEl = document.getElementById('bill-total-amount');
      if (subtotalEl) subtotalEl.textContent = `₹${quote.subtotal}`;
      if (feeEl) feeEl.textContent = quote.hasPassApplied ? '₹0 (Pass Waived)' : `₹${quote.convenienceFee}`;
      if (totalEl) totalEl.textContent = `₹${quote.total}`;
    } catch (err) {
      showToast(`Could not verify checkout prices: ${err.message}`, '⚠️');
      document.getElementById('modal-checkout')?.classList.remove('active');
    }
  }
}

async function placeOrder() {
  if (!AppState.user || !AppState.authToken) { showToast('Please sign in before placing an order.', '⚠️'); openAuthModal(); return; }
  const limitError = getCartLimitViolation();
  if (limitError) { showToast(limitError, '⚠️'); return; }
  const studentName = AppState.user.name;
  const studentRoll = AppState.user.roll;
  const studentPhone = document.getElementById('input-student-phone').value.trim();
  if (!studentPhone) { showToast('Enter a phone number for pickup coordination.', '⚠️'); return; }
  const outlet = CAMPUS_OUTLETS.find(o => o.id === AppState.selectedOutletId);
  if (!outlet) { showToast('Please select an available outlet.', '⚠️'); return; }
  const paymentMethod = document.querySelector('input[name="payment-method"]:checked')?.value || 'CASH_ON_PICKUP';
  const payload = {
    outletId: outlet.id,
    items: AppState.cart.map(c => ({ name:c.name, variant:c.variant, qty:c.qty })),
    studentName, studentRoll, studentPhone,
    academicBreakSlot: AppState.selectedPickupSlot,
    notes: AppState.cookingNotes,
    paymentMethod
  };
  const submit = document.querySelector('#checkout-form button[type="submit"]');
  if (submit) { submit.disabled = true; submit.textContent = 'Placing order…'; }
  try {
    const order = await apiRequest('/api/v1/orders', { method:'POST', body:JSON.stringify(payload) });
    AppState.activeOrder = {
      ...order, id:order.id, outletName:outlet.name,
      remainingSeconds:(order.estimatedMinutes || 12)*60,
      etaMinutes:order.estimatedMinutes
    };
    localStorage.setItem('grabngo_active_order', JSON.stringify(AppState.activeOrder));
    AppState.cart = []; AppState.cookingNotes = '';
    updateCartBadges(); renderMenuItems(); renderCart();
    document.getElementById('modal-checkout').classList.remove('active');
    await initOrderHistory();
    updateActiveOrderBanner();
    startCountdownTimer();
    showOrderPlacedDialog(order, outlet);
  } catch(err) {
    showToast(`Order not placed: ${err.message}`, '⚠️');
  } finally { if (submit) { submit.disabled = false; submit.innerHTML = '<span>Confirm Order & Allocate Token</span>'; } }
}

function showAppDialog({ title, message, detail = '', primaryLabel = 'Got it', onPrimary = null, icon = '🎉' }) {
  let overlay = document.getElementById('grabngo-app-dialog');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'grabngo-app-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:12000;background:rgba(15,23,42,.68);display:flex;align-items:center;justify-content:center;padding:20px;';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div role="dialog" aria-modal="true" style="width:min(440px,100%);background:#fff;color:#0f172a;border-radius:20px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.3);text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:10px;">${icon}</div>
      <h2 style="font-size:1.35rem;font-weight:850;margin:0 0 10px;">${escapeOrderHtml(title)}</h2>
      <p style="color:#475569;line-height:1.55;margin:0 0 8px;">${escapeOrderHtml(message)}</p>
      ${detail ? `<p style="background:#ecfdf5;color:#065f46;border-radius:12px;padding:12px;font-weight:750;margin:14px 0 18px;">${escapeOrderHtml(detail)}</p>` : '<div style="height:10px;"></div>'}
      <button id="grabngo-app-dialog-primary" style="width:100%;border:0;border-radius:12px;background:#059669;color:#fff;padding:13px;font-weight:800;cursor:pointer;">${escapeOrderHtml(primaryLabel)}</button>
    </div>`;
  overlay.style.display = 'flex';
  document.getElementById('grabngo-app-dialog-primary').onclick = () => {
    overlay.style.display = 'none';
    if (typeof onPrimary === 'function') onPrimary();
  };
}

function showOrderPlacedDialog(order, outlet) {
  const minutes = Math.max(1, Number(order.estimatedMinutes) || 12);
  const readyTime = order.estimatedReadyAt
    ? new Date(order.estimatedReadyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'shortly';
  showAppDialog({
    title: 'Thank you for ordering!',
    message: `Your order #${order.token} has been sent to ${outlet.name}. We will update you when it is ready.`,
    detail: `Estimated preparation time: ${minutes} minutes • Expected by ${readyTime}`,
    primaryLabel: 'Track my order',
    onPrimary: () => openTrackingModalForOrder(order.id),
    icon: '🍽️'
  });
}

function showPickupThankYouDialog(order) {
  showAppDialog({
    title: 'Thanks for ordering with Grab n Go!',
    message: `Order #${order.token} has been picked up successfully. We hope you enjoy your meal!`,
    primaryLabel: 'Continue browsing',
    icon: '💚'
  });
}

function escapeOrderHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
  }[char]));
}

function updateActiveOrderBanner() {
  const banner = document.getElementById('active-order-banner');
  const headerTrackBtn = document.getElementById('btn-header-order-track');
  const headerTokenLabel = document.getElementById('header-token-label');

  const activeOrders = (AppState.activeOrders || []).filter(order =>
    ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'].includes(order.status)
  );
  if (AppState.activeOrder && !activeOrders.some(order => order.id === AppState.activeOrder.id) &&
      ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'].includes(AppState.activeOrder.status)) {
    activeOrders.unshift(AppState.activeOrder);
  }
  AppState.activeOrders = activeOrders;

  if (!banner) return;
  if (!activeOrders.length) {
    banner.style.display = 'none';
    if (headerTrackBtn) headerTrackBtn.style.display = 'none';
    return;
  }

  banner.style.display = 'block';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
      <div><strong style="font-size:1.05rem;">Your active orders</strong><div style="font-size:.8rem;color:#a7f3d0;">${activeOrders.length} order${activeOrders.length === 1 ? '' : 's'} in progress</div></div>
      <span style="font-size:.78rem;background:rgba(255,255,255,.14);padding:5px 10px;border-radius:20px;">Live kitchen updates</span>
    </div>
    <div class="active-orders-grid">
      ${activeOrders.map(order => {
        const minutesLeft = order.estimatedReadyAt
          ? Math.max(1, Math.ceil((new Date(order.estimatedReadyAt).getTime() - Date.now()) / 60000))
          : Math.max(1, Number(order.remainingMinutes || order.estimatedMinutes || 12));
        const eta = order.status === 'READY_FOR_PICKUP'
          ? 'Ready for pickup now'
          : `Ready in ~${minutesLeft} min`;
        const status = getStatusHeadline(order.status);
        return `<article class="active-order-card">
          <div class="active-order-card-top"><span class="token-big-badge">#${escapeOrderHtml(order.token)}</span><span class="active-order-status-pill">${escapeOrderHtml(order.status.replaceAll('_', ' '))}</span></div>
          <h4>${escapeOrderHtml(order.outletName || 'Campus outlet')}</h4>
          <p>${escapeOrderHtml(status)}</p>
          <p class="active-order-card-eta">⏱ ${escapeOrderHtml(eta)}</p>
          <button class="btn-track-order" onclick="openTrackingModalForOrder('${escapeOrderHtml(order.id)}')">Track this order</button>
        </article>`;
      }).join('')}
    </div>`;

  if (headerTrackBtn) {
    headerTrackBtn.style.display = 'inline-flex';
    if (headerTokenLabel) headerTokenLabel.textContent = `${activeOrders.length} Active Order${activeOrders.length === 1 ? '' : 's'}`;
  }
}

function handleOrderCompletion(order) {
  if (!order) return;

  // 1. Terminate countdown interval immediately
  if (AppState.countdownInterval) {
    clearInterval(AppState.countdownInterval);
    AppState.countdownInterval = null;
  }

  // 2. Format completed record
  const completedRecord = {
    id: order.id || `ord-${Date.now()}`,
    token: order.token || 'A-100',
    outletId: order.outletId || 'outlet-arya-services-01',
    outletName: order.outletName || 'Arya Services',
    location: order.outletLocation || order.location || 'Food Court • Express Counter',
    status: 'COMPLETED',
    placedAt: order.placedAt || 'Today',
    completedAt: order.completedAt || (new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', Today'),
    items: (order.items || []).map(it => ({
      name: it.name || it.dishName || 'Item',
      variant: it.variant || null,
      qty: it.qty || it.quantity || 1,
      price: Number(it.price) || 0
    })),
    subtotal: order.subtotal || 0,
    convenienceFee: order.convenienceFee || 0,
    total: order.total || order.subtotal || 0,
    paymentMethod: order.paymentMethod || 'CASH_ON_PICKUP'
  };

  // 3. Prepend or update in history (prevent duplicate copies)
  if (!AppState.orderHistory) AppState.orderHistory = [];
  const existingIdx = AppState.orderHistory.findIndex(o => o.token === completedRecord.token || o.id === completedRecord.id);
  if (existingIdx >= 0) {
    AppState.orderHistory[existingIdx] = { ...AppState.orderHistory[existingIdx], ...completedRecord };
  } else {
    AppState.orderHistory.unshift(completedRecord);
  }
  AppState.activeOrders = (AppState.activeOrders || []).filter(item => item.id !== completedRecord.id);
  initOrderHistory();

  // 4. Remove active order from state and storage
  AppState.activeOrder = null;
  localStorage.removeItem('grabngo_active_order');

  // 5. Re-render remaining active orders instead of hiding the whole banner.
  updateActiveOrderBanner();

  // 7. If tracking modal is open, close it cleanly
  const trackingModal = document.getElementById('modal-tracking');
  if (trackingModal && trackingModal.classList.contains('active')) {
    trackingModal.classList.remove('active');
  }

  // 8. Update navigation badges & re-render Previous Orders
  updateOrdersBadge();
  renderPreviousOrders();

  // 9. Thank-you dialog after verified pickup.
  if (!AppState.completedDialogOrderIds.has(completedRecord.id)) {
    AppState.completedDialogOrderIds.add(completedRecord.id);
    showPickupThankYouDialog(completedRecord);
  }
  showToast(`🎉 Order #${completedRecord.token} completed!`, '📦');
}

function getStatusHeadline(status) {
  switch (status) {
    case 'PLACED': return 'Order Placed — Kitchen Preparing';
    case 'CONFIRMED': return 'Order Confirmed by Outlet';
    case 'PREPARING': return 'Chef is Cooking Your Meal 🔥';
    case 'READY_FOR_PICKUP': return '🔔 Food Ready for Express Pickup!';
    case 'COMPLETED': return '✅ Handover Completed. Enjoy!';
    default: return 'Order Active';
  }
}

async function openTrackingModalForOrder(orderId) {
  const selected = (AppState.activeOrders || []).find(order => order.id === orderId)
    || AppState.orderHistory.find(order => order.id === orderId);
  if (!selected || !AppState.authToken) return;
  try {
    const live = await apiRequest(`/api/v1/orders/${encodeURIComponent(selected.id)}/track`);
    AppState.activeOrder = { ...selected, ...live, id: live.orderId || selected.id };
    localStorage.setItem('grabngo_active_order', JSON.stringify(AppState.activeOrder));
    const modal = document.getElementById('modal-tracking');
    if (modal) modal.classList.add('active');
    renderTrackingModalContent();
    startCountdownTimer();
  } catch (err) {
    showToast(`Could not load this order: ${err.message}`, '⚠️');
  }
}

function openTrackingModal() {
  if (!AppState.activeOrder && AppState.activeOrders?.length) {
    openTrackingModalForOrder(AppState.activeOrders[0].id);
    return;
  }
  if (!AppState.activeOrder) return;
  const modal = document.getElementById('modal-tracking');
  if (modal) modal.classList.add('active');
  renderTrackingModalContent();
}

function renderTrackingModalContent() {
  if (!AppState.activeOrder) return;

  const o = AppState.activeOrder;
  document.getElementById('track-token-display').innerHTML = `#${o.token}${o.pickupPin ? ` <span style="font-size: 0.9rem; font-weight: 700; color: #10b981; margin-left: 0.5rem; background: #ecfdf5; padding: 2px 8px; border-radius: 6px; border: 1px solid #10b981;">PIN: ${o.pickupPin}</span>` : ''}`;
  document.getElementById('track-outlet-name').textContent = o.outletName || 'Arya Services Express Counter';

  const queuePosition = document.getElementById('track-queue-position');
  const ordersAhead = document.getElementById('track-orders-ahead');
  if (o.status === 'READY_FOR_PICKUP') {
    if (queuePosition) queuePosition.textContent = 'Ready for pickup';
    if (ordersAhead) ordersAhead.textContent = '—';
  } else if (o.status === 'COMPLETED') {
    if (queuePosition) queuePosition.textContent = 'Completed';
    if (ordersAhead) ordersAhead.textContent = '—';
  } else {
    if (queuePosition) queuePosition.textContent = Number.isInteger(o.queuePosition) ? `${o.queuePosition}` : 'Calculating…';
    if (ordersAhead) ordersAhead.textContent = Number.isInteger(o.ordersAhead) ? `${o.ordersAhead}` : 'Calculating…';
  }

  const trackTimer = document.getElementById('track-countdown-timer');

  if (o.status === 'COMPLETED') {
    if (trackTimer) trackTimer.innerHTML = '<span style="color: #10b981; font-weight: 800; font-size: 1.15rem;">✅ Order Completed</span>';
  } else if (o.status === 'READY_FOR_PICKUP') {
    if (trackTimer) trackTimer.innerHTML = '<span style="color: #10b981; font-weight: 800; font-size: 1.15rem;">🔔 Ready for Pickup!</span>';
  }

  const steps = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED'];
  const currentIndex = steps.indexOf(o.status);

  document.querySelectorAll('.stepper-step').forEach((stepEl, idx) => {
    stepEl.classList.remove('active', 'completed');
    if (idx < currentIndex || o.status === 'COMPLETED') {
      stepEl.classList.add('completed');
    } else if (idx === currentIndex) {
      stepEl.classList.add('active');
    }
  });

  const itemsList = document.getElementById('track-items-summary');
  if (itemsList) {
    itemsList.innerHTML = o.items.map(i => `
      <div style="display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.35rem 0; border-bottom: 1px dashed var(--border-color);">
        <span>${i.qty}x ${i.name} ${i.variant ? `(${i.variant})` : ''}</span>
        <span style="font-weight: 700;">₹${i.price * i.qty}</span>
      </div>
    `).join('');
  }

  // Completed Action Button
  let completedAction = document.getElementById('track-completed-action');
  if (o.status === 'COMPLETED') {
    if (!completedAction) {
      const modalBody = document.querySelector('#modal-tracking .modal-body');
      if (modalBody) {
        completedAction = document.createElement('div');
        completedAction.id = 'track-completed-action';
        completedAction.style.marginTop = '1.25rem';
        completedAction.innerHTML = `
          <button class="btn-checkout-primary" onclick="clearCompletedOrderAndReset()" style="background: #10b981; width: 100%; padding: 0.85rem; font-weight: 800; font-size: 0.95rem;">
            <span>🎉 Meal Collected — Place New Order</span>
          </button>
        `;
        modalBody.appendChild(completedAction);
      }
    }
  } else {
    if (completedAction) completedAction.remove();
  }
}

function startCountdownTimer() {
  if (AppState.countdownInterval) {
    clearInterval(AppState.countdownInterval);
    AppState.countdownInterval = null;
  }

  // If order is already completed, archive it and stop
  if (!AppState.activeOrder) return;
  if (AppState.activeOrder.status === 'COMPLETED') {
    handleOrderCompletion(AppState.activeOrder);
    return;
  }

  let tickCount = 0;
  AppState.countdownInterval = setInterval(async () => {
    if (!AppState.activeOrder) {
      clearInterval(AppState.countdownInterval);
      AppState.countdownInterval = null;
      return;
    }

    // Immediately stop & archive if status changed to COMPLETED
    if (AppState.activeOrder.status === 'COMPLETED') {
      handleOrderCompletion(AppState.activeOrder);
      return;
    }

    // Every 3 seconds, sync authoritative status and ETA from backend.
    tickCount++;
    if (tickCount % 3 === 0 && AppState.activeOrder.id) {
      try {
        const live = await apiRequest(`/api/v1/orders/${encodeURIComponent(AppState.activeOrder.id)}/track`);
        if (live) {
          const previousStatus = AppState.activeOrder.status;
          AppState.activeOrder.status = live.status;
          AppState.activeOrder.remainingSeconds = live.remainingSeconds;
          AppState.activeOrder.estimatedReadyAt = live.estimatedReadyAt;
          AppState.activeOrder.estimatedMinutes = live.estimatedMinutes;
          AppState.activeOrder.queuePosition = live.queuePosition;
          AppState.activeOrder.ordersAhead = live.ordersAhead;
          localStorage.setItem('grabngo_active_order', JSON.stringify(AppState.activeOrder));
          if (live.status === 'COMPLETED') {
            handleOrderCompletion(AppState.activeOrder);
            return;
          }
          if (live.status === 'CANCELLED') {
            clearInterval(AppState.countdownInterval);
            AppState.countdownInterval = null;
            AppState.activeOrder = null;
            localStorage.removeItem('grabngo_active_order');
            updateActiveOrderBanner();
            await initOrderHistory();
            showToast('This order was cancelled by the outlet.', '⚠️');
            return;
          }
          await initOrderHistory();
          updateActiveOrderBanner();
          renderTrackingModalContent();
          if (previousStatus !== 'READY_FOR_PICKUP' && live.status === 'READY_FOR_PICKUP') {
            showToast(`Token #${AppState.activeOrder.token} is READY for pickup!`, '🎉');
          }
        }
      } catch (e) { console.warn('Tracking sync failed:', e.message); }
    }

    if (AppState.activeOrder.status === 'READY_FOR_PICKUP') {
      const trackTimer = document.getElementById('track-countdown-timer');
      if (trackTimer) trackTimer.innerHTML = '<span style="color: #10b981; font-weight: 800; font-size: 1.15rem;">🔔 Ready for Pickup!</span>';
      const bannerSub = document.getElementById('banner-eta-sub');
      if (bannerSub) bannerSub.textContent = `${AppState.activeOrder.outletName || 'Arya Services'} • Ready at Counter`;
      return;
    }

    if (AppState.activeOrder.remainingSeconds <= 0) {
      const trackTimer = document.getElementById('track-countdown-timer');
      if (trackTimer) trackTimer.textContent = 'Ready Shortly';
      const bannerSub = document.getElementById('banner-eta-sub');
      if (bannerSub) bannerSub.textContent = `${AppState.activeOrder.outletName || 'Arya Services'} • Plating Meal`;
      return;
    }

    AppState.activeOrder.remainingSeconds -= 1;
    const mins = Math.floor(AppState.activeOrder.remainingSeconds / 60);
    const secs = AppState.activeOrder.remainingSeconds % 60;
    const timeStr = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;

    const trackTimer = document.getElementById('track-countdown-timer');
    if (trackTimer) trackTimer.textContent = timeStr;

    const bannerSub = document.getElementById('banner-eta-sub');
    if (bannerSub) bannerSub.textContent = `${AppState.activeOrder.outletName || 'Arya Services'} • Ready in ~${timeStr}`;
  }, 1000);
}

function clearCompletedOrderAndReset() {
  if (AppState.countdownInterval) {
    clearInterval(AppState.countdownInterval);
    AppState.countdownInterval = null;
  }
  if (AppState.activeOrder) {
    handleOrderCompletion(AppState.activeOrder);
  }
  AppState.activeOrder = null;
  localStorage.removeItem('grabngo_active_order');

  const modal = document.getElementById('modal-tracking');
  if (modal) modal.classList.remove('active');

  const banner = document.getElementById('active-order-banner');
  if (banner) banner.style.display = 'none';

  const headerTrackBtn = document.getElementById('btn-header-order-track');
  if (headerTrackBtn) headerTrackBtn.style.display = 'none';

  const completedAction = document.getElementById('track-completed-action');
  if (completedAction) completedAction.remove();

  const bannerNewBtn = document.getElementById('btn-banner-new-order');
  if (bannerNewBtn) bannerNewBtn.remove();

  showToast('Ready for your next meal! 🍛', '✨');
}

async function refreshPassStatus() {
  if (!AppState.authToken || !AppState.user) return;
  try {
    const pass = await apiRequest(`/api/v1/subscriptions?studentRoll=${encodeURIComponent(AppState.user.roll)}`);
    AppState.hasStudentPass = !!(pass && pass.status === 'ACTIVE' && new Date(pass.activeUntil) > new Date());
    updateUserUI();
  } catch (err) { console.warn('Pass status unavailable:', err.message); }
}

function initPass() {
  const passBtn = document.getElementById('btn-header-pass');
  const passModal = document.getElementById('modal-pass');
  const closePassBtn = document.getElementById('btn-close-pass');
  const activatePassBtn = document.getElementById('btn-activate-pass');
  if (passBtn) passBtn.addEventListener('click', () => passModal?.classList.add('active'));
  if (closePassBtn) closePassBtn.addEventListener('click', () => passModal?.classList.remove('active'));
  if (activatePassBtn) activatePassBtn.addEventListener('click', async () => {
    if (!AppState.user || !AppState.authToken) {
      showToast('Sign in before purchasing a Pass.', '⚠️');
      openAuthModal();
      return;
    }
    try {
      const result = await apiRequest('/api/v1/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ plan: 'CAMPUS_PASS_PRO' })
      });
      if (result?.status === 'ACTIVE') {
        await refreshPassStatus();
        passModal?.classList.remove('active');
        showToast('Pass activation confirmed by the server.', '✨');
      }
    } catch (err) {
      showToast(err.message, '⚠️');
    }
  });
}

// ====================================================================
// CROSS-TAB// ====================================================================
// CROSS-TAB SYNCHRONIZATION: Listen for Vendor KDS Status Transitions
// ====================================================================
window.addEventListener('storage', (e) => {
  if (e.key === 'grabngo_active_order') {
    if (!e.newValue) {
      // Active order removed or completed in another tab
      if (AppState.activeOrder) {
        handleOrderCompletion(AppState.activeOrder);
      } else {
        const banner = document.getElementById('active-order-banner');
        if (banner) banner.style.display = 'none';
        const headerTrackBtn = document.getElementById('btn-header-order-track');
        if (headerTrackBtn) headerTrackBtn.style.display = 'none';
        if (AppState.countdownInterval) {
          clearInterval(AppState.countdownInterval);
          AppState.countdownInterval = null;
        }
      }
    } else {
      try {
        const updated = JSON.parse(e.newValue);
        if (updated.status === 'COMPLETED') {
          handleOrderCompletion(updated);
        } else {
          AppState.activeOrder = updated;
          updateActiveOrderBanner();
          renderTrackingModalContent();
          if (updated.status === 'READY_FOR_PICKUP') {
            showToast(`🔔 Token #${updated.token} is READY for Express Pickup! PIN: ${updated.pickupPin || ''}`, '🎉');
          }
        }
      } catch (err) {}
    }
  } else if (e.key === 'grabngo_order_history') {
    initOrderHistory();
  }
});
