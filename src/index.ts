import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { scheduleSchema, setupSchema, voteSchema } from "./schema";

// Durable Object クラスは Worker のエントリから re-export する必要がある。
// これが無いと wrangler が class を見つけられない。
export { Poll } from "./poll";

const app = new Hono<{ Bindings: Env }>()
  /** お題を作る（選択肢を登録する） */
  .post("/api/polls/:id", zValidator("json", setupSchema), async (c) => {
    const { labels } = c.req.valid("json");

    // ここで初めてインスタンスが生まれる。2 回目以降は同じものに繋がる。
    const poll = c.env.POLL.getByName(c.req.param("id"));
    return c.json(await poll.setup(labels));
  })

  /** 締切を設定する */
  .post("/api/polls/:id/schedule", zValidator("json", scheduleSchema), async (c) => {
    const { closesInMs } = c.req.valid("json");

    const poll = c.env.POLL.getByName(c.req.param("id"));
    return c.json(await poll.schedule(closesInMs));
  })

  /** 投票する */
  .post("/api/polls/:id/vote", zValidator("json", voteSchema), async (c) => {
    const { optionId } = c.req.valid("json");

    const poll = c.env.POLL.getByName(c.req.param("id"));
    const result = await poll.vote(optionId);

    // 想定内の失敗は戻り値で受け取り、HTTP のステータスに翻訳する
    if (!result.ok) {
      return c.json({ error: result.reason }, result.reason === "closed" ? 409 : 400);
    }

    return c.json(result.state);
  })

  /** 現在の状態を見る */
  .get("/api/polls/:id", async (c) => {
    const poll = c.env.POLL.getByName(c.req.param("id"));
    return c.json(await poll.state());
  })

  /**
   * WebSocket で購読する。
   * upgrade リクエストはそのまま DO に丸投げする。RPC ではなく fetch を使う
   * 唯一の場面で、これは 101 レスポンスを返す必要があるため。
   */
  .get("/api/polls/:id/ws", (c) => {
    const poll = c.env.POLL.getByName(c.req.param("id"));
    return poll.fetch(c.req.raw);
  });

// フロントから import して RPC クライアントの型に使う
export type AppType = typeof app;

export default app;
