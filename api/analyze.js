// Vercel Serverless Function — /api/analyze
// The GEMINI_API_KEY env variable is set in Vercel dashboard (or .env locally).
// It is NEVER sent to the client browser.

const MODEL = 'gemini-2.5-flash-lite'; // Simplest model, 1M input tokens free tier

const COMPLIANCE_RULES = [
  { id: 'CR-01', type: 'unbundling', code: '71046', conflicts: ['99233'], description: 'Chest X-ray (71046) should typically be bundled if billed alongside high-complexity E&M (99233) on the same date.' },
  { id: 'CR-02', type: 'upcoding', code: '99233', condition: 'consecutive_days', max_days: 1, description: 'High complexity subsequent hospital care (99233) rarely justified for multiple consecutive days. Downgrade to 99232 usually required.' },
  { id: 'CR-03', type: 'incorrect_units', medication: 'Zithromax', max_units_per_day: 1, description: 'Zithromax (Azithromycin) typical dosing is 1 unit per day. Verify total course units.' },
  { id: 'CR-04', type: 'missing_auth', code: '71250', description: 'CT Thorax (71250) requires prior authorization.' },
  { id: 'CR-05', type: 'duplicate', description: 'Check for identical line items billed on the same date without modifier 76.' },
  { id: 'CR-06', type: 'unbundling', code: '36415', description: 'Routine venipuncture (36415) is bundled into lab panels.' },
  { id: 'CR-07', type: 'anomaly', code: '99238', description: 'Hospital discharge day management (99238) cannot be billed with concurrent care on the same day.' },
  { id: 'CR-08', type: 'upcoding', code: '99285', description: 'Level 5 ER visit (99285) requires comprehensive history, exam, and high complexity decision making.' },
  { id: 'CR-09', type: 'incorrect_units', code: 'J-codes', description: 'Verify biologicals/drugs (J-codes) units against vial sizes to prevent waste billing.' },
  { id: 'CR-10', type: 'missing_auth', code: 'MRI', description: 'All non-emergent MRIs require prior authorization.' }
];

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfiguration: GEMINI_API_KEY is not set.' });
  }

  const { text } = req.body;
  if (!text || text.trim().length < 50) {
    return res.status(400).json({ error: 'No valid bill text provided.' });
  }

  const prompt = `You are a hospital billing compliance auditor with expertise in CMS guidelines, CPT bundling rules, and medical coding.
Analyze the following hospital bill text and identify all discrepancies including unbundling, upcoding, duplicate charges, incorrect units, missing authorization codes, and charges inconsistent with the diagnosis. Always cite the relevant CPT/ICD-10 code.

Consider these common compliance rules during analysis:
${JSON.stringify(COMPLIANCE_RULES, null, 2)}

Hospital Bill Text:
${text.substring(0, 8000)}

Respond ONLY in valid JSON (no markdown fences, no extra text) using this EXACT schema:
{
  "encounter": {
    "patient_id": "masked P-XXXX",
    "facility": "",
    "admission_date": "",
    "discharge_date": "",
    "drg_code": "",
    "primary_diagnosis_icd": "",
    "attending_physician": "",
    "total_billed": 0,
    "insurance_adjustments": 0,
    "patient_responsibility": 0
  },
  "line_items": [
    { "cpt_code": "", "description": "", "units": 0, "unit_rate": 0, "billed_amount": 0, "cms_expected_rate": 0, "variance": 0, "flagged": false }
  ],
  "discrepancies": [
    { "severity": "critical|warning|info", "type": "unbundling|upcoding|duplicate|missing_auth|incorrect_units|anomaly", "cpt_code": "", "icd_code": "", "description": "", "cms_reference": "", "billed_amount": 0, "correct_amount": 0, "estimated_recovery": 0, "suggestion": "" }
  ],
  "risk_score": 0,
  "total_flagged_amount": 0,
  "estimated_total_recovery": 0,
  "summary": ""
}`;

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          response_mime_type: "application/json"
        }
      })
    });

    if (!geminiRes.ok) {
      const errJson = await geminiRes.json().catch(() => ({}));
      const msg = errJson?.error?.message || `HTTP ${geminiRes.status}`;
      return res.status(geminiRes.status).json({ error: `Gemini error: ${msg}` });
    }

    const result = await geminiRes.json();
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!rawText) {
      return res.status(502).json({ error: 'Gemini returned an empty response.' });
    }

    // Strip markdown fences and extract JSON object
    let cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: 'Gemini did not return valid JSON.', raw: rawText.substring(0, 300) });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: `Server error: ${err.message}` });
  }
}
