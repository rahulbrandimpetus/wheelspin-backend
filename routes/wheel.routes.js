const express = require('express');
const router = express.Router();
const { ADMIN_RESET_KEY } = require('../config/constants');
const {
  findCustomerByPhone,
  createCustomerWithPhone,
  hasPlayedWheel,
  getPrizeFromTags,
  addPrizeToCustomer
} = require('../services/shopify.service');
const {
  getCurrentPrizes,
  updatePrizeAfterSpin
} = require('../services/wheel.service');
const { updatePrizeMetaobject } = require('../services/shopify.service');

router.post('/spin', async (req, res) => {
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

    const PRIZES = await getCurrentPrizes();

    const available = PRIZES.filter(p => {
      if (p.remaining === null) return true;
      if (p.remaining <= 0) return false;
      if (p.max !== null && p.totalDistributed >= p.max) return false;
      return true;
    });
    
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

    if (chosen.remaining !== null && chosen.remaining <= 0) {
      return res.status(500).json({ 
        error: 'Prize no longer available',
        details: 'This prize ran out during selection' 
      });
    }
    
    if (chosen.max !== null && chosen.totalDistributed >= chosen.max) {
      return res.status(500).json({ 
        error: 'Prize limit reached',
        details: 'Maximum prizes already distributed' 
      });
    }

    const prizeNumber = await updatePrizeAfterSpin(chosen);
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

router.post('/admin/reset-prizes', async (req, res) => {
  try {
    const { adminKey } = req.body;
    
    if (adminKey !== ADMIN_RESET_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const PRIZES = await getCurrentPrizes();
    
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

router.get('/admin/stats', async (req, res) => {
  try {
    const { adminKey } = req.query;
    
    if (adminKey !== ADMIN_RESET_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const PRIZES = await getCurrentPrizes();
    
    const stats = PRIZES.map(p => ({
      id: p.id,
      label: p.label,
      probability: (p.prob * 100).toFixed(2) + '%',
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

router.get('/customer/:phone', async (req, res) => {
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

router.get('/api/prizes/available', async (req, res) => {
  try {
    const PRIZES = await getCurrentPrizes();
    
    const availablePrizes = PRIZES.map(p => ({
      id: p.id,
      label: p.label,
      probability: (p.prob * 100).toFixed(2) + '%',
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

module.exports = router;