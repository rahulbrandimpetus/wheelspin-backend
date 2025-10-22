require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_BASE = `https://${SHOP}/admin/api/2024-10`;
const PORT = process.env.PORT || process.env.APP_PORT || 3000;

const app = express();
app.use(bodyParser.json());

// ----- Prize Config -----
const SHOP_METAFIELD_NAMESPACE = 'wheel_spin';
const SHOP_METAFIELD_KEY = 'prize_counts';
const PRIZE_DISTRIBUTION_KEY = 'prize_distribution'; // Tracks how many of each prize distributed

const cors = require('cors');

// Allow Shopify store frontend access
app.use(cors({
  origin: [
 'https://motovolt-dev-store.myshopify.com',
 'https://motovolt.in'
  ],
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));


const PRIZES = [
  { id: 'kivo_easy_lite', label: 'Kivo Easy Lite', prob: 0.001, max: 1 },
  { id: '1gm_gold_coin', label: '1gm Gold Coin', prob: 0.05, max: 5 },
  { id: 'free_helmet', label: 'Free Helmet Rs.2000', prob: 0.33, max: 20 },
  { id: 'mobile_holder', label: 'Mobile Holder', prob: 0.30, max: 20 },
  { id: 'water_bottle', label: 'Water Bottle + Cap', prob: 0.30, max: 20 },
  { id: 'better_luck', label: 'Better Luck Next Time', prob: 0.01, max: null }
];

// ----- Shopify Helpers -----
async function shopifyRequest(method, path, data) {
  const url = `${API_BASE}${path}`;
  const headers = {
    'X-Shopify-Access-Token': TOKEN,
    'Content-Type': 'application/json',
  };
  try {
    const response = await axios({ method, url, headers, data });
    return response.data;
  } catch (error) {
    console.error('Shopify API Error:', {
      method,
      path,
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    throw error;
  }
}

// Get or create shop-level metafield for prize counts (remaining)
async function ensureShopPrizeCounts() {
  const res = await shopifyRequest('get', `/metafields.json?namespace=${SHOP_METAFIELD_NAMESPACE}&key=${SHOP_METAFIELD_KEY}`);
  if (res.metafields && res.metafields.length > 0) {
    const mf = res.metafields[0];
    const val = typeof mf.value === 'string' ? JSON.parse(mf.value) : mf.value;
    console.log('✅ Existing prize counts loaded:', val);
    return { metafield: mf, value: val };
  }

  // Not found → create it
  const initialCounts = {};
  PRIZES.forEach(p => initialCounts[p.id] = p.max === null ? null : p.max);

  const data = {
    metafield: {
      namespace: SHOP_METAFIELD_NAMESPACE,
      key: SHOP_METAFIELD_KEY,
      type: 'json',
      value: JSON.stringify(initialCounts)
    }
  };

  const createRes = await shopifyRequest('post', `/metafields.json`, data);
  console.log('🆕 Created initial prize counts metafield:', initialCounts);

  return { metafield: createRes.metafield, value: initialCounts };
}

// Get or create shop-level metafield for prize distribution tracking
async function ensurePrizeDistribution() {
  const res = await shopifyRequest('get', `/metafields.json?namespace=${SHOP_METAFIELD_NAMESPACE}&key=${PRIZE_DISTRIBUTION_KEY}`);
  if (res.metafields && res.metafields.length > 0) {
    const mf = res.metafields[0];
    const val = typeof mf.value === 'string' ? JSON.parse(mf.value) : mf.value;
    console.log('✅ Prize distribution tracking loaded:', val);
    return { metafield: mf, value: val };
  }

  // Not found → create it
  const initialDistribution = {};
  PRIZES.forEach(p => initialDistribution[p.id] = 0);

  const data = {
    metafield: {
      namespace: SHOP_METAFIELD_NAMESPACE,
      key: PRIZE_DISTRIBUTION_KEY,
      type: 'json',
      value: JSON.stringify(initialDistribution)
    }
  };

  const createRes = await shopifyRequest('post', `/metafields.json`, data);
  console.log('🆕 Created prize distribution tracking:', initialDistribution);

  return { metafield: createRes.metafield, value: initialDistribution };
}

async function setShopPrizeCounts(countObj, metafieldId) {
  const data = {
    metafield: {
      id: metafieldId,
      value: JSON.stringify(countObj),
      type: 'json'
    }
  };
  return shopifyRequest('put', `/metafields/${metafieldId}.json`, data);
}

async function incrementPrizeDistribution(prizeId, distributionMf) {
  const distribution = distributionMf.value;
  distribution[prizeId] = (distribution[prizeId] || 0) + 1;
  
  const data = {
    metafield: {
      id: distributionMf.metafield.id,
      value: JSON.stringify(distribution),
      type: 'json'
    }
  };
  
  await shopifyRequest('put', `/metafields/${distributionMf.metafield.id}.json`, data);
  return distribution[prizeId];
}

async function findCustomerByPhone(phone) {
  const res = await shopifyRequest('get', `/customers/search.json?query=phone:${encodeURIComponent(phone)}`);
  return (res.customers && res.customers[0]) || null;
}

async function createCustomerWithPhone(phone) {
  const res = await shopifyRequest('post', `/customers.json`, {
    customer: { phone, verified_email: false, note: 'Created for wheel spin' }
  });
  console.log('✅ Created customer:', res.customer.id, phone);
  return res.customer;
}

async function updateCustomerTags(customerId, tags) {
  const data = {
    customer: {
      id: customerId,
      tags: tags
    }
  };
  const result = await shopifyRequest('put', `/customers/${customerId}.json`, data);
  console.log('✅ Tags updated successfully for customer:', customerId);
  return result.customer;
}

async function addPrizeToCustomer(customer, prizeId, prizeLabel, prizeNumber) {
  const currentDate = new Date().toISOString().split('T')[0];
  
  // Create tags for tracking
  const spinPrizeTag = `Spin Prize: ${prizeLabel}`;
  const spinDateTag = `Spin Date: ${currentDate}`;
  const prizeNumberTag = `Prize Number: ${prizeNumber}`;
  const internalTag = `wheel_prize:${prizeId}`; // For internal tracking
  const playedTag = 'wheel_played';
  
  // Get existing tags and add new ones
  const existingTags = customer.tags ? customer.tags.split(',').map(t => t.trim()) : [];
  const newTags = [...existingTags, spinPrizeTag, spinDateTag, prizeNumberTag, internalTag, playedTag];
  const uniqueTags = [...new Set(newTags)].join(', ');
  
  console.log('📝 Adding tags to customer:', customer.id);
  console.log('   Tags:', spinPrizeTag, '|', spinDateTag, '|', prizeNumberTag);
  
  await updateCustomerTags(customer.id, uniqueTags);
  
  // Also update note with prize info
  const noteData = {
    customer: {
      id: customer.id,
      note: `Wheel Spin Prize: ${prizeLabel} (#${prizeNumber}) on ${new Date().toISOString()}`
    }
  };
  await shopifyRequest('put', `/customers/${customer.id}.json`, noteData);
  
  return { spinPrizeTag, spinDateTag, prizeNumberTag };
}

function hasPlayedWheel(customer) {
  if (!customer.tags) return false;
  const tags = customer.tags.toLowerCase();
  return tags.includes('wheel_played') || tags.includes('wheel_prize:');
}

function getPrizeFromTags(customer) {
  if (!customer.tags) return null;
  const tags = customer.tags.split(',').map(t => t.trim());
  
  const spinPrizeTag = tags.find(t => t.startsWith('Spin Prize:'));
  const spinDateTag = tags.find(t => t.startsWith('Spin Date:'));
  const prizeNumberTag = tags.find(t => t.startsWith('Prize Number:'));
  
  if (!spinPrizeTag) return null;
  
  return {
    label: spinPrizeTag.replace('Spin Prize:', '').trim(),
    date: spinDateTag ? spinDateTag.replace('Spin Date:', '').trim() : null,
    number: prizeNumberTag ? prizeNumberTag.replace('Prize Number:', '').trim() : null
  };
}

// ----- API Endpoint -----
app.post('/spin', async (req, res) => {
  try {
    const phone = (req.body.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone required' });

    console.log('🎡 Spin request for phone:', phone);

    // find or create customer
    let customer = await findCustomerByPhone(phone);
    
    if (customer) {
      console.log('👤 Found existing customer:', customer.id);
      
      // Check if already played via tags
      if (hasPlayedWheel(customer)) {
        console.log('⚠️ Customer already played');
        const prizeInfo = getPrizeFromTags(customer);
        return res.json({ 
          alreadyPlayed: true, 
          prize: prizeInfo || { label: 'Already Played' }
        });
      }
    } else {
      console.log('🆕 Creating new customer for phone:', phone);
      customer = await createCustomerWithPhone(phone);
    }

    // get current prize counts and distribution
    let shopMf = await ensureShopPrizeCounts();
    let distributionMf = await ensurePrizeDistribution();
    let counts = shopMf.value;

    console.log('📊 Current prize counts:', counts);
    console.log('📈 Total distributed:', distributionMf.value);

    const available = PRIZES.filter(p => counts[p.id] === null || counts[p.id] > 0);
    
    if (available.length === 0) {
      console.log('❌ No prizes available, giving fallback');
      const fallback = PRIZES.find(p => p.id === 'better_luck');
      const prizeNumber = await incrementPrizeDistribution(fallback.id, distributionMf);
      await addPrizeToCustomer(customer, fallback.id, fallback.label, prizeNumber);
      return res.json({ prize: { label: fallback.label, number: prizeNumber } });
    }

    // Weighted random selection
    const totalProb = available.reduce((sum, p) => sum + p.prob, 0);
    let r = Math.random() * totalProb;
    let cumulative = 0;
    let chosen = available[available.length - 1];
    
    for (const p of available) {
      cumulative += p.prob;
      if (r <= cumulative) {
        chosen = p;
        break;
      }
    }

    console.log('🎁 Prize selected:', chosen.label);

    // Update counts
    if (counts[chosen.id] !== null) {
      counts[chosen.id] = Math.max(0, counts[chosen.id] - 1);
      await setShopPrizeCounts(counts, shopMf.metafield.id);
      console.log('📉 Updated prize count for', chosen.id, ':', counts[chosen.id]);
    }

    // Increment distribution counter and get prize number
    const prizeNumber = await incrementPrizeDistribution(chosen.id, distributionMf);
    console.log('📈 Prize number for', chosen.id, ':', prizeNumber);

    // Save prize to customer tags
    await addPrizeToCustomer(customer, chosen.id, chosen.label, prizeNumber);

    res.json({ 
      prize: { 
        id: chosen.id, 
        label: chosen.label,
        number: prizeNumber
      } 
    });
  } catch (err) {
    console.error('❌ Spin Error:', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'server error', details: err.message });
  }
});

// Reset prize counts to initial values
app.post('/admin/reset-prizes', async (req, res) => {
  try {
    const { adminKey } = req.body;
    
    // Simple admin key check (set in .env as ADMIN_RESET_KEY)
    if (adminKey !== process.env.ADMIN_RESET_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const shopMf = await ensureShopPrizeCounts();
    
    // Reset to initial max values
    const resetCounts = {};
    PRIZES.forEach(p => resetCounts[p.id] = p.max === null ? null : p.max);
    
    await setShopPrizeCounts(resetCounts, shopMf.metafield.id);
    
    console.log('🔄 Prize counts reset to:', resetCounts);
    
    res.json({ 
      success: true, 
      message: 'Prize counts reset successfully',
      newCounts: resetCounts
    });
  } catch (err) {
    console.error('Reset Error:', err.message);
    res.status(500).json({ error: 'server error', details: err.message });
  }
});

// Get current prize statistics
app.get('/admin/stats', async (req, res) => {
  try {
    const { adminKey } = req.query;
    
    if (adminKey !== process.env.ADMIN_RESET_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const shopMf = await ensureShopPrizeCounts();
    const distributionMf = await ensurePrizeDistribution();
    
    const stats = PRIZES.map(p => ({
      id: p.id,
      label: p.label,
      maxAvailable: p.max,
      remaining: shopMf.value[p.id],
      totalDistributed: distributionMf.value[p.id] || 0
    }));
    
    res.json({ stats });
  } catch (err) {
    console.error('Stats Error:', err.message);
    res.status(500).json({ error: 'server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get customer spin history
app.get('/customer/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const customer = await findCustomerByPhone(phone);
    
    if (!customer) {
      return res.json({ found: false });
    }
    
    const hasPlayed = hasPlayedWheel(customer);
    const prize = getPrizeFromTags(customer);
    
    res.json({
      found: true,
      customerId: customer.id,
      hasPlayed,
      prize,
      tags: customer.tags,
      note: customer.note
    });
  } catch (err) {
    console.error('Error fetching customer:', err.message);
    res.status(500).json({ error: 'server error' });
  }
});

// ----- Server start -----
(async () => {
  try {
    console.log('🔧 Initializing prize counts and distribution tracking...');
    await ensureShopPrizeCounts();
    await ensurePrizeDistribution();
    app.listen(PORT, () => console.log(`🚀 Wheel spin backend running on port ${PORT}`));
  } catch (err) {
    console.error('💥 Startup error:', err.message);
    process.exit(1);
  }
})();