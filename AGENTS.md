# Cursor Cloud specific instructions

このリポジトリは公開される。CV のコンパイルエンジンは XeLaTeX に固定する。

## ビルド

CV を変更したあとは、次を実行する。

```bash
bash pdf/workspace/tex/build.sh
```

`build.sh` は XeLaTeX（`latexmk` の `$pdf_mode = 5`）で `pdf/workspace/tex/build/cv.pdf` を作り、成功したときだけ `pdf/AcademicCV.pdf` を更新する。ビルドが失敗したときは、既存の `pdf/AcademicCV.pdf` を上書きしない。

実行の前に `pdf/workspace/tex/install-fonts.sh` がフォントを fontconfig へ登録し、`fc-list` で次の名前が解決されることを確認する。

- Roboto
- Source Sans Pro
- FontAwesome
- Latin Modern Math

同梱フォントは Roboto のみである。ライセンス本文は `pdf/workspace/tex/fonts/LICENSE-Roboto.txt` にある。Source Sans Pro、Font Awesome、Latin Modern Math は TeX Live から供給する。Font Awesome は `texlive-fonts-extra` の OpenType 版を、ファミリ名 `FontAwesome` で解決する。

`cv.tex` の `draft` オプションは、依頼がない限り変えない。

## PDF 更新時の確認

CV の TeX を変更したあとは、上記のとおり `bash pdf/workspace/tex/build.sh` で PDF をビルドする。ビルドが失敗した状態で PR を出さない。

TeX の内容を変えた PR では、変更前の PDF（`git` の HEAD にある `pdf/AcademicCV.pdf`）と、ビルドで得た `pdf/AcademicCV.pdf` を次の順で比較し、**PR の説明に結果を書く**。

1. **`pdfinfo`**: ページ数、ページサイズ
2. **`pdftotext`**: 全文の diff（意図した変更だけが差分に出ていること）
3. **`pdftoppm`**: 150 dpi で画像化し、ページごとに画素の差を調べる。意図した変更の領域以外に差が出ていないこと

   1 ページ目の Font Awesome アイコン周辺（x=496..513, y=244..257）に、おおよそ 100 画素程度の描画差が出ることは、これまでの確認で再現している既知の揺れである。意図しない差分として扱わなくてよい。

意図しない差分があるときは PR を出さず、原因を報告する。

TeX の内容に変更がないときは、`pdf/AcademicCV.pdf` をコミットしない（ビルドのたびにバイナリが変わるため）。

TeX の内容を変え、上記の確認を通過した PR では、更新した `pdf/AcademicCV.pdf` を PR に含める。

## ブランチ

作業は新しいブランチで行い、PR で提出する。`master` へは直接 push しない（`master` は保護対象のため、push が通る状態になっていても行わない）。`master` に対する force push もしない。マージは **Squash merge のみ** とする。GitHub のブランチ保護の設定は、エージェントが変更しない。

## 公開リポジトリと連絡先

このリポジトリは公開であり、PR の説明にも機密情報を書かない。

tex、PR の説明、コミットメッセージに、自宅住所や私用の電話番号などの私的な連絡先を書かない。tex に載せてよい連絡先は、所属先の住所とメールアドレスだけである。
