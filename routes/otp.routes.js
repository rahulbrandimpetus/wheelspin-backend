const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
  formatPhoneNumber,
  isValidPhoneNumber,
  sendOTP,
  verifyOTP,
  resendOTP
} = require('../services/otp.service');

const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { 
    success: false, 
    message: 'Too many OTP requests, please try again later.' 
  }
});

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
      message: 'Invalid phone number format. Please use Indian mobile number (10 digits)'
    });
  }
  
  req.formattedPhone = formattedPhone;
  next();
};

router.post('/otp/send', otpRateLimit, validatePhoneNumber, async (req, res) => {
  try {
    const phoneNumber = req.formattedPhone;
    const { templateParams } = req.body; // Optional template variables
    
    const result = await sendOTP(phoneNumber, templateParams || {});
    
    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      type: result.type,
      requestId: result.requestId,
      expiresIn: '10 minutes'
    });
    
  } catch (error) {
    console.error('Error sending OTP:', error);
    
    const errorMessage = error.response?.data?.message || error.message;
    
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
});

router.post('/otp/verify', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    
    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
    }
    
    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    if (!isValidPhoneNumber(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }
    
    const result = await verifyOTP(formattedPhone, otp);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
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

router.post('/otp/resend', otpRateLimit, validatePhoneNumber, async (req, res) => {
  try {
    const phoneNumber = req.formattedPhone;
    const { retryType } = req.body; // 'text' or 'voice'
    
    const result = await resendOTP(phoneNumber, retryType || 'text');
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.status(200).json({
      success: true,
      message: result.message,
      type: result.type,
      expiresIn: '10 minutes'
    });
    
  } catch (error) {
    console.error('Error resending OTP:', error);
    
    const errorMessage = error.response?.data?.message || error.message;
    
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
});

module.exports = router;