// Vercel Serverless Function
// ユーザーの自撮り写真（1枚）＋ 目標の髪型（テキスト指定）を Gemini API に渡し、
// 顔立ち・肌の色・背景を保持したまま、指定の髪型に変更した「正面＋横顔（2面図・16:9）」の
// 合成画像を1枚生成する。
//
// 参照写真（2枚目の画像）は使わない方式。実際にコピペ用プロンプトとして動作実績のある
// 「自撮り1枚＋髪型のテキスト指定」の構成をそのままAPI化したもの。
//
// リクエストBody: { userFaceImage: "data:image/...;base64,...", styleName: string, styleSub?: string }
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

  const { userFaceImage, styleName, styleSub } = req.body || {};

  if (!userFaceImage || !styleName) {
    res.status(400).json({ error: "userFaceImage と styleName が必要です" });
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
  if (!imageA) {
    res.status(400).json({ error: "画像はdata URL形式（data:image/...;base64,...）である必要があります" });
    return;
  }

  const styleLabel = styleSub ? `${styleName}（${styleSub}）` : styleName;

  const prompt = [
    `添付した人物写真の髪型だけを「${styleLabel}」に変更してください。`,
    "顔立ち・肌の色・背景はそのまま保持してください。別人にならないよう、顔のパーツ（目・鼻・口・輪郭）は一切変形させないでください。",
    "正面から見た写真と、横顔（サイド）から見た写真の2枚を、1枚の画像の中に左右に並べて生成してください（アスペクト比16:9、左：正面、右：横顔）。",
    "画像内に文字・タイトル・ロゴ・透かし・キャプション・番号は一切含めないでください。写真のみを生成してください。",
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
              { text: prompt },
              { inlineData: { mimeType: imageA.mimeType, data: imageA.data } },
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
