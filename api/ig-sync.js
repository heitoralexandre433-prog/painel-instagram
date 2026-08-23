const V = process.env.IG_API_VERSION || 'v21.0';
const BASE = `https://graph.instagram.com/${V}`;
const TOKEN = () => process.env.IG_TOKEN || process.env.IG_ACCESS_TOKEN || '';

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

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const id = process.env.IG_USER_ID, tk = TOKEN();
  if (!id || !tk) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'faltam variaveis', id: !!id, tk: !!tk, nomes: Object.keys(process.env).filter(k => k.startsWith('IG')) })); }
  try {
    const c = await g(`/${id}`, { fields: 'username,followers_count', access_token: tk });
    const md = await g(`/${id}/media`, { fields: 'id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink', limit: '25', access_token: tk });
    const posts = [];
    for (const m of (md.data || [])) {
      const f = fmt(m.media_product_type, m.media_type);
      let i = {};
      try { const r = await g(`/${m.id}/insights`, { metric: 'reach,likes,comments,shares,saved,views,total_interactions', access_token: tk }); (r.data || []).forEach(x => i[x.name] = (x.values && x.values[0] ? x.values[0].value : 0)); } catch (e) {}
      posts.push({ igId: m.id, data: (m.timestamp || '').slice(0, 10), titulo: (m.caption || '(sem legenda)').split('\n')[0].slice(0, 90), formato: f, views: i.views != null ? i.views : (i.reach || 0), lead: 0, alcance: i.reach || 0, curtidas: m.like_count || 0, comentarios: m.comments_count || 0, compartilhamentos: i.shares || 0, salvamentos: i.saved || 0, visitasPerfil: 0, novosSeguidores: 0, retencao: null, permalink: m.permalink || null });
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ conta: c.username, seguidores: c.followers_count || 0, atualizadoEm: new Date().toISOString(), total: posts.length, posts }));
  } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: 'falha na API do Instagram', detalhe: e.message })); }
};
