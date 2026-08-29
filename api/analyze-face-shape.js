// 顔型診断API（Vercel Serverless Function）
// フロントエンドからアップロードされた自撮り画像1枚を Gemini API に送り、
// 顔型（骨格）を6種類のうちどれに近いか判定してもらう。
//
// 必要な環境変数（Vercelのプロジェクト設定 > Environment Variables で設定）:
//   GEMINI_API_KEY = あなたのGemini APIキー
//
// 注意: APIキーはこのサーバー側の環境変数としてのみ保持し、
//       フロントエンドのコードには絶対に埋め込まないこと。

const FACE_SHAPE_IDS = ["oval", "round", "oblong", "square", "triangle", "heart"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64) {
      res.status(400).json({ error: "imageBase64 is required" });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
      return;
    }

    const prompt =
      "あなたは美容師のアシスタントです。添付された人物の顔写真から、顔型（骨格）を次の6種類のうち" +
      "最も近いものを1つだけ判定してください。\n" +
      "候補: oval(卵型), round(丸顔), oblong(面長), square(ベース型), triangle(逆三角形), heart(ハート型)\n" +
      "必ず次のJSON形式のみで回答してください（説明文やコードブロックは不要）:\n" +
      '{"faceShape": "候補のid", "confidence": 0から1の数値}';

    // gemini-flash-latest は Google 側が常に「その時点で推奨されるFlashモデル」を指すように
    // 自動で切り替えてくれるエイリアス。個別バージョン名（例: gemini-2.0-flash）を指定すると
    // 将来そのモデルが廃止された際に404エラーになるため、ここではあえて固定しない。
    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=" +
        apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } }
              ]
            }
          ]
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      res.status(502).json({ error: "Gemini API error", detail: errText });
      return;
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      res.status(502).json({ error: "Could not parse Gemini response", raw: text });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch (e) {
      res.status(502).json({ error: "Invalid JSON from Gemini", raw: text });
      return;
    }

    if (!FACE_SHAPE_IDS.includes(parsed.faceShape)) {
      res.status(502).json({ error: "Unexpected faceShape value", raw: parsed });
      return;
    }

    res.status(200).json({
      faceShape: parsed.faceShape,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : null
    });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
