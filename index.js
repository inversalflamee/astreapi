require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { getMovieMeta, getTvMeta, getSubtitles } = require('./tmdb');
const { providers, resolveProvider } = require('./providers');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

function verifyToken(req, res, next) {
  const authHeader = req.headers['x-session-token'];
  if (!authHeader) return res.status(401).json({ error: 'Missing X-Session-Token' });
  try {
    jwt.verify(authHeader, process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

app.post('/api/auth', (req, res) => {
  const apiKey = req.headers.authorization?.split(' ')[1];
  if (apiKey !== process.env.API_KEY) return res.status(403).json({ error: 'Invalid API key' });
  const token = jwt.sign({ type: 'session' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamSources(req, res, type, params) {
  const requestId = uuidv4();
  console.log(`[${requestId}] ${type} request`, params);
  let meta, subtitles;
  try {
    [meta, subtitles] = await Promise.all([
      type === 'movie' ? getMovieMeta(params.tmdbId) : getTvMeta(params.tmdbId, params.season, params.episode),
      getSubtitles(type, params.tmdbId).catch(() => []),
    ]);
  } catch (err) {
    return sendSSE(res, 'error', { message: 'Metadata fetch failed', detail: err.message }) && res.end();
  }
  sendSSE(res, 'meta', { type: 'meta', meta, subtitles, requestId });
  const providerPromises = providers.map(async fn => {
    const r = await resolveProvider(fn, params);
    if (r) sendSSE(res, 'source', { type: 'source', source: { url: r.url, label: r.label }, requestId });
    return r;
  });
  const results = await Promise.allSettled(providerPromises);
  const success = results.filter(r => r.status === 'fulfilled' && r.value).length;
  sendSSE(res, 'done', { type: 'done', totalSources: success, requestId });
  res.end();
}

app.get('/movie', verifyToken, async (req, res) => {
  const id = parseInt(req.query.id);
  if (!id) return res.status(400).json({ error: 'Missing id' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  streamSources(req, res, 'movie', { type: 'movie', tmdbId: id });
});

app.get('/tv', verifyToken, async (req, res) => {
  const id = parseInt(req.query.id);
  const season = parseInt(req.query.season);
  const episode = parseInt(req.query.episode);
  if (!id || !season || !episode) return res.status(400).json({ error: 'Missing params' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  streamSources(req, res, 'tv', { type: 'tv', tmdbId: id, season, episode });
});

// ---- /player route ----
app.get('/player', (req, res) => {
  const { id, season, episode } = req.query;
  if (!id) return res.status(400).send('Missing id');
  const streamUrl = (season && episode) ? `/tv?id=${id}&season=${season}&episode=${episode}` : `/movie?id=${id}`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Player</title><style>body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh}video{width:100%;height:100%}#status{position:absolute;bottom:10px;left:10px;color:#fff;font-size:.8rem;background:rgba(0,0,0,.6);padding:4px 8px;border-radius:4px}</style><script src="https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js"></script></head><body><video id="player" controls autoplay></video><div id="status">Loading…</div><script>const API_KEY="${process.env.API_KEY}";const video=document.getElementById('player');const status=document.getElementById('status');let hlsInst=null;function isMp4(u){try{const i=new URL(u).searchParams.get('url')??u;return /\.(mp4|mkv)(\\?|$)/i.test(i)}catch{return /\.(mp4|mkv)(\\?|$)/i.test(u)}}function attachSource(u,l){status.textContent='Loading '+l+'…';hlsInst?.destroy();hlsInst=null;if(isMp4(u)){video.src=u;video.play().catch(()=>{});status.textContent='Playing '+l+' (MP4)';return}if(Hls.isSupported()){hlsInst=new Hls();hlsInst.loadSource(u);hlsInst.attachMedia(video);hlsInst.on(Hls.Events.MANIFEST_PARSED,()=>{video.play().catch(()=>{});status.textContent='Playing '+l})}else if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=u;video.play().catch(()=>{});status.textContent='Playing '+l}}async function load(){const r=await fetch('/api/auth',{method:'POST',headers:{'Authorization':'Bearer '+API_KEY}});const{token}=await r.json();const res=await fetch('${streamUrl}',{headers:{'X-Session-Token':token}});const reader=res.body.getReader();const dec=new TextDecoder();let buf='',started=false;while(true){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split('\\n');buf=lines.pop();for(const line of lines){if(!line.startsWith('data: '))continue;const ev=JSON.parse(line.slice(6));if(ev.type==='source'&&!started){started=true;attachSource(ev.source.url,ev.source.label)}if(ev.type==='done'&&!started)status.textContent='No sources available.'}}}load();</script></body></html>`;
  res.set('Content-Type', 'text/html').send(html);
});

// ---- Root ASCII Art ----
app.get('/', (_, res) => res.send(`<!DOCTYPE html>...your ASCII art here...</html>`));

app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));