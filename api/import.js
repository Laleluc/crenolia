// Fonction serverless Vercel — secours IA pour l'import de réservations.
// La clé API Gemini est lue depuis la variable d'environnement GEMINI_API_KEY
// (configurée dans Vercel → Settings → Environment Variables). Elle n'est
// JAMAIS exposée au navigateur.

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }
  // Contrôle d'accès : si APP_SECRET est défini, on exige l'en-tête X-App-Secret.
  const APP_SECRET = process.env.APP_SECRET;
  if (APP_SECRET) {
    const provided = String(req.headers['x-app-secret'] || '');
    const a = Buffer.from(provided), b = Buffer.from(APP_SECRET);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: 'Non autorisé' });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GEMINI_API_KEY non configurée sur Vercel' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const text = (body && body.text) || '';
    const tab = (body && body.tab) || 'email';
    const mode = (body && body.mode) || 'booking';
    const year = new Date().getFullYear();

    let prompt;
    if (mode === 'revenue') {
      prompt =
        "Tu analyses un recapitulatif financier d'une plateforme (Uber, GetYourGuide, Viator, Sixt, Maze ou autre) pour une societe de VTC. "
        + "Renvoie UNIQUEMENT un objet JSON, sans texte autour, avec ces cles : "
        + "amount (le CHIFFRE D'AFFAIRES / revenus de la periode, nombre sans symbole, point decimal), "
        + "date (debut de la periode au format YYYY-MM-DD), "
        + "channel (Uber, GetYourGuide, Viator, Sixt, Maze, ou le nom de la plateforme detecte). "
        + "REGLES IMPORTANTES : le montant recherche est le CHIFFRE D'AFFAIRES = le total des revenus BRUTS de la periode. "
        + "Chez Uber, c'est la ligne 'Total des revenus' (sommaire fiscal mensuel) ou 'Vos revenus' (recap hebdomadaire). "
        + "Surtout PAS le 'Versement total' / 'Versements' (net encaisse), PAS le 'Solde de depart' ni 'Solde final', PAS les 'Frais de service'. "
        + "Si plusieurs montants existent, prends le total des revenus bruts de la periode. "
        + "Convertis les montants francais (1 054,63 €) en nombre (1054.63). Si une info manque, mets une chaine vide.\n\nTexte:\n"
        + text;
    } else {
      const extra = (tab === 'whatsapp')
      ? "Il peut s'agir d'une conversation WhatsApp sur PLUSIEURS messages. Rassemble les infos eparpillees : passengerName = tous les noms de voyageurs separes par des virgules ; dates en anglais possibles (May 26 = " + year + "-05-26) ; si un hotel est cite dans un autre message, c'est le lieu de prise en charge ou la destination selon le sens du trajet ; trajet VERS un aeroport : destination = aeroport ; trajet DEPUIS un aeroport : pickupLocation = aeroport ; ignore les messages hors-sujet ; si une info est absente ou 'pending', laisse une chaine vide."
      : "Si le transfert va VERS un aeroport, destination = aeroport. S'il vient DEPUIS un aeroport, destination = adresse de depot.";

    prompt =
      "Tu es un assistant pour une societe de VTC parisienne. Analyse ce texte de reservation et renvoie UNIQUEMENT un objet JSON, sans texte autour, avec exactement ces cles : "
      + "passengerName, phone, passengerCount (nombre), pickupDate (format YYYY-MM-DD, annee " + year + " si absente), "
      + "pickupTime (format HH:MM sur 24h), pickupLocation, destination, flightNumber, fare (nombre sans symbole). "
      + "Si une information est absente, mets une chaine vide. " + extra
      + "\n\nTexte:\n" + text;
    }

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: 'Erreur Gemini ' + r.status, detail: data });
    }

    let out = '';
    try { out = data.candidates[0].content.parts[0].text; } catch (e) { out = ''; }
    return res.status(200).json({ raw: out });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
