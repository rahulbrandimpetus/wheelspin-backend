require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { PORT, allowedOrigins } = require('../config/constants');
const wheelRoutes = require('../routes/wheel.routes');
const otpRoutes = require('../routes/otp.routes');
const { getCurrentPrizes } = require('../services/wheel.service');

const app = express();

app.use(bodyParser.json());
app.use(express.json());

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Routes
app.use('/', wheelRoutes);
app.use('/api', otpRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Combined API is running',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Server start
(async () => {
  try {
    console.log('COMBINED BACKEND - STARTING');
    const PRIZES = await getCurrentPrizes();
    console.log('✓ Loaded', PRIZES.length, 'prizes (real-time mode)');
    app.listen(PORT, () => console.log('✓ Server running on port', PORT));
  } catch (err) {
    console.error(err.message);
    
    process.exit(1);
  }
})();

module.exports = app;