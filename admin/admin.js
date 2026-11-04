/**
 * Grab n Go — Campus Food Court Administration Portal
 * Role: IIT Patna Dining Supervisory Committee & Estate Management
 * Connects with /api/v1/admin/analytics
 */

const AdminState = {
  adminSession: null,
  analytics: null
};


document.addEventListener('DOMContentLoaded', () => {
  initAuthForm();
  checkAdminSession();
  renderAdminMetrics();
});

function adminHeaders(extra = {}) {
  const token = AdminState.adminSession?.token;
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function checkAdminSession() {
  const saved = localStorage.getItem('grabngo_admin_session');
  if (!saved) {
    showAuth();
    return;
  }
  try {
    const cached = JSON.parse(saved);
    if (!cached?.token) throw new Error('Missing administrator token');
    const response = await fetch('/api/v1/admin/auth/me', {
      headers: { Authorization: `Bearer ${cached.token}` }
    });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error('Administrator session expired');
    AdminState.adminSession = { ...json.data.session, token: cached.token };
    localStorage.setItem('grabngo_admin_session', JSON.stringify(AdminState.adminSession));
    showMainAdmin();
  } catch (_) {
    localStorage.removeItem('grabngo_admin_session');
    AdminState.adminSession = null;
    showAuth();
  }
}

function showAuth() {
  document.getElementById('admin-auth-view').style.display = 'flex';
  document.getElementById('admin-main-view').style.display = 'none';
}

function showMainAdmin() {
  document.getElementById('admin-auth-view').style.display = 'none';
  document.getElementById('admin-main-view').style.display = 'block';
  if (AdminState.adminSession) {
    document.getElementById('admin-officer-name').textContent =
      AdminState.adminSession.officerName || AdminState.adminSession.name || AdminState.adminSession.email;
  }
  renderAdminMetrics();
  fetchLiveAnalytics();
}

function initAuthForm() {
  const form = document.getElementById('admin-login-form');
  if (form) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const email = document.getElementById('admin-input-email').value.trim();
      const password = document.getElementById('admin-input-key').value;
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const response = await fetch('/api/v1/admin/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const json = await response.json();
        if (!response.ok || !json.success) {
          throw new Error(json.message || 'Administrator sign-in failed');
        }
        AdminState.adminSession = { ...json.data.session, token: json.data.token };
        localStorage.setItem('grabngo_admin_session', JSON.stringify(AdminState.adminSession));
        showToast('Welcome to Campus Dining Administration', '📊');
        showMainAdmin();
      } catch (error) {
        showToast(error.message, '⚠️');
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  const logoutBtn = document.getElementById('btn-admin-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('grabngo_admin_session');
      AdminState.adminSession = null;
      showToast('Logged out of Admin Portal', '👋');
      showAuth();
    });
  }
}

function showToast(message, icon = '📊') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.innerHTML = `<span>${icon}</span> <span></span>`;
  toast.lastElementChild.textContent = String(message);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

async function fetchLiveAnalytics() {
  try {
    const res = await fetch('/api/v1/admin/analytics', {
      headers: adminHeaders()
    });
    if (res.status === 401) {
      localStorage.removeItem('grabngo_admin_session');
      AdminState.adminSession = null;
      showAuth();
      return;
    }
    if (!res.ok) throw new Error(`Analytics request failed (${res.status})`);
    const json = await res.json();
    if (!json.success || !json.data) throw new Error(json.message || 'Analytics response was invalid');
    AdminState.analytics = json.data;
    updateKpiCards(json.data.kpis);
    renderOutletsTableFromApi(json.data.outletBreakdown || []);
  } catch (err) {
    const tableBody = document.getElementById('admin-outlet-table-body');
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="8">Live analytics could not be loaded. Check the server connection and sign in again.</td></tr>';
    }
    console.error('Admin analytics load failed:', err);
  }
}

function updateKpiCards(kpis) {
  if (!kpis) return;
  const ordersEl = document.getElementById('admin-kpi-orders');
  const savedEl = document.getElementById('admin-kpi-saved');
  const turnaroundEl = document.getElementById('admin-kpi-turnaround');
  const accuracyEl = document.getElementById('admin-kpi-pickups');

  if (ordersEl) ordersEl.textContent = kpis.totalOrdersToday;
  if (savedEl) savedEl.textContent = `${kpis.studentBreakHoursSaved}h`;
  if (turnaroundEl) turnaroundEl.textContent = `${kpis.avgTurnaroundMinutes}m`;
  if (accuracyEl) accuracyEl.textContent = Number(kpis.completedOrders || 0).toLocaleString('en-IN');
}


function renderOutletsTableFromApi(outletBreakdown) {
  const tableBody = document.getElementById('admin-outlet-table-body');
  if (!tableBody) return;

  tableBody.innerHTML = (outletBreakdown || []).map(outlet => {
    const gross = Number(outlet.grossSales) || 0;
    const commission = Number(outlet.commissionFee) || 0;
    const net = Number(outlet.netPayout) || 0;
    const backlog = Number(outlet.activeBacklog) || 0;
    const congestion = outlet.congestionLevel || 'UNKNOWN';
    const congestionClass = congestion === 'LOW'
      ? 'badge-low'
      : congestion === 'MODERATE'
        ? 'badge-moderate'
        : 'badge-busy';

    return `
      <tr>
        <td>
          <strong>${escapeAdminHtml(outlet.name)}</strong><br>
          <span style="font-size:.75rem;color:#64748b;">${escapeAdminHtml(outlet.location)}</span>
        </td>
        <td><strong>${backlog}</strong> active orders</td>
        <td>~${Number(outlet.estimatedWaitMinutes) || 0} mins</td>
        <td><span class="congestion-badge ${congestionClass}">${escapeAdminHtml(congestion)}</span></td>
        <td>₹${gross.toLocaleString('en-IN')}</td>
        <td>₹${commission.toLocaleString('en-IN')} (3.5%)</td>
        <td><strong style="color:#059669;">₹${net.toLocaleString('en-IN')}</strong></td>
        <td>${outlet.status === 'ACTIVE' ? '🟢 Menu active' : '🟠 Menu not configured'}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="8">No outlet analytics available yet.</td></tr>';
}

function escapeAdminHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function renderAdminMetrics() {
  const tableBody = document.getElementById('admin-outlet-table-body');
  if (tableBody) {
    tableBody.innerHTML = '<tr><td colspan="8">Loading live outlet analytics…</td></tr>';
  }
}

