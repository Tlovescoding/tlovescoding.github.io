const express = require('express'), Database = require('better-sqlite3'), bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer'), cookieParser = require('cookie-parser'), crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const db = new Database(process.env.DB_PATH || 'inkwell.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE, hash TEXT, verified INTEGER DEFAULT 0, token TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY, uid TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS docs(coll TEXT, id TEXT, uid TEXT, data TEXT, PRIMARY KEY(coll, id));`);

// Email: set SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465) and MAIL_FROM. Without it, links print to the console.
const mail = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
const rnd = (n = 24) => crypto.randomBytes(n).toString('hex');
const ah = f => (req, res) => f(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '400kb' }), cookieParser());

// crude rate limit for login/signup: 20 attempts per IP per 15 min
const hits = new Map();
setInterval(() => hits.clear(), 15 * 60 * 1000);
const limit = (req, res, next) => {
  const n = (hits.get(req.ip) || 0) + 1; hits.set(req.ip, n);
  n > 20 ? res.status(429).json({ error: 'Too many attempts. Try again later.' }) : next();
};

app.use((req, res, next) => {
  req.user = db.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.uid WHERE sid = ?').get(req.cookies.sid || '') || null;
  next();
});

app.post('/api/signup', limit, ah(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pw = String(req.body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'That email already has an account.' });
  const token = rnd();
  db.prepare('INSERT INTO users VALUES(?,?,?,0,?,?)').run(rnd(8), email, await bcrypt.hash(pw, 10), token, Date.now());
  const link = `${BASE}/verify?token=${token}`;
  if (mail) await mail.sendMail({ from: process.env.MAIL_FROM, to: email, subject: 'Confirm your Inkwell account', text: `Welcome to Inkwell! Confirm your email here: ${link}` });
  else console.log('VERIFY LINK (SMTP_URL not set):', link);
  res.json({ message: 'Account created! Check your email for a confirmation link, then log in.' });
}));

app.get('/verify', (req, res) => {
  const t = String(req.query.token || '');
  const r = t ? db.prepare('UPDATE users SET verified = 1, token = NULL WHERE token = ?').run(t) : { changes: 0 };
  res.send(r.changes ? 'Email confirmed! <a href="/">Go log in</a>' : 'This link is invalid or was already used. <a href="/">Back</a>');
});

app.post('/api/login', limit, ah(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(req.body.email || '').trim().toLowerCase());
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.hash))) return res.status(401).json({ error: 'Wrong email or password.' });
  if (!u.verified) return res.status(403).json({ error: 'Please confirm your email first (check your inbox).' });
  const sid = rnd();
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sid, u.id, Date.now());
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', secure: BASE.startsWith('https'), maxAge: 30 * 864e5 });
  res.json({ id: u.id, email: u.email });
}));

app.post('/api/logout', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE sid = ?').run(req.cookies.sid || '');
  res.clearCookie('sid'); res.json({});
});
app.get('/api/me', (req, res) => res.json(req.user || {}));

// Stories, comments and likes. The server (not the browser) enforces ownership.
const chk = (req, res, next) => ['stories', 'comments', 'likes'].includes(req.params.c) ? next() : res.status(404).json({ error: 'Not found' });
app.get('/api/c/:c', chk, (req, res) =>
  res.json(db.prepare('SELECT id, data FROM docs WHERE coll = ?').all(req.params.c).map(r => ({ ...JSON.parse(r.data), id: r.id }))));

function guard(req, res) {
  const { c, id } = req.params;
  if (!req.user) { res.status(401).json({ error: 'Sign in first.' }); return null; }
  if (!/^[\w-]{1,40}$/.test(id) || (c === 'likes' && id !== req.user.id)) { res.status(403).json({ error: 'Not allowed.' }); return null; }
  const old = db.prepare('SELECT uid FROM docs WHERE coll = ? AND id = ?').get(c, id);
  if (old && old.uid !== req.user.id) { res.status(403).json({ error: 'That isn’t yours to change.' }); return null; }
  return { c, id };
}
app.put('/api/c/:c/:id', chk, (req, res) => {
  const g = guard(req, res); if (!g) return;
  const d = req.body || {};
  if (g.c === 'stories') d.authorId = req.user.id;
  if (g.c === 'comments') d.uid = req.user.id;
  db.prepare('INSERT OR REPLACE INTO docs VALUES(?,?,?,?)').run(g.c, g.id, req.user.id, JSON.stringify(d));
  res.json({});
});
app.delete('/api/c/:c/:id', chk, (req, res) => {
  const g = guard(req, res); if (!g) return;
  db.prepare('DELETE FROM docs WHERE coll = ? AND id = ?').run(g.c, g.id);
  res.json({});
});

app.use(express.static('public'));
app.listen(process.env.PORT || 3000, () => console.log('Inkwell running on', BASE));
