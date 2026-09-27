import { ToggleChip } from "@/components/ui/ToggleChip";

interface ChipsAnswerProps {
  labelledBy: string;
  errorId?: string;
  options: readonly string[];
  value: readonly string[];
  onChange: (value: string[]) => void;
}

/** 12.10 Sở thích (63:74): 44px multi-select chips, wrapped with 8px gaps. */
export function ChipsAnswer({ labelledBy, errorId, options, value, onChange }: ChipsAnswerProps) {
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={errorId} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = value.includes(option);
        return (
          <ToggleChip
            key={option}
            size="lg"
            selected={selected}
            onSelectedChange={(next) =>
              onChange(next ? [...value, option] : value.filter((item) => item !== option))
            }
          >
            {option}
          </ToggleChip>
        );
      })}
    </div>
  );
}
