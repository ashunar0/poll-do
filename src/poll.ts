import { SyncedObject } from "./lib/synced/server";
import type { CommandResult } from "./lib/synced/protocol";
import {
  pollCommandSchema,
  type Option,
  type PollCommand,
  type PollState,
} from "./schema";

/**
 * 投票の結果。
 *
 * 想定内の失敗を例外で返してはいけない。DO の RPC はプロセス境界を越えるため、
 * 例外はシリアライズされて向こう側でただの Error に作り直される。
 * つまり呼び出し側の instanceof が効かない。
 * プレーンなオブジェクトなら境界を無事に越えられる。
 */
export type VoteResult =
  | { ok: true; state: PollState }
  | { ok: false; reason: "option_not_found" | "closed" };

/**
 * 1 つのお題 = 1 つの Poll インスタンス。
 * getByName("お題ID") で呼び出すたび、必ず同じインスタンスに繋がる。
 *
 * WebSocket まわりは SyncedObject が持っている。ここにあるのは
 * 「投票とは何か」だけ。
 */
export class Poll extends SyncedObject<PollState, PollCommand> {
  protected readonly commandSchema = pollCommandSchema;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // スキーマ作成は初期化時に一度だけ。
    // blockConcurrencyWhile はこの間の全リクエストを待たせるので、
    // 使っていいのは constructor での初期化だけ。
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS options (
          id    INTEGER PRIMARY KEY,
          label TEXT    NOT NULL,
          votes INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS meta (
          id        INTEGER PRIMARY KEY CHECK (id = 1),
          closes_at INTEGER,
          closed    INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO meta (id) VALUES (1);
      `);
    });
  }

  // ---------------------------------------------------------------- RPC

  /** お題の選択肢を登録する。public メソッドがそのまま RPC になる。 */
  async setup(labels: string[]): Promise<PollState> {
    // await を挟まない連続書き込みは 1 つのトランザクションにまとまる
    this.ctx.storage.sql.exec("DELETE FROM options");
    // id は「何番目の選択肢か」でしかないので明示的に振る。
    // AUTOINCREMENT に任せると、作り直したとき採番が 1 に戻らずズレる。
    labels.forEach((label, i) => {
      this.ctx.storage.sql.exec(
        "INSERT INTO options (id, label) VALUES (?, ?)",
        i + 1,
        label,
      );
    });
    this.ctx.storage.sql.exec("UPDATE meta SET closed = 0 WHERE id = 1");

    this.broadcast();
    return this.readState();
  }

  /**
   * 締切を設定する。
   *
   * Alarm は 1 つの DO につき 1 つだけで、setAlarm は既存の予約を上書きする。
   * cron と違い「お題ごと」に持てるのが利点で、
   * 全お題を定期スキャンして期限切れを探す、という処理が要らない。
   */
  async schedule(closesInMs: number): Promise<PollState> {
    const closesAt = Date.now() + closesInMs;
    this.ctx.storage.sql.exec(
      "UPDATE meta SET closes_at = ?, closed = 0 WHERE id = 1",
      closesAt,
    );
    await this.ctx.storage.setAlarm(closesAt);

    this.broadcast();
    return this.readState();
  }

  /**
   * 投票する。
   * このインスタンスへのリクエストは直列に処理されるので、
   * 同時に 100 人が押しても数はズレない。ロックを書く必要がない。
   *
   * 「締切済みか」「実在する選択肢か」の検証はここで行う。
   * 入口（HTTP / WebSocket）がいくつ増えても、
   * この 1 箇所を通る限り不正な票は入らない。
   */
  async vote(optionId: number): Promise<VoteResult> {
    if (this.readState().closed) {
      return { ok: false, reason: "closed" };
    }

    const cursor = this.ctx.storage.sql.exec(
      "UPDATE options SET votes = votes + 1 WHERE id = ?",
      optionId,
    );
    if (cursor.rowsWritten === 0) {
      return { ok: false, reason: "option_not_found" };
    }

    this.broadcast();
    return { ok: true, state: this.readState() };
  }

  /** 現在の状態を返す。 */
  async state(): Promise<PollState> {
    return this.readState();
  }

  // -------------------------------------------------------------- Alarm

  /**
   * 締切時刻に Cloudflare が呼ぶ。
   * 失敗すると自動でリトライされるので、何度呼ばれても同じ結果になるよう書く。
   */
  override async alarm(): Promise<void> {
    this.ctx.storage.sql.exec("UPDATE meta SET closed = 1 WHERE id = 1");
    this.broadcast();
  }

  // ------------------------------------------------ SyncedObject への実装

  /** WebSocket から届いたコマンドを、この DO の語彙に流し込む。 */
  protected async handle(command: PollCommand): Promise<CommandResult> {
    const result = await this.vote(command.optionId);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }

  /** SQL API は同期なので、そのまま値を返せる。 */
  protected readState(): PollState {
    const options = this.ctx.storage.sql
      .exec<Option>("SELECT id, label, votes FROM options ORDER BY id")
      .toArray();

    const meta = this.ctx.storage.sql
      .exec<{ closes_at: number | null; closed: number }>(
        "SELECT closes_at, closed FROM meta WHERE id = 1",
      )
      .one();

    return {
      options,
      closesAt: meta.closes_at,
      closed: meta.closed === 1,
    };
  }
}
