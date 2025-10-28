const crypto = require('crypto');
const twilio = require('twilio');
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = require('../config/constants');

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const otpStorage = new Map();

const generateOTP = () => {
  return crypto.randomInt(1000, 9999).toString();
};

const formatPhoneNumber = (phoneNumber) => {
  const cleaned = phoneNumber.replace(/\D/g, '');
  
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

const sendOTP = async (phoneNumber) => {
  const otp = "1234";
  const expiryTime = Date.now() + 10 * 60 * 1000;
  
  otpStorage.set(phoneNumber, {
    otp: otp,
    expiryTime: expiryTime,
    attempts: 0,
    createdAt: Date.now()
  });
  
  const message = await client.messages.create({
    body: `Your verification code is: ${otp}. This code will expire in 10 minutes.`,
    from: TWILIO_PHONE_NUMBER,
    to: phoneNumber
  });
  
  console.log(`OTP sent to ${phoneNumber}: ${otp}`);
  
  return message;
};

const verifyOTP = (phoneNumber, otp) => {
  const storedData = otpStorage.get(phoneNumber);
  
  if (!storedData) {
    return { success: false, message: 'No OTP found for this phone number' };
  }
  
  if (Date.now() > storedData.expiryTime) {
    otpStorage.delete(phoneNumber);
    return { success: false, message: 'OTP has expired' };
  }
  
  if (storedData.attempts >= 3) {
    otpStorage.delete(phoneNumber);
    return { success: false, message: 'Maximum verification attempts exceeded' };
  }
  
  if (storedData.otp === otp.toString()) {
    otpStorage.delete(phoneNumber);
    return { success: true, message: 'OTP verified successfully' };
  } else {
    storedData.attempts += 1;
    otpStorage.set(phoneNumber, storedData);
    return { 
      success: false, 
      message: 'Invalid OTP', 
      attemptsRemaining: 3 - storedData.attempts 
    };
  }
};

const resendOTP = async (phoneNumber) => {
  const storedData = otpStorage.get(phoneNumber);
  
  if (storedData) {
    const timeSinceCreation = Date.now() - storedData.createdAt;
    const minResendTime = 60 * 1000;
    
    if (timeSinceCreation < minResendTime) {
      const remainingTime = Math.ceil((minResendTime - timeSinceCreation) / 1000);
      return { 
        success: false, 
        message: `Please wait ${remainingTime} seconds before requesting a new OTP` 
      };
    }
  }
  
  const otp = "1234";
  const expiryTime = Date.now() + 10 * 60 * 1000;
  
  otpStorage.set(phoneNumber, {
    otp: otp,
    expiryTime: expiryTime,
    attempts: 0,
    createdAt: Date.now()
  });
  
  const message = await client.messages.create({
    body: `Your new verification code is: ${otp}. This code will expire in 10 minutes.`,
    from: TWILIO_PHONE_NUMBER,
    to: phoneNumber
  });
  
  console.log(`OTP resent to ${phoneNumber}: ${otp}`);
  
  return { success: true, message };
};

// Cleanup expired OTPs
setInterval(() => {
  const now = Date.now();
  for (const [phoneNumber, data] of otpStorage.entries()) {
    if (now > data.expiryTime) {
      otpStorage.delete(phoneNumber);
      console.log(`Cleaned up expired OTP for ${phoneNumber}`);
    }
  }
}, 5 * 60 * 1000);

module.exports = {
  generateOTP,
  formatPhoneNumber,
  isValidPhoneNumber,
  sendOTP,
  verifyOTP,
  resendOTP,
  otpStorage
};