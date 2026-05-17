const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(require('cookie-parser')());
app.use(express.static(path.join(__dirname, 'public')));

// in-memory sessions: token -> { userId, createdAt }
const sessions = {};

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { userId, createdAt: Date.now() };
  return token;
}

function getSession(token) {
  return sessions[token] || null;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('SQLite error:', err.message);
  else console.log('SQLite connected');
});

// === MIGRATIONS / SCHEMA ===
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS list_access (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(list_id, user_id),
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit TEXT DEFAULT 'шт',
    price REAL DEFAULT 0,
    responsible TEXT,
    purchased INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
  )`);

  // migrate old lists without owner_id: add column if missing
  db.get(`PRAGMA table_info(lists)`, (err, row) => {
    if (err) return;
    // PRAGMA returns rows; we need to check if owner_id exists. Simpler: try ALTER and ignore error
    db.run(`ALTER TABLE lists ADD COLUMN owner_id TEXT`, (err2) => {
      if (err2 && !err2.message.includes('duplicate column')) {
        // console.log(err2.message);
      }
    });
  });
});

// === MIDDLEWARE ===
function authMiddleware(req, res, next) {
  const token = req.cookies?.session;
  const sess = token ? getSession(token) : null;
  if (!sess) return res.status(401).json({ error: 'Требуется авторизация' });
  db.get('SELECT id, username FROM users WHERE id = ?', [sess.userId], (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Сессия недействительна' });
    req.user = user;
    next();
  });
}

function requireAuth(req, res, next) {
  authMiddleware(req, res, next);
}

function checkListAccess(req, res, next) {
  const { listId } = req.params;
  const userId = req.user.id;
  db.get('SELECT owner_id FROM lists WHERE id = ?', [listId], (err, list) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!list) return res.status(404).json({ error: 'Список не найден' });
    if (list.owner_id === userId) {
      req.listRole = 'owner';
      return next();
    }
    db.get('SELECT 1 FROM list_access WHERE list_id = ? AND user_id = ?', [listId, userId], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (!row) return res.status(403).json({ error: 'Нет доступа к списку' });
      req.listRole = 'member';
      next();
    });
  });
}

// === AUTH ===

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
  const id = uuidv4();
  const hash = hashPassword(password);
  db.run('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)', [id, username, hash], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Пользователь уже существует' });
      return res.status(500).json({ error: err.message });
    }
    const token = createSession(id);
    res.cookie('session', token, { httpOnly: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.status(201).json({ id, username });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
  db.get('SELECT id, username, password_hash FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user || user.password_hash !== hashPassword(password)) return res.status(401).json({ error: 'Неверный логин или пароль' });
    const token = createSession(user.id);
    res.cookie('session', token, { httpOnly: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ id: user.id, username: user.username });
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) delete sessions[token];
  res.clearCookie('session');
  res.json({ message: 'Выход выполнен' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

// === LISTS ===

app.get('/api/lists', requireAuth, (req, res) => {
  const userId = req.user.id;
  db.all(`
    SELECT l.*, u.username as owner_name FROM lists l
    JOIN users u ON u.id = l.owner_id
    WHERE l.owner_id = ? OR l.id IN (SELECT list_id FROM list_access WHERE user_id = ?)
    ORDER BY l.updated_at DESC
  `, [userId, userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/lists', requireAuth, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Название обязательно' });
  const id = uuidv4();
  db.run('INSERT INTO lists (id, name, description, owner_id) VALUES (?, ?, ?, ?)', [id, name, description || '', req.user.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id, name, description: description || '', owner_id: req.user.id });
  });
});

app.get('/api/lists/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  db.get('SELECT * FROM lists WHERE id = ?', [id], (err, list) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!list) return res.status(404).json({ error: 'Список не найден' });
    // access check
    if (list.owner_id !== userId) {
      db.get('SELECT 1 FROM list_access WHERE list_id = ? AND user_id = ?', [id, userId], (err2, row) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (!row) return res.status(403).json({ error: 'Нет доступа' });
        fetchListDetails(id, list, res);
      });
    } else {
      fetchListDetails(id, list, res);
    }
  });
});

function fetchListDetails(id, list, res) {
  db.all('SELECT * FROM items WHERE list_id = ? ORDER BY created_at', [id], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all('SELECT a.id, u.username as name, u.id as user_id FROM list_access a JOIN users u ON u.id = a.user_id WHERE a.list_id = ?', [id], (err, accessMembers) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get('SELECT username FROM users WHERE id = ?', [list.owner_id], (err2, owner) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ ...list, items, members: accessMembers, owner_name: owner?.username || '' });
      });
    });
  });
}

app.put('/api/lists/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  db.get('SELECT owner_id FROM lists WHERE id = ?', [id], (err, list) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!list) return res.status(404).json({ error: 'Список не найден' });
    if (list.owner_id !== req.user.id) return res.status(403).json({ error: 'Только владелец может редактировать список' });
    db.run('UPDATE lists SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, description, id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ id, name, description });
    });
  });
});

app.delete('/api/lists/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.get('SELECT owner_id FROM lists WHERE id = ?', [id], (err, list) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!list) return res.status(404).json({ error: 'Список не найден' });
    if (list.owner_id !== req.user.id) return res.status(403).json({ error: 'Только владелец может удалить список' });
    db.run('DELETE FROM lists WHERE id = ?', [id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: 'Список удален' });
    });
  });
});

// === INVITE / LIST ACCESS ===

app.post('/api/lists/:listId/invite', requireAuth, (req, res) => {
  const { listId } = req.params;
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите имя пользователя' });
  db.get('SELECT owner_id FROM lists WHERE id = ?', [listId], (err, list) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!list) return res.status(404).json({ error: 'Список не найден' });
    if (list.owner_id !== req.user.id) return res.status(403).json({ error: 'Только владелец может приглашать' });

    db.get('SELECT id FROM users WHERE username = ?', [username], (err2, target) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
      if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя пригласить себя' });

      const id = uuidv4();
      db.run('INSERT INTO list_access (id, list_id, user_id) VALUES (?, ?, ?)', [id, listId, target.id], function(err3) {
        if (err3) {
          if (err3.message.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Пользователь уже имеет доступ' });
          return res.status(500).json({ error: err3.message });
        }
        res.status(201).json({ id, list_id: listId, user_id: target.id, username });
      });
    });
  });
});

app.delete('/api/lists/:listId/access/:userId', requireAuth, (req, res) => {
  const { listId, userId } = req.params;
  db.get('SELECT owner_id FROM lists WHERE id = ?', [listId], (err, list) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!list) return res.status(404).json({ error: 'Список не найден' });
    if (list.owner_id !== req.user.id) return res.status(403).json({ error: 'Только владелец может удалять доступ' });
    db.run('DELETE FROM list_access WHERE list_id = ? AND user_id = ?', [listId, userId], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: 'Доступ удален' });
    });
  });
});

// === ITEMS ===

app.post('/api/lists/:listId/items', requireAuth, checkListAccess, (req, res) => {
  const { listId } = req.params;
  const { name, quantity, unit, price, responsible } = req.body;
  if (!name) return res.status(400).json({ error: 'Название товара обязательно' });
  const id = uuidv4();
  db.run('INSERT INTO items (id, list_id, name, quantity, unit, price, responsible) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, listId, name, quantity || 1, unit || 'шт', price || 0, responsible || ''], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    db.run('UPDATE lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [listId]);
    res.status(201).json({ id, list_id: listId, name, quantity: quantity || 1, unit: unit || 'шт', price: price || 0, responsible: responsible || '', purchased: 0 });
  });
});

app.put('/api/items/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { name, quantity, unit, price, responsible, purchased } = req.body;
  db.get('SELECT list_id FROM items WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Товар не найден' });
    req.params.listId = row.list_id;
    checkListAccess(req, res, () => {
      const fields = [];
      const values = [];
      if (name !== undefined) { fields.push('name = ?'); values.push(name); }
      if (quantity !== undefined) { fields.push('quantity = ?'); values.push(quantity); }
      if (unit !== undefined) { fields.push('unit = ?'); values.push(unit); }
      if (price !== undefined) { fields.push('price = ?'); values.push(price); }
      if (responsible !== undefined) { fields.push('responsible = ?'); values.push(responsible); }
      if (purchased !== undefined) { fields.push('purchased = ?'); values.push(purchased ? 1 : 0); }
      if (fields.length === 0) return res.status(400).json({ error: 'Нет данных для обновления' });
      values.push(id);
      db.run(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, values, function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        db.run('UPDATE lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [row.list_id]);
        res.json({ id });
      });
    });
  });
});

app.delete('/api/items/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.get('SELECT list_id FROM items WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Товар не найден' });
    req.params.listId = row.list_id;
    checkListAccess(req, res, () => {
      db.run('DELETE FROM items WHERE id = ?', [id], function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        db.run('UPDATE lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [row.list_id]);
        res.json({ message: 'Товар удален' });
      });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
