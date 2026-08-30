// スクリーンショット解析API（Vercel Serverless Function）
// ユーザーが送ったヘアスタイルのスクリーンショット画像を Gemini API に送り、
// カタログ（catalog.json）の中から最も近いスタイルを1つ選んでもらう。
//
// 必要な環境変数（Vercelのプロジェクト設定 > Environment Variables で設定）:
//   GEMINI_API_KEY = あなたのGemini APIキー
//
// 注意: カタログの内容を変更した場合は、public/catalog.json と
//       フロントエンド（public/index.html内のCATALOG）の両方を更新すること。

import { readFile } from "fs/promises";
import path from "path";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { imageBase64, mimeType, gender } = req.body || {};
    if (!imageBase64) {
      res.status(400).json({ error: "imageBase64 is required" });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
      return;
    }

    const catalogPath = path.join(process.cwd(), "public", "catalog.json");
    const catalogRaw = await readFile(catalogPath, "utf-8");
    const catalog = JSON.parse(catalogRaw);
    const candidates = gender ? catalog.filter((c) => c.gender === gender) : catalog;

    const listText = candidates
      .map((c) => `- id:"${c.id}" name:"${c.name}"（${c.sub}）`)
      .join("\n");

    const prompt =
      "あなたは美容師のアシスタントです。添付されたヘアスタイルのスクリーンショット画像を見て、" +
      "以下のカタログの中から見た目が最も近いスタイルを1つだけ選んでください。\n\n" +
      listText +
      "\n\n重要な注意事項：\n" +
      "・判定材料は髪型の視覚的特徴（長さ・質感・前髪・カラー・シルエットなど）のみとし、" +
      "画像内に写り込んだ文字情報（人物名、店舗名、SNSアカウント名、キャプション、ロゴ、透かし、" +
      "電話番号など）は一切読み取らず、判定に一切使用しないでください。\n" +
      "・応答に画像内の文字情報を引用・転記・要約しないでください。\n" +
      "\n必ず次のJSON形式のみで回答してください（説明文やコードブロックは不要）:\n" +
      '{"styleId": "選んだid", "confidence": 0から1の数値}';

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

    const found = catalog.find((c) => c.id === parsed.styleId);
    if (!found) {
      res.status(502).json({ error: "Unexpected styleId value", raw: parsed });
      return;
    }

    res.status(200).json({
      styleId: parsed.styleId,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : null
    });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
