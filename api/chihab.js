// Chihab AI - Gemini Vercel serverless endpoint
// Required Vercel Environment Variable: GEMINI_API_KEY
// Optional Vercel Environment Variable: GEMINI_MODEL

const PREFERRED_MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash'
].filter(Boolean);

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return { message: req.body };
    }
  }

  const raw = await new Promise((resolve, reject) => {
    let data = '';

    req.on('data', chunk => {
      data += chunk;

      if (data.length > 300000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

function toText(value, max = 1200) {
  if (value == null) return '';

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  if (Array.isArray(value)) {
    return value.map(x => toText(x, max)).filter(Boolean).join('\n').slice(0, max);
  }

  if (typeof value === 'object') {
    return toText(value.text || value.content || value.message || value.value || '', max);
  }

  return '';
}

function extractMessage(body) {
  const candidates = [
    body?.message,
    body?.prompt,
    body?.text,
    body?.input,
    body?.question,
    body?.userMessage,
    body?.content,
    body?.query
  ];

  for (const candidate of candidates) {
    const msg = toText(candidate, 1200);
    if (msg) return msg;
  }

  return '';
}

function normalize(value) {
  return String(value || '').toLowerCase();
}

function detectForbiddenTerms(message) {
  const m = normalize(message);
  const forbidden = [];

  function add(term, patterns) {
    if (patterns.some(p => m.includes(p))) forbidden.push(term);
  }

  add('fries', ['hate fries', 'no fries', 'without fries', "don't want fries", 'do not want fries', "don't like fries", 'do not like fries', 'sans frites', 'pas de frites']);
  add('cheese', ['hate cheese', 'no cheese', 'without cheese', "don't want cheese", 'do not want cheese', "don't like cheese", 'do not like cheese', 'sans fromage', 'pas de fromage']);
  add('shrimp', ['hate shrimp', 'no shrimp', 'without shrimp', "don't want shrimp", 'do not want shrimp', 'sans crevette', 'pas de crevette']);
  add('spicy', ['not spicy', 'no spicy', 'without spicy', 'hate spicy', 'pas piquant', 'pas épicé', 'sans piquant']);
  add('meat', ['no meat', 'without meat', 'vegetarian', 'veggie', 'sans viande', 'végétarien']);

  return [...new Set(forbidden)];
}

function itemContainsForbidden(item, forbiddenTerms) {
  if (!forbiddenTerms.length) return false;

  const text = normalize([
    item?.name,
    item?.category,
    item?.desc,
    item?.description,
    Array.isArray(item?.ingredients) ? item.ingredients.join(' ') : ''
  ].filter(Boolean).join(' '));

  return forbiddenTerms.some(term => {
    if (term === 'fries') return text.includes('fries') || text.includes('frites') || text.includes('loaded fries');
    if (term === 'cheese') return text.includes('cheese') || text.includes('fromage') || text.includes('cheddar') || text.includes('mozzarella');
    if (term === 'shrimp') return text.includes('shrimp') || text.includes('crevette');
    if (term === 'spicy') return text.includes('spicy') || text.includes('volcano') || text.includes('hot') || text.includes('piquant');
    if (term === 'meat') return text.includes('beef') || text.includes('chicken') || text.includes('turkey') || text.includes('shawarma') || text.includes('meat') || text.includes('viande');
    return text.includes(term);
  });
}

function buildMenuText(menu, message = '') {
  if (!Array.isArray(menu) || menu.length === 0) {
    return 'No menu data was sent by the website.';
  }

  const forbiddenTerms = detectForbiddenTerms(message);

  const filtered = menu
    .filter(item => item && item.name && item.available !== false)
    .filter(item => !itemContainsForbidden(item, forbiddenTerms));

  const source = filtered.length ? filtered : menu.filter(item => item && item.name);
  const grouped = {};

  source.slice(0, 180).forEach(item => {
    const category = toText(item?.category || 'Other', 60);
    if (!grouped[category]) grouped[category] = [];

    const name = toText(item?.name, 80);
    const price = Number.isFinite(Number(item?.price)) ? `${Number(item.price)} MAD` : 'price not provided';
    const ingredients = Array.isArray(item?.ingredients)
      ? item.ingredients.slice(0, 8).map(x => toText(x, 30)).filter(Boolean).join(', ')
      : '';
    const desc = toText(item?.desc || item?.description, 130);

    grouped[category].push(`${name} | ${price} | ${ingredients} | ${desc}`);
  });

  const menuText = Object.entries(grouped)
    .map(([category, items]) => `CATEGORY: ${category}\n${items.join('\n')}`)
    .join('\n\n');

  if (!forbiddenTerms.length) return menuText;

  return [
    `CUSTOMER RESTRICTIONS DETECTED: Avoid ${forbiddenTerms.join(', ')}.`,
    'The menu below was filtered to reduce conflicting items.',
    '',
    menuText
  ].join('\n');
}

function basicFallback(message) {
  const m = normalize(message);

  if (m.includes('weather')) {
    return 'I do not have live weather access here, but I can help you choose something warm, cold, light, or filling from the menu.';
  }

  if (m.includes('hour') || m.includes('open') || m.includes('close')) {
    return 'For You opens at 3 PM every day. It closes at 12:30 AM from Monday to Thursday, 1 AM on Sunday, and 2 AM on Friday and Saturday.';
  }

  return 'I can help with the For You menu, recommendations, prices, ingredients, orders, and delivery.';
}

function formatRecommendationIntelligence(analytics) {
  const intelligence = analytics?.recommendationIntelligence || {};

  const topItems = Array.isArray(intelligence.topItems)
    ? intelligence.topItems.slice(0, 10).map(x => `${x.name} (${x.qty || x.orders || x.count || 0})`).join(', ')
    : '';

  const commonPairings = Array.isArray(intelligence.commonPairings)
    ? intelligence.commonPairings.slice(0, 10).map(x => `${Array.isArray(x.items) ? x.items.join(' + ') : x.pair} (${x.count || 0})`).join('; ')
    : '';

  const categoryUpsells = intelligence.categoryUpsells
    ? Object.entries(intelligence.categoryUpsells).slice(0, 10).map(([category, items]) => {
        const names = Array.isArray(items)
          ? items.slice(0, 5).map(x => `${x.item || x.name} (${x.count || 0})`).join(', ')
          : '';
        return `${category}: ${names}`;
      }).join('\n')
    : '';

  const weekendFavorites = Array.isArray(intelligence.weekendFavorites)
    ? intelligence.weekendFavorites.slice(0, 8).map(x => `${x.name} (${x.count || 0})`).join(', ')
    : '';

  const lateNightFavorites = Array.isArray(intelligence.lateNightFavorites)
    ? intelligence.lateNightFavorites.slice(0, 8).map(x => `${x.name} (${x.count || 0})`).join(', ')
    : '';

  const budgetFavorites = Array.isArray(intelligence.budgetFavorites)
    ? intelligence.budgetFavorites.slice(0, 8).map(x => `${x.name} (${x.count || 0})`).join(', ')
    : '';

  const hasData = topItems || commonPairings || categoryUpsells || weekendFavorites || lateNightFavorites || budgetFavorites;

  if (!hasData) {
    return [
      'Manager analytics were not sent in this request.',
      'Do not tell the customer you lack popularity data.',
      'Use menu knowledge and sensible restaurant pairing logic confidently.'
    ].join('\n');
  }

  return [
    `Historical dataset size: ${intelligence.datasetSize || 'not provided'} valid orders`,
    `Popular items: ${topItems || 'not provided'}`,
    `Association rules / common pairings: ${commonPairings || 'not provided'}`,
    `Upselling by category:\n${categoryUpsells || 'not provided'}`,
    `Weekend favorites: ${weekendFavorites || 'not provided'}`,
    `Late-night favorites: ${lateNightFavorites || 'not provided'}`,
    `Budget favorites: ${budgetFavorites || 'not provided'}`
  ].join('\n');
}

function buildPrompt({ message, menu, language, analytics }) {
  const forbiddenTerms = detectForbiddenTerms(message);
  const m = normalize(message);

  return [
    'You are Chihab, the smart restaurant assistant for For You Restaurant in Ifrane, Morocco.',
    `Reply in ${toText(language, 40) || 'English'} unless the customer clearly uses another language.`,
    '',
    'MAIN RULE:',
    'Answer food, menu, price, ingredient, recommendation, upselling, order, delivery, and opening-hour questions fully.',
    'For unrelated topics such as sports, politics, news, homework, general trivia, or live weather, briefly say you are focused on restaurant help and redirect to food or orders.',
    '',
    'INTENT RULE:',
    'If the customer asks “what can I eat?”, “recommend something”, “I am hungry”, “something filling”, “what is good?”, or similar, give food recommendations. Do not answer with opening hours unless they ask about hours.',
    `Customer message lowercased: ${m}`,
    '',
    'CUSTOMER PREFERENCE RULE:',
    'Dislikes and restrictions are mandatory. Never recommend something the customer says they hate or do not want.',
    `Detected restrictions: ${forbiddenTerms.length ? forbiddenTerms.join(', ') : 'none'}.`,
    '',
    'RESTAURANT FACTS:',
    'Location: Ifrane, Morocco.',
    'Opening hours: opens 3 PM daily. Closes 12:30 AM Monday to Thursday, 1 AM Sunday, and 2 AM Friday and Saturday.',
    'Payment: cash or card at delivery. Prices are in MAD.',
    '',
    'MENU RULES:',
    'Recommend only exact items from the provided menu.',
    'Do not invent dishes, prices, ingredients, discounts, promotions, or availability.',
    'Use the whole menu and diversify suggestions. Do not always recommend the same category.',
    '',
    'ANALYTICS AND UPSELLING RULE:',
    'Use the historical analytics and association rules when provided.',
    'If analytics are provided, treat them as the restaurant’s historical order data.',
    'If analytics are missing, do not mention that to the customer. Use sensible menu logic.',
    'For burgers/sandwiches, realistic add-ons are onion rings, soda, or milkshake. Fries only if the customer did not reject fries.',
    'For sushi, realistic add-ons are soda, juice, tea, or light dessert.',
    'For loaded fries/loaded mac, realistic add-ons are soda, cheese sides, or milkshake unless rejected.',
    '',
    'ANSWER STYLE:',
    'Be direct and helpful.',
    'Give 2 to 4 options maximum.',
    'Each recommendation should include price and a short reason.',
    'Always finish the sentence.',
    'No markdown tables.',
    '',
    `MENU:\n${menu}`,
    '',
    `HISTORICAL ANALYTICS / UPSELLING DATA:\n${formatRecommendationIntelligence(analytics)}`,
    '',
    `CUSTOMER MESSAGE:\n${message}`
  ].join('\n');
}

async function listUsableGeminiModels(apiKey) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );

    const raw = await response.text();

    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok || !Array.isArray(data?.models)) return [];

    return data.models
      .filter(model =>
        Array.isArray(model.supportedGenerationMethods) &&
        model.supportedGenerationMethods.includes('generateContent')
      )
      .map(model => String(model.name || '').replace(/^models\//, ''))
      .filter(Boolean)
      .sort((a, b) => {
        const score = name => {
          if (name.includes('2.0-flash')) return 1;
          if (name.includes('2.5-flash')) return 2;
          if (name.includes('flash')) return 3;
          if (name.includes('pro')) return 4;
          return 9;
        };
        return score(a) - score(b);
      });
  } catch {
    return [];
  }
}

async function tryGeminiModel({ apiKey, model, prompt }) {
  const cleanModel = String(model).replace(/^models\//, '');

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1200
      }
    })
  });

  const raw = await response.text();

  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.error?.status || raw || `HTTP ${response.status}`;
    throw new Error(`${cleanModel}: ${detail}`);
  }

  return data?.candidates?.[0]?.content?.parts
    ?.map(part => part?.text || '')
    .join('\n')
    .trim() || '';
}

async function callGemini({ apiKey, prompt }) {
  const availableModels = await listUsableGeminiModels(apiKey);

  const modelsToTry = [
    ...PREFERRED_MODELS,
    ...availableModels
  ]
    .map(model => String(model).replace(/^models\//, ''))
    .filter(Boolean)
    .filter((model, index, arr) => arr.indexOf(model) === index);

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const answer = await tryGeminiModel({ apiKey, model, prompt });
      if (answer) return answer;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || 'No usable Gemini model was found for this API key.');
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      provider: 'Gemini',
      route: 'Chihab API is live. The browser test works. The chat sends POST requests.'
    });
  }

  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 200, {
      text: 'Chihab API is live. Please use the chat box on the website.'
    });
  }

  let body = {};

  try {
    body = await readBody(req);
  } catch {
    body = {};
  }

  const message = extractMessage(body);

  if (!message) {
    return sendJson(res, 200, {
      text: 'I did not receive your message. Please type it again in the chat box.'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return sendJson(res, 200, {
      text: 'Chihab AI is not configured yet. Add GEMINI_API_KEY in Vercel Environment Variables, then redeploy.'
    });
  }

  const menu = buildMenuText(body?.menu, message);

  const prompt = buildPrompt({
    message,
    menu,
    language: body?.language,
    analytics: body?.analytics || {}
  });

  try {
    const answer = await callGemini({ apiKey, prompt });

    return sendJson(res, 200, {
      text: answer || basicFallback(message)
    });
  } catch (error) {
    return sendJson(res, 200, {
      text: `Gemini is reachable but rejected the request: ${error.message || error}`
    });
  }
};