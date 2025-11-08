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
    console.log('========================================');
    console.log('COMBINED BACKEND - STARTING');
    console.log('========================================');
    
    const PRIZES = await getCurrentPrizes();
    
    console.log('✓ Loaded', PRIZES.length, 'prizes (real-time mode)');
    console.log('✓ OTP Service initialized');
    console.log('');
    
    console.log('========================================');
    console.log('✓ SERVER READY - Real-time Updates Active');
    console.log('========================================');
    console.log('');
    console.log('Wheel Spin Endpoints:');
    console.log('  POST /spin - Spin the wheel');
    console.log('  POST /admin/reset-prizes - Reset counts');
    console.log('  GET  /admin/stats - View statistics');
    console.log('  GET  /customer/:phone - Get customer info');
    console.log('  GET  /api/prizes/available - Get available prizes');
    console.log('');
    console.log('OTP Endpoints:');
    console.log('  POST /api/otp/send - Send OTP');
    console.log('  POST /api/otp/verify - Verify OTP');
    console.log('  POST /api/otp/resend - Resend OTP');
    console.log('========================================');
    console.log('');
    
    app.listen(PORT, () => console.log('✓ Server running on port', PORT));
  } catch (err) {
    console.error('');
    console.error('========================================');
    console.error('❌ STARTUP ERROR');
    console.error('========================================');
    console.error(err.message);
    console.error('');
    console.error('SETUP REQUIRED:');
    console.error('');
    console.error('1. Go to: Shopify Admin → Settings → Custom Data → Metaobjects');
    console.error('2. Click "Add definition"');
    console.error('3. Name: "Wheel Prize", Type: "wheel_prize"');
    console.error('4. Add these fields:');
    console.error('   - prize_id (Single line text) - REQUIRED');
    console.error('   - prize_label (Single line text) - REQUIRED');
    console.error('   - probability (Decimal) - REQUIRED - Client editable (0-100%)');
    console.error('   - max_count (Integer) - REQUIRED - Client editable (-1 for unlimited)');
    console.error('   - remaining_count (Integer) - Auto-updated by system');
    console.error('   - total_distributed (Integer) - Auto-updated by system');
    console.error('   - is_available (True/False) - Auto-updated by system');
    console.error('   - last_updated (Date and time) - Auto-updated by system');
    console.error('5. Create metaobject entries for each prize');
    console.error('6. Configure Twilio credentials in .env');
    console.error('7. Restart the server');
    console.error('');
    console.error('========================================');
    process.exit(1);
  }
})();

module.exports = app;