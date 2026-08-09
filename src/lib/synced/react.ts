import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { serverEnvelope } from "./protocol";

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

type Options<TState> = {
  /** 購読する WebSocket のパス。例: "/api/polls/lunch/ws" */
  path: string;
  /** サーバーが送ってくる状態の形。モジュールレベルの定数を渡すこと。 */
  stateSchema: z.ZodType<TState>;
};

const MAX_BACKOFF_MS = 15_000;

/**
 * サーバー側の 1 オブジェクトを購読し、その状態を鏡のように保つ。
 *
 * ここが担うのは輸送だけ。
 *   - 接続のライフサイクル（切れたら指数バックオフで再接続）
 *   - 受信メッセージの検証
 *   - コマンドの送信
 *
 * アプリ固有の語彙（vote とか）は一切知らない。
 */
export function useSyncedObject<TState, TCommand>({
  path,
  stateSchema,
}: Options<TState>) {
  const [state, setState] = useState<TState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const envelope = useMemo(() => serverEnvelope(stateSchema), [stateSchema]);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${proto}//${location.host}${path}`);
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setStatus("open");
      };

      socket.onmessage = (event) => {
        // サーバー側が zod で守っているのと同じ強さで受信側も守る。
        // 片側だけ固めると、そこが穴になる。
        const parsed = envelope.safeParse(safeJsonParse(event.data));
        if (!parsed.success) {
          setError("サーバーから不正なメッセージが届きました");
          return;
        }
        if (parsed.data.type === "state") {
          setState(parsed.data.state as TState);
          setError(null);
        } else {
          setError(parsed.data.message);
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        setStatus("reconnecting");
        // 切断は日常的に起きる。指数バックオフで繋ぎ直す。
        const delay = Math.min(500 * 2 ** attempt++, MAX_BACKOFF_MS);
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, [path, envelope]);

  const send = useCallback((command: TCommand) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) {
      setError("接続していないため送信できませんでした");
      return;
    }
    socket.send(JSON.stringify(command));
  }, []);

  return { state, status, error, send, setError };
}

function safeJsonParse(text: unknown): unknown {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
