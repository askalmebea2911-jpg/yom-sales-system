// አስፈላጊ እቃዎችን ጥራ
const express = require('express');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

// ሚስጥራዊ ቁልፎችን ከ .env ፋይል አምጣ (በኮምፒውተርህ ስትሰራ)
dotenv.config();

const app = express();
// ሬንደር የሚፈልገው በር ቁጥር ነው፣ ካልሆነ 10000 ተጠቀም
const PORT = process.env.PORT || 10000;

// መሀል ሰራተኞች
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ሴሽን (ማንነት ማስታወሻ) ማዘጋጃ
app.use(session({
  // ሚስጥሩን ከሬንደር አካባቢ አምጣ፣ ካልተገኘ በኮምፒውተርህ የሚሰራውን ተጠቀም
  secret: process.env.SESSION_SECRET || 'yom_amharic_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

let db;

// የውሂብ ሳጥን አዘጋጅ
async function initDB() {
  // ሬንደር ላይ ከሆነ የተለየ መንገድ ተጠቀም
  const dbPath = process.env.DATABASE_URL || './yom_sales.db';
  
  db = await open({ 
    filename: dbPath, 
    driver: sqlite3.Database 
  });
  
  // ሰንጠረዦችን ፍጠር
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT DEFAULT 'sales',
      employee_type TEXT DEFAULT 'sales',
      short_code TEXT UNIQUE,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      position TEXT,
      employee_type TEXT DEFAULT 'sales',
      salary REAL,
      hire_date DATE,
      is_active INTEGER DEFAULT 1,
      user_id INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      plate_number TEXT,
      short_code TEXT UNIQUE NOT NULL,
      assigned_driver_id INTEGER,
      is_active INTEGER DEFAULT 1
    );
    
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      selling_price REAL NOT NULL,
      current_stock REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
    
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER,
      sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      total REAL DEFAULT 0,
      created_by INTEGER,
      status TEXT DEFAULT 'pending_payment'
    );
    
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS sale_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      returned_by INTEGER NOT NULL,
      received_by INTEGER,
      return_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'pending'
    );
    
    CREATE TABLE IF NOT EXISTS sale_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      from_user_id INTEGER,
      to_user_id INTEGER,
      quantity REAL NOT NULL,
      movement_type TEXT NOT NULL,
      movement_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      received_confirmed INTEGER DEFAULT 0,
      notes TEXT
    );
    
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      expense_date DATE DEFAULT CURRENT_DATE,
      description TEXT,
      vehicle_id INTEGER,
      created_by INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS fuel_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      given_by INTEGER NOT NULL,
      given_to INTEGER NOT NULL,
      quantity_liters REAL NOT NULL,
      log_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );
    
    CREATE TABLE IF NOT EXISTS edit_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      requested_by INTEGER NOT NULL,
      request_reason TEXT NOT NULL,
      new_total REAL,
      status TEXT DEFAULT 'pending',
      admin_decision TEXT,
      accountant_decision TEXT,
      decision_reason TEXT,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS discounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      discount_percent REAL,
      min_quantity INTEGER,
      min_total REAL,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER
    );
  `);
  
  // ዋና አስተዳዳሪን ፍጠር (ከሌለ)
  const admin = await db.get("SELECT * FROM users WHERE username = 'admin'");
  if (!admin) {
    const hashed = await bcrypt.hash('admin123', 10);
    await db.run(
      "INSERT INTO users (username, password, full_name, role, short_code) VALUES (?, ?, ?, ?, ?)",
      ['admin', hashed, 'ዋና አስተዳዳሪ', 'admin', 'ADM-001']
    );
    console.log('--- ዋና አስተዳዳሪ ተፈጥሯል: admin / admin123 ---');
  }
  
  console.log('የውሂብ ሳጥን ዝግጁ ነው።');
}

initDB();

// ==================== ማንነት ማረጋገጫ ====================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE username = ? AND is_active = 1", username);
  if (!user) return res.status(401).json({ error: 'ስም ወይም ይለፍ ቃል ተሳስቷል' });
  
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'ስም ወይም ይለፍ ቃል ተሳስቷል' });
  
  req.session.userId = user.id;
  req.session.userRole = user.role;
  
  const userInfo = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
  res.json({ success: true, user: userInfo });
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = await db.get("SELECT id, username, full_name, role, employee_type FROM users WHERE id = ?", req.session.userId);
  res.json(user);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ==================== ዳሽቦርድ ====================
app.get('/api/dashboard', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const today = new Date().toISOString().split('T')[0];
  const todaySales = await db.get("SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE DATE(sale_date) = ?", today);
  const totalCustomers = await db.get("SELECT COUNT(*) as count FROM customers");
  const totalProducts = await db.get("SELECT COUNT(*) as count FROM products WHERE is_active = 1");
  const pendingReturns = await db.get("SELECT COUNT(*) as count FROM sale_returns WHERE status = 'pending'");
  const pendingEdits = await db.get("SELECT COUNT(*) as count FROM edit_requests WHERE status = 'pending'");
  
  const recentSales = await db.all(`
    SELECT s.*, c.name as customer_name 
    FROM sales s 
    LEFT JOIN customers c ON s.customer_id = c.id 
    ORDER BY s.sale_date DESC LIMIT 5
  `);
  
  res.json({
    todaySales: todaySales.total,
    totalCustomers: totalCustomers.count,
    totalProducts: totalProducts.count,
    pendingReturns: pendingReturns.count,
    pendingEdits: pendingEdits.count,
    recentSales
  });
});

// ==================== ተጠቃሚዎች እና ሰራተኞች (አስተዳዳሪ ብቻ) ====================
app.get('/api/users', async (req, res) => {
  if (req.session.userRole !== 'admin') return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  const users = await db.all("SELECT id, username, full_name, role, employee_type, short_code, is_active FROM users ORDER BY full_name");
  res.json(users);
});

app.post('/api/users', async (req, res) => {
  if (req.session.userRole !== 'admin') return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  const { full_name, role, employee_type, phone } = req.body;
  
  if (!full_name) return res.status(400).json({ error: 'ሙሉ ስም ያስፈልጋል' });
  
  // አጭር ኮድ ፍጠር
  let prefix = 'SLS';
  if (role === 'admin') prefix = 'ADM';
  else if (role === 'warehouse') prefix = 'WRH';
  else if (role === 'accountant') prefix = 'ACC';
  else if (employee_type === 'sales') prefix = 'SLS';
  
  const lastCode = await db.get("SELECT short_code FROM users WHERE short_code LIKE ? ORDER BY id DESC LIMIT 1", `${prefix}%`);
  let nextNum = 1;
  if (lastCode) {
    const num = parseInt(lastCode.short_code.split('-')[1]);
    if (!isNaN(num)) nextNum = num + 1;
  }
  const short_code = `${prefix}-${String(nextNum).padStart(3, '0')}`;
  
  // የተጠቃሚ ስም እና ጊዜያዊ የይለፍ ቃል ፍጠር
  const username = short_code.toLowerCase();
  const tempPassword = Math.random().toString(36).slice(-8);
  const hashed = await bcrypt.hash(tempPassword, 10);
  
  const result = await db.run(
    "INSERT INTO users (username, password, full_name, role, employee_type, short_code) VALUES (?, ?, ?, ?, ?, ?)",
    [username, hashed, full_name, role, employee_type || 'sales', short_code]
  );
  
  // የሰራተኛ መዝገብ ፍጠር
  await db.run(
    "INSERT INTO employees (name, phone, employee_type, user_id) VALUES (?, ?, ?, ?)",
    [full_name, phone || '', employee_type || 'sales', result.lastID]
  );
  
  res.json({ 
    success: true, 
    username: username, 
    temp_password: tempPassword,
    short_code: short_code 
  });
});

app.delete('/api/users/:id', async (req, res) => {
  if (req.session.userRole !== 'admin') return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  await db.run("UPDATE users SET is_active = 0 WHERE id = ?", req.params.id);
  res.json({ success: true });
});

// ==================== ተሽከርካሪዎች (አስተዳዳሪ ብቻ) ====================
app.get('/api/vehicles', async (req, res) => {
  if (req.session.userRole !== 'admin') return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  const vehicles = await db.all(`
    SELECT v.*, e.name as driver_name 
    FROM vehicles v 
    LEFT JOIN employees e ON v.assigned_driver_id = e.id 
    WHERE v.is_active = 1
    ORDER BY v.name
  `);
  res.json(vehicles);
});

app.post('/api/vehicles', async (req, res) => {
  if (req.session.userRole !== 'admin') return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  const { name, plate_number, assigned_driver_id } = req.body;
  
  if (!name) return res.status(400).json({ error: 'የመኪና ስም ያስፈልጋል' });
  
  const lastCode = await db.get("SELECT short_code FROM vehicles WHERE short_code LIKE 'VHL%' ORDER BY id DESC LIMIT 1");
  let nextNum = 1;
  if (lastCode) {
    const num = parseInt(lastCode.short_code.split('-')[1]);
    if (!isNaN(num)) nextNum = num + 1;
  }
  const short_code = `VHL-${String(nextNum).padStart(3, '0')}`;
  
  await db.run(
    "INSERT INTO vehicles (name, plate_number, short_code, assigned_driver_id) VALUES (?, ?, ?, ?)",
    [name, plate_number || '', short_code, assigned_driver_id || null]
  );
  res.json({ success: true, short_code });
});

// ==================== ደንበኞች ====================
app.get('/api/customers', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const customers = await db.all("SELECT * FROM customers ORDER BY name");
  res.json(customers);
});

app.post('/api/customers', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { name, phone, address } = req.body;
  if (!name) return res.status(400).json({ error: 'ስም ያስፈልጋል' });
  
  await db.run("INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)",
    [name, phone || '', address || '']);
  res.json({ success: true });
});

// ==================== ምርቶች ====================
app.get('/api/products', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const products = await db.all("SELECT * FROM products WHERE is_active = 1 ORDER BY name");
  res.json(products);
});

app.post('/api/products', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { name, selling_price } = req.body;
  if (!name || !selling_price) return res.status(400).json({ error: 'ስም እና ዋጋ ያስፈልጋል' });
  
  await db.run("INSERT INTO products (name, selling_price) VALUES (?, ?)", [name, selling_price]);
  res.json({ success: true });
});

app.put('/api/products/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { selling_price } = req.body;
  await db.run("UPDATE products SET selling_price = ? WHERE id = ?", [selling_price, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/products/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  await db.run("UPDATE products SET is_active = 0 WHERE id = ?", req.params.id);
  res.json({ success: true });
});

// ==================== የእቃ እንቅስቃሴ (የዕቃ ቤት) ====================
app.post('/api/stock-movements', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { product_id, to_user_id, quantity, notes } = req.body;
  
  if (!product_id || !to_user_id || !quantity) {
    return res.status(400).json({ error: 'ሁሉንም መረጃ ያስገቡ' });
  }
  
  const product = await db.get("SELECT current_stock FROM products WHERE id = ?", product_id);
  if (product.current_stock < quantity) {
    return res.status(400).json({ error: 'በቂ ክምችት የለም' });
  }
  
  await db.run(
    "INSERT INTO stock_movements (product_id, from_user_id, to_user_id, quantity, movement_type, notes) VALUES (?, ?, ?, ?, 'transfer', ?)",
    [product_id, req.session.userId, to_user_id, quantity, notes || '']
  );
  
  await db.run("UPDATE products SET current_stock = current_stock - ? WHERE id = ?", [quantity, product_id]);
  
  res.json({ success: true });
});

app.get('/api/stock-movements/pending', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const movements = await db.all(`
    SELECT sm.*, p.name as product_name, u.full_name as from_user_name 
    FROM stock_movements sm
    JOIN products p ON sm.product_id = p.id
    JOIN users u ON sm.from_user_id = u.id
    WHERE sm.to_user_id = ? AND sm.received_confirmed = 0
    ORDER BY sm.movement_date DESC
  `, req.session.userId);
  res.json(movements);
});

app.post('/api/stock-movements/:id/confirm', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  await db.run("UPDATE stock_movements SET received_confirmed = 1 WHERE id = ? AND to_user_id = ?", 
    [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// ==================== ሽያጮች ====================
async function generateInvoiceNumber() {
  const last = await db.get("SELECT invoice_number FROM sales ORDER BY id DESC LIMIT 1");
  if (!last) return 'INV-00001';
  const num = parseInt(last.invoice_number.split('-')[1]) + 1;
  return `INV-${String(num).padStart(5, '0')}`;
}

app.get('/api/sales', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  let query = `
    SELECT s.*, c.name as customer_name 
    FROM sales s 
    LEFT JOIN customers c ON s.customer_id = c.id 
  `;
  
  if (req.session.userRole === 'sales') {
    query += " WHERE s.created_by = ? ";
  }
  query += " ORDER BY s.sale_date DESC";
  
  const sales = req.session.userRole === 'sales' 
    ? await db.all(query, req.session.userId)
    : await db.all(query);
    
  res.json(sales);
});

app.post('/api/sales', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { customer_id, items } = req.body;
  
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'ቢያንስ አንድ ምርት ያስፈልጋል' });
  }
  
  let total = 0;
  for (const item of items) {
    const product = await db.get("SELECT selling_price FROM products WHERE id = ? AND is_active = 1", item.product_id);
    if (!product) return res.status(400).json({ error: 'ምርት አልተገኘም' });
    total += product.selling_price * item.quantity;
  }
  
  const invoice_number = await generateInvoiceNumber();
  
  const result = await db.run(
    "INSERT INTO sales (invoice_number, customer_id, total, created_by, status) VALUES (?, ?, ?, ?, 'pending_payment')",
    [invoice_number, customer_id || null, total, req.session.userId]
  );
  
  const saleId = result.lastID;
  
  for (const item of items) {
    const product = await db.get("SELECT selling_price FROM products WHERE id = ?", item.product_id);
    await db.run(
      "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
      [saleId, item.product_id, item.quantity, product.selling_price]
    );
  }
  
  res.json({ success: true, invoice_number });
});

// ==================== የተመለሱ ሽያጮች ====================
app.post('/api/sale-returns', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { sale_id, items } = req.body;
  
  const result = await db.run(
    "INSERT INTO sale_returns (sale_id, returned_by, status) VALUES (?, ?, 'pending')",
    [sale_id, req.session.userId]
  );
  
  const returnId = result.lastID;
  
  for (const item of items) {
    await db.run(
      "INSERT INTO sale_return_items (return_id, product_id, quantity) VALUES (?, ?, ?)",
      [returnId, item.product_id, item.quantity]
    );
  }
  
  res.json({ success: true });
});

app.get('/api/sale-returns/pending', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const returns = await db.all(`
    SELECT sr.*, s.invoice_number, u.full_name as returned_by_name
    FROM sale_returns sr
    JOIN sales s ON sr.sale_id = s.id
    JOIN users u ON sr.returned_by = u.id
    WHERE sr.status = 'pending'
    ORDER BY sr.return_date DESC
  `);
  res.json(returns);
});

app.post('/api/sale-returns/:id/confirm', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.userRole !== 'warehouse' && req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  }
  
  const returnItems = await db.all("SELECT product_id, quantity FROM sale_return_items WHERE return_id = ?", req.params.id);
  
  for (const item of returnItems) {
    await db.run("UPDATE products SET current_stock = current_stock + ? WHERE id = ?", [item.quantity, item.product_id]);
  }
  
  await db.run("UPDATE sale_returns SET status = 'received', received_by = ? WHERE id = ?", [req.session.userId, req.params.id]);
  
  res.json({ success: true });
});

// ==================== የማረሚያ ጥያቄዎች ====================
app.post('/api/edit-requests', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { sale_id, request_reason, new_total } = req.body;
  
  if (!request_reason) {
    return res.status(400).json({ error: 'የማረሚያ ምክንያት ያስፈልጋል' });
  }
  
  await db.run(
    "INSERT INTO edit_requests (sale_id, requested_by, request_reason, new_total, status) VALUES (?, ?, ?, ?, 'pending')",
    [sale_id, req.session.userId, request_reason, new_total || null]
  );
  
  res.json({ success: true });
});

app.get('/api/edit-requests/pending', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.userRole !== 'admin' && req.session.userRole !== 'accountant') {
    return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  }
  
  const requests = await db.all(`
    SELECT er.*, s.invoice_number, s.total as original_total, u.full_name as requested_by_name
    FROM edit_requests er
    JOIN sales s ON er.sale_id = s.id
    JOIN users u ON er.requested_by = u.id
    WHERE er.status = 'pending'
    ORDER BY er.requested_at DESC
  `);
  res.json(requests);
});

app.post('/api/edit-requests/:id/decision', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { decision, decision_reason } = req.body;
  
  const request = await db.get("SELECT * FROM edit_requests WHERE id = ?", req.params.id);
  if (!request) return res.status(404).json({ error: 'ጥያቄው አልተገኘም' });
  
  let updateFields = {};
  if (req.session.userRole === 'admin') {
    updateFields.admin_decision = decision;
  } else if (req.session.userRole === 'accountant') {
    updateFields.accountant_decision = decision;
  } else {
    return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  }
  
  updateFields.decision_reason = decision_reason || '';
  
  let setClause = Object.keys(updateFields).map(k => `${k} = ?`).join(', ');
  let values = [...Object.values(updateFields), req.params.id];
  
  await db.run(`UPDATE edit_requests SET ${setClause} WHERE id = ?`, values);
  
  const updated = await db.get("SELECT * FROM edit_requests WHERE id = ?", req.params.id);
  
  if (updated.admin_decision === 'approved' && updated.accountant_decision === 'approved') {
    await db.run("UPDATE edit_requests SET status = 'approved' WHERE id = ?", req.params.id);
    if (updated.new_total) {
      await db.run("UPDATE sales SET total = ? WHERE id = ?", [updated.new_total, updated.sale_id]);
    }
  } else if (updated.admin_decision === 'rejected' || updated.accountant_decision === 'rejected') {
    await db.run("UPDATE edit_requests SET status = 'rejected' WHERE id = ?", req.params.id);
  }
  
  res.json({ success: true });
});

// ==================== የክፍያ ማረጋገጫ (የሂሳብ ሰራተኛ) ====================
app.get('/api/sales/pending-payment', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.userRole !== 'accountant' && req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  }
  
  const sales = await db.all(`
    SELECT s.*, c.name as customer_name, u.full_name as sales_person
    FROM sales s 
    LEFT JOIN customers c ON s.customer_id = c.id 
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.status = 'pending_payment'
    ORDER BY s.sale_date DESC
  `);
  res.json(sales);
});

app.post('/api/sales/:id/confirm-payment', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.userRole !== 'accountant' && req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  }
  
  await db.run("UPDATE sales SET status = 'paid' WHERE id = ?", req.params.id);
  res.json({ success: true });
});

// ==================== የነዳጅ መዝገብ (የዕቃ ቤት) ====================
app.post('/api/fuel-logs', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.userRole !== 'warehouse' && req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  }
  
  const { vehicle_id, given_to, quantity_liters, notes } = req.body;
  if (!vehicle_id || !given_to || !quantity_liters) {
    return res.status(400).json({ error: 'ሁሉንም መረጃ ያስገቡ' });
  }
  
  await db.run(
    "INSERT INTO fuel_logs (vehicle_id, given_by, given_to, quantity_liters, notes) VALUES (?, ?, ?, ?, ?)",
    [vehicle_id, req.session.userId, given_to, quantity_liters, notes || '']
  );
  
  res.json({ success: true });
});

app.get('/api/fuel-logs', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const logs = await db.all(`
    SELECT fl.*, v.name as vehicle_name, v.short_code,
           u1.full_name as given_by_name, u2.full_name as given_to_name
    FROM fuel_logs fl
    JOIN vehicles v ON fl.vehicle_id = v.id
    JOIN users u1 ON fl.given_by = u1.id
    JOIN users u2 ON fl.given_to = u2.id
    ORDER BY fl.log_date DESC
  `);
  res.json(logs);
});

// ==================== ወጪዎች ====================
app.get('/api/expenses', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const expenses = await db.all("SELECT * FROM expenses ORDER BY expense_date DESC");
  res.json(expenses);
});

app.post('/api/expenses', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { category, amount, description, vehicle_id } = req.body;
  if (!category || !amount) return res.status(400).json({ error: 'ምድብ እና ገንዘብ ያስፈልጋል' });
  
  await db.run(
    "INSERT INTO expenses (category, amount, description, vehicle_id, created_by) VALUES (?, ?, ?, ?, ?)",
    [category, amount, description || '', vehicle_id || null, req.session.userId]
  );
  res.json({ success: true });
});

// ==================== ቅናሾች (አስተዳዳሪ) ====================
app.get('/api/discounts', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const discounts = await db.all("SELECT * FROM discounts WHERE is_active = 1 ORDER BY name");
  res.json(discounts);
});

app.post('/api/discounts', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.userRole !== 'admin') return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  
  const { name, discount_percent, min_quantity, min_total } = req.body;
  if (!name) return res.status(400).json({ error: 'የቅናሹ ስም ያስፈልጋል' });
  
  await db.run(
    "INSERT INTO discounts (name, discount_percent, min_quantity, min_total, created_by) VALUES (?, ?, ?, ?, ?)",
    [name, discount_percent || 0, min_quantity || null, min_total || null, req.session.userId]
  );
  res.json({ success: true });
});

// ==================== ሪፖርቶች (አስተዳዳሪ እና ሂሳብ) ====================
app.get('/api/reports/sales-by-user', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.userRole !== 'admin' && req.session.userRole !== 'accountant') {
    return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  }
  
  const report = await db.all(`
    SELECT u.full_name, u.short_code, COUNT(s.id) as total_sales, COALESCE(SUM(s.total), 0) as total_amount
    FROM users u
    LEFT JOIN sales s ON u.id = s.created_by
    WHERE u.role = 'sales' OR u.employee_type = 'sales'
    GROUP BY u.id
    ORDER BY total_amount DESC
  `);
  res.json(report);
});

app.get('/api/reports/stock-status', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.userRole !== 'admin' && req.session.userRole !== 'warehouse') {
    return res.status(403).json({ error: 'ፈቃድ የለዎትም' });
  }
  
  const stock = await db.all(`
    SELECT p.name, p.current_stock, p.selling_price,
           COALESCE(SUM(si.quantity), 0) as total_sold
    FROM products p
    LEFT JOIN sale_items si ON p.id = si.product_id
    WHERE p.is_active = 1
    GROUP BY p.id
    ORDER BY p.current_stock ASC
  `);
  res.json(stock);
});

// ==================== የፊት ለፊት ገፁን አስረክብ ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ሰርቨሩ በሩ ላይ ነው ${PORT}`);
});
