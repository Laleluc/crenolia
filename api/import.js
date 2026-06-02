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
  amount   : CA BRUT de la période (nombre, point décimal, sans symbole €)
  date     : date de fin de période au format YYYY-MM-DD
  channel  : plateforme détectée (Uber, GetYourGuide, Viator, Sixt, Maze, ou autre)
  rides    : nombre de courses de la période (entier, 0 si inconnu)
  km_total : kilométrage total de la période (nombre, 0 si inconnu)

══════════════════════════════════════════
RÈGLES SIXT (PRIORITÉ ABSOLUE) :
══════════════════════════════════════════
Le document Sixt contient une phrase du type :
  "pour la période allant jusqu'à JJ.MM.AAAA, vous recevrez le montant X €"
  ET un tableau avec colonnes : Type | Période | Courses | Courses acceptées | Sixt | Crédit

→ date   = la date après "période allant jusqu'à" (ex: "12.04.2026" → "2026-04-12")
→ amount = la valeur de la colonne "Crédit" sur la ligne "Total" (ex: 65,29 € → 65.29)
           C'est le montant NET transféré sur votre compte bancaire.
           NE PAS prendre "Courses acceptées" ni la colonne "Sixt".
→ rides  = la valeur de la colonne "Courses" sur la ligne "Total" (ex: 1)
→ km_total = 0 (Sixt ne fournit pas les km)

EXEMPLE Sixt : "Total jusqu'au 12.04.202  1  58,20 €  7,09 €  65,29 €"
→ amount=65.29, rides=1, date="2026-04-12"

══════════════════════════════════════════
RÈGLES UBER :
══════════════════════════════════════════
Sommaire fiscal mensuel :
→ amount    = ligne "Total des revenus" — PAS "Versement total", PAS "Frais de service"
→ rides     = nombre de "Courses" indiqué dans les statistiques du sommaire
→ km_total  = "Kilométrage total" × 1.8 (pour tenir compte des km à vide)
              ex: 1659 km → km_total = 2986.2
→ date      = premier jour du mois du sommaire (ex: "01-30 Avril 2026" → "2026-04-01")

Récap hebdomadaire Uber :
→ amount = "Vos revenus" (pas "Versements")
→ rides  = nombre de courses si indiqué
→ km_total = km indiqués × 1.8 si disponibles

══════════════════════════════════════════
RÈGLES GETYOURGUIDE :
══════════════════════════════════════════
→ amount = "Total bookings" (montant BRUT avant commission)
           NE PAS prendre "Total balance in your favor"
→ rides  = nombre de réservations si indiqué, sinon 0
→ date   = début de période de la facture

══════════════════════════════════════════
RÈGLES VIATOR :
══════════════════════════════════════════
→ amount = montant brut avant commission Viator
           cherche "Gross booking value", "Total bookings", "Supplier payout"
→ rides  = nombre de réservations si indiqué, sinon 0

══════════════════════════════════════════
RÈGLES MAZE / AUTRES :
══════════════════════════════════════════
→ amount = total brut des prestations facturées
→ rides  = nombre de courses si indiqué, sinon 0

FORMAT MONTANTS FRANÇAIS : '3 818,71 €' → 3818.71 | '65,29 €' → 65.29
FORMAT DATES FRANÇAISES  : 'JJ.MM.AAAA' → 'AAAA-MM-JJ'

Si une info est absente : 0 pour rides/km_total, chaîne vide pour les autres.

Texte du document :
${text.slice(0, 14000)}`;

    } else {
      const extra = (tab === 'whatsapp')
        ? `Il peut s'agir d'une conversation WhatsApp sur PLUSIEURS messages.
passengerName = tous les noms de voyageurs séparés par des virgules.
Dates en anglais possibles (May 26 = ${year}-05-26).
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
