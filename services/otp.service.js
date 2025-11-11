const axios = require('axios');
const { MSG91_AUTH_KEY, MSG91_TEMPLATE_ID } = require('../config/constants');

// Store send timestamp for rate limiting resend
const otpTimestamps = new Map();

const formatPhoneNumber = (phoneNumber) => {
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // For Indian numbers (10 digits)
  if (cleaned.length === 10) {
    return `91${cleaned}`;
  } 
  // Already has country code
  else if (cleaned.length === 12 && cleaned.startsWith('91')) {
    return cleaned;
  }
  // Remove + if present
  else if (phoneNumber.startsWith('+')) {
    return phoneNumber.replace('+', '');
  } 
  else {
    return cleaned;
  }
};

const isValidPhoneNumber = (phoneNumber) => {
  // Indian phone number: 91 followed by 10 digits
  const phoneRegex = /^91[6-9]\d{9}$/;
  return phoneRegex.test(phoneNumber);
};

const sendOTP = async (phoneNumber, templateParams = {}) => {
  try {
    const response = await axios.post(
      'https://control.msg91.com/api/v5/otp',
      templateParams,
      {
        params: {
          template_id: MSG91_TEMPLATE_ID,
          mobile: phoneNumber,
          authkey: MSG91_AUTH_KEY,
          otp_expiry: 10 // 10 minutes
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Store timestamp for rate limiting
    otpTimestamps.set(phoneNumber, Date.now());
    
    console.log(`OTP sent to ${phoneNumber}`);
    console.log('MSG91 Response:', response.data);
    
    return {
      success: true,
      type: response.data.type,
      message: response.data.message,
      requestId: response.data.request_id
    };
  } catch (error) {
    console.error('MSG91 Send Error:', error.response?.data || error.message);
    throw error;
  }
};

const verifyOTP = async (phoneNumber, otp) => {
  try {
    const response = await axios.get('https://control.msg91.com/api/v5/otp/verify', {
      params: {
        otp: otp,
        mobile: phoneNumber
      },
      headers: {
        authkey: MSG91_AUTH_KEY
      }
    });
    
    console.log(`OTP verified for ${phoneNumber}`);
    console.log('MSG91 Verify Response:', response.data);
    
    if (response.data.type === 'success') {
      // Clear timestamp after successful verification
      otpTimestamps.delete(phoneNumber);
      
      return {
        success: true,
        message: response.data.message || 'OTP verified successfully'
      };
    } else {
      return {
        success: false,
        message: response.data.message || 'Invalid OTP'
      };
    }
  } catch (error) {
    console.error('MSG91 Verify Error:', error.response?.data || error.message);
    
    const errorMessage = error.response?.data?.message || 'Invalid OTP';
    
    return {
      success: false,
      message: errorMessage
    };
  }
};

const resendOTP = async (phoneNumber, retryType = 'text') => {
  // Check if enough time has passed since last send
  const lastSendTime = otpTimestamps.get(phoneNumber);
  
  if (lastSendTime) {
    const timeSinceLastSend = Date.now() - lastSendTime;
    const minResendTime = 30 * 1000; // 30 seconds
    
    if (timeSinceLastSend < minResendTime) {
      const remainingTime = Math.ceil((minResendTime - timeSinceLastSend) / 1000);
      return { 
        success: false, 
        message: `Please wait ${remainingTime} seconds before requesting a new OTP` 
      };
    }
  }
  
  try {
    const response = await axios.get('https://control.msg91.com/api/v5/otp/retry', {
      params: {
        authkey: MSG91_AUTH_KEY,
        retrytype: retryType, // 'text' or 'voice'
        mobile: phoneNumber
      }
    });
    
    // Update timestamp
    otpTimestamps.set(phoneNumber, Date.now());
    
    console.log(`OTP resent to ${phoneNumber} via ${retryType}`);
    console.log('MSG91 Resend Response:', response.data);
    
    return { 
      success: true,
      type: response.data.type,
      message: response.data.message || 'OTP resent successfully'
    };
  } catch (error) {
    console.error('MSG91 Resend Error:', error.response?.data || error.message);
    throw error;
  }
};

// Cleanup old timestamps (run every 15 minutes)
setInterval(() => {
  const now = Date.now();
  const maxAge = 15 * 60 * 1000; // 15 minutes
  
  for (const [phoneNumber, timestamp] of otpTimestamps.entries()) {
    if (now - timestamp > maxAge) {
      otpTimestamps.delete(phoneNumber);
      console.log(`Cleaned up timestamp for ${phoneNumber}`);
    }
  }
}, 15 * 60 * 1000);

module.exports = {
  formatPhoneNumber,
  isValidPhoneNumber,
  sendOTP,
  verifyOTP,
  resendOTP
};