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
const BOOT_DATE = new Date().toISOString().slice(0, 10); // дата деплоя — для <lastmod> в sitemap

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

// Строка-приветствие («👋 Привет, коллеги-инвесторы!») — не заголовок поста.
const GREETING_RE = /^[^a-zа-яё]*((всем|друзья)[\s,!]+)?(привет(ствую)?|здравствуй(те)?|добрый\s+(день|вечер)|доброе\s+утро|доброго\s+(дня|вечера|утра|времени)|салют|hi|hello|hey)(?![a-zа-яё])/i;

function firstLine(text, max = 110) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const line = lines.find(l => !GREETING_RE.test(l)) || lines[0] || '';
  const clean = line.replace(/\s+/g, ' ');
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
}

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
    // Обход EU-consent-страницы YouTube (Railway в EU): без этой куки отдаётся интерстишл.
    if (/youtube\.com|ytimg\.com/.test(url)) headers.Cookie = 'SOCS=CAI; CONSENT=YES+cb';
    const res = await fetch(url, { signal: ctrl.signal, headers, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

const diag = {}; // диагностика последней попытки по каждому YouTube-каналу (видна в /data.json)

// ---------------------------------------------------------------- cache ----
// stale-while-revalidate: отдаём из кэша мгновенно, обновляем в фоне.
const cache = new Map(); // key -> { data, fetchedAt, refreshing }

function cached(key, maxAge, fetcher) {
  const entry = cache.get(key);
  const maxAgeMs = typeof maxAge === 'function' ? maxAge(entry ? entry.data : null) : maxAge;
  const fresh = entry && Date.now() - entry.fetchedAt < maxAgeMs;
  if (!fresh && !(entry && entry.refreshing)) {
    const prev = entry ? entry.data : null;
    const upd = { data: prev, fetchedAt: entry ? entry.fetchedAt : 0, refreshing: true };
    cache.set(key, upd);
    fetcher(prev)
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
  const direct = youtube.match(/(UC[\w-]{20,})/); // голый ID или URL вида /channel/UC...
  if (direct) return direct[1];
  const url = youtube.startsWith('http') ? youtube : `https://www.youtube.com/${youtube.replace(/^@?/, '@')}`;
  const html = await fetchText(url);
  const m = html.match(/"channelId":"(UC[\w-]+)"/) || html.match(/channel\/(UC[\w-]+)/);
  return m ? m[1] : null;
}

function parseYtFeed(xml) {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.slice(0, config.limits.ytVideos).map(e => {
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    return { id, title: decodeEntities(title), url: `https://www.youtube.com/watch?v=${id}`, date: published };
  });
}

// Вкладка «Видео» через внутренний API YouTube (innertube) — тот же путь,
// каким ходит обычный веб-клиент; запасной вариант, когда RSS у канала 404.
async function browseYtChannel(channelId) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let json;
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', Cookie: 'SOCS=CAI' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240701.00.00', hl: 'ru', gl: 'RU' } },
        browseId: channelId,
        params: 'EgZ2aWRlb3PyBgQKAjoA', // вкладка «Видео»
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for innertube browse`);
    json = await res.text();
  } finally {
    clearTimeout(t);
  }
  // Два поколения разметки: старый videoRenderer и новый lockupViewModel.
  const out = [];
  const seen = new Set();
  const TITLE_RE = /"title":\{(?:"runs":\[\{"text":|"content":)"((?:[^"\\]|\\.)*)"/;
  const collect = (chunks, idRe) => {
    for (const chunk of chunks) {
      if (out.length >= config.limits.ytVideos) return;
      const win = chunk.slice(0, 15000);
      const idm = win.match(idRe);
      if (!idm || !/^[\w-]{11}$/.test(idm[1]) || seen.has(idm[1])) continue;
      seen.add(idm[1]);
      const t2 = win.match(TITLE_RE);
      out.push({
        id: idm[1],
        title: t2 ? JSON.parse(`"${t2[1]}"`) : '',
        url: `https://www.youtube.com/watch?v=${idm[1]}`,
        date: null,
      });
    }
  };
  collect(json.split('"videoRenderer":{').slice(1), /"videoId":"([\w-]{11})"/);
  if (!out.length) collect(json.split('"lockupViewModel":{').slice(1), /(?:"contentId":"|\/vi\/)([\w-]{11})["/]/);
  return out;
}

async function fetchYtVideos(youtube, prev) {
  const channelId = await resolveChannelId(youtube);
  if (!channelId) return null;
  const d = diag[channelId] = {};
  // 1) RSS канала → 2) RSS плейлиста загрузок (UU…) → 3) скрейп страницы канала.
  const feeds = [`channel_id=${channelId}`, `playlist_id=UU${channelId.slice(2)}`];
  for (const q of feeds) {
    try {
      const items = parseYtFeed(await fetchText(`https://www.youtube.com/feeds/videos.xml?${q}`));
      d[q.split('=')[0]] = `ok:${items.length}`;
      if (items.length) return items;
    } catch (err) {
      d[q.split('=')[0]] = err.message.slice(0, 60);
      if (!String(err.message).includes('HTTP 404')) throw err;
    }
  }
  try {
    const browsed = await browseYtChannel(channelId);
    d.browse = `ok:${browsed.length}`;
    if (browsed.length) return browsed;
  } catch (err) {
    d.browse = err.message.slice(0, 60);
    console.error('yt browse failed:', err.message);
  }
  return prev && prev.length ? prev : [];
}

function columnData(col) {
  return {
    tg: cached(`tg:${col.tg}`, config.refreshMinutes.tg * 60_000, () => fetchTgPosts(col.tg)),
    yt: col.youtube
      // Пустая лента у свежего канала часто «мигает» 404 — перепроверяем каждые 5 минут.
      ? cached(`yt:${col.slug}`, data => (data && data.length ? config.refreshMinutes.yt : 5) * 60_000,
               prev => fetchYtVideos(col.youtubeId || col.youtube, prev))
      : null,
  };
}

// ------------------------------------------------------------ rendering ----
// Нолик vibec0ding.ru как inline-SVG: браузеры принудительно перекрашивают
// ТЕКСТ внутри посещённых ссылок (privacy-модель :visited), а SVG-обводку — нет,
// поэтому нолик остаётся красным независимо от посещённости ссылки.
const ZERO_SVG = '<svg class="z0" viewBox="0 0 100 130" aria-hidden="true"><ellipse cx="50" cy="65" rx="33" ry="50" fill="none" stroke="#FD2529" stroke-width="15"/><line x1="15.5" y1="128" x2="84.5" y2="2" stroke="#FD2529" stroke-width="11"/></svg>';

function zeroize(html) {
  // Домен целиком в неразрывном контейнере: на узких экранах переносится
  // одним куском на новую строку, а не рвётся посреди слова.
  return String(html)
    .replace(/vibec<span class="zero">0<\/span>ding\.ru/g, `<span class="nowrap">vibec${ZERO_SVG}ding.ru</span>`)
    .replace(/<span class="zero">0<\/span>/g, ZERO_SVG);
}
function renderList(items, loadingNote, emptyNote = 'пока пусто — скоро будет') {
  if (!items) return `<p class="muted">${loadingNote}</p>`;
  if (items.length === 0) return `<p class="muted">${emptyNote}</p>`;
  return `<ul class="feed">${items
    .map(i => `<li><span class="date">${fmtDate(i.date)}</span><a href="${escapeHtml(i.url)}" target="_blank" rel="noopener">${escapeHtml(i.title)}</a></li>`)
    .join('')}</ul>`;
}

function renderYtBlock(col, yt) {
  if (!col.youtube) return `<h3>YouTube</h3><p class="muted">канал скоро появится</p>`;
  const head = `<h3>YouTube <a class="chan" href="${escapeHtml(col.youtube)}" target="_blank" rel="noopener">канал →</a></h3>`;
  if (!yt) return `${head}<p class="muted">видео загружаются…</p>`;
  if (yt.length === 0) return `${head}<p class="muted">видео скоро появятся</p>`;
  const pair = yt.slice(0, 2);
  const thumbs = pair.map(v =>
    `<a class="vthumb" href="${escapeHtml(v.url)}" target="_blank" rel="noopener" title="${escapeHtml(v.title)}"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="${escapeHtml(v.title)}" loading="lazy"></a>`
  ).join('');
  const cap = pair.length === 1 ? 'Последнее видео с канала' : 'Два последних видео с канала';
  return `${head}<div class="vrow">${thumbs}</div>
    <p class="vcap">${cap} · <a href="${escapeHtml(col.youtube)}" target="_blank" rel="noopener">все видео →</a></p>`;
}

function renderColumn(col) {
  const { tg, yt } = columnData(col);
  const tgUrl = `https://t.me/${col.tg}`;
  const ytBlock = renderYtBlock(col, yt);
  const logo = `logo-${col.slug}.jpg`;
  return `
  <section class="col" id="${col.slug}">
    <h2><img class="clogo" src="/assets/${logo}?v=${assetVer(logo)}" alt="">${escapeHtml(col.title)}</h2>
    <p class="about">${escapeHtml(col.about)}</p>
    ${ytBlock}
    <h3>Telegram <a class="chan" href="${tgUrl}" target="_blank" rel="noopener">канал →</a></h3>
    ${renderList(tg, 'посты загружаются…')}
  </section>`;
}

function assetVer(name) {
  try { return Math.round(fs.statSync(path.join(__dirname, 'assets', name)).mtimeMs); }
  catch { return 0; }
}

function renderIndex(theme) {
  const o = config.owner;
  const av = assetVer('avatar.png');
  const cols = config.columns.map(renderColumn).join('\n');
  const links = [
    ...config.columns.map(c => `<li><a href="https://t.me/${c.tg}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a> — <span class="lbl-full">телеграм-канал:</span><span class="lbl-short">Т-канал:</span> ${escapeHtml(c.about)}</li>`),
    ...config.columns.filter(c => c.youtube).map(c => `<li><a href="${escapeHtml(c.youtube)}" target="_blank" rel="noopener">${escapeHtml(c.title)} на YouTube</a> — видео: ${escapeHtml(c.about)}</li>`),
    ...(o.community ? [`<li><a href="${escapeHtml(o.community.url)}" target="_blank" rel="noopener">${zeroize(o.community.titleHtml || escapeHtml(o.community.title))}</a> — ${escapeHtml(o.community.note)}</li>`] : []),
    `<li><a href="${escapeHtml(o.github)}" target="_blank" rel="noopener">GitHub</a> — код и пет-проекты</li>`,
  ].join('');
  return `<!doctype html>
<html lang="ru"${theme ? ` data-theme="${theme}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.name)} — akov.tech</title>
<meta name="description" content="${escapeHtml(o.tagline)}">
<link rel="canonical" href="https://akov.tech/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="akov.tech">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${escapeHtml(o.name)} — akov.tech">
<meta property="og:description" content="${escapeHtml(o.tagline)}">
<meta property="og:url" content="https://akov.tech/">
<meta property="og:image" content="https://akov.tech/assets/og-image.png?v=${assetVer('og-image.png')}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(o.name)} — akov.tech">
<meta name="twitter:description" content="${escapeHtml(o.tagline)}">
<meta name="twitter:image" content="https://akov.tech/assets/og-image.png?v=${assetVer('og-image.png')}">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png?v=${assetVer('favicon-32.png')}">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png?v=${assetVer('favicon-16.png')}">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=${assetVer('apple-touch-icon.png')}">
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
  .avatar { width: 87px; height: 87px; border-radius: 50%; flex-shrink: 0; border: 1px solid var(--border); object-fit: cover; }
  .tagline { color: var(--muted); margin: 0 0 6px; }
  .social { font-size: 13px; margin: 0; }
  .social span { color: var(--muted); }
  .theme-btn { margin-left: auto; align-self: flex-start; font: inherit; font-size: 16px; line-height: 1;
               background: none; border: 1px solid var(--border); color: var(--fg);
               padding: 6px 9px; cursor: pointer; }
  .theme-btn:hover { background: var(--box); }
  .cta { border: 1px solid var(--border); background: var(--box); padding: 12px 16px; margin: 18px 0 26px; }
  .cta a { font-weight: bold; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; }
  .lbl-short { display: none; }
  .nowrap { white-space: nowrap; }
  @media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; }
    .lbl-full { display: none; }
    .lbl-short { display: inline; }
    header { display: block; position: relative; }
    .avatar { float: left; margin: 0 16px 8px 0; }
    h1, .tagline { padding-right: 46px; } /* не заезжать под кнопку темы */
    .tagline2, .social { padding-right: 0; clear: left; margin-top: 10px; }
    .sgroup { display: block; margin-bottom: 2px; }
    .sep { display: none; }
    .theme-btn { position: absolute; top: 0; right: 0; }
  }
  .clogo { width: 50px; height: 50px; border-radius: 50%; margin-right: 10px; vertical-align: -15px; }
  .z0 { width: .6em; height: .77em; display: inline-block; vertical-align: -0.06em; margin: 0 .03em; }
  .about { color: var(--muted); font-size: 13px; margin: 0 0 4px; }
  .chan { font-size: 12px; font-weight: normal; margin-left: 6px; }
  .vrow { display: flex; gap: 8px; margin: 6px 0 4px; }
  .vthumb { flex: 0 1 calc(50% - 4px); min-width: 0; display: block; }
  .vthumb img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; border: 1px solid var(--border); }
  .vcap { font-size: 12px; color: var(--muted); margin: 2px 0 0; }
  .feed { list-style: none; padding: 0; margin: 6px 0 0; }
  .feed li { margin-bottom: 8px; }
  .date { color: var(--muted); font-size: 12px; margin-right: 8px; white-space: nowrap; }
  .muted { color: var(--muted); font-size: 13px; }
  .contact { margin: 40px 0 6px; text-align: center; }
  .mailbtn { display: inline-block; border: 1px solid var(--border); padding: 9px 18px;
             text-decoration: none; color: var(--fg); font-weight: bold; }
  .mailbtn:visited { color: var(--fg); }
  .mailbtn:hover { background: var(--box); }
  .mailico { width: 20px; height: 20px; vertical-align: -5px; margin-right: 9px; }
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
    <p class="tagline">${zeroize(o.taglineHtml1 || escapeHtml(o.tagline))}</p>
    ${o.taglineHtml2 ? `<p class="tagline tagline2">${zeroize(o.taglineHtml2)}</p>` : ''}
    <p class="social"><span class="sgroup"><span>Telegram:</span> ${config.columns.map(c => `<a href="https://t.me/${c.tg}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a>`).join(' · ')}</span><span class="sep"> · </span><span class="sgroup"><span>YouTube:</span> ${config.columns.map(c => c.youtube
        ? `<a href="${escapeHtml(c.youtube)}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a>`
        : `<span>${escapeHtml(c.title)} скоро</span>`).join(' · ')}</span>${o.community ? `<span class="sep"> · </span><span class="sgroup"><span>Сообщество:</span> <a href="${escapeHtml(o.community.url)}" target="_blank" rel="noopener">${zeroize(o.community.titleHtml || escapeHtml(o.community.title))}</a></span>` : ''}</p>
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
${o.email ? `<div class="contact">
  <a class="mailbtn" href="mailto:${escapeHtml(o.email)}"><img class="mailico" src="/assets/favicon-32.png?v=${assetVer('favicon-32.png')}" alt="">Написать мне</a>
</div>` : ''}
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
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
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
    <p>Здесь будет страница-резюме: где работал, чем управлял и какие результаты приносил. Страница в работе.</p>
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
  // Ссылки на статику версионированы (?v=mtime), поэтому кэшировать можно долго.
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' });
  fs.createReadStream(file).pipe(res);
}

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  // Перед сайтом стоит CDN (Яндекс): без Cache-Control он кэширует HTML на сутки+,
  // и посетители видят устаревшие ленты. no-cache = отдавать только после проверки у origin.
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra };
  if (PREVIEW_KEY) headers['X-Robots-Tag'] = 'noindex, nofollow';
  res.writeHead(status, headers);
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/health') return send(res, 200, JSON.stringify({ ok: true }), 'application/json');
  if (p === '/favicon.ico') return serveAsset(req, res, '/assets/favicon-32.png');
  if (p === '/robots.txt') {
    return send(res, 200, PREVIEW_KEY
      ? 'User-agent: *\nDisallow: /\n'
      : 'User-agent: *\nAllow: /\nSitemap: https://akov.tech/sitemap.xml\n', 'text/plain');
  }
  if (p === '/sitemap.xml' && !PREVIEW_KEY) {
    return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://akov.tech/</loc><lastmod>${BOOT_DATE}</lastmod><changefreq>daily</changefreq></url></urlset>`, 'application/xml');
  }

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
    return send(res, 200, JSON.stringify({ feeds: dump, ytDiag: diag }, null, 2), 'application/json');
  }
  return send(res, 302, '', 'text/plain', { Location: '/' });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`akov.tech on :${PORT}${PREVIEW_KEY ? ' (preview mode: gated)' : ''}`);
  // Прогреваем кэш при старте.
  config.columns.forEach(columnData);
});
