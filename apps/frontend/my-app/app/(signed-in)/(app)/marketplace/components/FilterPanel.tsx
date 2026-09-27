import { Checkbox } from "@/components/ui/Checkbox";
import { Radio } from "@/components/ui/Radio";
import {
  DURATION_FILTERS,
  DURATION_LABELS,
  toggleSurveyType,
  type MarketplaceFilters,
} from "@/lib/marketplace/marketplace-query";

interface FilterPanelProps {
  /** Keeps ids unique: the panel renders in the desktop sidebar and the mobile dialog. */
  idPrefix: string;
  filters: MarketplaceFilters;
  onChange: (patch: Partial<MarketplaceFilters>) => void;
}

const LEGEND = "mb-3 text-[13px] font-bold uppercase tracking-[0.5px] text-ink-muted";

/** Figma 62:600–62:618: Loại khảo sát, Thời lượng, Ẩn khảo sát đã làm. */
export function FilterPanel({ idPrefix, filters, onChange }: FilterPanelProps) {
  return (
    <div className="flex flex-col gap-6.5">
      <fieldset>
        <legend className={LEGEND}>Loại khảo sát</legend>
        <div className="flex flex-col gap-4">
          <Checkbox
            id={`${idPrefix}-type-internal`}
            label="Trong Rescom"
            checked={filters.types.internal}
            onChange={() => onChange({ types: toggleSurveyType(filters.types, "internal") })}
          />
          <Checkbox
            id={`${idPrefix}-type-external`}
            label="Google Forms"
            checked={filters.types.external}
            onChange={() => onChange({ types: toggleSurveyType(filters.types, "external") })}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className={LEGEND}>Thời lượng</legend>
        <div className="flex flex-col gap-3">
          {DURATION_FILTERS.map((duration) => (
            <Radio
              key={duration}
              id={`${idPrefix}-duration-${duration}`}
              name={`${idPrefix}-duration`}
              label={DURATION_LABELS[duration]}
              checked={filters.duration === duration}
              onChange={() => onChange({ duration })}
            />
          ))}
        </div>
      </fieldset>

      <Checkbox
        id={`${idPrefix}-hide-completed`}
        label="Ẩn khảo sát đã làm"
        checked={filters.hideCompleted}
        onChange={(event) => onChange({ hideCompleted: event.target.checked })}
      />
    </div>
  );
}
