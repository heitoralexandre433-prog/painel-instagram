/**
 * api/ig-sync.js  —  Backend (Vercel Serverless Function)
 * ------------------------------------------------------------
 * Fala com a Instagram Graph API e devolve, em JSON, os últimos posts
 * com suas métricas + o total de seguidores da conta. O painel HTML
 * chama este endpoint no botão "Sincronizar do Instagram".
 *
 * COMO USAR
 * 1. Coloque este arquivo em:  api/ig-sync.js  (na raiz do projeto Vercel)
 * 2. Na Vercel → Project → Settings → Environment Variables, crie:
 *      IG_USER_ID       = id da sua conta profissional (Instagram Business Account)
 *      IG_ACCESS_TOKEN  = token de longa duração (60 dias) com permissões de insights
 *      SYNC_SECRET      = (opcional) uma senha; se definida, o painel precisa enviá-la
 *      IG_API_VERSION   = (opcional) versão da API, ex: v21.0
 * 3. Faça o deploy. O painel na mesma Vercel chama /api/ig-sync automaticamente.
 *
 * O passo a passo completo (criar o app no Meta, gerar o token, achar o IG_USER_ID)
 * está no arquivo "guia-integracao-instagram.md".
 */

const API_VERSION = process.env.IG_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

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

// título curto a partir da legenda
function tituloDaLegenda(caption) {
  if (!caption) return '(sem legenda)';
  const primeiraLinha = String(caption).split('\n')[0].trim();
  return primeiraLinha.length > 90 ? primeiraLinha.slice(0, 90) + '…' : (primeiraLinha || '(sem legenda)');
}

async function graph(path, params) {
  const url = new URL(BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  const body = await r.json();
  if (!r.ok || body.error) {
    const msg = body.error ? `${body.error.message} (code ${body.error.code})` : `HTTP ${r.status}`;
    const err = new Error(msg);
    err.detalhe = body.error || null;
    throw err;
  }
  return body;
}

// busca insights de UM post, tolerando métricas indisponíveis para o tipo
async function insightsDoPost(mediaId, formato) {
  // conjunto de métricas por formato — o Instagram rejeita a chamada inteira
  // se pedir uma métrica inválida, por isso separamos por tipo
  let metricas;
  if (formato === 'Reels') {
    metricas = 'reach,likes,comments,shares,saved,views,total_interactions';
  } else {
    metricas = 'reach,likes,comments,shares,saved,total_interactions';
  }
  try {
    const res = await graph(`/${mediaId}/insights`, { metric: metricas, access_token: process.env.IG_ACCESS_TOKEN });
    const out = {};
    (res.data || []).forEach(m => {
      const val = m.values && m.values[0] ? m.values[0].value : 0;
      out[m.name] = typeof val === 'number' ? val : 0;
    });
    return out;
  } catch (e) {
    // se os insights falharem (post muito antigo, permissão, etc.), devolve vazio
    return {};
  }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  // proteção opcional por senha
  if (process.env.SYNC_SECRET) {
    const enviada = (req.query && req.query.key) || (req.headers['x-sync-key']);
    if (enviada !== process.env.SYNC_SECRET) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: 'não autorizado' }));
    }
  }

  const IG_USER_ID = process.env.IG_USER_ID;
  const TOKEN = process.env.IG_ACCESS_TOKEN;
  if (!IG_USER_ID || !TOKEN) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'faltam IG_USER_ID e/ou IG_ACCESS_TOKEN nas variáveis de ambiente da Vercel' }));
  }

  const limite = Math.min(parseInt((req.query && req.query.limit) || '25', 10) || 25, 50);

  try {
    // 1) seguidores da conta
    const conta = await graph(`/${IG_USER_ID}`, { fields: 'followers_count,username', access_token: TOKEN });

    // 2) lista dos últimos posts
    const midia = await graph(`/${IG_USER_ID}/media`, {
      fields: 'id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink',
      limit: String(limite),
      access_token: TOKEN
    });

    const lista = (midia.data || []);
    const posts = [];
    for (const m of lista) {
      const formato = mapFormato(m.media_product_type, m.media_type);
      const ins = await insightsDoPost(m.id, formato);

      const reach = ins.reach || 0;
      const views = ins.views != null ? ins.views : reach; // fotos não têm "views": usa alcance

      posts.push({
        igId: m.id,
        data: (m.timestamp || '').slice(0, 10),
        titulo: tituloDaLegenda(m.caption),
        formato,
        views: views,
        // "lead" orgânico não existe na API; fica 0 para você preencher à mão se quiser
        lead: 0,
        alcance: reach,
        curtidas: m.like_count != null ? m.like_count : (ins.likes || 0),
        comentarios: m.comments_count != null ? m.comments_count : (ins.comments || 0),
        compartilhamentos: ins.shares || 0,
        salvamentos: ins.saved || 0,
        visitasPerfil: 0,       // não disponível de forma confiável por post
        novosSeguidores: 0,     // atribuição por post não é exposta pela API
        retencao: null,
        permalink: m.permalink || null
      });
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({
      conta: conta.username || null,
      seguidores: conta.followers_count || 0,
      atualizadoEm: new Date().toISOString(),
      total: posts.length,
      posts
    }));
  } catch (e) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: 'falha ao consultar a Instagram Graph API', detalhe: e.message }));
  }
};
