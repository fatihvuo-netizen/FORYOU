// Vercel Serverless Function for Chihab AI
// Required environment variable in Vercel: ANTHROPIC_API_KEY
// Optional environment variable: CLAUDE_MODEL, e.g. claude-3-5-haiku-latest

const DEFAULT_MODEL = 'claude-3-5-haiku-latest';
const MAX_MENU_ITEMS = 220;
const MAX_HISTORY_MESSAGES = 12;
const MAX_CONTENT_CHARS = 900;

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body)); } catch (err) { return reject(err); }
    }

    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 400_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function text(value, max = MAX_CONTENT_CHARS) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeHistory(history) {
  const out = [];
  for (const m of Array.isArray(history) ? history : []) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const content = text(m?.content);
    if (!content) continue;
    if (out.length && out[out.length - 1].role === role) {
      out[out.length - 1].content += '\n' + content;
    } else {
      out.push({ role, content });
    }
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out.slice(-MAX_HISTORY_MESSAGES);
}

function sanitizeMenu(menu) {
  return (Array.isArray(menu) ? menu : [])
    .slice(0, MAX_MENU_ITEMS)
    .map(item => ({
      id: text(item?.id, 80),
      name: text(item?.name, 120),
      category: text(item?.category, 80),
      price: Number.isFinite(Number(item?.price)) ? Number(item.price) : null,
      prep: text(item?.prep, 60),
      ingredients: Array.isArray(item?.ingredients) ? item.ingredients.slice(0, 12).map(x => text(x, 40)).filter(Boolean) : [],
      desc: text(item?.desc, 220),
      available: item?.available !== false
    }))
    .filter(item => item.id && item.name && item.price !== null);
}

function buildPrompt({ language, menu, analytics }) {
  const compactMenu = menu
    .map(item => `${item.available ? 'AVAILABLE' : 'UNAVAILABLE'} | ${item.name} | ${item.category} | ${item.price} MAD | ${item.ingredients.join(', ')} | ${item.desc}`)
    .join('\n');

  const topItems = Array.isArray(analytics?.topItems)
    ? analytics.topItems.slice(0, 5).map(x => `${text(x?.name, 80)} (${Number(x?.qty || 0)} orders)`).filter(Boolean).join(', ')
    : '';

  return [
    'You are Chihab, the warm and conversational AI assistant for "For You Restaurant" in Ifrane, Morocco.',
    '',
    `LANGUAGE: Reply in ${text(language, 40) || 'English'} unless the customer clearly writes in another language.`,
    '',
    'RESTAURANT INFO:',
    '- Opens at 3 PM every day.',
    '- Closes 12:30 AM Mon-Thu, 1 AM Sunday, 2 AM Fri-Sat.',
    '- Payment: cash or card at delivery. Prices are in Moroccan dirhams (MAD).',
    '',
    `MENU (${menu.length} items):`,
    compactMenu || 'No menu was provided by the app.',
    '',
    `ANALYTICS - most ordered: ${topItems || 'No order history yet'}`,
    '',
    'RULES:',
    '- Recommend ONLY items from the MENU, using exact names and prices.',
    '- Never invent dishes, prices, ingredients, promotions, opening hours, or unavailable options.',
    '- Skip UNAVAILABLE items and suggest available alternatives.',
    '- Respect restrictions: no cheese, no shrimp, no meat, budget, spicy, sweet, salty, filling, sushi, drinks, desserts.',
    '- For greetings, reply naturally and briefly.',
    '- For food advice, give 2 to 4 suggestions with a short reason each.',
    '- Never output JSON, code blocks, markdown tables, or technical implementation text.',
    '- Keep answers friendly, useful, and concise.'
  ].join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, { error: 'Chihab AI is not configured. Add ANTHROPIC_API_KEY in your deployment environment variables.' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (_) {
    return sendJson(res, 400, { error: 'Invalid JSON request.' });
  }

  const message = text(body?.message, 1200);
  const menu = sanitizeMenu(body?.menu);
  const history = sanitizeHistory(body?.history);

  if (!message) return sendJson(res, 400, { error: 'Missing message.' });
  if (!history.length || history[history.length - 1].content !== message) {
    history.push({ role: 'user', content: message });
  }

  const system = buildPrompt({
    language: body?.language,
    menu,
    analytics: body?.analytics
  });

  let anthropicResponse;
  try {
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || DEFAULT_MODEL,
        max_tokens: 520,
        temperature: 0.55,
        system,
        messages: history
      })
    });
  } catch (_) {
    return sendJson(res, 502, { error: 'Could not reach Claude. Check network or deployment logs.' });
  }

  let data = null;
  const raw = await anthropicResponse.text();
  try { data = raw ? JSON.parse(raw) : null; } catch (_) {}

  if (!anthropicResponse.ok) {
    const detail = data?.error?.message || raw || `Claude returned HTTP ${anthropicResponse.status}`;
    return sendJson(res, anthropicResponse.status, { error: detail });
  }

  const answer = Array.isArray(data?.content)
    ? data.content.filter(block => block?.type === 'text').map(block => block.text).join('\n').trim()
    : '';

  if (!answer) return sendJson(res, 502, { error: 'Claude returned an empty response.' });

  return sendJson(res, 200, { text: answer });
};
