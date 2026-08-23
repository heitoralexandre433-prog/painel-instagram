/**
 * /api/insights.js  — Serverless Function da Vercel
 *
 * Busca as metricas do Instagram com seguranca (o token NUNCA vai ao navegador).
 * O frontend do painel chama:  GET /api/insights
 *
 * Variaveis de ambiente necessarias (configurar no painel da Vercel):
 *   IG_TOKEN     -> token de longa duracao do Instagram (60 dias)
 *   IG_USER_ID   -> ID da sua conta do Instagram
 *   API_VERSION  -> (opcional) versao da Graph API, ex.: v21.0
 */

const BASE = 'https://graph.instagram.com';

export default async function handler(req, res) {
  // ---- CORS (permite o painel chamar esta funcao) ----
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const TOKEN   = process.env.IG_TOKEN;
  const USER_ID = process.env.IG_USER_ID;
  const VERSION = process.env.API_VERSION || 'v21.0';

  if (!TOKEN || !USER_ID) {
    return res.status(500).json({
      error: 'Configuracao ausente. Defina IG_TOKEN e IG_USER_ID nas variaveis de ambiente da Vercel.',
    });
  }

  const resultado = {
    atualizado_em: new Date().toISOString(),
    conta: {},
    metricas: {},
    avisos: [],
  };

  // -----------------------------------------------------------
  // 1) Dados da conta: seguidores, nome, total de posts
  // -----------------------------------------------------------
  try {
    const url =
      `${BASE}/${VERSION}/${USER_ID}` +
      `?fields=username,followers_count,follows_count,media_count` +
      `&access_token=${TOKEN}`;

    const r = await fetch(url);
    const data = await r.json();

    if (data.error) throw new Error(data.error.message);

    resultado.conta = {
      usuario:    data.username,
      seguidores: data.followers_count,
      seguindo:   data.follows_count,
      posts:      data.media_count,
    };
  } catch (err) {
    resultado.avisos.push(`Nao foi possivel ler os dados da conta: ${err.message}`);
  }

  // -----------------------------------------------------------
  // 2) Metricas agregadas da
