# HAIR Recipe（本番デプロイ用プロジェクト）

チャット型ヘアスタイル診断アプリ「HAIR Recipe」を、実際にインターネット上に公開するためのプロジェクト一式です。
これまでClaude上で確認していた1枚のHTMLプロトタイプを、GitHub + Vercel で公開できる構成に組み直しています。

## 構成

```
hair-recipe-app/
  api/
    analyze-face-shape.js   顔型診断API（Gemini APIを呼び出す）
    analyze-screenshot.js   スクショ解析API（Gemini APIを呼び出す）
  public/
    index.html              アプリ本体（フロントエンド）
    catalog.json             ヘアスタイル一覧（APIとフロントで共有するデータ）
  package.json
  .gitignore
  .env.example
  README.md（このファイル）
```

APIキー（Gemini APIキー）はサーバー側の環境変数としてのみ保持され、ブラウザ側のコードには一切含まれません。
画像解析APIに接続できない場合（キー未設定・通信エラーなど）は、自動的に今まで通りのモック（仮の結果）にフォールバックするので、公開直後で万一APIが動かなくてもアプリ自体は壊れません。

## 公開までの手順

### 1. Gemini APIキーを取得する
1. https://aistudio.google.com/apikey にアクセスし、Googleアカウントでログイン
2. 「Create API key」からAPIキーを発行する（無料枠があります）
3. 発行されたキーは後で使うので控えておく

### 2. GitHubにリポジトリを作る
1. GitHubで新規リポジトリを作成する（例: `hair-recipe`）
2. このフォルダ（`hair-recipe-app`）の中身をそのリポジトリにアップロードする
   - GitHub Desktopや `git` コマンドをお使いの場合は、通常通り `git init` → `git add .` → `git commit` → `git push` で構いません
   - コマンド操作に不慣れな場合は、GitHubのWeb画面の「Add file → Upload files」からドラッグ＆ドロップでもアップロードできます
3. **`.env` や実際のAPIキーは絶対にアップロードしないでください**（`.gitignore` で除外済みです）

### 3. Vercelでプロジェクトを作る
1. https://vercel.com にログイン（GitHubアカウントで連携可能）
2. 「Add New... → Project」から、先ほど作成したGitHubリポジトリを選択してインポートする
3. フレームワークの設定は特に変更不要（「Other」のままでOK）のまま「Deploy」を押す
   - この時点ではまだGemini APIキーを設定していないため、画像解析はモックのまま動作します

### 4. Gemini APIキーをVercelに設定する
1. Vercelのプロジェクト画面 → 「Settings」→「Environment Variables」を開く
2. 以下を追加する
   - Name: `GEMINI_API_KEY`
   - Value: 手順1で取得したAPIキー
   - Environment: Production（必要なら Preview / Development にも追加）
3. 保存したら、「Deployments」タブから最新のデプロイを「Redeploy」する（環境変数は再デプロイ後に反映されます）

### 5. 動作確認
1. Vercelが発行したURL（例: `https://hair-recipe.vercel.app`）にアクセス
2. 顔型診断で自撮り画像をアップロードし、「AI診断結果（Gemini API）」のバッジが出れば、実際にGemini APIで判定できています
3. 何らかの理由でAPIに接続できない場合は「AI診断結果（デモ・実APIに差し替え可能）」と表示され、モックの結果になります（アプリが落ちることはありません）

## ヘアスタイルを追加・変更したいとき

`public/catalog.json` と `public/index.html` 内の `CATALOG`（JavaScript配列）の両方を更新してください。
`catalog.json` はスクショ解析API（`api/analyze-screenshot.js`）がどのスタイルを候補にするかの判定に使われ、
`index.html` 側の `CATALOG` は実際にアプリ内で表示する画像・詳細情報を持っています。

## 今後の課題（引き続き検討中の項目）

- Web検索によるイメージ補完機能（「🔍 Webから他のイメージを探す」）は現状まだモックのままです。実際にGoogle Custom Search API等と接続する場合は、`public/index.html` 内の `searchWebImages()` を同様の仕組み（サーバー側APIルート経由）に差し替える必要があります
- 「もっとリアルに試したい方へ」の外部プロンプト生成機能は、社内で画像生成APIを呼ばない設計のため、そのままで問題ありません
- 顔型×スタイルの相性タグ（`faceShapes`）は仮のデータです。美容師監修のうえで見直すことをおすすめします
- 運営者ページ（このアプリについて）の名前・写真・SNSリンクはプレースホルダーです。公開前に実際の情報に差し替えてください
- Gemini APIの利用は無料枠を超えると課金が発生します。想定アクセス数に応じて料金・レート制限をご確認ください
