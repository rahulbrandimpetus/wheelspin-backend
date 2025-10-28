const {
  getAllWheelPrizeMetaobjects,
  getFieldValue,
  updatePrizeMetaobject
} = require('./shopify.service');

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
    
    let prob = parseFloat(probStr);
    if (!probStr || isNaN(prob) || prob < 0) {
      prob = 1.0;
    } else {
      prob = prob / 100;
    }
    
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
    
    let remaining = max;
    if (remainingStr && remainingStr !== '' && remainingStr !== '-1') {
      const parsed = parseInt(remainingStr);
      if (!isNaN(parsed) && parsed >= 0) {
        remaining = parsed;
      }
    }
    
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

async function getCurrentPrizes() {
  return await loadPrizesFromMetaobjects();
}

async function updatePrizeAfterSpin(prize) {
  const updates = [];
  
  const newTotal = prize.totalDistributed + 1;
  let newRemaining = prize.remaining;
  let isAvailable = true;
  
  if (prize.remaining !== null) {
    newRemaining = Math.max(0, prize.remaining - 1);
    isAvailable = newRemaining > 0;
    updates.push({ key: "remaining_count", value: String(newRemaining) });
  }
  
  updates.push({ key: "total_distributed", value: String(newTotal) });
  updates.push({ key: "is_available", value: String(isAvailable) });
  updates.push({ key: "last_updated", value: new Date().toISOString() });
  
  await updatePrizeMetaobject(prize.metaobjectId, updates);
  
  return newTotal;
}

module.exports = {
  loadPrizesFromMetaobjects,
  getCurrentPrizes,
  updatePrizeAfterSpin
};