const V = process.env.IG_API_VERSION || 'v21.0';
const KV = process.env.KV_REST_API_URL;
const KVT = process.env.KV_REST_API_TOKEN;

const KV = process.env.KV_REST_API_URL;
const KVT = process.env.KV_REST_API_TOKEN;
async function kvGet(k) {
  if (!KV || !KVT) return null;
  try {
    const r = await fetch(`${KV}/get/${encodeURIComponent(k)}`, { headers: { Authorization: `Bearer ${KVT}` } });
    const j = await r.json();
    return j.result ?? null;
  } catch (e) { return null; }
}

async function kvSet(k, v) {
  const r = await fetch(`${KV}/set/${encodeURIComponent(k)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KVT}` }, body: String(v)
  });
  return r.ok;
}
async function kvGet(k) {
  const r = await fetch(`${KV}/get/${encodeURIComponent(k)}`, {
    headers: { Authorization: `Bearer ${KVT}` }
  });
  const j = await r.json().catch(() => ({}));
  return j.result ?? null;
}
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const log = { em: new Date().toISOString(), token: null, seguidores: null, erros: [] };

  if (!KV || !KVT) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'KV nao configurado' })); }

  const tk = (await kvGet('ig:token')) || process.env.IG_TOKEN || process.env.IG_ACCESS_TOKEN;
  const id = process.env.IG_USER_ID;
  const tk = (await kvGet('ig:token')) || TK();
  if (!tk || !id) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'faltam IG_TOKEN/IG_USER_ID' })); }

  let atual = tk;

  try {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${tk}`);
    const j = await r.json();
    if (j.access_token) {
      atual = j.access_token;
      await kvSet('ig:token', atual);
      await kvSet('ig:token_em', new Date().toISOString());
      log.token = `renovado (expira em ${Math.round((j.expires_in || 0) / 86400)} dias)`;
    } else {
      log.token = 'nao renovado';
      log.erros.push((j.error && j.error.message) || 'resposta sem access_token');
          let crescimento = null;
    try {
      const hist = JSON.parse((await kvGet('ig:hist')) || '[]');
      if (hist.length >= 2) {
        const lim = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
        const ant = hist.filter(x => x.d <= lim).pop() || hist[0];
        const at = hist[hist.length - 1];
        if (ant && at && ant.d !== at.d) crescimento = at.v - ant.v;
      }
    } catch (e) {}
    }
  } catch (e) { log.erros.push('refresh: ' + e.message); }

  try {
    const r = await fetch(`https://graph.instagram.com/${V}/${id}?fields=followers_count&access_token=${atual}`);
    const j = await r.json();
    if (typeof j.followers_count === 'number') {
      const hoje = new Date().toISOString().slice(0, 10);
            let hist = [];
      try { hist = JSON.parse((await kvGet('ig:hist')) || '[]'); } catch (e) { hist = []; }
      hist = hist.filter(x => x && x.d !== hoje);
      hist.push({ d: hoje, v: j.followers_count });
      hist.sort((a, b) => a.d < b.d ? -1 : 1);
      await kvSet('ig:hist', JSON.stringify(hist.slice(-120)));
      log.seguidores = j.followers_count;
    } else {
      log.erros.push((j.error && j.error.message) || 'sem followers_count');
    }
  } catch (e) { log.erros.push('seguidores: ' + e.message); }

  res.statusCode = 200;
  res.end(JSON.stringify(log));
};
