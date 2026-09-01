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
const LENGTH_OPTIONS = ["スキンヘッド", "ボウズ", "ショート", "ミディアム", "ロング"];
const BANGS_OPTIONS = ["シースルーバング", "流し前髪", "前髪なし", "ぱっつん前髪", "センターパート"];
const COLOR_OPTIONS = ["黒髪", "暗髪ブラウン", "赤みブラウン", "ベージュ", "暗めゴールド", "明るめ金髪", "オレンジ系ゴールド", "アッシュグレー"];
const TEXTURE_OPTIONS = ["ストレート", "ゆるふわウェーブ", "強めパーマ", "無造作ウェーブ"];

// 🔧 差し替えポイント：長さ・カラーの判定がズレやすかったため、
// 「どこからどこまでがその選択肢か」という基準を具体的に定義している。
// 実際の傾向を見て、さらに調整してください。
const LENGTH_DEFINITIONS = `
- スキンヘッド：髪をすべて剃り上げた、髪の毛がほぼ無い状態。頭皮が完全に見える。（メンズのみの区分）
- ボウズ：長さ約12mmまでのバリカン刈り。髪はあるがごく短く、地肌が透けて見える程度の長さ。（メンズのみの区分）
- ショート：耳が半分〜完全に見える程度の長さ。襟足が短く刈り上げ・レイヤーが入っていることが多い。長くても「あごのライン」までは届かない。全体的にコンパクトで軽いシルエット。
- ミディアム：あごのライン〜鎖骨・肩にかかる程度の長さ。顔まわりの髪が頬や首にかかるが、胸元までは届かない。「ボブ」「ロブ」と呼ばれる長さもここに含む。
- ロング：肩よりも下、鎖骨〜胸元、あるいはそれよりも長く伸びた長さ。まとめ髪や毛先の揺れが目立つ長さ。
【判定のコツ】まず「スキンヘッド」「ボウズ」に該当するほど短いかどうかを最初に確認すること（女性の画像では通常この2つは選ばない）。該当しなければ、毛先が「耳・あご・肩・鎖骨・胸」のどのライン付近にあるかを基準に、ショート／ミディアム／ロングの3択で判断すること。
`.trim();

const COLOR_DEFINITIONS = `
- 黒髪：赤みや茶色みがほとんど感じられない、地毛に近い自然な黒〜濃い黒。光を当てても明るい色味がほぼ見えない。
- 暗髪ブラウン：一見黒に近いが、光の当たる部分に茶色みがうっすら見える暗めのブラウン。地毛よりわずかに明るい程度で、いわゆる「透明感のある暗髪」。赤みは強くない。
- 赤みブラウン：暗髪ブラウンより赤み・ワインレッドっぽさがはっきり見える暗め〜中間の明るさのブラウン。光の当たり方によって赤紫〜赤茶に見える。
- ベージュ：黄み・オレンジみを含んだ、明るめのライトブラウン〜ベージュ系。日本人の地毛より明らかに明るく、抜け感のある柔らかい色味。赤みは強くない。
- 暗めゴールド：ベージュよりやや暗く、黄金色（ゴールド）っぽい落ち着いた黄み系の明るさ。派手すぎない、大人っぽい柔らかいツヤ感がある。
- 明るめ金髪：全体がはっきり明るい金髪〜ブロンド。黒みがほとんど残っておらず、髪全体が強く発光して見えるレベルの明るさ。
- オレンジ系ゴールド：ゴールドよりもオレンジみ・赤みが強く出た、暖色感の強い明るめカラー。夕日のような赤橙系の発色が特徴。
- アッシュグレー：赤み・黄みを抑えた、灰色がかった寒色系のカラー。外国人風の透明感・くすみ感がある。全体的に「グレーがかって見えるか」がポイント。
【判定のコツ】
1. まず全体の明るさで「暗い（黒髪・暗髪ブラウン・赤みブラウンの候補）」「中間〜明るい（ベージュ・暗めゴールド・アッシュグレーの候補）」「かなり明るい（明るめ金髪・オレンジ系ゴールドの候補）」の3段階に分ける。
2. 暗い場合：赤み・茶色みが全く無ければ「黒髪」、赤みが弱い茶色みなら「暗髪ブラウン」、赤み・ワインレッドっぽさがはっきりしていれば「赤みブラウン」。
3. 中間〜明るい場合：グレー・くすみがかって寒色系に見えれば「アッシュグレー」、黄みが柔らかく落ち着いていれば「ベージュ」、黄み・ゴールド感が濃く出ていれば「暗めゴールド」。
4. かなり明るい場合：赤み・オレンジみが強ければ「オレンジ系ゴールド」、それ以外の全体的に明るい金髪であれば「明るめ金髪」。
5. 画像の照明・ホワイトバランスによる色かぶり（例：暖色照明で黒髪が茶色っぽく写る等）に惑わされず、髪全体のトーンで総合的に判断すること。
`.trim();

// 🔧 差し替えポイント：特に検索・オーダーの多いトレンドスタイルを判定の参考知識として与える。
// 出力の選択肢自体は増やさず、既存4項目（長さ・前髪・色・質感）の判定精度を上げるための参考情報。
const TREND_STYLE_REFERENCE = `
【参考：現在特に人気が高いトレンドスタイル】
以下は、現在特に検索・オーダーの多い代表的なスタイルです。写真がこれらに近い場合、タグ選びの参考にしてください（完全一致でなくても、近ければ参考程度で構いません。実際の画像の見た目を最優先してください）。

<メンズ>
1. ゆる感シャドウパーマ／フェザーパーマ：毛流れが後ろや横へ羽のようにふんわり流れる質感重視スタイル。長さの目安＝ショート〜ミディアム（目にかかる〜耳が隠れる程度）。質感の目安＝ゆるふわウェーブ。
2. ニュアンス・コンマバング（センターパート）：前髪をセンター分けし毛先を内側に入れたスタイル。前髪の目安＝センターパート。質感の目安＝ストレート。
3. スパイキーショート：毛先を立ち上げた爽やかなショート。長さの目安＝ショート。質感の目安＝無造作ウェーブ。
4. マッシュウルフ（ハッシュウルフ）：マッシュの丸みと襟足長めのウルフのミックス。長さの目安＝ミディアム。質感の目安＝無造作ウェーブ。
5. シースルーマッシュ：前髪に隙間を作った軽やかなマッシュ。前髪の目安＝シースルーバング。長さの目安＝ショート。質感の目安＝ストレート。

<レディース>
1. 韓国風くびれレイヤー：顔まわり〜胸元に大きくレイヤーを入れくびれさせたスタイル。長さの目安＝ロング。質感の目安＝ゆるふわウェーブ。
2. 重めラインのレイヤーボブ（バロック・ボブ）：ラインを残しつつ表面だけ軽さを出したボブ。長さの目安＝ミディアム。質感の目安＝ゆるふわウェーブ。
3. ハッシュカット（ウルフボブ）：毛先を鋭角に削いだエッジィなウルフ。長さの目安＝ミディアム。質感の目安＝無造作ウェーブ。
4. ニュアンスウェーブ・ミディアム：クセ毛風のリラックスウェーブ。長さの目安＝ミディアム。質感の目安＝無造作ウェーブ。
5. コンパクト・丸みショートボブ：襟足を首に密着させた女性らしい丸みのショート。長さの目安＝ショート。質感の目安＝ストレート。
`.trim();

function buildPrompt() {
  return `
あなたはプロの美容師です。添付された画像に写っている「なりたい髪型」の参考写真を分析してください。

【重要な注意事項】
画像内に写っている店名・個人名・SNSハンドル・ロゴ・透かし・電話番号などの文字情報は、
分析には一切使用せず、出力にも含めないでください。あくまで髪型そのものの見た目だけを分析対象としてください。

以下の4項目について、それぞれ指定された選択肢の中から画像に最も近いものを1つだけ選んでください。
（選択肢以外の言葉は使わないでください）

- length（長さ）: ${LENGTH_OPTIONS.join(" / ")}
${LENGTH_DEFINITIONS}

- color（カラー）: ${COLOR_OPTIONS.join(" / ")}
${COLOR_DEFINITIONS}

- bangs（前髪）: ${BANGS_OPTIONS.join(" / ")}
- texture（質感）: ${TEXTURE_OPTIONS.join(" / ")}

${TREND_STYLE_REFERENCE}

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
