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

  // 🔧 差し替えポイント：髪色のタグ名（例：「ベージュ・ハイトーン」）だけでは
  // 画像生成AIが具体的な色味（トーン・彩度）を誤解しやすい（例：ゴールドの金髪になってしまう等）。
  // 実際の狙いに近づけるため、代表的な色タグごとに具体的な見た目の説明を補足する。
  const COLOR_HINTS = {
    "黒髪": "赤みや茶色みのない、地毛に近い自然な黒〜濃い黒。",
    "暗髪ブラウン": "一見黒に近いが、光に当たるとほんのり茶色みが見える暗めのブラウン。",
    "ブラウン": "赤み〜黄みのある、はっきりとしたライトブラウン〜ミディアムブラウン。金色に寄りすぎない落ち着いた茶色。",
    "ベージュ・ハイトーン": "黄み・オレンジみを抑えた、明るく柔らかいベージュ系のハイトーンカラー。派手な金髪（ゴールドブロンド）にはしないこと。",
    "アッシュ・グレー": "赤み・黄みを抑えた、灰色がかった寒色系のカラー。くすみ・透明感のあるモノトーン系。",
    "ピンク・レッド・オレンジ": "ピンク・レッド・オレンジ系のはっきりした暖色カラー。",
    "ブルー・パープル・グリーン": "ブルー・パープル・グリーン系のはっきりした寒色〜中間色カラー。",
    "ホワイト・ペール": "脱色による白髪風のホワイト、または彩度を抑えたペールカラー。",
  };
  const colorHintEntry = Object.entries(COLOR_HINTS).find(([tag]) => styleLabel.includes(tag));

  // 🔧 差し替えポイント：長さの指定（例：「ミディアム」）も、タグ名だけでは
  // 画像生成AIが自身の判断で伸ばしてしまう等、指定通りにならないことがある。
  // 具体的な長さの目安を補足し、元の自撮り写真の髪の長さに引っ張られないよう明示する。
  const LENGTH_HINTS = {
    "スキンヘッド": "髪をすべて剃り上げた、髪の毛がほぼ無い状態。頭皮が完全に見える。",
    "ボウズ": "長さ約12mmまでのバリカン刈り。髪はあるがごく短く、地肌が透けて見える程度の長さ。",
    "ショート": "耳が半分〜完全に見える程度の長さ。あごのラインより上で収まる、コンパクトなシルエット。",
    "ミディアム": "あごのライン〜鎖骨・肩にかかる程度の長さ。胸元までは届かない（ボブ・ロブを含む）。",
    "ロング": "肩よりも下、鎖骨〜胸元、あるいはそれよりも長く伸びた長さ。",
  };
  const lengthHintEntry = Object.entries(LENGTH_HINTS).find(([tag]) => styleLabel.includes(tag));

  const prompt = [
    `添付した人物写真の髪型だけを「${styleLabel}」に変更してください。`,
    "顔立ち・肌の色・背景はそのまま保持してください。別人にならないよう、顔のパーツ（目・鼻・口・輪郭）は一切変形させないでください。",
    colorHintEntry ? `髪色「${colorHintEntry[0]}」の具体的な見た目：${colorHintEntry[1]}` : null,
    lengthHintEntry
      ? `髪の長さ「${lengthHintEntry[0]}」の具体的な目安：${lengthHintEntry[1]} 元の自撮り写真の髪の長さがこれと異なっていても、必ず指定の長さに変更してください（伸ばす方向・切る方向のどちらであっても、指定の長さを優先すること）。`
      : null,
    "正面から見た写真と、横顔（サイド）から見た写真の2枚を、1枚の画像の中に左右に並べて生成してください（アスペクト比16:9、左：正面、右：横顔）。",
    "左側の正面写真は、元の写真をそのまま使い回さず、必ず指定した新しい髪型（長さ・前髪・質感）・髪色に変更した状態で生成してください。左右どちらの画像も同じ新しい髪型・髪色になっている必要があります（片方だけ髪型・髪色が変わっていない状態は不可）。",
    "画像内に文字・タイトル・ロゴ・透かし・キャプション・番号は一切含めないでください。写真のみを生成してください。",
  ].filter(Boolean).join("\n");

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
      res.status(502).json({ error: `画像生成APIエラー(${response.status}): ${errText.slice(0, 300)}` });
      return;
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData);

    if (!imagePart) {
      const snippet = JSON.stringify(data).slice(0, 300);
      console.error("No image returned from Gemini:", snippet);
      res.status(502).json({ error: `画像が生成されませんでした: ${snippet}` });
      return;
    }

    const mimeType = imagePart.inlineData.mimeType || "image/png";
    const base64 = imagePart.inlineData.data;

    res.status(200).json({ image: `data:${mimeType};base64,${base64}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `サーバーエラー: ${err && err.message ? err.message : String(err)}` });
  }
}
