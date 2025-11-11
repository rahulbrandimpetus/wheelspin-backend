module.exports = {
  // Server
  PORT: process.env.PORT || process.env.APP_PORT || 3000,
  
  // Shopify
  SHOP: process.env.SHOPIFY_STORE,
  TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
  API_BASE: `https://${process.env.SHOPIFY_STORE}/admin/api/2024-10`,
  GRAPHQL_ENDPOINT: `https://${process.env.SHOPIFY_STORE}/admin/api/2024-10/graphql.json`,
  
  // MSG91
  MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY,
  MSG91_TEMPLATE_ID: process.env.MSG91_TEMPLATE_ID,
  MSG91_SENDER_ID: process.env.MSG91_SENDER_ID,
  
  // Admin
  ADMIN_RESET_KEY: process.env.ADMIN_RESET_KEY,
  
  // CORS
  allowedOrigins: [
    'https://motovolt-dev-store.myshopify.com',
    'https://motovolt.co'
  ]
};