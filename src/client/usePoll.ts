import { useCallback, useMemo } from "react";
import { hc } from "hono/client";
import type { AppType } from "../index";
import { pollStateSchema, type PollCommand, type PollState } from "../schema";
import { useSyncedObject } from "../lib/synced/react";

// Worker 側のルート定義から型が生えている。
// パスもボディもレスポンスも補完が効く。
const client = hc<AppType>("/");

/**
 * 1 つのお題を購読する。
 * 接続・再接続・検証は useSyncedObject が持っているので、
 * ここにあるのは投票の語彙だけ。
 */
export function usePoll(pollId: string) {
  const path = useMemo(() => `/api/polls/${pollId}/ws`, [pollId]);
  const { state, status, error, send, setError } = useSyncedObject<
    PollState,
    PollCommand
  >({ path, stateSchema: pollStateSchema });

  /** 投票は高頻度なので WebSocket 経由。結果は broadcast で返ってくる。 */
  const vote = useCallback(
    (optionId: number) => send({ type: "vote", optionId }),
    [send],
  );

  /** お題作成は確実性が要るので HTTP 経由。 */
  const setup = useCallback(
    async (labels: string[]) => {
      const res = await client.api.polls[":id"].$post({
        param: { id: pollId },
        json: { labels },
      });
      if (!res.ok) setError("お題の作成に失敗しました");
    },
    [pollId, setError],
  );

  /** 締切設定も HTTP 経由。 */
  const schedule = useCallback(
    async (closesInMs: number) => {
      const res = await client.api.polls[":id"].schedule.$post({
        param: { id: pollId },
        json: { closesInMs },
      });
      if (!res.ok) setError("締切の設定に失敗しました");
    },
    [pollId, setError],
  );

  return { state, status, error, vote, setup, schedule };
}
