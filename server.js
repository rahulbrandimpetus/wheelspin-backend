const express = require('express');
const twilio = require('twilio');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.use(express.json());

// Twilio configuration
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// In-memory storage for OTPs (use Redis in production)
const otpStorage = new Map();

// Rate limiting
const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: { 
    success: false, 
    message: 'Too many OTP requests, please try again later.' 
  }
});

// Helper functions
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

const formatPhoneNumber = (phoneNumber) => {
  // Remove any non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Add country code if not present (assuming +1 for US/Canada)
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  } else if (cleaned.startsWith('+')) {
    return phoneNumber;
  } else {
    return `+${cleaned}`;
  }
};

const isValidPhoneNumber = (phoneNumber) => {
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  return phoneRegex.test(phoneNumber);
};

// Middleware for input validation
const validatePhoneNumber = (req, res, next) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      message: 'Phone number is required'
    });
  }
  
  const formattedPhone = formatPhoneNumber(phoneNumber);
  
  if (!isValidPhoneNumber(formattedPhone)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid phone number format'
    });
  }
  
  req.formattedPhone = formattedPhone;
  next();
};

// Send OTP endpoint
app.post('/api/otp/send', otpRateLimit, validatePhoneNumber, async (req, res) => {
  try {
    const phoneNumber = req.formattedPhone;
    const otp = generateOTP();
    const expiryTime = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
    
    // Store OTP with metadata
    otpStorage.set(phoneNumber, {
      otp: otp,
      expiryTime: expiryTime,
      attempts: 0,
      createdAt: Date.now()
    });
    
    // Send SMS via Twilio
    const message = await client.messages.create({
      body: `Your verification code is: ${otp}. This code will expire in 10 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });
    
    console.log(`OTP sent to ${phoneNumber}: ${otp}`); // Remove in production
    
    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      messageSid: message.sid,
      expiresIn: '10 minutes'
    });
    
  } catch (error) {
    console.error('Error sending OTP:', error);
    
    if (error.code === 21211) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Verify OTP endpoint
app.post('/api/otp/verify', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    
    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
    }
    
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const storedData = otpStorage.get(formattedPhone);
    
    if (!storedData) {
      return res.status(400).json({
        success: false,
        message: 'No OTP found for this phone number'
      });
    }
    
    // Check if OTP has expired
    if (Date.now() > storedData.expiryTime) {
      otpStorage.delete(formattedPhone);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }
    
    // Check attempt limit
    if (storedData.attempts >= 3) {
      otpStorage.delete(formattedPhone);
      return res.status(400).json({
        success: false,
        message: 'Maximum verification attempts exceeded'
      });
    }
    
    // Verify OTP
    if (storedData.otp === otp.toString()) {
      otpStorage.delete(formattedPhone);
      
      res.status(200).json({
        success: true,
        message: 'OTP verified successfully'
      });
    } else {
      // Increment attempt counter
      storedData.attempts += 1;
      otpStorage.set(formattedPhone, storedData);
      
      res.status(400).json({
        success: false,
        message: 'Invalid OTP',
        attemptsRemaining: 3 - storedData.attempts
      });
    }
    
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Resend OTP endpoint
app.post('/api/otp/resend', otpRateLimit, validatePhoneNumber, async (req, res) => {
  try {
    const phoneNumber = req.formattedPhone;
    const storedData = otpStorage.get(phoneNumber);
    
    // Check if there's an existing OTP and if enough time has passed
    if (storedData) {
      const timeSinceCreation = Date.now() - storedData.createdAt;
      const minResendTime = 60 * 1000; // 1 minute
      
      if (timeSinceCreation < minResendTime) {
        const remainingTime = Math.ceil((minResendTime - timeSinceCreation) / 1000);
        return res.status(400).json({
          success: false,
          message: `Please wait ${remainingTime} seconds before requesting a new OTP`
        });
      }
    }
    
    const otp = generateOTP();
    const expiryTime = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
    
    // Store new OTP
    otpStorage.set(phoneNumber, {
      otp: otp,
      expiryTime: expiryTime,
      attempts: 0,
      createdAt: Date.now()
    });
    
    // Resend SMS via Twilio
    const message = await client.messages.create({
      body: `Your new verification code is: ${otp}. This code will expire in 10 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });
    
    console.log(`OTP resent to ${phoneNumber}: ${otp}`); // Remove in production
    
    res.status(200).json({
      success: true,
      message: 'OTP resent successfully',
      messageSid: message.sid,
      expiresIn: '10 minutes'
    });
    
  } catch (error) {
    console.error('Error resending OTP:', error);
    
    if (error.code === 21211) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'OTP API is running',
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

// Cleanup expired OTPs (run every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [phoneNumber, data] of otpStorage.entries()) {
    if (now > data.expiryTime) {
      otpStorage.delete(phoneNumber);
      console.log(`Cleaned up expired OTP for ${phoneNumber}`);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OTP API server running on port ${PORT}`);
});

module.exports = app;
