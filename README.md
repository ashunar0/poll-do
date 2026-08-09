# poll-do

Cloudflare Durable Objects を学ぶための、リアルタイム投票アプリです。

お題を作り、複数人が同時に投票し、票が全員の画面に即座に反映され、締切時刻になると自動で締まります。

Durable Objects で押さえるべき性質を、1 つの題材で全部通すことを狙って作りました。

- 名前でインスタンスが決まる（`getByName`）
- そのインスタンスへの処理は直列化される（ロック不要）
- インスタンスごとに専属の SQLite を持つ
- Alarm と WebSocket を自分で握れる

## 動かす

```bash
pnpm install
pnpm dev
```

http://localhost:5173 を複数タブで開くと、票がリアルタイムで同期します。
`?id=dinner` を付けると別の Durable Object になり、状態は完全に独立します。

## 構成

```
src/
├── index.ts                 Worker のエントリ（Hono）。ルーティングと形の検証
├── poll.ts                  Durable Object 本体。投票の意味と不変条件
├── schema.ts                状態とコマンドの定義（zod）。両経路で共有
├── lib/synced/              輸送だけを担う土台。投票を何も知らない
│   ├── protocol.ts          両端が共有する封筒の定義
│   ├── server.ts            SyncedObject（cloudflare:workers に依存）
│   └── react.ts             useSyncedObject（react に依存）
└── client/                  React
```

## 設計メモ

### 検証は形と意味で分ける

投票の入口は HTTP と WebSocket の 2 つあります。入口ごとに検証を書くと、片方だけ緩くなります。

- **形の検証**は入口で。zod スキーマを `schema.ts` に置き、両方から使う
- **意味の検証**は Durable Object の中で。「実在する選択肢か」「締切済みか」はここでしか判断できない

入口がいくつ増えても、`Poll.vote()` を通る限り不正な票は入りません。

### 想定内の失敗は戻り値で返す

Durable Object の RPC はプロセス境界を越えるため、例外はシリアライズされて向こう側でただの `Error` に作り直されます。カスタム例外を投げても `instanceof` が効きません。

```typescript
export type VoteResult =
  | { ok: true; state: PollState }
  | { ok: false; reason: "option_not_found" | "closed" };
```

想定外のバグは例外のままで構いません。500 になるべきだからです。

### 土台は自動で broadcast しない

`SyncedObject` は `handle()` を呼びますが、その後に自動で配信はしません。HTTP からも Alarm からも状態は変わるため、「状態が変わったから配るべき」を判断できるのは意味を知っている側だけです。`broadcast()` は道具として渡すに留めています。

### 抽象の単位でまとめ、ランタイムの単位でファイルを割る

`lib/synced/` は輸送だけを担い、投票のことを何も知りません。サーバー用とクライアント用で 2 ファイルに分かれますが、同じディレクトリに置いています。ランタイムで散らすと 1 つの抽象が引き裂かれ、片方だけ直す事故が起きます。

`server.ts` と `react.ts` という名前は、そのファイルがどのランタイムに属するかの宣言です。1 ファイルにまとめないのは、`cloudflare:workers` をクライアントのバンドルに引き込むとビルドが壊れるためです。

Cloudflare の Agents SDK が `agents` / `agents/react` に分けているのと同じ形です。

## 現状の制約

学習用のため、意図的に入れていないものがあります。

- 認可がありません。誰でもお題の作成と締切設定ができます
- テストがありません。開発中に見つけたバグ（RPC 越しの `instanceof`、`AUTOINCREMENT` の採番）は手元のスクリプトで確認したもので、リポジトリには残っていません
- 差分配信をしていません。状態が変わるたびに全体を送っています

## 解説

作りながら踏んだ罠と設計判断は、別途記事にまとめています。
