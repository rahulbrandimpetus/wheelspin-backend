const axios = require('axios');
const { API_BASE, GRAPHQL_ENDPOINT, TOKEN } = require('../config/constants');

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
  const spinTheWheel = `Spin The Wheel`;
  
  const existingTags = customer.tags ? customer.tags.split(',').map(t => t.trim()) : [];
  
  // Add all three tags to the array
  const newTags = [...existingTags, spinPrizeTag, spinDateTag, spinTheWheel];
  const uniqueTags = [...new Set(newTags)].join(', ');
  
  // Pass only customerId and the tags string
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

module.exports = {
  shopifyRequest,
  shopifyGraphQL,
  findCustomerByPhone,
  createCustomerWithPhone,
  updateCustomerTags,
  addPrizeToCustomer,
  hasPlayedWheel,
  getPrizeFromTags,
  getAllWheelPrizeMetaobjects,
  getFieldValue,
  updatePrizeMetaobject
};