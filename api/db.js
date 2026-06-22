// Fonction serverless Vercel — PROXY SÉCURISÉ entre l'app et Firebase.
// L'application ne parle JAMAIS directement à Firebase : tout passe par ici.
// La clé de service Firebase reste côté serveur, jamais exposée au navigateur.
//
// Variables d'environnement à configurer dans Vercel → Settings → Environment Variables :
//   FIREBASE_SERVICE_ACCOUNT  = TOUT le contenu du fichier .json de la clé de service
//   FIREBASE_DB_URL           = (optionnel) URL de la base ; sinon valeur par défaut ci-dessous
//
// Une fois ce proxy déployé et testé, on verrouille la base :
//   { "rules": { ".read": false, ".write": false } }
// (l'accès par clé de service contourne les règles : le proxy continue de fonctionner.)

import crypto from 'crypto';

const DEFAULT_DB_URL = 'https://crenolia-919d7-default-rtdb.europe-west1.firebasedatabase.app';

// Cache du jeton d'accès en mémoire (réutilisé tant qu'il est valide).
let cachedToken = null;
let cachedExp = 0;

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedExp - 60) return cachedToken;

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claim);
  const signature = signer.sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = header + '.' + claim + '.' + signature;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error('Échec OAuth : ' + JSON.stringify(data));
  }
  cachedToken = data.access_token;
  cachedExp = now + (data.expires_in || 3600);
  return cachedToken;
}

export default async function handler(req, res) {
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saRaw) {
    return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT non configurée sur Vercel' });
  }

  let sa;
  try {
    sa = JSON.parse(saRaw);
    // Si la clé privée contient des \n littéraux, on les convertit en vrais sauts de ligne.
    if (sa.private_key && sa.private_key.indexOf('\\n') !== -1) {
      sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    }
  } catch (e) {
    return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT invalide (JSON illisible)' });
  }

  const dbUrl = (process.env.FIREBASE_DB_URL || DEFAULT_DB_URL).replace(/\/+$/, '');

  try {
    const token = await getAccessToken(sa);
    const target = dbUrl + '/crenolia.json?access_token=' + encodeURIComponent(token);

    // LECTURE
    if (req.method === 'GET') {
      const r = await fetch(target);
      const data = await r.json();
      if (!r.ok) return res.status(502).json({ error: 'Lecture Firebase ' + r.status, detail: data });
      return res.status(200).json(data);
    }

    // ÉCRITURE
    if (req.method === 'POST' || req.method === 'PUT') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Corps JSON manquant ou invalide' });
      }
      const r = await fetch(target, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if (!r.ok) return res.status(502).json({ error: 'Écriture Firebase ' + r.status, detail: data });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
