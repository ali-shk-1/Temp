function renderNav(activePage) {
  const user = JSON.parse(sessionStorage.getItem('user') || '{}');
  const pages = [
    { href: 'dashboard.html', label: 'Dashboard', key: 'dashboard' },
    { href: 'students.html',  label: 'Students',  key: 'students'  },
    { href: 'left-students.html', label: 'Left Students', key: 'left-students' },
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