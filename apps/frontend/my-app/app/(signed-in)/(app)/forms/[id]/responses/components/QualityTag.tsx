import { Icon } from "@/components/ui/Icon";
import { Tag } from "@/components/ui/Tag";
import type { ResponseQuality } from "@/lib/forms/results-service";

/** Per-response quality pill (Figma 10d): teal "Đạt" / amber flag "Cần xem lại". */
export function QualityTag({ quality, withCheck = false }: { quality: ResponseQuality; withCheck?: boolean }) {
  if (quality === "NEEDS_REVIEW") {
    return (
      <Tag tone="amber" icon={<Icon name="flag" size={13} />}>
        Cần xem lại
      </Tag>
    );
  }
  return (
    <Tag tone="teal" icon={withCheck ? <Icon name="check" size={13} /> : undefined}>
      Đạt
    </Tag>
  );
}
