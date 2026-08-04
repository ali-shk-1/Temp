// Use the same host/port the page was loaded from, so this works whether
// you open it as http://localhost:5000 or http://<server-ip>:5000 from
// another device on the network.
const BASE_URL = window.location.origin;

function getToken() {
  return sessionStorage.getItem('token');
}

function logout() {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  window.location.href = 'login.html';
}

function checkAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

function renderNav(activePage) {
  const user = JSON.parse(sessionStorage.getItem('user') || '{}');
  const pages = [
    { href: 'dashboard.html', label: 'Dashboard', key: 'dashboard' },
    { href: 'students.html',  label: 'Students',  key: 'students'  },
    { href: 'staff.html',     label: 'Staff',     key: 'staff'     },
    { href: 'fees.html',      label: 'Fees',      key: 'fees'      },
    { href: 'expenses.html',  label: 'Expenses',  key: 'expenses'  },
  ];

  const links = pages.map(p =>
    `<a href="${p.href}" class="${activePage === p.key ? 'active' : ''}">${p.label}</a>`
  ).join('');

  const nav = document.createElement('div');
  nav.innerHTML = `
    <nav class="navbar">
      <a class="brand" href="dashboard.html">🏫 School Mgmt</a>
      <nav>${links}</nav>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="color:#aaa;font-size:12px;">${user.username || ''}</span>
        <button class="logout-btn" onclick="logout()">Logout</button>
      </div>
    </nav>
  `;
  document.body.insertBefore(nav.firstElementChild, document.body.firstChild);
}

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(BASE_URL + path, opts);

  if (res.status === 401) {
    logout();
    return;
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB');
}

function formatMoney(n) {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 0 });
}

function normalizeList(res, hints = []) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  for (const key of hints) {
    if (Array.isArray(res[key])) return res[key];
  }
  for (const key of Object.keys(res)) {
    if (Array.isArray(res[key])) return res[key];
  }
  return [];
}

function dbg(label, val) {
  console.log(`[DBG] ${label}:`, JSON.stringify(val)?.slice(0, 300));
}