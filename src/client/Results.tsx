import type { Option } from "../schema";

type Props = {
  options: Option[];
  disabled: boolean;
  onVote: (optionId: number) => void;
};

export function Results({ options, disabled, onVote }: Props) {
  const total = options.reduce((sum, o) => sum + o.votes, 0);

  return (
    <ul className="results">
      {options.map((option) => {
        const ratio = total === 0 ? 0 : option.votes / total;
        const handleClick = () => onVote(option.id);

        return (
          <li key={option.id}>
            <button onClick={handleClick} disabled={disabled}>
              <span className="bar" style={{ width: `${ratio * 100}%` }} />
              <span className="label">{option.label}</span>
              <span className="votes">{option.votes}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
