import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = 3000;

// --- load local secrets from .env.local (gitignored, never committed) ---
function loadEnvLocal() {
  const envPath = join(__dirname, '.env.local');
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}
const env = loadEnvLocal();
const KIT_API_KEY = env.KIT_API_KEY || process.env.KIT_API_KEY || '';
const KIT_FORM_ID = env.KIT_FORM_ID || process.env.KIT_FORM_ID || '';

const mime = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function handleLead(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    if (!KIT_API_KEY || !KIT_FORM_ID) {
      console.warn('[lead] Kit not configured (missing KIT_API_KEY / KIT_FORM_ID in .env.local) — lead logged locally only.');
      console.log('[lead]', JSON.stringify(payload));
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, delivered: false }));
      return;
    }

    const r = payload.results || {};

    try {
      const kitRes = await fetch(`https://api.kit.com/v4/forms/${KIT_FORM_ID}/subscribers`, {
        method: 'POST',
        headers: {
          'X-Kit-Api-Key': KIT_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_address: payload.email,
          fields: {
            maintenance_calories: r.maintenance ?? '',
            target_calories: r.target ?? '',
            walk_km: r.walkKm ?? '',
          },
        }),
      });
      if (!kitRes.ok) {
        const errText = await kitRes.text();
        console.error('[lead] Kit API error:', kitRes.status, errText);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, delivered: false }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, delivered: true }));
    } catch (err) {
      console.error('[lead] Failed to reach Kit:', err.message);
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, delivered: false }));
    }
  });
}

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/lead') {
    return handleLead(req, res);
  }

  let url = req.url === '/' ? '/index.html' : req.url;
  if (url === '/calculator' || url === '/calculator/') url = '/calculator.html';
  const filePath = join(__dirname, url.split('?')[0]);
  const ext = extname(filePath);
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
