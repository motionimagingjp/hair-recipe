// Vercel Serverless Function
// アップロードされた「今日の服装」写真を Gemini Vision で解析し、
// トップス/ボトムスの種類・色、色の相性コメント、靴・ワンポイント小物のアドバイスを
// JSON形式で返す。
//
// リクエストBody: { image: "data:image/...;base64,...", gender: "men"|"women", personalColor?: string }
// レスポンス: {
//   top, bottom, topColor, bottomColor,
//   colorComment, shoeAdvice, accessoryAdvice, silhouetteTip
// } または { error: string }

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { image, gender, personalColor } = req.body || {};

  if (!image) {
    res.status(400).json({ error: "image が必要です" });
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

  const img = toInlineData(image);
  if (!img) {
    res.status(400).json({ error: "画像はdata URL形式（data:image/...;base64,...）である必要があります" });
    return;
  }

  const isMen = gender === "men";
  // 🔧 差し替えポイント：ベース/アクセサリーの参考ブランドはターゲット層に合わせて調整可能
  const baseItems = isMen
    ? "ユニクロ、GU、無印良品、バナナ・リパブリック、niko and..."
    : "ユニクロ、GU、ZARA、無印良品、niko and...";
  const accItems = isMen
    ? "エルメス、ティファニー、トムフォード"
    : "エルメス、シャネル、ティファニー、カルティエ、CELINE";

  const prompt = `
あなたは、ハイ＆ロー（ライフウェアとラグジュアリーブランドのミックス）を得意とする、35〜55歳向けのプロのパーソナルスタイリストです。

添付された写真に写っている人物の「今日の服装」を分析し、以下の方針でアドバイスを作成してください。

【分析・アドバイスの方針】
- トップス・ボトムスの種類を具体的に判定する（例：Tシャツ、ポロシャツ、シャツ、ニット、スーツジャケット／スラックス、デニム、チノパン、ワイドパンツ、スカート など）
- トップス・ボトムスそれぞれの色を判定する
- その色の組み合わせが良い点・惜しい点を、具体的な理由とともに評価する（例：ネイビー×グレーは知的でシック、黒×紺は色味が近く光の当たり方でちぐはぐに見えやすい、など）。固定のルールに頼らず、実際の色同士の相性をその都度判断すること
- 配色に映える靴の色・素材のアドバイスを提案する
- ワンポイントのアクセサリー・小物を1つ提案する（ベースアイテムの参考ブランド：${baseItems}／小物の参考ブランド：${accItems}）
- シルエットや着こなし（タックイン、袖まくりなど）のコツを1つ提案する
${personalColor ? `- このユーザーのパーソナルカラーは「${personalColor}」です。これも考慮すること。` : ""}

【厳守事項】
- 写真に写っている店名・個人名・SNSアカウント名・ロゴ・透かし文字など、写真内の文字情報は一切読み取らず、出力にも含めないこと
- 顔や個人が特定できる情報には言及しないこと（服装・色・小物の話題に限定すること）
- 各コメントは日本語で、80字以内を目安に簡潔にまとめること

【出力形式】
以下のJSON形式のみを出力してください。説明文やコードブロック記号（\`\`\`）は一切含めないでください。
{
  "top": "トップスの種類",
  "bottom": "ボトムスの種類",
  "topColor": "トップスの色",
  "bottomColor": "ボトムスの色",
  "colorComment": "配色の評価コメント",
  "shoeAdvice": "靴のアドバイス",
  "accessoryAdvice": "ワンポイント小物の提案",
  "silhouetteTip": "シルエット・着こなしのコツ"
}
`.trim();

  try {
    const model = "gemini-2.5-flash";
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
              { inlineData: { mimeType: img.mimeType, data: img.data } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("Gemini API error:", response.status, errText);
      res.status(502).json({ error: `分析APIエラー(${response.status}): ${errText.slice(0, 300)}` });
      return;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let parsed;
    try {
      // まれにコードブロック記号が付くことがあるため念のため除去してからパースする
      const cleaned = text.replace(/^```json\s*|```$/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("JSON parse failed:", text.slice(0, 300));
      res.status(502).json({ error: `分析結果の解析に失敗しました: ${text.slice(0, 200)}` });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `サーバーエラー: ${err && err.message ? err.message : String(err)}` });
  }
}
