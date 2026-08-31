// Vercel Serverless Function
// ユーザーの顔写真（Image A）＋ 目標の髪型写真（Image B）を Gemini API に渡し、
// 顔立ちを保持したまま目標の髪型を適用した「正面＋横顔（2面図・16:9）」の合成画像を1枚生成する。
//
// リクエストBody: { userFaceImage: "data:image/...;base64,...", targetHairstyleImage: "data:image/...;base64,...", note?: string }
// レスポンス: { image: "data:image/...;base64,..." } または { error: string }
//
// 🔧 差し替えポイント：
//  - 画像生成に対応したモデル名は、実際に利用可能なGemini APIのモデル一覧に合わせて調整してください
//  - レスポンスの構造（candidates[0].content.parts）はAPIのバージョンにより変わる可能性があります

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { userFaceImage, targetHairstyleImage, note } = req.body || {};

  if (!userFaceImage || !targetHairstyleImage) {
    res.status(400).json({ error: "userFaceImage と targetHairstyleImage の両方が必要です" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "サーバー側にGEMINI_API_KEYが設定されていません" });
    return;
  }

  function toInlineData(dataUrl) {
    const match = /^data:(.+);base64,(.+)$/.exec(dataUrl || "");
    if (!match) return null;
    return { mimeType: match[1], data: match[2] };
  }

  const imageA = toInlineData(userFaceImage);
  const imageB = toInlineData(targetHairstyleImage);

  if (!imageA || !imageB) {
    res.status(400).json({ error: "画像はdata URL形式（data:image/...;base64,...）である必要があります" });
    return;
  }

  const systemPrompt = [
    "あなたはプロのヘアスタイリストおよび高度なAI画像合成エンジニアです。",
    "提供された2枚の画像（Image AおよびImage B）を分析し、指示通りの新しい画像を1枚生成してください。",
    "",
    "【入力画像の役割定義】",
    "- Image A（ユーザーの顔）：登場人物の「顔立ち」「目鼻立ち」「肌のトーン」「輪郭」の絶対的な参照元です。この人物の顔のアイデンティティを100%保持してください。",
    "- Image B（目標の髪型）：適用する「髪型」「髪色」「毛束感」「スタイリング」「ボリューム」の参照元です。",
    "",
    "【生成画像のレイアウトおよび構成要件】",
    "1. アスペクト比：16:9（横長）",
    "2. 画面構成：左右に等分された2分割の画面（左：正面、右：真横）",
    "   - 【左画面】：Image Aの顔立ちを保持した人物が、Image Bの髪型をセットしてカメラを見つめている「正面アップ（フロントショット）」。",
    "   - 【右画面】：同じ人物の同じ髪型による「真横からの横顔（90度サイドショット）」。",
    "3. 背景：明るく清潔感のある白〜明るいグレーを基調とした、柔らかくボケたヘアサロン風のスタジオ背景。",
    "4. ライティング：柔らかく均一な室内プロ照明。高解像度で超リアルなヘアカタログ写真の質感。",
    "",
    "【最重要遵守事項】",
    "- 顔は必ずImage Aの人物そのものであること。別人にならないよう精密に合成すること。",
    "- 髪型・髪色はImage Bのスタイル（形状、カット、質感、トーン）を正確に再現すること。",
    note ? `\n【補足情報】${note}` : "",
  ].join("\n");

  try {
    // 🔧 差し替えポイント：画像生成対応モデル名（例：gemini-2.5-flash-image 等）を実際の利用可能モデルに合わせてください
    const model = "gemini-2.5-flash-image";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: systemPrompt },
              { inlineData: { mimeType: imageA.mimeType, data: imageA.data } },
              { inlineData: { mimeType: imageB.mimeType, data: imageB.data } },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("Gemini API error:", response.status, errText);
      res.status(502).json({ error: "画像生成APIの呼び出しに失敗しました" });
      return;
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData);

    if (!imagePart) {
      console.error("No image returned from Gemini:", JSON.stringify(data).slice(0, 500));
      res.status(502).json({ error: "画像が生成されませんでした" });
      return;
    }

    const mimeType = imagePart.inlineData.mimeType || "image/png";
    const base64 = imagePart.inlineData.data;

    res.status(200).json({ image: `data:${mimeType};base64,${base64}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "サーバーエラーが発生しました" });
  }
}
