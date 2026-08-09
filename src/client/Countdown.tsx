import { useEffect, useState } from "react";

type Props = {
  closesAt: number | null;
  closed: boolean;
};

/**
 * 残り時間の表示。
 * 締切そのものはサーバー側の Alarm が握っているので、
 * ここはあくまで見た目。0 になっても勝手に締め切らない。
 */
export function Countdown({ closesAt, closed }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (closed || closesAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [closed, closesAt]);

  if (closed) return <p className="countdown closed">締め切られました</p>;
  if (closesAt === null) return <p className="countdown">締切なし</p>;

  const remain = Math.max(0, closesAt - now);
  return <p className="countdown">残り {(remain / 1000).toFixed(1)} 秒</p>;
}
