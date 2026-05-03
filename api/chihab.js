// Chihab AI - Gemini Vercel serverless endpoint
// Required Vercel Environment Variable: GEMINI_API_KEY
// Optional Vercel Environment Variable: GEMINI_MODEL
// Recommended optional value: gemini-2.0-flash

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
    return value
      .map(item => toText(item, max))
      .filter(Boolean)
      .join('\n')
      .slice(0, max);
  }

  if (typeof value === 'object') {
    return toText(
      value.text ||
      value.content ||
      value.message ||
      value.value ||
      '',
      max
    );
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
    body?.query,
    body?.contents?.[0]?.parts,
    Array.isArray(body?.messages)
      ? body.messages[body.messages.length - 1]?.content
      : '',
    Array.isArray(body?.history)
      ? body.history[body.history.length - 1]?.content
      : ''
  ];

  for (const candidate of candidates) {
    const msg = toText(candidate, 1200);
    if (msg) return msg;
  }

  return '';
}

function buildMenuText(menu) {
  if (!Array.isArray(menu) || menu.length === 0) {
    return 'No menu data was sent by the website.';
  }

  return menu
    .slice(0, 120)
    .map(item => {
      const name = toText(item?.name, 80);
      if (!name) return '';

      const category = toText(item?.category, 50);

      const price = Number.isFinite(Number(item?.price))
        ? `${Number(item.price)} MAD`
        : 'price not provided';

      const ingredients = Array.isArray(item?.ingredients)
        ? item.ingredients
            .slice(0, 8)
            .map(x => toText(x, 30))
            .filter(Boolean)
            .join(', ')
        : '';

      const desc = toText(item?.desc || item?.description, 120);
      const availability = item?.available === false ? 'UNAVAILABLE' : 'AVAILABLE';

      return `${availability} | ${name} | ${category} | ${price} | ${ingredients} | ${desc}`;
    })
    .filter(Boolean)
    .join('\n');
}

function basicFallback(message) {
  const m = message.toLowerCase();

  if (m.includes('hi') || m.includes('hello') || m.includes('salut') || m.includes('salam')) {
    return 'Hi, welcome to For You Restaurant. Tell me your budget, what you like, or what you want to avoid, and I will suggest something from the menu.';
  }

  if (m.includes('hour') || m.includes('open') || m.includes('close')) {
    return 'For You opens at 3 PM every day. It closes at 12:30 AM from Monday to Thursday, 1 AM on Sunday, and 2 AM on Friday and Saturday.';
  }

  if (m.includes('weather')) {
    return 'I do not have live weather access inside this restaurant assistant, but I can suggest something warm, cold, light, or filling from the menu.';
  }

  if (m.includes('chicken')) {
    return 'For chicken options, tell me your budget and whether you want something light or filling. You can also check the Menu tab for the exact available chicken items and prices.';
  }

  if (m.includes('cheese')) {
    return 'Got it — no cheese. Tell me your budget and what type of food you want, and I will help narrow it down.';
  }

  return 'I can help you choose from the For You menu. Tell me your budget, what you like, and what you want to avoid.';
}

function formatRecommendationIntelligence(analytics) {
  const intelligence = analytics?.recommendationIntelligence || {};

  const topItems = Array.isArray(intelligence.topItems)
    ? intelligence.topItems
        .slice(0, 8)
        .map(x => `${x.name} (${x.qty || x.orders || x.count || 0})`)
        .join(', ')
    : '';

  const commonPairings = Array.isArray(intelligence.commonPairings)
    ? intelligence.commonPairings
        .slice(0, 8)
        .map(x => `${Array.isArray(x.items) ? x.items.join(' + ') : x.pair} (${x.count || 0})`)
        .join('; ')
    : '';

  const categoryUpsells = intelligence.categoryUpsells
    ? Object.entries(intelligence.categoryUpsells)
        .slice(0, 8)
        .map(([category, items]) => {
          const names = Array.isArray(items)
            ? items
                .slice(0, 4)
                .map(x => `${x.item || x.name} (${x.count || 0})`)
                .join(', ')
            : '';

          return `${category}: ${names}`;
        })
        .join('\n')
    : '';

  const weekendFavorites = Array.isArray(intelligence.weekendFavorites)
    ? intelligence.weekendFavorites
        .slice(0, 6)
        .map(x => `${x.name} (${x.count || 0})`)
        .join(', ')
    : '';

  const lateNightFavorites = Array.isArray(intelligence.lateNightFavorites)
    ? intelligence.lateNightFavorites
        .slice(0, 6)
        .map(x => `${x.name} (${x.count || 0})`)
        .join(', ')
    : '';

  const budgetFavorites = Array.isArray(intelligence.budgetFavorites)
    ? intelligence.budgetFavorites
        .slice(0, 6)
        .map(x => `${x.name} (${x.count || 0})`)
        .join(', ')
    : '';

  return [
    `Dataset size: ${intelligence.datasetSize || 'not provided'}`,
    `Top items: ${topItems || 'not provided'}`,
    `Common pairings: ${commonPairings || 'not provided'}`,
    `Category upsells:\n${categoryUpsells || 'not provided'}`,
    `Weekend favorites: ${weekendFavorites || 'not provided'}`,
    `Late-night favorites: ${lateNightFavorites || 'not provided'}`,
    `Budget favorites: ${budgetFavorites || 'not provided'}`
  ].join('\n');
}

function buildPrompt({ message, menu, language, analytics }) {
  return [
    'You are Chihab, a warm and concise AI assistant for For You Restaurant in Ifrane, Morocco.',
    `Reply in ${toText(language, 40) || 'English'} unless the customer clearly uses another language.`,
    '',
    'ROLE:',
    'You are a restaurant assistant, not a general chatbot.',
    'Help with menu recommendations, ingredients, prices, opening hours, delivery, payment, order tracking, and realistic upselling.',
    '',
    'UNRELATED QUESTIONS:',
    'If the user asks about weather, news, politics, homework, sports scores, medical advice, or other unrelated topics, do not pretend to have live access.',
    'Reply briefly and politely, then redirect to restaurant help.',
    'Example: “I do not have live weather access here, but I can suggest something warm, cold, light, or filling from the menu.”',
    '',
    'RESTAURANT FACTS:',
    'For You Restaurant is in Ifrane, Morocco.',
    'Opening hours: opens 3 PM daily. Closes 12:30 AM Monday to Thursday, 1 AM Sunday, and 2 AM Friday and Saturday.',
    'Payment: cash or card at delivery. Prices are in MAD.',
    '',
    'MENU RULES:',
    'Recommend only exact menu items from the provided menu.',
    'Do not invent dishes, prices, ingredients, promotions, or availability.',
    'Respect restrictions like no cheese, no shrimp, spicy, light, filling, budget, sweet, salty, etc.',
    '',
    'RECOMMENDATION LOGIC:',
    'Use the order intelligence below when available. If no intelligence is provided, use menu logic.',
    'For burgers and sandwiches, suggest realistic add-ons like fries, onion rings, soda, or milkshake.',
    'For sushi, suggest soda, juice, tea, or lighter desserts.',
    'For loaded fries and loaded mac, suggest soda, cheese sides, or milkshake.',
    'Avoid weird pairings such as mint tea with burgers unless the user specifically asks for tea.',
    '',
    'ANSWER FORMAT:',
    'Always answer in complete sentences.',
    'Never stop mid-sentence.',
    'Keep the answer short but complete.',
    'If recommending items, give 2 to 4 options maximum.',
    'Do not use markdown tables.',
    '',
    `MENU:\n${menu}`,
    '',
    `ORDER INTELLIGENCE:\n${formatRecommendationIntelligence(analytics)}`,
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

    if (!response.ok || !Array.isArray(data?.models)) {
      return [];
    }

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
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 700
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
    const detail =
      data?.error?.message ||
      data?.error?.status ||
      raw ||
      `HTTP ${response.status}`;

    throw new Error(`${cleanModel}: ${detail}`);
  }

  const answer =
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      .join('\n')
      .trim() || '';

  return answer;
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

      if (answer) {
        return answer;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    lastError?.message ||
    'No usable Gemini model was found for this API key.'
  );
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

  const menu = buildMenuText(body?.menu);

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