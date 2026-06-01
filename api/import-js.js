// Fonction serverless Vercel — import IA réservations & CA.
// Clé Gemini dans GEMINI_API_KEY (Vercel → Settings → Environment Variables).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
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
    const text = (body && body.text)  || '';
    const tab  = (body && body.tab)   || 'email';
    const mode = (body && body.mode)  || 'booking';
    const year = new Date().getFullYear();

    let prompt;

    if (mode === 'revenue') {
      prompt = `Tu analyses un relevé financier d'une plateforme VTC. Exercice fiscal : AVRIL→MARS.
Renvoie UNIQUEMENT un objet JSON (sans texte ni backticks) avec :
  amount  : CA BRUT de la période (nombre, point décimal, sans symbole €)
  date    : date de début de période au format YYYY-MM-DD
  channel : plateforme détectée (Uber, GetYourGuide, Viator, Sixt, Maze, ou autre)

RÈGLES D'EXTRACTION PAR PLATEFORME :

UBER (sommaire fiscal mensuel) :
  → amount = "Total des revenus" (ex: 3818.71)
  → NE PAS prendre "Versement total" (net après frais), "Frais de service", "Solde"
  → "Total des revenus" = "Revenu des courses" + "Revenu provenant d'autres services"

UBER (recap hebdomadaire) :
  → amount = "Vos revenus" (pas "Versements")

GETYOURGUIDE :
  → amount = "Total bookings" (montant brut des réservations)
  → NE PAS prendre "Total balance in your favor" (net après commission GYG)
  → NE PAS prendre "Service commission" / "Our commission"
  → La commission GYG est une charge séparée, pas à déduire ici

VIATOR :
  → amount = montant brut total des réservations (avant commission Viator)
  → cherche "Gross booking value", "Total bookings", "Supplier payout" selon le format

SIXT / MAZE / autres :
  → amount = total brut des prestations facturées

FORMAT MONTANTS FRANÇAIS : '3 818,71 €' → 3818.71 | '1 054,63 €' → 1054.63

Si une info est absente, mets une chaîne vide.

Texte du document :
${text.slice(0, 14000)}`;

    } else {
      const extra = (tab === 'whatsapp')
        ? `Il peut s'agir d'une conversation WhatsApp sur PLUSIEURS messages.
passengerName = tous les noms de voyageurs séparés par des virgules.
Dates en anglais possibles (May 26 = ${year}-05-26).
Si un hôtel est cité, c'est le lieu de prise en charge ou la destination selon le sens.
Trajet VERS aéroport : destination = aéroport. Trajet DEPUIS aéroport : pickupLocation = aéroport.
Si une info est absente ou 'pending', laisse une chaîne vide.`
        : `Si le transfert va VERS un aéroport, destination = aéroport.
S'il vient DEPUIS un aéroport, destination = adresse de dépôt.`;

      prompt = `Tu es un assistant pour une société de VTC parisienne.
Analyse ce texte de réservation et renvoie UNIQUEMENT un objet JSON (sans texte autour) avec ces clés :
passengerName, phone, passengerCount (nombre), pickupDate (YYYY-MM-DD, année ${year} si absente),
pickupTime (HH:MM sur 24h), pickupLocation, destination, flightNumber, fare (nombre sans symbole).
Si une information est absente, mets une chaîne vide.
${extra}

Texte :
${text}`;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
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
