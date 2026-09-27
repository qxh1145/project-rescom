import Link from "next/link";
import { ErrorScreen, errorActionClassName } from "./ErrorScreen";
import { SurveySummaryCard } from "./ErrorScreenSlots";

interface SurveyFullScreenProps {
  /** Omitted when the survey summary could not be loaded: the card is then left out. */
  survey?: {
    title: string;
    responseCount: number;
    responseQuota: number;
  };
}

/** Figma 18.7 "Khảo sát đã đủ người" — desktop 63:6252, mobile 63:6287. */
export function SurveyFullScreen({ survey }: SurveyFullScreenProps) {
  return (
    <ErrorScreen
      pill="Khảo sát đã đóng"
      title="Khảo sát này vừa đủ người"
      description="Người đăng đã nhận đủ câu trả lời nên khảo sát tự đóng. Bạn chưa bắt đầu nên không mất gì cả."
      mascot="surprise"
      extra={
        survey ? (
          <SurveySummaryCard
            title={survey.title}
            meta={`${survey.responseCount}/${survey.responseQuota} câu trả lời · đã ẩn khỏi Khám phá`}
          />
        ) : undefined
      }
      actions={
        <Link href="/marketplace" className={errorActionClassName("primary")}>
          Xem khảo sát khác
        </Link>
      }
    />
  );
}
