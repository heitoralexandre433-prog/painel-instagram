/**
 * api/ig-sync.js  —  Backend (Vercel Serverless Function)
 * Devolve os ultimos posts com metricas + seguidores da conta.
 *
 * Variaveis de ambiente na Vercel:
 *   IG_USER_ID   = id da conta
 *   IG_TOKEN     = token de longa duracao gerado no painel da Meta
 */

const API_VERSION = process.env.IG_API_VERSION || 'v21.0';
const BASE = `https://graph.instagram.com/${API_VERSION}`;

function getToken() {
  return process.env.IG_TOKEN || process.env.IG_ACCESS_TOKEN || '';
}

function mapFormato(media_product_type, media_type) {
  const p = (media_product_type || '').toUpperCase();
  const t = (media_type || '').toUpperCase();
  if (p === 'REELS') return 'Reels';
  if (p === 'STORY') return 'Story';
  if (t === 'CAROUSEL_ALBUM') return 'Carrossel';
  if (t === 'VIDEO') return 'Reels';
  return 'Foto';
}

function tituloDaLegenda(caption) {
  if (!caption) return '(sem legenda)';
  const primeiraLinha = String(caption).split('\n')[0].trim();
  return primeiraLinha.length > 90
    ? primeiraLinha.slice(0, 90) + '...'
    : (primeiraLinha || '(sem legenda)');
}

async function graph(path, params) {
  const url = new URL(BASE + path);
  Object.entries(params ||
