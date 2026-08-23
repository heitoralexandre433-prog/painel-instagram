/**
 * api/ig-sync.js  —  Backend (Vercel Serverless Function)
 * ------------------------------------------------------------
 * Devolve os ultimos posts com metricas + seguidores da conta.
 * O painel chama este endpoint no botao "Sincronizar do Instagram".
 *
 * CORRIGIDO PARA O FLUXO "API DO INSTAGRAM COM LOGIN DO INSTAGRAM":
 *   - usa graph.instagram.com (e nao graph.facebook.com)
 *   - aceita o token em IG_TOKEN ou IG_ACCESS_TOKEN
 *
 * Variaveis de ambiente na Vercel:
 *   IG_USER_ID   = id da conta (o "id" que aparece em /me)
 *   IG_TOKEN     = token de longa duracao gerado no painel da Meta
 *   SYNC_SECRET  = (opcional) senha para proteger o endpoint
 *   IG_API_VERSION = (opcional) ex.: v21.0
 */

const API_VERSION = process.env.IG_API_VERSION || 'v21.0';
const BASE = `https://graph.instagram.com/${API_VERSION}`;

// aceita os dois nomes de variavel, para nao depender de qual foi cadastrada
function getToken() {
  return process.env.IG_TOKEN || process.env.IG_ACCESS_TOKEN || '';
}

// mapeia o tipo do post do Instagram para os formatos usados no painel
function mapFormato(media_product_type, media_type) {
  const p = (media_product_type || '').toUpperCase();
  const t = (media_type || '').toUpperCase();
  if (p === 'REELS') return 'Reels';
  if (p === 'STORY') return 'Story';
  if (t === 'CAROUSEL_ALBUM') return 'Carrossel';
  if (t === 'VIDEO') return 'Reels';
  return 'Foto';
}

// titulo curto a partir da legenda
function tituloDaLegenda(caption) {
  if (!caption) return '(sem legenda)';
  const primeiraLinha = String(caption).split('\n')[0].trim();
  return primeiraLinha.length > 90
    ? primeiraLinha.slice(0, 90) + '…'
    : (primeiraLinha || '(sem legenda)');
}

async function graph(path, params) {
  const url = new URL(BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  const body = await r.json();
  if (!r.ok || body.error) {
    const msg = body.error
      ? `${body.error.message} (code ${body.error.code})`
      : `HTTP ${r.status}`;
    const err = new Error(msg);
    err.detalhe = body.error || null;
    throw err;
  }
  return body;
}

/**
 * Busca insights de UM post.
 * A Meta rejeita a chamada inteira se uma metrica for invalida para o formato,
 * entao pedimos um conjunto por formato e, se ainda falhar, tentamos uma a uma.
 */
async function insightsDoPost(mediaId, formato) {
  const TOKEN = getToken();

  const conjunto = formato === 'Reels'
    ? ['reach', 'likes', 'comments', 'shares', 'saved', 'views', 'total_interactions']
    : ['reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions'];

  // tentativa 1: todas de uma vez
  try {
    const res = await graph(`/${mediaId}/insights`, {
      metric: conjunto.join(','),
      access_token: TOKEN,
    });
    const out = {};
    (res.data || []).forEach(m => {
      const val = m.values && m.values[0] ? m.values[0].value : 0;
      out[m.name] = typeof val === 'number' ? val : 0;
    });
    return out;
  } catch (e) {
    // tentativa 2: uma metrica de cada vez, ignorando as que a conta nao libera
    const out = {};
    for (const met of conjunto) {
      try {
        const res = await graph(`/${mediaId}/insights`, {
          metric: met,
          access_token: TOKEN,
        });
        const m = (res.data || [])[0];
        const val = m && m.values && m.values[0] ? m.values[0].value : 0;
        out[met] = typeof val === 'number' ? val : 0;
      } catch (_) {
        /* metrica indisponivel para este post — segue adiante */
      }
    }
    return out;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  // protecao opcional por senha
  if (process.env.SYNC_SECRET) {
    const enviada = (req.query && req.query.key) || req.headers['x-sync-key'];
    if (enviada !== process.env.SYNC_SECRET) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: 'nao autorizado' }));
    }
  }

  const IG_USER_ID = process.env.IG_USER_ID;
  const TOKEN = getToken();

  if (!IG_USER_ID || !TOKEN) {
    res.statusCode = 500;
    return res.end(JSON.stringify({
      error: 'faltam IG_USER_ID e/ou IG_TOKEN nas variaveis de ambiente da Vercel',
    }));
  }

  const limite = Math.min(
    parseInt((req.query && req.query.limit) || '25', 10) || 25,
    50
  );

  try {
    // 1) dados da conta
    const conta = await graph(`/${IG_USER_ID}`, {
      fields: 'username,followers_count',
      access_token: TOKEN,
    });

    // 2) lista dos ultimos posts
    const midia = await graph(`/${IG_USER_ID}/media`, {
      fields: 'id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink',
      limit: String(limite),
      access_token: TOKEN,
    });

    const lista = midia.data || [];
    const posts = [];

    for (const m of lista) {
      const formato = mapFormato(m.media_product_type, m.media_type);
      const ins = await insightsDoPost(m.id, formato);

      const reach = ins.reach || 0;
      // fotos nao tem "views": usa o alcance como aproximacao
      const views = ins.views != null ? ins.views : reach;

      posts.push({
        igId: m.id,
        data: (m.timestamp || '').slice(0, 10),
        titulo: tituloDaLegenda(m.caption),
        formato,
        views: views,
        lead: 0,                 // nao existe na API — preencher a mao se quiser
        alcance: reach,
        curtidas: m.like_count != null ? m.like_count : (ins.likes || 0),
        comentarios: m.comments_count != null ? m.comments_count : (ins.comments || 0),
        compartilhamentos: ins.shares || 0,
        salvamentos: ins.saved || 0,
        visitasPerfil: 0,        // nao disponivel por post
        novosSeguidores: 0,      // atribuicao por post nao e exposta pela API
        retencao: null,
        permalink: m.permalink || null,
      });
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({
      conta: conta.username || null,
      seguidores: conta.followers_count || 0,
      atualizadoEm: new Date().toISOString(),
      total: posts.length,
      posts,
    }));
  } catch (e) {
    res.statusCode = 502;
    return res.end(JSON.stringify({
      error: 'falha ao consultar a API do Instagram',
      detalhe: e.message,
    }));
  }
};
