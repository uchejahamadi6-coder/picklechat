// PickleChat server — a tiny ChatGPT-style app.
// No npm packages needed: only Node.js built-in modules.
//
// Run:  node server.js
// Then open http://localhost:3000
//
// Optional environment variables:
//   OPENAI_API_KEY   – API key for a real AI brain (without it: demo mode)
//   OPENAI_BASE_URL  – default https://api.openai.com/v1
//   OPENAI_MODEL     – default gpt-4o-mini
//   APP_PASSWORD     – if set, visitors must enter this password to chat
//   PORT             – default 3000
//   HOST             – default 0.0.0.0 (needed on hosting platforms)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 15 * 1024 * 1024; // 15 MB (images are compressed in the browser)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
};

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Simple rate limit: max 40 chat requests per 10 minutes per IP ----
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

// ---- The "pretend brain" used when no API key is configured ----
function demoReply(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const raw = last ? last.content : '';
  const text = typeof raw === 'string' ? raw : '(attachment)';
  const lower = text.toLowerCase();

  if (!text.trim()) return 'Say something and I will answer!';
  if (lower.includes('hello') || lower.includes('hi') || lower === 'hey') {
    return "Hey there! 👋 I'm running in demo mode. I don't have a real AI brain connected yet — add an API key in Settings (⚙️) and I'll answer for real!";
  }
  if (lower.includes('how') && (lower.includes('work') || lower.includes('chatbot') || lower.includes('stream'))) {
    return (
      'Great question! Here is how I work:\n\n' +
      '1. You type a message.\n' +
      '2. My server sends the whole conversation to an AI model (the brain).\n' +
      '3. The brain writes a reply one word at a time.\n' +
      '4. The words appear on your screen live, as they arrive.\n\n' +
      'Right now step 2 is faked with canned answers. Add an API key in ⚙️ Settings to plug in a real brain. 🥒'
    );
  }
  if (lower.includes('pickle')) {
    return 'A pickle is a cucumber that took a very brave bath in brine. 🥒\n\n(Demo-mode answer — add an API key for real AI replies!)';
  }
  return (
    `You said: "${text.slice(0, 200)}"\n\n` +
    "I'm in **demo mode** right now — no real AI brain is connected, so my replies are canned. " +
    'Add an API key in ⚙️ Settings (or set OPENAI_API_KEY on the server) and I will answer for real!'
  );
}

// ---- Server-Sent Events helpers ----
function startSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...SECURITY_HEADERS,
  });
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function streamDemo(res, messages) {
  const send = startSSE(res);
  const reply = demoReply(messages);
  for (const piece of reply.split(/(\s+)/)) {
    if (!piece) continue;
    send({ delta: piece });
    await sleep(22);
  }
  send({ done: true, demo: true });
  res.end();
}

async function streamUpstream(res, apiKey, model, baseUrl, messages, system) {
  const send = startSSE(res);
  const finalMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;

  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: finalMessages,
        temperature: 0.8,
        stream: true,
      }),
    });
  } catch (err) {
    send({ error: `Could not reach the AI provider: ${err.message}` });
    return res.end();
  }

  if (!upstream.ok) {
    const data = await upstream.json().catch(() => ({}));
    const msg = (data && data.error && data.error.message) || `AI provider error (${upstream.status})`;
    send({ error: msg });
    return res.end();
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta =
            json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) send({ delta });
        } catch {
          // Ignore keep-alive comments and partial noise.
        }
      }
    }
    send({ done: true, demo: false });
  } catch (err) {
    send({ error: `Stream interrupted: ${err.message}` });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    // ---- Chat API (streaming) ----
    if (pathname === '/api/chat' && req.method === 'POST') {
      const ip =
        String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket.remoteAddress ||
        'unknown';

      if (rateLimited(ip)) {
        return sendJSON(res, 429, {
          error: 'Too many messages — please slow down and try again in a few minutes.',
        });
      }

      if (process.env.APP_PASSWORD) {
        const given = String(req.headers['x-app-password'] || '');
        if (given !== process.env.APP_PASSWORD) {
          return sendJSON(res, 401, { error: 'This app is password protected.' });
        }
      }

      const body = JSON.parse((await readBody(req)) || '{}');
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const system = typeof body.system === 'string' ? body.system.slice(0, 20000) : '';
      const apiKey = String(req.headers['x-api-key'] || process.env.OPENAI_API_KEY || '').trim();

      if (!apiKey) return streamDemo(res, messages);

      const model = String(body.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
      const baseUrl = String(body.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
        .trim()
        .replace(/\/+$/, '');

      return streamUpstream(res, apiKey, model, baseUrl, messages, system);
    }

    // ---- Static files ----
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        ...SECURITY_HEADERS,
      });
      res.end(content);
    });
  } catch (err) {
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`🥒 PickleChat is running → http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.OPENAI_API_KEY ? 'live AI' : 'demo (no API key)'}`);
});
