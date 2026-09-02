// デート向けレストラン/カフェ提案API（Vercel Serverless Function）
// フロントエンドから受け取った条件（カテゴリ・ランチ/ディナー・エリア・予算・追加要望）をもとに、
// Gemini API でお店の提案とデート視点のアドバイスを生成する。
//
// 必要な環境変数（Vercelのプロジェクト設定 > Environment Variables で設定）:
//   GEMINI_API_KEY = あなたのGemini APIキー
//
// 設計方針:
// ・固定の店舗データベースは持たない（トレンドの変化・閉店等のメンテコストを避けるため）。
//   ヒアリングした条件をそのままGemini APIに渡し、都度お店を提案してもらう。
// ・喫煙可否・個室有無・夜景などの「店舗固有の事実情報」は、Google検索連携（grounding）を
//   優先して最新情報を参照する。grounding が使えない/取得できなかった場合は、
//   各お店に unverified:true を付けて返し、フロント側で「要確認」と案内する
//   （事実を断定して利用者に実害が出ることを避けるため）。
//
// 注意: APIキーはこのサーバー側の環境変数としてのみ保持し、フロントエンドには埋め込まないこと。

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const {
      gender,       // "women" | "men"
      category,     // "restaurant" | "cafe"
      mealtime,     // "lunch" | "dinner"（category==="restaurant"のときのみ意味を持つ）
      location,     // 自由入力（駅名・エリア・路線名など）
      cuisine,      // 料理ジャンル（例:"韓国料理"）。フロント側で地名＋国名から自動判定される場合がある
      budgetLabel,  // 画面表示用の予算ラベル（例:"4,000〜5,000円/人（お飲み物込み）"）
      budgetNote,   // 「もっと高め」等、金額に変換できなかった補足要望
      extraNote     // 結果表示後に追加された自由相談の内容
    } = req.body || {};

    if (!category) {
      res.status(400).json({ error: "category is required" });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
      return;
    }

    const categoryLabel = category === "cafe" ? "カフェ" : "レストラン";
    const mealtimeLabel = mealtime === "lunch" ? "ランチ" : (mealtime === "dinner" ? "ディナー" : "");
    const genderLabel = gender === "men" ? "男性" : "女性";

    const conditionLines = [
      "・カテゴリ: " + categoryLabel + (mealtimeLabel ? "（" + mealtimeLabel + "）" : ""),
      "・エリア: " + (location || "指定なし"),
      cuisine ? "・料理ジャンル: " + cuisine : null,
      "・予算目安（お一人あたり）: " + (budgetLabel || "指定なし") + (budgetNote ? "（補足: " + budgetNote + "）" : ""),
      "・相談者: " + genderLabel,
      extraNote ? "・追加の希望: " + extraNote : null
    ].filter(Boolean).join("\n");

    // 🔧 差し替えポイント: デート視点で重視する観点。美容師/コンシェルジュ監修で調整可能。
    const datePerspectiveHint =
      "各お店について、わかる範囲で次のようなデート視点のアドバイスを1〜3個添えてください（無理に全部埋めなくてよい）。\n" +
      "・個室/半個室がある → 予約時に指定するとよい旨\n" +
      "・喫煙可の店である → タバコが苦手な相手なら避けたほうがよい旨の注意喚起\n" +
      "・横並びのカウンター席がある → 初デートで会話しやすい旨\n" +
      "・お酒（特にワインなど）の品揃えが良い → お酒好きな相手におすすめな旨\n" +
      "・夜景やロマンチックな眺め（東京タワー、スカイツリーが見えるなど）がある → 理由つきで紹介";

    const prompt =
      "あなたは婚活・恋愛サポートに詳しい、デートのお店選びアドバイザーです。\n" +
      "以下の条件に合う、日本国内の実在するお店を3件程度提案してください。\n\n" +
      conditionLines + "\n\n" +
      datePerspectiveHint + "\n\n" +
      "重要な注意事項:\n" +
      "・実在しないお店を創作しないでください。\n" +
      "・住所・営業時間・個室有無・喫煙可否などの事実情報は、確認が取れたものだけ断定してください。\n" +
      "・確認が取れない、または自信がない項目がある場合は、無理に断定せず該当お店の \"unverified\" を true にしてください。\n" +
      '必ず次のJSON形式のみで回答してください（説明文やコードブロックは不要）:\n' +
      '{"spots":[{"name":"店名","area":"エリア","desc":"一言紹介（60文字程度）","dateTips":["デート視点のアドバイス","..."],"unverified":true または false}]}';

    // gemini-flash-latest は Google 側が常に「その時点で推奨されるFlashモデル」を指すように
    // 自動で切り替えてくれるエイリアス。個別バージョン名を指定すると、将来そのモデルが
    // 廃止された際に404エラーになるため、ここではあえて固定しない（過去の404対応の教訓）。
    const apiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=" + apiKey;

    async function callGemini(useGrounding) {
      const body = { contents: [{ parts: [{ text: prompt }] }] };
      if (useGrounding) {
        // Google検索連携（grounding）。モデル/APIバージョンによっては未対応でエラーになるため、
        // 失敗時は下で一般知識ベースの呼び出しにフォールバックする。
        body.tools = [{ google_search: {} }];
      }
      return fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    }

    let geminiRes = await callGemini(true);
    let usedGrounding = geminiRes.ok;

    if (!geminiRes.ok) {
      // grounding非対応などで失敗した場合は、一般知識ベースで再試行する
      geminiRes = await callGemini(false);
      usedGrounding = false;
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      res.status(502).json({ error: "Gemini API error", detail: errText });
      return;
    }

    const data = await geminiRes.json();

    // grounding利用時、実際に検索結果を参照できたかを groundingMetadata の有無で確認する
    const groundingMeta = data && data.candidates && data.candidates[0] && data.candidates[0].groundingMetadata;
    const actuallyGrounded = !!(usedGrounding && groundingMeta && groundingMeta.groundingChunks && groundingMeta.groundingChunks.length);

    const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map(function (p) { return p.text || ""; }).join("");
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

    if (!parsed || !Array.isArray(parsed.spots)) {
      res.status(502).json({ error: "Unexpected response shape", raw: parsed });
      return;
    }

    res.status(200).json({
      spots: parsed.spots.slice(0, 5).map(function (s) {
        return {
          name: String((s && s.name) || "").slice(0, 60),
          area: String((s && s.area) || "").slice(0, 30),
          desc: String((s && s.desc) || "").slice(0, 120),
          dateTips: Array.isArray(s && s.dateTips)
            ? s.dateTips.slice(0, 3).map(function (t) { return String(t).slice(0, 80); })
            : [],
          // groundingで確認が取れなかった場合は、個別の断定有無に関わらず全体を「要確認」寄りに倒す
          unverified: !!(s && s.unverified) || !actuallyGrounded
        };
      }),
      grounded: actuallyGrounded
    });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
