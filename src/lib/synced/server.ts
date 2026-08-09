import { DurableObject } from "cloudflare:workers";
import type { z } from "zod";
import type { CommandResult } from "./protocol";

/**
 * 「状態をひとつ持ち、繋がっている全員に配る」Durable Object の土台。
 *
 * ここが担うのは輸送だけ。
 *   - WebSocket の受付と Hibernation 対応
 *   - 受信メッセージの検証とディスパッチ
 *   - 接続中の全員への配信
 *
 * アプリ固有のこと（どんな状態か、どんなコマンドがあるか）は一切知らない。
 * だから投票にも、チャットにも、共同編集にもそのまま載る。
 */
export abstract class SyncedObject<
  TState,
  TCommand,
> extends DurableObject<Env> {
  /** クライアントから受け取るコマンドの形。 */
  protected abstract readonly commandSchema: z.ZodType<TCommand>;

  /** 今の状態を組み立てる。SQL API は同期なので戻り値も同期でよい。 */
  protected abstract readState(): TState;

  /**
   * コマンドを 1 件処理する。
   *
   * 状態が変わったら実装側で broadcast() を呼ぶ。
   * 土台が勝手に配信しないのは、HTTP など WebSocket 以外の入口から
   * 状態が変わることもあり、配信の判断は意味を知っている側にしか
   * できないため。
   */
  protected abstract handle(command: TCommand): Promise<CommandResult>;

  // ------------------------------------------------------------ WebSocket

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    // acceptWebSocket で渡すと Hibernation 対象になり、
    // アイドル中は DO がメモリから落ちても接続は維持される。
    this.ctx.acceptWebSocket(server);

    // 繋いだ直後に今の状態を 1 回送る
    server.send(this.stateMessage());

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") {
      return this.sendError(ws, "binary message is not supported");
    }

    const parsed = this.commandSchema.safeParse(safeJsonParse(message));
    if (!parsed.success) {
      return this.sendError(
        ws,
        parsed.error.issues[0]?.message ?? "invalid message",
      );
    }

    const result = await this.handle(parsed.data);
    if (!result.ok) this.sendError(ws, result.reason);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // 1006（異常終了）はそのまま返すと例外になるので 1000 に丸める
    ws.close(code === 1006 ? 1000 : code, "closed");
  }

  // -------------------------------------------------------------- 配信

  /** 接続中の全員に最新の状態を配る。 */
  protected broadcast(): void {
    const payload = this.stateMessage();
    for (const ws of this.ctx.getWebSockets()) {
      ws.send(payload);
    }
  }

  /** WebSocket は投げっぱなしなので、エラーは明示的に返す。 */
  protected sendError(ws: WebSocket, message: string): void {
    ws.send(JSON.stringify({ type: "error", message }));
  }

  private stateMessage(): string {
    return JSON.stringify({ type: "state", state: this.readState() });
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
