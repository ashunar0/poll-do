import { z } from "zod";

/**
 * サーバーからクライアントへ送る封筒の形。
 * 中身（state）はアプリごとに違うので、スキーマを受け取って組み立てる。
 *
 * この 1 箇所だけが「サーバーが何を送るか」の定義になるので、
 * 送る側と受け取る側が同時に壊れてくれる。
 */
export function serverEnvelope<S extends z.ZodType>(stateSchema: S) {
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("state"), state: stateSchema }),
    z.object({ type: z.literal("error"), message: z.string() }),
  ]);
}

/** コマンドを処理した結果。想定内の失敗は例外ではなく値で返す。 */
export type CommandResult =
  | { ok: true }
  | { ok: false; reason: string };
