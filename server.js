// akov.tech — сервер без зависимостей (Node 18+).
// Отдаёт главную с тремя колонками (ПроТех/ПроИнвест/ПроLife), агрегирует
// посты из публичных Telegram-каналов (t.me/s/...) и видео из YouTube RSS.
// Если задан PREVIEW_KEY — сайт закрыт: без ключа показывается заглушка.
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const PORT = process.env.PORT || 3000;
const PREVIEW_KEY = (process.env.PREVIEW_KEY || '').trim();
const PLACEHOLDER = path.join(__dirname, 'placeholder.html');

// ---------------------------------------------------------------- utils ----
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );
}

function firstLine(text, max = 110) {
  const line = text.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
  const clean = line.replace(/\s+/g, ' ');
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
}

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; akov.tech aggregator)' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- cache ----
// stale-while-revalidate: отдаём из кэша мгновенно, обновляем в фоне.
const cache = new Map(); // key -> { data, fetchedAt, refreshing }

function cached(key, maxAgeMs, fetcher) {
  const entry = cache.get(key);
  const fresh = entry && Date.now() - entry.fetchedAt < maxAgeMs;
  if (!fresh && !(entry && entry.refreshing)) {
    const upd = { data: entry ? entry.data : null, fetchedAt: entry ? entry.fetchedAt : 0, refreshing: true };
    cache.set(key, upd);
    fetcher()
      .then(data => cache.set(key, { data, fetchedAt: Date.now(), refreshing: false }))
      .catch(err => {
        console.error(`refresh ${key} failed:`, err.message);
        cache.set(key, { ...upd, refreshing: false });
      });
  }
  return entry ? entry.data : null;
}

// ------------------------------------------------------------- telegram ----
async function fetchTgPosts(handle) {
  const html = await fetchText(`https://t.me/s/${handle}`);
  const chunks = html.split('tgme_widget_message_wrap').slice(1);
  const posts = [];
  for (const chunk of chunks) {
    if (/service_message|tgme_widget_message_service/.test(chunk)) continue; // «Channel created» и т.п.
    const post = chunk.match(/data-post="([^"]+)"/);
    const text = chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const time = chunk.match(/datetime="([^"]+)"/);
    if (!post || !text) continue; // посты без текста (только фото и т.п.)
    const title = firstLine(stripTags(text[1]));
    if (!title) continue;
    posts.push({
      title,
      url: `https://t.me/${post[1]}`,
      date: time ? time[1] : null,
    });
  }
  return posts.slice(-config.limits.tgPosts).reverse(); // новые сверху
}

// -------------------------------------------------------------- youtube ----
async function resolveChannelId(youtube) {
  if (!youtube) return null;
  if (/^UC[\w-]{20,}$/.test(youtube)) return youtube;
  const url = youtube.startsWith('http') ? youtube : `https://www.youtube.com/${youtube.replace(/^@?/, '@')}`;
  const html = await fetchText(url);
  const m = html.match(/"channelId":"(UC[\w-]+)"/) || html.match(/channel\/(UC[\w-]+)/);
  return m ? m[1] : null;
}

async function fetchYtVideos(youtube) {
  const channelId = await resolveChannelId(youtube);
  if (!channelId) return null;
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.slice(0, config.limits.ytVideos).map(e => {
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    return { title: decodeEntities(title), url: `https://www.youtube.com/watch?v=${id}`, date: published };
  });
}

function columnData(col) {
  return {
    tg: cached(`tg:${col.tg}`, config.refreshMinutes.tg * 60_000, () => fetchTgPosts(col.tg)),
    yt: col.youtube
      ? cached(`yt:${col.slug}`, config.refreshMinutes.yt * 60_000, () => fetchYtVideos(col.youtube))
      : null,
  };
}

// ------------------------------------------------------------ rendering ----
function renderList(items, loadingNote, emptyNote = 'пока пусто — скоро будет') {
  if (!items) return `<p class="muted">${loadingNote}</p>`;
  if (items.length === 0) return `<p class="muted">${emptyNote}</p>`;
  return `<ul class="feed">${items
    .map(i => `<li><span class="date">${fmtDate(i.date)}</span><a href="${escapeHtml(i.url)}" target="_blank" rel="noopener">${escapeHtml(i.title)}</a></li>`)
    .join('')}</ul>`;
}

function renderColumn(col) {
  const { tg, yt } = columnData(col);
  const tgUrl = `https://t.me/${col.tg}`;
  const ytBlock = col.youtube
    ? `<h3>YouTube <a class="chan" href="${escapeHtml(col.youtube)}" target="_blank" rel="noopener">канал →</a></h3>
       ${renderList(yt, 'видео загружаются…')}`
    : `<h3>YouTube</h3><p class="muted">канал скоро появится</p>`;
  return `
  <section class="col" id="${col.slug}">
    <h2><span class="mark" style="background:${col.accent}"></span>${escapeHtml(col.title)}</h2>
    <p class="about">${escapeHtml(col.about)}</p>
    ${ytBlock}
    <h3>Telegram <a class="chan" href="${tgUrl}" target="_blank" rel="noopener">канал →</a></h3>
    ${renderList(tg, 'посты загружаются…')}
  </section>`;
}

function avatarVersion() {
  try { return Math.round(fs.statSync(path.join(__dirname, 'assets', 'avatar.png')).mtimeMs); }
  catch { return 0; }
}

function renderIndex(theme) {
  const o = config.owner;
  const av = avatarVersion();
  const cols = config.columns.map(renderColumn).join('\n');
  const links = [
    ...config.columns.map(c => `<li><a href="https://t.me/${c.tg}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a> — телеграм-канал: ${escapeHtml(c.about)}</li>`),
    ...config.columns.filter(c => c.youtube).map(c => `<li><a href="${escapeHtml(c.youtube)}" target="_blank" rel="noopener">${escapeHtml(c.title)} на YouTube</a> — видео: ${escapeHtml(c.about)}</li>`),
    `<li><a href="${escapeHtml(o.github)}" target="_blank" rel="noopener">GitHub</a> — код и пет-проекты</li>`,
  ].join('');
  return `<!doctype html>
<html lang="ru"${theme ? ` data-theme="${theme}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.name)} — akov.tech</title>
<meta name="description" content="${escapeHtml(o.tagline)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎙️</text></svg>">
<style>
  :root {
    --bg: #fff; --fg: #000; --link: #0000EE; --visited: #551A8B;
    --muted: #666; --border: #000; --box: #f5f5f5;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #111; --fg: #e8e8e8; --link: #7db4ff; --visited: #c8a8f0;
      --muted: #909090; --border: #e8e8e8; --box: #1c1c1c;
    }
  }
  :root[data-theme="dark"] {
    --bg: #111; --fg: #e8e8e8; --link: #7db4ff; --visited: #c8a8f0;
    --muted: #909090; --border: #e8e8e8; --box: #1c1c1c;
  }
  body { font-family: monospace; max-width: 1100px; margin: 0 auto; padding: 20px; line-height: 1.6; background: var(--bg); color: var(--fg); }
  a { color: var(--link); text-decoration: underline; }
  a:visited { color: var(--visited); }
  h1 { font-size: 24px; margin: 0 0 4px; line-height: 1.3; }
  h2 { font-size: 18px; margin: 0 0 2px; }
  h3 { font-size: 14px; margin: 22px 0 6px; }
  header { display: flex; gap: 18px; align-items: center; margin-bottom: 8px; }
  .avatar { width: 76px; height: 76px; border-radius: 50%; flex-shrink: 0; border: 1px solid var(--border); object-fit: cover; }
  .tagline { color: var(--muted); margin: 0 0 6px; }
  .social { font-size: 13px; margin: 0; }
  .social span { color: var(--muted); }
  .theme-btn { margin-left: auto; align-self: flex-start; font: inherit; font-size: 16px; line-height: 1;
               background: none; border: 1px solid var(--border); color: var(--fg);
               padding: 6px 9px; cursor: pointer; }
  .theme-btn:hover { background: var(--box); }
  .cta { border: 2px solid var(--border); background: var(--box); padding: 12px 16px; margin: 18px 0 26px; }
  .cta a { font-weight: bold; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .mark { display: inline-block; width: 10px; height: 10px; margin-right: 8px; }
  .about { color: var(--muted); font-size: 13px; margin: 0 0 4px; }
  .chan { font-size: 12px; font-weight: normal; margin-left: 6px; }
  .feed { list-style: none; padding: 0; margin: 6px 0 0; }
  .feed li { margin-bottom: 8px; }
  .date { color: var(--muted); font-size: 12px; display: block; }
  .muted { color: var(--muted); font-size: 13px; }
  .links { margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--border); }
  .links ul { list-style: none; padding: 0; }
  .links li { margin-bottom: 5px; }
  footer { margin-top: 30px; text-align: center; font-size: 13px; color: var(--muted); }
</style>
</head>
<body>
<header>
  <img class="avatar" src="/assets/avatar.png?v=${av}" alt="${escapeHtml(o.name)}">
  <div>
    <h1>${escapeHtml(o.name)}</h1>
    <p class="tagline">${escapeHtml(o.tagline)}</p>
    <p class="social"><span>Telegram:</span> ${config.columns.map(c => `<a href="https://t.me/${c.tg}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a>`).join(' · ')} <span>· YouTube: скоро</span></p>
  </div>
  <button class="theme-btn" id="themeBtn" type="button" title="Переключить тему" aria-label="Переключить тему"></button>
</header>
<div class="cta">→ <a href="/cv">Карьера и достижения</a> — где работал и что сделал: обо мне для работодателей и партнёров</div>
<main class="grid">
${cols}
</main>
<div class="links">
  <h3>Ссылки</h3>
  <ul>${links}</ul>
</div>
<footer>© ${new Date().getFullYear()} akov.tech</footer>
<script>
(function () {
  var btn = document.getElementById('themeBtn');
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function effective() {
    var manual = document.documentElement.getAttribute('data-theme');
    return manual || (mq.matches ? 'dark' : 'light');
  }
  function paint() { btn.textContent = effective() === 'dark' ? '☀' : '☾'; }
  btn.addEventListener('click', function () {
    var next = effective() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.cookie = 'theme=' + next + '; Path=/; Max-Age=31536000; SameSite=Lax';
    paint();
  });
  mq.addEventListener('change', paint); // ОС сменила тему, а ручного выбора нет
  paint();
})();
</script>
</body>
</html>`;
}

function renderCv() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Карьера и достижения — akov.tech</title>
<meta name="robots" content="noindex">
<style>
  body { margin: 0; min-height: 100svh; display: flex; align-items: center; justify-content: center; text-align: center;
         background: radial-gradient(1200px 600px at 50% -10%, #1b2540 0%, #0b0f17 60%);
         color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; }
  h1 { font-size: clamp(30px, 6vw, 54px); background: linear-gradient(135deg, #6ee7ff, #a78bfa);
       -webkit-background-clip: text; background-clip: text; color: transparent; margin: 0 0 14px; }
  p { color: #94a3b8; max-width: 520px; margin: 0 auto 26px; line-height: 1.6; }
  a { color: #6ee7ff; }
</style>
</head>
<body>
  <div>
    <h1>Карьера и достижения</h1>
    <p>Здесь будет яркая страница-резюме: где работал, чем управлял и какие результаты приносил. Страница в работе.</p>
    <a href="/">← на главную</a>
  </div>
</body>
</html>`;
}

// --------------------------------------------------------------- server ----
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}

function serveAsset(req, res, urlPath) {
  const name = path.basename(urlPath); // защита от traversal
  const file = path.join(__dirname, 'assets', name);
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
  const type = types[path.extname(name).toLowerCase()];
  if (!type || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
}

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  const headers = { 'Content-Type': type, ...extra };
  if (PREVIEW_KEY) headers['X-Robots-Tag'] = 'noindex, nofollow';
  res.writeHead(status, headers);
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/health') return send(res, 200, JSON.stringify({ ok: true }), 'application/json');
  if (p === '/robots.txt' && PREVIEW_KEY) return send(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain');

  // Закрытый предпросмотр: без ключа все видят заглушку.
  if (PREVIEW_KEY) {
    const authed = parseCookies(req).pk === PREVIEW_KEY;
    if (!authed) {
      if (url.searchParams.get('k') === PREVIEW_KEY) {
        return send(res, 302, '', 'text/plain', {
          'Set-Cookie': `pk=${PREVIEW_KEY}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
          Location: p,
        });
      }
      return send(res, 200, fs.readFileSync(PLACEHOLDER));
    }
  }

  if (p === '/') {
    const t = parseCookies(req).theme;
    return send(res, 200, renderIndex(t === 'dark' || t === 'light' ? t : null));
  }
  if (p === '/cv') return send(res, 200, renderCv());
  if (p.startsWith('/assets/')) return serveAsset(req, res, p);
  if (p === '/data.json') {
    const dump = Object.fromEntries([...cache].map(([k, v]) => [k, { fetchedAt: v.fetchedAt, items: v.data ? v.data.length : null }]));
    return send(res, 200, JSON.stringify(dump, null, 2), 'application/json');
  }
  return send(res, 302, '', 'text/plain', { Location: '/' });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`akov.tech on :${PORT}${PREVIEW_KEY ? ' (preview mode: gated)' : ''}`);
  // Прогреваем кэш при старте.
  config.columns.forEach(columnData);
});
