require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_BASE = `https://${SHOP}/admin/api/2024-10`;
const GRAPHQL_ENDPOINT = `https://${SHOP}/admin/api/2024-10/graphql.json`;
const PORT = process.env.PORT || process.env.APP_PORT || 3000;

const app = express();

app.use(bodyParser.json());

const cors = require('cors');
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));

// Shopify REST API Helpers
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

// GraphQL Helper
async function shopifyGraphQL(query, variables = {}) {
  const headers = {
    'X-Shopify-Access-Token': TOKEN,
    'Content-Type': 'application/json',
  };
  
  try {
    const response = await axios.post(GRAPHQL_ENDPOINT, {
      query,
      variables
    }, { headers });
    
    if (response.data.errors) {
      console.error('GraphQL Errors:', JSON.stringify(response.data.errors, null, 2));
      throw new Error(`GraphQL Error: ${response.data.errors[0].message}`);
    }
    
    return response.data.data;
  } catch (error) {
    console.error('GraphQL Request Error:', {
      message: error.message,
      response: error.response?.data
    });
    throw error;
  }
}

async function findCustomerByPhone(phone) {
  const res = await shopifyRequest('get', `/customers/search.json?query=phone:${encodeURIComponent(phone)}`);
  return (res.customers && res.customers[0]) || null;
}

async function createCustomerWithPhone(phone) {
  const res = await shopifyRequest('post', `/customers.json`, {
    customer: { phone, verified_email: false, note: 'Created for wheel spin' }
  });
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
  return result.customer;
}

async function addPrizeToCustomer(customer, prizeLabel) {
  const currentDate = new Date().toISOString().split('T')[0];
  
  const spinPrizeTag = `Spin Prize: ${prizeLabel}`;
  const spinDateTag = `Spin Date: ${currentDate}`;
  
  const existingTags = customer.tags ? customer.tags.split(',').map(t => t.trim()) : [];
  const newTags = [...existingTags, spinPrizeTag, spinDateTag];
  const uniqueTags = [...new Set(newTags)].join(', ');
  
  await updateCustomerTags(customer.id, uniqueTags);
  
  const noteData = {
    customer: {
      id: customer.id,
      note: `Wheel Spin Prize: ${prizeLabel} on ${new Date().toISOString()}`
    }
  };
  await shopifyRequest('put', `/customers/${customer.id}.json`, noteData);
  
  return { spinPrizeTag, spinDateTag };
}

function hasPlayedWheel(customer) {
  if (!customer.tags) return false;
  const tags = customer.tags.toLowerCase();
  return tags.includes('spin prize:');
}

function getPrizeFromTags(customer) {
  if (!customer.tags) return null;
  const tags = customer.tags.split(',').map(t => t.trim());
  
  const spinPrizeTag = tags.find(t => t.startsWith('Spin Prize:'));
  const spinDateTag = tags.find(t => t.startsWith('Spin Date:'));
  
  if (!spinPrizeTag) return null;
  
  return {
    label: spinPrizeTag.replace('Spin Prize:', '').trim(),
    date: spinDateTag ? spinDateTag.replace('Spin Date:', '').trim() : null
  };
}

// GraphQL Metaobject Functions
async function getAllWheelPrizeMetaobjects() {
  const query = `
    query {
      metaobjects(type: "wheel_prize", first: 50) {
        edges {
          node {
            id
            handle
            fields {
              key
              value
            }
          }
        }
      }
    }
  `;
  
  try {
    const data = await shopifyGraphQL(query);
    
    if (!data.metaobjects || !data.metaobjects.edges) {
      return null;
    }
    
    const metaobjects = data.metaobjects.edges.map(edge => edge.node);
    return metaobjects;
  } catch (err) {
    console.error('Error fetching metaobjects:', err.message);
    return null;
  }
}

function getFieldValue(metaobject, key) {
  const field = metaobject.fields.find(f => f.key === key);
  return field ? field.value : null;
}

async function updatePrizeMetaobject(metaobjectId, updates) {
  const mutation = `
    mutation UpdateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          id
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  
  const variables = {
    id: metaobjectId,
    metaobject: { fields: updates }
  };
  
  const data = await shopifyGraphQL(mutation, variables);
  
  if (data.metaobjectUpdate.userErrors.length > 0) {
    console.error('Error updating metaobject:', data.metaobjectUpdate.userErrors);
    throw new Error(data.metaobjectUpdate.userErrors[0].message);
  }
  
  return data.metaobjectUpdate.metaobject;
}

// Load prizes from metaobjects (ONLY source of truth)
async function loadPrizesFromMetaobjects() {
  const metaobjects = await getAllWheelPrizeMetaobjects();
  
  if (!metaobjects || metaobjects.length === 0) {
    throw new Error('No metaobjects found. Please create prize metaobjects in Shopify Admin first.');
  }
  
  const prizes = [];
  const errors = [];
  
  metaobjects.forEach((mo, index) => {
    const id = getFieldValue(mo, 'prize_id');
    const label = getFieldValue(mo, 'prize_label');
    const probStr = getFieldValue(mo, 'probability');
    const maxStr = getFieldValue(mo, 'max_count');
    const remainingStr = getFieldValue(mo, 'remaining_count');
    const distributedStr = getFieldValue(mo, 'total_distributed');
    
    if (!id || !label) {
      errors.push(`Metaobject ${index + 1}: Missing prize_id or prize_label`);
      return;
    }
    
    // Parse probability as percentage (0-100) and convert to decimal (0-1)
    let prob = parseFloat(probStr);
    if (!probStr || isNaN(prob) || prob < 0) {
      prob = 1.0; // Default 1%
    } else {
      prob = prob / 100; // Convert percentage to decimal
    }
    
    // Cap at 100%
    if (prob > 1) {
      prob = 1;
    }
    
    let max = null;
    if (maxStr && maxStr !== '' && maxStr !== '-1') {
      const parsed = parseInt(maxStr);
      if (!isNaN(parsed) && parsed >= 0) {
        max = parsed;
      }
    }
    
    // If remaining_count is empty/invalid, use max_count
    let remaining = max;
    if (remainingStr && remainingStr !== '' && remainingStr !== '-1') {
      const parsed = parseInt(remainingStr);
      if (!isNaN(parsed) && parsed >= 0) {
        remaining = parsed;
      }
    }
    
    // If max_count changed but remaining_count is higher, cap it at max
    if (max !== null && remaining !== null && remaining > max) {
      remaining = max;
    }
    
    const totalDistributed = parseInt(distributedStr) || 0;
    
    prizes.push({ 
      id, 
      label, 
      prob, 
      max,
      remaining: max === null ? null : remaining,
      totalDistributed,
      metaobjectId: mo.id
    });
  });
  
  if (errors.length > 0) {
    console.error('Prize validation errors:', errors);
  }
  
  if (prizes.length === 0) {
    throw new Error('No valid prizes found in metaobjects. Check prize_id and prize_label fields.');
  }
  
  return prizes;
}

// Get current prizes - always fresh from metaobjects (real-time)
async function getCurrentPrizes() {
  return await loadPrizesFromMetaobjects();
}

// Update all fields after prize distribution
async function updatePrizeAfterSpin(prize) {
  const updates = [];
  
  // Calculate new remaining count
  if (prize.remaining !== null) {
    const newRemaining = Math.max(0, prize.remaining - 1);
    updates.push({ key: "remaining_count", value: String(newRemaining) });
    updates.push({ key: "is_available", value: String(newRemaining > 0) });
  } else {
    updates.push({ key: "is_available", value: "true" });
  }
  
  // Increment total distributed
  const newTotal = prize.totalDistributed + 1;
  updates.push({ key: "total_distributed", value: String(newTotal) });
  
  // Update timestamp
  updates.push({ key: "last_updated", value: new Date().toISOString() });
  
  await updatePrizeMetaobject(prize.metaobjectId, updates);
  
  return newTotal;
}

// API Endpoints
app.post('/spin', async (req, res) => {
  try {
    const phone = (req.body.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone required' });

    let customer = await findCustomerByPhone(phone);
    
    if (customer) {
      if (hasPlayedWheel(customer)) {
        const prizeInfo = getPrizeFromTags(customer);
        return res.json({ 
          alreadyPlayed: true, 
          prize: prizeInfo || { label: 'Already Played' }
        });
      }
    } else {
      customer = await createCustomerWithPhone(phone);
    }

    // Load fresh prizes from metaobjects (real-time with latest probability and max_count)
    const PRIZES = await getCurrentPrizes();

    // Filter available prizes based on remaining count
    const available = PRIZES.filter(p => p.remaining === null || p.remaining > 0);
    
    if (available.length === 0) {
      const fallback = PRIZES.find(p => p.id === 'better_luck') || PRIZES[PRIZES.length - 1];
      const prizeNumber = await updatePrizeAfterSpin(fallback);
      await addPrizeToCustomer(customer, fallback.label);
      
      return res.json({ 
        prize: { 
          label: fallback.label, 
          number: prizeNumber 
        } 
      });
    }

    // Calculate winner based on probability
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

    // Update all metaobject fields after spin
    const prizeNumber = await updatePrizeAfterSpin(chosen);

    // Add prize to customer (only 2 tags)
    await addPrizeToCustomer(customer, chosen.label);

    res.json({ 
      prize: { 
        id: chosen.id, 
        label: chosen.label,
        number: prizeNumber
      } 
    });
  } catch (err) {
    console.error('Spin Error:', err.message);
    res.status(500).json({ error: 'server error', details: err.message });
  }
});

app.post('/admin/reset-prizes', async (req, res) => {
  try {
    const { adminKey } = req.body;
    
    if (adminKey !== process.env.ADMIN_RESET_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const PRIZES = await getCurrentPrizes();
    
    // Reset each prize's remaining_count to max_count
    for (const prize of PRIZES) {
      const resetValue = prize.max === null ? -1 : prize.max;
      await updatePrizeMetaobject(prize.metaobjectId, [
        { key: "remaining_count", value: String(resetValue) },
        { key: "is_available", value: String(prize.max === null || prize.max > 0) },
        { key: "last_updated", value: new Date().toISOString() }
      ]);
    }
    
    res.json({ 
      success: true, 
      message: 'Prize counts reset to max_count values'
    });
  } catch (err) {
    console.error('Reset Error:', err.message);
    res.status(500).json({ error: 'server error', details: err.message });
  }
});

app.get('/admin/stats', async (req, res) => {
  try {
    const { adminKey } = req.query;
    
    if (adminKey !== process.env.ADMIN_RESET_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const PRIZES = await getCurrentPrizes();
    
    const stats = PRIZES.map(p => ({
      id: p.id,
      label: p.label,
      probability: (p.prob * 100).toFixed(2) + '%', // Convert back to percentage for display
      maxCount: p.max,
      remaining: p.remaining,
      totalDistributed: p.totalDistributed,
      isAvailable: p.remaining === null || p.remaining > 0
    }));
    
    res.json({ stats });
  } catch (err) {
    console.error('Stats Error:', err.message);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

app.get('/api/prizes/available', async (req, res) => {
  try {
    const PRIZES = await getCurrentPrizes();
    
    const availablePrizes = PRIZES.map(p => ({
      id: p.id,
      label: p.label,
      probability: (p.prob * 100).toFixed(2) + '%', // Convert back to percentage for display
      maxCount: p.max,
      remaining: p.remaining,
      totalDistributed: p.totalDistributed,
      isAvailable: p.remaining === null || p.remaining > 0
    }));
    
    res.json({ 
      prizes: availablePrizes,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching available prizes:', err.message);
    res.status(500).json({ error: 'server error' });
  }
});

// Server start
(async () => {
  try {
    console.log('========================================');
    console.log('WHEEL SPIN BACKEND - STARTING');
    console.log('========================================');
    
    const PRIZES = await getCurrentPrizes();
    
    console.log('✓ Loaded', PRIZES.length, 'prizes (real-time mode)');
    console.log('');
    
    console.log('========================================');
    console.log('✓ SERVER READY - Real-time Updates Active');
    console.log('========================================');
    console.log('');
    console.log('All data stored in metaobjects');
    console.log('Prize changes in Shopify apply INSTANTLY');
    console.log('');
    console.log('Endpoints:');
    console.log('  POST /spin - Spin the wheel');
    console.log('  POST /admin/reset-prizes - Reset counts');
    console.log('  GET  /admin/stats - View statistics');
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
    console.error('   Example:');
    console.error('   - prize_id: "kivo_easy_lite"');
    console.error('   - prize_label: "Kivo Easy Lite"');
    console.error('   - probability: 0.1 (for 0.1% chance)');
    console.error('   - probability: 33 (for 33% chance)');
    console.error('   - max_count: 1 (use -1 for unlimited)');
    console.error('6. Restart the server');
    console.error('');
    console.error('========================================');
    process.exit(1);
  }
})();