require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { addClient, broadcast } = require('./sse');

const app = express();

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && typeof req.query.token === 'string' && req.query.token) {
    token = req.query.token;
  }
  if (!token) return res.status(401).json({ error: 'no token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(403).json({ error: 'invalid token' });
  }
}

app.get('/api/events', authenticate, (req, res) => {
  addClient(req, res);
});

app.listen(5555, () => {
  console.log('test server up on 5555');
  setTimeout(() => {
    console.log('broadcasting test event...');
    broadcast('students.changed', { action: 'added', student_id: 999 });
  }, 1500);
});
