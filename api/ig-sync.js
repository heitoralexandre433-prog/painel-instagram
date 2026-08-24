const V = process.env.IG_API_VERSION || 'v21.0';
const BASE = `https://graph.instagram.com/${V}`;
const TK = () => process.env.IG_TOKEN || process.env.IG_ACCESS_TOKEN || '';

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

function fmt(p, t) {
  p = (p || '').toUpperCase(); t = (t || '').toUpperCase();
  if (p === 'REELS') return 'Reels';
  if (p === 'STORY') return 'Story';
  if (t === 'CAROUSEL_ALBUM') return 'Carrossel';
  if (t === 'VIDEO') return 'Reels';
  return 'Foto';
}

async function g(path, params) {
  const u = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const b = await (await fetch(u)).json();
  if (b.error) throw new Error(b.error.message);
  return b;
}

async function somaConta(id, tk, metric, dias) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - dias * 86400;
  try {
    const r = await g(`/${id}/insights`, { metric, period: 'day', metric_type: 'total_value', since, until, access_token: tk });
    const d = r.data && r.data[0];
    if (d && d.total_value && typeof d.total_value.value === 'number') return d.total_value.value;
    const s = (d && d.values) || [];
    if (s.length) return s.reduce((a, v) => a + (typeof v.value === 'number' ? v.value : 0), 0);
  } catch (e) {}
  try {
    const r = await g(`/${id}/insights`, { metric, period: 'day', since, until, access_token: tk });
    const s = (r.data && r.data[0] && r.data[0].values) || [];
    return s.length ? s.reduce((a, v) => a + (typeof v.value === 'number' ? v.value : 0), 0) : null;
  } catch (e) { return null; }
} 
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const id = process.env.IG_USER_ID;
  const tk = (await kvGet('ig:token')) || TK();
  if (!id || !tk) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'faltam variaveis' })); }

  const dias = Math.min(parseInt((req.query && req.query.dias) || '30', 10) || 30, 90);

  try {
    const c = await g(`/${id}`, { fields: 'username,followers_count,media_count', access_token: tk });

    const [visitasPerfil, novosSeguidores] = await Promise.all([
      somaConta(id, tk, 'profile_views', dias),
      somaConta(id, tk, 'follower_count', dias),
    ]);

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

    const md = await g(`/${id}/media`, { fields: 'id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url', limit: '25', access_token: tk });

    const posts = [];
    for (const m of (md.data || [])) {
      let i = {};
      try {
        const r = await g(`/${m.id}/insights`, { metric: 'reach,likes,comments,shares,saved,views,total_interactions', access_token: tk });
        (r.data || []).forEach(x => i[x.name] = (x.values && x.values[0] ? x.values[0].value : 0));
      } catch (e) {}
      posts.push({
        igId: m.id,
        data: (m.timestamp || '').slice(0, 10),
        titulo: (m.caption || '(sem legenda)').split('\n')[0].slice(0, 90),
        formato: fmt(m.media_product_type, m.media_type),
        views: i.views != null ? i.views : (i.reach || 0),
        alcance: i.reach || 0,
        curtidas: m.like_count || 0,
        comentarios: m.comments_count || 0,
        compartilhamentos: i.shares || 0,
        salvamentos: i.saved || 0,
        interacoes: i.total_interactions || 0,
        capa: m.thumbnail_url || m.media_url || null,
        permalink: m.permalink || null,
      });
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      conta: c.username, seguidores: c.followers_count || 0, totalPosts: c.media_count || 0,
      periodoDias: dias, visitasPerfil, novosSeguidores: (novosSeguidores != null ? novosSeguidores : crescimento),
      atualizadoEm: new Date().toISOString(), total: posts.length, posts,
    }));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'falha na API do Instagram', detalhe: e.message }));
  }
};
