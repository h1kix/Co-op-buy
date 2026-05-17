const API = '';
const app = document.getElementById('app');
let currentModal = null;
let currentUser = null;

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function checkAuth() {
  try {
    currentUser = await fetchJSON(`${API}/api/auth/me`);
    updateHeader();
    return true;
  } catch (e) {
    currentUser = null;
    updateHeader();
    return false;
  }
}

function updateHeader() {
  const userEl = document.getElementById('user-info');
  if (!userEl) return;
  if (currentUser) {
    userEl.innerHTML = `
      <span style="color:var(--text-muted);font-size:0.9rem">${escapeHtml(currentUser.username)}</span>
      <button class="btn btn-ghost btn-sm" id="btn-logout">Выйти</button>
    `;
    $('#btn-logout').addEventListener('click', async () => {
      await fetchJSON(`${API}/api/auth/logout`, { method: 'POST' });
      currentUser = null;
      navigate('auth');
    });
  } else {
    userEl.innerHTML = '';
  }
}

// === ROUTING ===
function parseRoute() {
  const hash = location.hash.replace(/^#/, '');
  const [page, id] = hash.split('/');
  return { page: page || 'home', id };
}

function navigate(page, id) {
  location.hash = id ? `#${page}/${id}` : `#${page}`;
}

async function render() {
  const { page, id } = parseRoute();
  const authed = await checkAuth();
  if (!authed && page !== 'auth') {
    navigate('auth');
    return;
  }
  if (page === 'auth') renderAuth();
  else if (page === 'home') renderHome();
  else if (page === 'list') renderList(id);
  else renderHome();
}

window.addEventListener('hashchange', render);

// === AUTH PAGE ===
function renderAuth() {
  app.innerHTML = `
    <div class="auth-container">
      <div class="auth-box">
        <h2 class="auth-title">Co-op Buy</h2>
        <p class="auth-subtitle">Войдите или зарегистрируйтесь</p>
        <div class="form-group">
          <label class="form-label">Логин</label>
          <input class="form-input" id="auth-username" placeholder="username">
        </div>
        <div class="form-group">
          <label class="form-label">Пароль</label>
          <input class="form-input" id="auth-password" type="password" placeholder="password">
        </div>
        <div class="auth-actions">
          <button class="btn btn-primary" style="flex:1" id="btn-login">Войти</button>
          <button class="btn btn-ghost" style="flex:1" id="btn-register">Регистрация</button>
        </div>
        <div id="auth-error" style="color:var(--danger);margin-top:0.75rem;font-size:0.9rem;text-align:center"></div>
      </div>
    </div>
  `;
  $('#btn-login').addEventListener('click', async () => {
    const username = $('#auth-username').value.trim();
    const password = $('#auth-password').value;
    $('#auth-error').textContent = '';
    try {
      await fetchJSON(`${API}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username, password }) });
      currentUser = await checkAuth();
      navigate('home');
    } catch (e) { $('#auth-error').textContent = e.message; }
  });
  $('#btn-register').addEventListener('click', async () => {
    const username = $('#auth-username').value.trim();
    const password = $('#auth-password').value;
    $('#auth-error').textContent = '';
    try {
      await fetchJSON(`${API}/api/auth/register`, { method: 'POST', body: JSON.stringify({ username, password }) });
      currentUser = await checkAuth();
      navigate('home');
    } catch (e) { $('#auth-error').textContent = e.message; }
  });
}

// === HOME PAGE ===
async function renderHome() {
  app.innerHTML = '<div class="page-title">Мои списки покупок</div><div id="lists-container">Загрузка...</div>';
  try {
    const lists = await fetchJSON(`${API}/api/lists`);
    const container = document.getElementById('lists-container');
    if (!lists.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🛒</div>
          <div>Пока нет списков покупок</div>
          <div style="margin-top:0.5rem">Нажмите «Новый список», чтобы создать первый</div>
        </div>`;
      return;
    }
    container.innerHTML = `<div class="lists-grid">${lists.map(list => `
      <div class="list-card" onclick="navigate('list','${list.id}')">
        <div class="list-card-name">${escapeHtml(list.name)}</div>
        <div class="list-card-desc">${escapeHtml(list.description || 'Нет описания')}</div>
        <div class="list-card-stats">
          <span>${formatDate(list.updated_at)}</span>
          ${list.owner_id === currentUser.id ? '<span style="color:var(--primary)">владелец</span>' : '<span style="color:var(--text-muted)">участник</span>'}
        </div>
      </div>
    `).join('')}</div>`;
  } catch (e) {
    app.innerHTML = `<div class="empty-state">Ошибка загрузки: ${escapeHtml(e.message)}</div>`;
  }
}

// === LIST PAGE ===
async function renderList(id) {
  app.innerHTML = '<div>Загрузка...</div>';
  try {
    const list = await fetchJSON(`${API}/api/lists/${id}`);
    const items = list.items || [];
    const members = list.members || [];
    const isOwner = list.owner_id === currentUser.id;
    const purchasedCount = items.filter(i => i.purchased).length;
    const total = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
    const remaining = items.reduce((s, i) => s + (i.purchased ? 0 : (i.price || 0) * (i.quantity || 1)), 0);

    app.innerHTML = `
      <a href="#home" class="back-link">← Назад к спискам</a>
      <div class="page-title">${escapeHtml(list.name)}</div>
      <div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:1rem">Владелец: ${escapeHtml(list.owner_name || 'Неизвестно')}</div>

      <div class="summary-bar">
        <div class="summary-left">
          <div><span class="summary-label">Куплено:</span> <span class="summary-value">${purchasedCount} / ${items.length}</span></div>
          <div><span class="summary-label">Осталось:</span> <span class="summary-value">${remaining.toFixed(2)} ₽</span></div>
          <div><span class="summary-label">Всего:</span> <span class="summary-value">${total.toFixed(2)} ₽</span></div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="copyShareLink('${list.id}')">🔗 Копировать ссылку</button>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Товары</div>
          <button class="btn btn-primary btn-sm" onclick="openAddItemModal('${list.id}')">+ Добавить товар</button>
        </div>
        <div id="items-container" class="items-list">
          ${renderItemsHTML(items)}
        </div>
      </div>

      <div class="card" style="margin-top:1rem">
        <div class="card-header">
          <div class="card-title">Участники</div>
          ${isOwner ? `<button class="btn btn-ghost btn-sm" onclick="openInviteModal('${list.id}')">+ Пригласить</button>` : ''}
        </div>
        <div class="members-tags" id="members-container">
          <span class="member-tag" style="background:var(--success-light);color:var(--success)">${escapeHtml(list.owner_name || 'владелец')}</span>
          ${members.map(m => `
            <span class="member-tag">
              ${escapeHtml(m.name)}
              ${isOwner ? `<button onclick="removeAccess('${list.id}','${m.user_id}')" title="Удалить доступ">×</button>` : ''}
            </span>
          `).join('')}
        </div>
      </div>

      ${isOwner ? `
      <div class="card" style="margin-top:1rem">
        <div class="card-header">
          <div class="card-title">Управление списком</div>
        </div>
        <div class="row">
          <button class="btn btn-danger" onclick="deleteList('${list.id}')">Удалить список</button>
        </div>
      </div>` : ''}
    `;
  } catch (e) {
    if (e.message.includes('401') || e.message.includes('403')) {
      app.innerHTML = `<div class="empty-state">Нет доступа к этому списку</div>`;
    } else {
      app.innerHTML = `<div class="empty-state">Ошибка загрузки списка: ${escapeHtml(e.message)}</div>`;
    }
  }
}

function renderItemsHTML(items) {
  if (!items.length) {
    return '<div class="empty-state" style="padding:2rem 0"><div>Нет товаров в списке</div></div>';
  }
  return items.map(item => `
    <div class="item-row ${item.purchased ? 'purchased' : ''}">
      <input type="checkbox" class="item-checkbox" ${item.purchased ? 'checked' : ''}
        onchange="toggleItem('${item.id}',this.checked)">
      <div class="item-info">
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-meta">
          ${item.quantity || 1} ${escapeHtml(item.unit || 'шт')}
          ${item.responsible ? ' · Ответственный: ' + escapeHtml(item.responsible) : ''}
        </div>
      </div>
      <div class="item-price">${((item.price || 0) * (item.quantity || 1)).toFixed(2)} ₽</div>
      <div class="item-actions">
        <button class="btn btn-ghost btn-icon" onclick="openEditItemModal('${item.id}')" title="Редактировать">✎</button>
        <button class="btn btn-ghost btn-icon" style="color:var(--danger)" onclick="deleteItem('${item.id}')" title="Удалить">🗑</button>
      </div>
    </div>
  `).join('');
}

// === ACTIONS ===
async function toggleItem(itemId, purchased) {
  try {
    await fetchJSON(`${API}/api/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ purchased }) });
    const { page, id } = parseRoute();
    if (page === 'list') renderList(id);
  } catch (e) { alert(e.message); }
}

async function deleteItem(itemId) {
  if (!confirm('Удалить товар?')) return;
  try {
    await fetchJSON(`${API}/api/items/${itemId}`, { method: 'DELETE' });
    const { page, id } = parseRoute();
    if (page === 'list') renderList(id);
  } catch (e) { alert(e.message); }
}

async function removeAccess(listId, userId) {
  if (!confirm('Удалить доступ пользователю?')) return;
  try {
    await fetchJSON(`${API}/api/lists/${listId}/access/${userId}`, { method: 'DELETE' });
    renderList(listId);
  } catch (e) { alert(e.message); }
}

async function deleteList(listId) {
  if (!confirm('Удалить весь список? Это действие необратимо.')) return;
  try {
    await fetchJSON(`${API}/api/lists/${listId}`, { method: 'DELETE' });
    navigate('home');
  } catch (e) { alert(e.message); }
}

function copyShareLink(listId) {
  const url = `${location.origin}${location.pathname}#list/${listId}`;
  navigator.clipboard.writeText(url).then(() => alert('Ссылка скопирована!')).catch(() => prompt('Скопируйте ссылку:', url));
}

// === MODALS ===
function openModal(title, bodyHTML, onConfirm) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-title">${escapeHtml(title)}</div>
      <div class="modal-body">${bodyHTML}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
        <button class="btn btn-primary" id="modal-confirm">Сохранить</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  currentModal = overlay;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  $('#modal-confirm').addEventListener('click', () => { onConfirm(); });
}

function closeModal() {
  if (currentModal) { currentModal.remove(); currentModal = null; }
}

function openNewListModal() {
  openModal('Новый список покупок', `
    <div class="form-group">
      <label class="form-label">Название</label>
      <input class="form-input" id="inp-list-name" placeholder="Например, Продукты на неделю">
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <textarea class="form-textarea" id="inp-list-desc" placeholder="Опционально..."></textarea>
    </div>
  `, async () => {
    const name = $('#inp-list-name').value.trim();
    const description = $('#inp-list-desc').value.trim();
    if (!name) return alert('Введите название');
    try {
      const list = await fetchJSON(`${API}/api/lists`, { method: 'POST', body: JSON.stringify({ name, description }) });
      closeModal();
      navigate('list', list.id);
    } catch (e) { alert(e.message); }
  });
}

function openAddItemModal(listId) {
  openModal('Добавить товар', `
    <div class="form-group">
      <label class="form-label">Название товара</label>
      <input class="form-input" id="inp-item-name" placeholder="Например, Молоко">
    </div>
    <div class="row">
      <div class="form-group">
        <label class="form-label">Количество</label>
        <input class="form-input" id="inp-item-qty" type="number" step="any" value="1">
      </div>
      <div class="form-group">
        <label class="form-label">Единица</label>
        <input class="form-input" id="inp-item-unit" value="шт" placeholder="шт, кг, л...">
      </div>
      <div class="form-group">
        <label class="form-label">Цена за ед. (₽)</label>
        <input class="form-input" id="inp-item-price" type="number" step="any" value="0" placeholder="0">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Ответственный</label>
      <input class="form-input" id="inp-item-resp" placeholder="Имя">
    </div>
  `, async () => {
    const name = $('#inp-item-name').value.trim();
    const quantity = parseFloat($('#inp-item-qty').value) || 1;
    const unit = $('#inp-item-unit').value.trim() || 'шт';
    const price = parseFloat($('#inp-item-price').value) || 0;
    const responsible = $('#inp-item-resp').value.trim();
    if (!name) return alert('Введите название товара');
    try {
      await fetchJSON(`${API}/api/lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ name, quantity, unit, price, responsible }) });
      closeModal();
      renderList(listId);
    } catch (e) { alert(e.message); }
  });
}

async function openEditItemModal(itemId) {
  try {
    const allLists = await fetchJSON(`${API}/api/lists`);
    let item = null;
    for (const l of allLists) {
      const detail = await fetchJSON(`${API}/api/lists/${l.id}`);
      const found = detail.items.find(i => i.id === itemId);
      if (found) { item = found; break; }
    }
    if (!item) return alert('Товар не найден');

    openModal('Редактировать товар', `
      <div class="form-group">
        <label class="form-label">Название товара</label>
        <input class="form-input" id="inp-edit-name" value="${escapeHtml(item.name)}">
      </div>
      <div class="row">
        <div class="form-group">
          <label class="form-label">Количество</label>
          <input class="form-input" id="inp-edit-qty" type="number" step="any" value="${item.quantity || 1}">
        </div>
        <div class="form-group">
          <label class="form-label">Единица</label>
          <input class="form-input" id="inp-edit-unit" value="${escapeHtml(item.unit || 'шт')}">
        </div>
        <div class="form-group">
          <label class="form-label">Цена за ед. (₽)</label>
          <input class="form-input" id="inp-edit-price" type="number" step="any" value="${item.price || 0}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Ответственный</label>
        <input class="form-input" id="inp-edit-resp" value="${escapeHtml(item.responsible || '')}">
      </div>
    `, async () => {
      const name = $('#inp-edit-name').value.trim();
      const quantity = parseFloat($('#inp-edit-qty').value);
      const unit = $('#inp-edit-unit').value.trim();
      const price = parseFloat($('#inp-edit-price').value);
      const responsible = $('#inp-edit-resp').value.trim();
      if (!name) return alert('Введите название');
      try {
        await fetchJSON(`${API}/api/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ name, quantity, unit, price, responsible }) });
        closeModal();
        const { page, id } = parseRoute();
        if (page === 'list') renderList(id);
      } catch (e) { alert(e.message); }
    });
  } catch (e) { alert(e.message); }
}

function openInviteModal(listId) {
  openModal('Пригласить пользователя', `
    <div class="form-group">
      <label class="form-label">Логин пользователя</label>
      <input class="form-input" id="inp-invite-user" placeholder="username">
    </div>
    <p style="font-size:0.85rem;color:var(--text-muted)">Пользователь получит доступ к списку как участник.</p>
  `, async () => {
    const username = $('#inp-invite-user').value.trim();
    if (!username) return alert('Введите логин');
    try {
      await fetchJSON(`${API}/api/lists/${listId}/invite`, { method: 'POST', body: JSON.stringify({ username }) });
      closeModal();
      renderList(listId);
    } catch (e) { alert(e.message); }
  });
}

// === UTILS ===
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('ru-RU');
}

// === INIT ===
$('#btn-home').addEventListener('click', () => navigate('home'));
$('#btn-new-list').addEventListener('click', openNewListModal);

render();
