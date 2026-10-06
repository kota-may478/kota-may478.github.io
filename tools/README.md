# KiCad プロジェクトの限定共有（share/）

KiCad のプロジェクトを暗号化して GitHub Pages に置き、ID とパスワードを知っている相手だけがブラウザで閲覧できるようにする仕組みです。サーバー側の処理は使わず、復号は閲覧者のブラウザ内で行います。

閲覧ページの URL は全プロジェクト共通です。相手には次の 3 つを渡します（URL と、ID・パスワードは別の経路で送ってください）。

- URL：`https://kota-fujimoto.com/share/`（全プロジェクト共通）
- ID：プロジェクト名（`local_share/` のフォルダ名）
- パスワード（20 文字）

`share/data/` に置かれる暗号化ファイルの名前（データファイル名）は ID とパスワードから自動的に決まる内部用の値で、相手に伝える必要はありません。

入力すると「KiCADデータ」（KiCanvas で回路図・基板を表示）と「README.md」（Markdown のプレビュー。Mermaid の図にも対応）の 2 項目が表示されます。

## ディレクトリ構成

```
tools/
├─ share-encrypt.mjs      暗号化・更新・同期のスクリプト（秘密情報は含まない）
├─ vendor-kicanvas.mjs    KiCanvas に独自の変更を加えて vendor/ に置くスクリプト
├─ node-version.mjs       Node.js のバージョン確認
└─ test/                  テスト
local_share/              ※ git の対象外。公開されない
├─ manifest.json          ID（プロジェクト名）・パスワード・データファイル名・ハッシュ・コピー元の対応表
├─ dev.html, dev.js       平文のまま表示を確認する開発用ページ
└─ <ID>/                  KiCad ファイル一式と README.md（平文。フォルダ名がそのまま ID）
share/                    公開される（暗号化済みのものと閲覧用のコードだけ）
├─ index.html             閲覧ページ（全プロジェクト共通。スクリプトが生成）
├─ assets/                閲覧ページのコード・スタイル・ライブラリ
│   ├─ viewer.js / viewer.css / i18n.js   表示（日本語・英語）
│   ├─ share-main.js                      ID とパスワードからデータファイル名を計算 → 取得 → 復号
│   ├─ crypto-format.js                   暗号形式（Node とブラウザで共有）
│   └─ vendor/                            KiCanvas・marked・DOMPurify・Mermaid など（versions.txt に版と取得元）
└─ data/
    └─ <データファイル名>.bin  暗号化されたプロジェクト 1 つ分（名前は ID とパスワードから導出。32 桁の 16 進数）
```

## 必要なもの

- Node.js 22.7 以降（20 系なら 20.19 以降）。古い場合はスクリプトがエラーを表示して止まります。
- 追加のパッケージは不要です（`npm install` は要りません）。

## よく使う操作

コマンドはすべてリポジトリのルートで実行します。

### 新しいプロジェクトを共有する

1. `local_share/<ID>/` を作り、`*.kicad_pro`・`*.kicad_sch`・`*.kicad_pcb`・`README.md` を置く（階層シートはサブフォルダのままで可）。KiCad の作業フォルダから取り込む場合は下の `--sync` を使います。
2. 実行する。

   ```bash
   node tools/share-encrypt.mjs
   ```

   未登録のフォルダについて登録するか聞かれるので `y` と答えます。相手に伝える URL・ID・パスワード（と内部用のデータファイル名）が **このときだけ** 表示されます。
3. `share/` を commit・push する。

ID（プロジェクト名）に使える文字は英数字と `!#$%*+-=?@^_`（大文字・小文字は区別）。`*` と `?` は Windows ではフォルダ名に使えません。`!` や `$` を含む名前をコマンドで指定するときは `'a!b'` のようにシングルクォートで囲みます。

### 内容を更新する

`local_share/<ID>/` のファイルを差し替えて、同じコマンドを実行します。

```bash
node tools/share-encrypt.mjs                  # 変更のあったプロジェクトだけ再暗号化
node tools/share-encrypt.mjs --only myboard   # 特定のプロジェクトだけ
node tools/share-encrypt.mjs --force          # 変更がなくても再暗号化
```

ID・パスワード（したがってデータファイル名）は変わらないので、相手は同じ情報のまま最新版を見られます。各プロジェクトに「新規／更新／変更なし（スキップ）」が表示されます。

### KiCad の作業フォルダから取り込む（--sync）

```bash
node tools/share-encrypt.mjs --set-source myboard ~/KiCad/myboard   # コピー元を登録（初回のみ）
node tools/share-encrypt.mjs --sync --only myboard                   # 取り込み → 暗号化
```

- コピーするのは KiCad の 3 種類のファイル（サブフォルダの階層シートを含む）、`README.md`、README から参照されている画像だけです。
- バックアップ（`*-backups/`、`*-bak`）、自動保存（`_autosave-*`）、ロック（`*.lck`）、`fp-info-cache`、`*.kicad_prl`、`.git/` などのドットフォルダ、`gerber/` などの製造データはコピーしません（除外パターンは `share-encrypt.mjs` の先頭）。
- コピー前に追加・上書き・変更なしの一覧を表示して確認します（既定は No、`--yes` で省略）。コピー元から消えたファイルは警告するだけで、削除はしません。

### 共有情報を確認する

```bash
node tools/share-encrypt.mjs --list                    # 共通 URL と、各プロジェクトの ID・データファイル名・更新日時（パスワードは出ない）
node tools/share-encrypt.mjs --show-password myboard   # 相手に伝える URL・ID・パスワード（とデータファイル名）
```

### パスワードを変える

```bash
node tools/share-encrypt.mjs --rotate-password myboard
```

新しいパスワードを発行して再暗号化します。URL と ID は変わりませんが、データファイル名もパスワードから導出されるため新しくなり、古い `share/data/<旧データファイル名>.bin` は削除してよいか確認されます（対話的に `y` と答えたときだけ削除）。git の履歴には古いファイルが残り、古いパスワードで復号できます。共有した相手から過去の版を取り消すことはできません。

### 共有をやめる

`local_share/manifest.json` からそのプロジェクトの項目を削除し、`local_share/<ID>/` も別の場所へ移してからスクリプトを実行すると、不要になった `share/data/<データファイル名>.bin` を消すか確認されます（既定は No。`--yes` を付けても削除の確認は省略されません）。フォルダを残したままだと、新規として再登録するか聞かれます（No と答えれば登録されません）。消したファイルも git の履歴には残ります。

## 公開前の確認

```bash
git status --short share/   # 変更されているのが share/ だけであること
git add share/
```

`local_share/`（平文・パスワード・manifest）は `.gitignore` で除外されています。コミットに含めないでください。スクリプトは commit も push もしません。

## 表示の確認（開発用）

- 平文のまま確認：VS Code の Go Live で `http://127.0.0.1:5500/local_share/dev.html?project=<ID>` を開く。
- 暗号化後の確認：`http://127.0.0.1:5500/share/` を開いて ID とパスワードを入力。
- 英語表示は URL に `?lang=en`（または画面の Japanese/English ボタン）。
- 復号は HTTPS か `localhost`／`127.0.0.1` でのみ動きます（LAN の IP アドレスでは動きません）。

## テスト

```bash
node --test "tools/test/*.test.mjs"
```

## ライブラリの更新

- 版・取得元・SHA-256・変更点は `share/assets/vendor/versions.txt` にまとめています。
- KiCanvas は独自の変更（外部フォントの読み込み削除、KiCad 風の配色と操作）を加えています。更新するときは元のファイルを取得して変換スクリプトを通します。

  ```bash
  curl -o /tmp/kicanvas.js https://kicanvas.org/kicanvas/kicanvas.js
  node tools/vendor-kicanvas.mjs /tmp/kicanvas.js
  ```

  元のファイルが変わっているとハッシュの不一致で止まるので、変更内容を確認してからスクリプト内のハッシュと置換箇所を更新します。

## 仕組みとセキュリティ（要点）

ID（プロジェクト名）とパスワードは、前後の空白を除いて NFKC で正規化し、長さ付きで連結したもの（以下「資格情報」）として使います。

1. **データファイル名**：`PBKDF2-SHA256(資格情報, 固定のソルト "kicad-share/locator/v1", 60 万回)` の先頭 16 バイトを 16 進数にしたもの。ブラウザはこれを計算して `share/data/<データファイル名>.bin` を取得します。ファイルが無ければ「ID かパスワードが違う」と表示します。ID とファイルの対応表はどこにも置きません。
2. **暗号化の鍵**：`PBKDF2-SHA256(資格情報, ファイルごとの乱数ソルト, 60 万回)`。ソルトとノンスは各ファイルの先頭にあり（公開されていて問題ない値）、暗号化のたびに新しくなります。データファイル名とはソルトが異なるため、公開されたデータファイル名から鍵は分かりません。
3. **暗号**：AES-256-GCM。ファイル一式（ファイル名を含む）を圧縮してから暗号化し、改ざんは復号時に検出されます。

- 復号した内容はメモリ上だけに置き、ブラウザのストレージには保存しません。ページを離れると消去し、「戻る」で復元された場合は読み込み直します（共用 PC 対策）。ページのタイトルにも ID を入れません（閲覧履歴に残るため）。
- 他のサイトに埋め込まれた状態（iframe）ではフォームを表示しません（クリックジャッキング対策）。
- README は marked → DOMPurify で無害化し、`style` 属性も除去します。Mermaid は `securityLevel: "strict"`・SVG ラベルで描画し、出力をさらに DOMPurify に通します。
- リポジトリは公開なので、`share/data/` のファイルは誰でも入手できます。保護は暗号化（パスワードの強度は約 124 ビット）だけで行っています。データファイル名の導出にも遅い PBKDF2 を使っているため、ファイル名の一覧を使って総当たりを高速化することはできません。
- 閲覧ページは `noindex`、`no-referrer`、厳しめの CSP を設定し、外部への通信はしません。`share/` はサイトマップからも除外しています（`_config.yml`）。
