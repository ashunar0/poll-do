import { useState } from "react";
import { usePoll } from "./usePoll";
import { Results } from "./Results";
import { Countdown } from "./Countdown";

const DEFAULT_LABELS = ["ラーメン", "カレー", "寿司"];

export function App() {
  // URL の ?id= でお題を切り替えられる。別 id = 別 Durable Object。
  const [pollId] = useState(
    () => new URLSearchParams(location.search).get("id") ?? "lunch",
  );
  const { state, status, error, vote, setup, schedule } = usePoll(pollId);

  const handleSetup = () => setup(DEFAULT_LABELS);
  const handleSchedule = () => schedule(30_000);

  return (
    <main>
      <header>
        <h1>{pollId}</h1>
        <span data-status={status}>{status}</span>
      </header>

      {state && state.options.length === 0 && (
        <p className="empty">
          まだお題がありません。
          <button onClick={handleSetup}>お題を作る</button>
        </p>
      )}

      {state && state.options.length > 0 && (
        <>
          <Countdown closesAt={state.closesAt} closed={state.closed} />
          <Results
            options={state.options}
            disabled={state.closed || status !== "open"}
            onVote={vote}
          />
          <footer>
            <button onClick={handleSchedule} disabled={state.closed}>
              30秒後に締め切る
            </button>
            <button onClick={handleSetup}>作り直す</button>
          </footer>
        </>
      )}

      {error && <p className="error">{error}</p>}

      <p className="hint">
        このページを複数タブで開くと、票がリアルタイムで同期します。
        <br />
        <code>?id=dinner</code> を付けると別の Durable Object になります。
      </p>
    </main>
  );
}
