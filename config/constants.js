module.exports = {
  // Server
  PORT: process.env.PORT || process.env.APP_PORT || 3000,
  
  // Shopify
  SHOP: process.env.SHOPIFY_STORE,
  TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
  API_BASE: `https://${process.env.SHOPIFY_STORE}/admin/api/2024-10`,
  GRAPHQL_ENDPOINT: `https://${process.env.SHOPIFY_STORE}/admin/api/2024-10/graphql.json`,
  
  // Twilio
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  
  // Admin
  ADMIN_RESET_KEY: process.env.ADMIN_RESET_KEY,
  
  // CORS
  allowedOrigins: [
    'https://motovolt-dev-store.myshopify.com',
    'https://motovolt.co'
  ]
};