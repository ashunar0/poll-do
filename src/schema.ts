import { z } from "zod";

/**
 * このアプリの語彙。状態とコマンドの定義がここに集約されている。
 * サーバーもクライアントも同じものを見るので、片側だけズレることがない。
 */

// ------------------------------------------------------------------ 状態

export const optionSchema = z.object({
  id: z.number().int().positive(),
  label: z.string(),
  votes: z.number().int().nonnegative(),
});

export const pollStateSchema = z.object({
  options: z.array(optionSchema),
  /** 締切の時刻（ミリ秒）。未設定なら null。 */
  closesAt: z.number().int().nullable(),
  closed: z.boolean(),
});

export type Option = z.infer<typeof optionSchema>;
export type PollState = z.infer<typeof pollStateSchema>;

// -------------------------------------------------- コマンド（WebSocket）

export const pollCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("vote"), optionId: z.number().int().positive() }),
]);

export type PollCommand = z.infer<typeof pollCommandSchema>;

// ------------------------------------------------------ リクエスト（HTTP）

export const setupSchema = z.object({
  labels: z.array(z.string().min(1)).min(2),
});

export const voteSchema = z.object({
  optionId: z.number().int().positive(),
});

export const scheduleSchema = z.object({
  /** 何ミリ秒後に締め切るか */
  closesInMs: z.number().int().positive().max(24 * 60 * 60 * 1000),
});
