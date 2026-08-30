// api/analyze-screenshot.js
// 「なりたい髪型」の参考写真を Gemini Vision API で解析し、
// { length, bangs, color, texture, confidence } の形で返す Vercel Serverless Function。
//
// フロントエンド（public/index.html）は、このAPIが失敗した場合（エラー応答・通信失敗など）に
// 自動的にデモ解析（ランダム表示）へフォールバックする作りになっているため、
// このファイル側は「うまくいかない時は素直にエラーを返す」だけでよい。

const GEMINI_MODEL = "gemini-flash-latest";

// フロント側（index.html）が選択肢として使っているタグと完全に一致させる。
// ここがズレると「選んだスタイルとの一致：X/4項目」の判定が正しく機能しない。
const LENGTH_OPTIONS  = ["ショート", "ミディアム", "ロング"];
const BANGS_OPTIONS   = ["シースルーバング", "流し前髪", "前髪なし", "ぱっつん前髪", "センターパート"];
const COLOR_OPTIONS   = ["ベージュ", "暗髪ブラウン", "アッシュグレー", "黒髪"];
const TEXTURE_OPTIONS = ["ストレート", "ゆるふわウェーブ", "強めパーマ", "無造作ウェーブ"];

function buildPrompt() {
  return `
あなたはプロの美容師です。添付された画像に写っている「なりたい髪型」の参考写真を分析してください。

【重要な注意事項】
画像内に写っている店名・個人名・SNSハンドル・ロゴ・透かし・電話番号などの文字情報は、
分析には一切使用せず、出力にも含めないでください。あくまで髪型そのものの見た目だけを分析対象としてください。

以下の4項目について、それぞれ指定された選択肢の中から画像に最も近いものを1つだけ選んでください。
（選択肢以外の言葉は使わないでください）

- length（長さ）: ${LENGTH_OPTIONS.join(" / ")}
- bangs（前髪）: ${BANGS_OPTIONS.join(" / ")}
- color（カラー）: ${COLOR_OPTIONS.join(" / ")}
- texture（質感）: ${TEXTURE_OPTIONS.join(" / ")}

必ず次のJSON形式のみで回答してください（説明文やコードブロックの記号は不要です）。
{"length": "...", "bangs": "...", "color": "...", "texture": "...", "confidence": 0.0〜1.0の数値}
`.trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not set" });
  }

  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64 || !mimeType) {
    return res.status(400).json({ error: "imageBase64 and mimeType are required" });
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: buildPrompt() },
                { inline_data: { mime_type: mimeType, data: imageBase64 } }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      return res.status(502).json({ error: "Gemini API request failed" });
    }

    const data = await geminiRes.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return res.status(502).json({ error: "No content returned from Gemini" });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      console.error("Failed to parse Gemini response as JSON:", rawText);
      return res.status(502).json({ error: "Invalid JSON from Gemini" });
    }

    // 想定外の値が返ってきた場合は、フロント側のデモ解析にフォールバックさせるためエラーにする
    const isValid =
      LENGTH_OPTIONS.includes(parsed.length) &&
      BANGS_OPTIONS.includes(parsed.bangs) &&
      COLOR_OPTIONS.includes(parsed.color) &&
      TEXTURE_OPTIONS.includes(parsed.texture);

    if (!isValid) {
      console.error("Gemini returned unexpected values:", parsed);
      return res.status(502).json({ error: "Unexpected values from Gemini" });
    }

    return res.status(200).json({
      length: parsed.length,
      bangs: parsed.bangs,
      color: parsed.color,
      texture: parsed.texture,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8
    });
  } catch (err) {
    console.error("analyze-screenshot error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
