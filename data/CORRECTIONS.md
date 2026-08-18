# データセットの訂正記録

gold ラベルはOSSの公開PRの記録から再構築したものなので、**間違いが見つかりうる**という前提で運用します。
訂正はここに時系列で残します。各項目には「何が間違っていたか」「どう確かめたか」「公開済みの数字に影響するか」を書きます。

`pnpm verify:dataset` はケースが上流リポジトリと一致していること（コミットが解決するか、`refs/pull/<n>/head` が
`headSha` と一致するか、保存されたdiffが上流のdiffの忠実な部分集合か、根拠ファイルが実在するか）を機械的に検査しますが、
**gold ラベルそのものの正しさは検査できません**。ラベルの誤りは、ここにあるように実際に動かして確かめるしかありません。

---

## 2026-08-18: `rg_0011` / `rg_0012` — 参照PRの誤り（gold FAIL が実際にはPASS）

**症状**: `rg_0012`（head）の gold が FAIL だったが、そのPRのheadリビジョンではテストはPASSする。

**元のケース**: expressjs/express#6909 `deps: qs@6.14.0`（`"qs": "6.13.0"` → `"6.14.0"` の完全固定）。
テストは「同じクエリキーを25回繰り返したとき `req.query.ids` が配列になるか」。

**確かめ方**: express の `lib/utils.js` の `parseExtendedQueryString` が呼ぶのと同じ形で qs を直接実行した。

```
qs.parse('ids=1&...&ids=25', { allowPrototypes: true })
  qs 6.13.0 → 配列（25要素）
  qs 6.14.0 → 配列（25要素）   ← #6909 のheadはこれを完全固定している
  qs 6.14.1 / 6.14.2 → 数値キーのオブジェクト
```

つまり #6909 のheadでは壊れておらず、gold FAIL は誤りだった。4.x の履歴を追うと、実際に壊したのは次のPRである
expressjs/express#6919 `deps: use tilde notation for qs`（`"6.14.0"` → `"~6.14.0"`）で、
チルダ範囲はインストール時に 6.14.2 へ解決される（express の 4.x はロックファイルをコミットしていない）。

**訂正内容**: ケースの参照PRを #6919 に付け替えた（`baseSha` = `8c12cdf`、`headSha` = `539037f`、diff・説明・provenance を差し替え）。
テスト文面と gold（base PASS / head FAIL）は変更していない——base/head が指すリビジョンが正しくなっただけ。
`provenance.source` は `REPRODUCED` から `HISTORICAL_EVIDENCE` に落とした（#6919 自身はテストを追加していないため）。

**公開済みの数字への影響**: なし。splitはPRクラスタのハッシュで決まり、`expressjs/express#6909` も `#6919` も
`test` split に入る。README に載っている結果はすべて `dev` split（26ケース）で取ったものなので、このケースは含まれていない。

---

## 2026-08-18: `rgf_0003` / `rgf_0004` — `evidenceTestFile` がパスになっていなかった

`playground/assets (multiline-import-meta-url.js)` という散文が入っていて、どちらのリビジョンにも解決しなかった。
修正PR vitejs/vite#20644 が実際に触っているテストファイル `playground/assets/__tests__/assets.spec.ts`
（このリビジョンにも存在する）に差し替え、fixtureの話は `note` に移した。gold ラベルは変更していない。

---

## 訂正とデータセットバージョンの関係

`data/oss/*.json` を直すこと自体は、すでに凍結されたデータセットバージョンを書き換えません。
コミット済みの `data/benchmark.sqlite` に入っている凍結版と、そこに紐づく公開済みのrunは訂正前の内容のままです
（バージョンは不変で、runは常に「実際に解かせた内容」に解決される）。訂正は次に `pnpm seed --force` で
凍結したバージョンから反映されます。訂正前後の数字を比べたい場合は、両方のバージョンでrunを取り直してください。
