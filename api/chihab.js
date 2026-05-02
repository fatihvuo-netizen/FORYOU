// Chihab AI - final robust Vercel serverless endpoint
// Required Vercel Environment Variable: ANTHROPIC_API_KEY
// Optional: CLAUDE_MODEL

const MODEL = process.env.CLAUDE_MODEL || 'claude-3-haiku-20240307';

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
    return value.map(v => toText(v, max)).filter(Boolean).join('\n').slice(0, max);
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
        ? item.ingredients.slice(0, 8).map(x => toText(x, 30)).filter(Boolean).join(', ')
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

  if (m.includes('chicken')) {
    return 'For chicken options, tell me your budget and whether you want something light or filling. You can also check the Menu tab for the exact available chicken items and prices.';
  }

  if (m.includes('cheese')) {
    return 'Got it — no cheese. Tell me your budget and what type of food you want, and I will help narrow it down.';
  }

  return 'I can help you choose from the For You menu. Tell me your budget, what you like, and what you want to avoid.';
}

module.exports = async function handler(req, res) {
  // This fixes the GET 405 issue.
  if (req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      route: 'Chihab API is live. The browser test works. The chat should send POST requests.'
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

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return sendJson(res, 200, {
      text: 'Chihab AI is not configured yet. Add ANTHROPIC_API_KEY in Vercel Environment Variables, then redeploy.'
    });
  }

  const system = [
    'You are Chihab, a warm and concise AI assistant for For You Restaurant in Ifrane, Morocco.',
    'Recommend only from the provided menu. Do not invent dishes, prices, ingredients, promotions, or hours.',
    'Restaurant hours: opens 3 PM daily. Closes 12:30 AM Mon-Thu, 1 AM Sunday, 2 AM Fri-Sat.',
    'Payment: cash or card at delivery. Prices are in MAD.',
    'Keep replies short and practical. For recommendations, suggest 2 to 4 items with brief reasons.',
    '',
    `MENU:\n${buildMenuText(body?.menu)}`
  ].join('\n');

  try {
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 350,
        temperature: 0.4,
        system,
        messages: [
          {
            role: 'user',
            content: message
          }
        ]
      })
    });

    const raw = await claudeResponse.text();

    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!claudeResponse.ok) {
      const detail = data?.error?.message || raw || `HTTP ${claudeResponse.status}`;
      return sendJson(res, 200, {
        text: `Claude is reachable but rejected the request: ${detail}`
      });
    }

    const answer = Array.isArray(data?.content)
      ? data.content
          .filter(block => block?.type === 'text')
          .map(block => block.text)
          .join('\n')
          .trim()
      : '';

    return sendJson(res, 200, {
      text: answer || basicFallback(message)
    });
  } catch {
    return sendJson(res, 200, {
      text: basicFallback(message)
    });
  }
};
