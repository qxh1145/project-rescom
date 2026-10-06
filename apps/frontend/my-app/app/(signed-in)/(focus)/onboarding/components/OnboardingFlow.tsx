"use client";

import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import {
  FIELDS_OF_STUDY,
  DANANG_UNIVERSITY_OPTIONS,
  ONBOARDING_GENDER_OPTIONS,
  INCOME_RANGES,
  INTEREST_OPTIONS,
  OCCUPATIONS,
  SCHOOL_YEAR_OPTIONS,
  VIETNAM_LOCATIONS,
  withSavedOption,
  withSavedOptions,
} from "@/lib/demographic-options";
import {
  checkBirthYear,
  firstInvalidStep,
  GOAL_LABELS,
  MIN_INTERESTS,
  profileSummary,
  type OnboardingGoal,
} from "@/lib/onboarding/onboarding-answers";
import { ONBOARDING_MESSAGES } from "@/lib/onboarding/onboarding-messages";
import { stepPosition, visibleSteps, type QuestionStep } from "@/lib/onboarding/onboarding-steps";
import type { Gender } from "@rescom/schemas";
import { useOnboardingFlow, type OnboardingFlow as Flow } from "../hooks/use-onboarding-flow";
import { ChipsAnswer } from "./answers/ChipsAnswer";
import { ChoiceAnswer, type ChoiceOption } from "./answers/ChoiceAnswer";
import { SearchableChoice } from "./answers/SearchableChoice";
import { TextAnswer } from "./answers/TextAnswer";
import { YearAnswer } from "./answers/YearAnswer";
import { DoneScreen } from "./DoneScreen";
import { errorIdFor, StepLayout, type StepHint } from "./StepLayout";
import { WelcomeScreen } from "./WelcomeScreen";

/** Figma page 12 copy: question title + helper per screen. */
const QUESTIONS: Record<QuestionStep, { title: string; helper?: string }> = {
  name: {
    title: "Rescom nên gọi bạn là gì?",
    helper: "Lấy từ tài khoản Google, bạn có thể sửa. Người đăng khảo sát không thấy tên bạn.",
  },
  "birth-year": {
    title: "Bạn sinh năm nào?",
    helper: "Dùng để tính độ tuổi khi ghép khảo sát. Không hiển thị công khai.",
  },
  gender: {
    title: "Giới tính của bạn?",
    helper: "Một số khảo sát chỉ dành cho một nhóm giới tính. Bạn có thể chọn không chia sẻ.",
  },
  location: { title: "Bạn đang sống ở đâu?" },
  occupation: {
    title: "Hiện tại bạn đang là…",
    helper: "Nếu không phải sinh viên hay học viên, bạn sẽ bỏ qua câu về trường và năm học.",
  },
  school: { title: "Bạn đang học trường nào?" },
  "school-year": { title: "Bạn đang học năm mấy?" },
  field: { title: "Ngành học của bạn?" },
  income: {
    title: "Thu nhập hộ gia đình mỗi tháng?",
    helper: "Chỉ dùng thống kê chung, không bắt buộc chia sẻ con số thật.",
  },
  interests: {
    title: "Bạn quan tâm chủ đề nào?",
    helper: `Chọn ít nhất ${MIN_INTERESTS} để Rescom gợi ý khảo sát hợp với bạn.`,
  },
  goal: {
    title: "Bạn đến Rescom để làm gì?",
    helper: "Chỉ để gợi ý bước tiếp theo. Bạn vẫn dùng được mọi tính năng.",
  },
};

const toOptions = (values: readonly string[]): ChoiceOption[] => values.map((value) => ({ value, label: value }));

function GoalTile({ icon, className }: { icon: string; className: string }) {
  return (
    <span className={`flex size-11 shrink-0 items-center justify-center rounded-field ${className}`}>
      <Icon name={icon} size={22} />
    </span>
  );
}

/** 12.11 (62:3122): icon tiles from Figma — file-text (green), bar-chart (teal), arrows-swap (amber). */
const GOAL_OPTIONS: ChoiceOption[] = [
  {
    value: "EARN",
    label: GOAL_LABELS.EARN,
    description: "Giúp bạn bè và nhận điểm cho mỗi lượt hợp lệ.",
    tile: <GoalTile icon="file-text" className="bg-tone-green-bg text-tone-green-fg" />,
  },
  {
    value: "COLLECT",
    label: GOAL_LABELS.COLLECT,
    description: "Đăng khảo sát cho đồ án, luận văn của bạn.",
    tile: <GoalTile icon="bar-chart" className="bg-tone-teal-bg text-tone-teal-fg" />,
  },
  {
    value: "BOTH",
    label: GOAL_LABELS.BOTH,
    description: "Tích điểm trước, rồi dùng cho khảo sát của mình.",
    tile: <GoalTile icon="arrows-swap" className="bg-tone-amber-bg text-tone-amber-fg" />,
  },
];

function QuestionScreen({ step, flow }: { step: QuestionStep; flow: Flow }) {
  const { answers, setAnswers, error, currentYear } = flow;
  const titleId = `onboarding-${step}-title`;
  const errorId = error ? errorIdFor(titleId) : undefined;
  const { title, helper } = QUESTIONS[step];
  let hint: StepHint | undefined;
  let content: ReactNode;

  switch (step) {
    case "name":
      content = (
        <TextAnswer
          id="onboarding-name"
          label="Tên hiển thị"
          value={answers.displayName}
          onValueChange={(displayName) => setAnswers({ displayName })}
          errorId={errorId}
          autoComplete="name"
          maxLength={60}
        />
      );
      break;
    case "birth-year": {
      const check = checkBirthYear(answers.birthYear, currentYear);
      content = (
        <YearAnswer
          id="onboarding-birth-year"
          label="Năm sinh"
          value={answers.birthYear}
          onValueChange={(birthYear) => setAnswers({ birthYear })}
          age={check.ok ? check.age : null}
          errorId={errorId}
        />
      );
      break;
    }
    case "gender":
      content = (
        <ChoiceAnswer
          name="onboarding-gender"
          labelledBy={titleId}
          errorId={errorId}
          options={ONBOARDING_GENDER_OPTIONS}
          value={answers.gender}
          onChange={(gender) => setAnswers({ gender: gender as Gender })}
        />
      );
      break;
    case "location":
      content = (
        <select
          id="onboarding-location"
          aria-labelledby={titleId}
          aria-describedby={errorId}
          aria-invalid={errorId ? true : undefined}
          value={answers.location ?? ""}
          onChange={(event) => setAnswers({ location: event.target.value })}
          className="h-14 w-full rounded-control border border-line-strong bg-surface px-4 text-button text-ink focus:border-primary focus:outline-none"
        >
          <option value="" disabled>Chọn tỉnh/thành phố</option>
          {withSavedOption(VIETNAM_LOCATIONS, answers.location).map((location) => (
            <option key={location} value={location}>{location}</option>
          ))}
        </select>
      );
      break;
    case "occupation":
      content = (
        <ChoiceAnswer
          name="onboarding-occupation"
          labelledBy={titleId}
          errorId={errorId}
          options={toOptions(withSavedOption(OCCUPATIONS, answers.occupation))}
          value={answers.occupation}
          onChange={(occupation) => setAnswers({ occupation })}
        />
      );
      break;
    case "school":
      content = (
        <SearchableChoice
          name="onboarding-school"
          labelledBy={titleId}
          errorId={errorId}
          catalog={DANANG_UNIVERSITY_OPTIONS}
          popular={DANANG_UNIVERSITY_OPTIONS}
          value={answers.school}
          onChange={(school) => setAnswers({ school })}
          searchLabel="Tìm trường"
          layout="list"
          custom={{
            linkLabel: "Không thấy trường của bạn? Nhập tên trường",
            inputLabel: "Tên trường",
            placeholder: "Ví dụ: Trường Đại học Duy Tân",
          }}
        />
      );
      break;
    case "school-year":
      content = (
        <ChoiceAnswer
          name="onboarding-school-year"
          labelledBy={titleId}
          errorId={errorId}
          options={SCHOOL_YEAR_OPTIONS}
          value={answers.schoolYear}
          onChange={(schoolYear) => setAnswers({ schoolYear })}
          layout="row"
        />
      );
      break;
    case "field":
      content = (
        <ChoiceAnswer
          name="onboarding-field"
          labelledBy={titleId}
          errorId={errorId}
          options={toOptions(withSavedOption(FIELDS_OF_STUDY, answers.fieldOfStudy))}
          value={answers.fieldOfStudy}
          onChange={(fieldOfStudy) => setAnswers({ fieldOfStudy })}
        />
      );
      break;
    case "income":
      content = (
        <ChoiceAnswer
          name="onboarding-income"
          labelledBy={titleId}
          errorId={errorId}
          options={toOptions(withSavedOption(INCOME_RANGES, answers.householdIncome))}
          value={answers.householdIncome}
          onChange={(householdIncome) => setAnswers({ householdIncome })}
        />
      );
      break;
    case "interests":
      hint = {
        text: `Đã chọn ${answers.interests.length} · tối thiểu ${MIN_INTERESTS}`,
        tone: error ? "danger" : "muted",
      };
      content = (
        <ChipsAnswer
          labelledBy={titleId}
          errorId={errorId}
          options={withSavedOptions(INTEREST_OPTIONS, answers.interests)}
          value={answers.interests}
          onChange={(interests) => setAnswers({ interests })}
        />
      );
      break;
    case "goal":
      content = (
        <ChoiceAnswer
          name="onboarding-goal"
          labelledBy={titleId}
          errorId={errorId}
          options={GOAL_OPTIONS}
          value={answers.goal}
          onChange={(goal) => setAnswers({ goal: goal as OnboardingGoal })}
          layout="rich"
        />
      );
      break;
  }

  return (
    <StepLayout
      stepKey={step}
      position={stepPosition(step, answers)}
      title={title}
      titleId={titleId}
      helper={helper}
      error={error}
      onBack={flow.back}
      onSubmit={flow.next}
      submitLabel={step === "goal" ? "Hoàn tất" : "Tiếp tục"}
      submitting={flow.submitting}
      hint={hint}
    >
      {content}
    </StepLayout>
  );
}

function FlowStatus({ flow }: { flow: Flow }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-5 lg:bg-surface-muted">
      {flow.loadError && !flow.redirecting ? (
        <div className="flex w-full max-w-110 flex-col gap-4">
          <Alert tone="danger">{ONBOARDING_MESSAGES.loadFailed}</Alert>
          <Button variant="secondary" size="lg" onClick={flow.reload}>
            Thử lại
          </Button>
        </div>
      ) : (
        <p role="status" className="flex items-center gap-3 text-body text-ink-muted">
          <Spinner className="size-5 text-primary" />
          Đang tải hồ sơ của bạn…
        </p>
      )}
    </main>
  );
}

/** `/onboarding` — Figma page 12 "Onboarding mới – mỗi màn 1 câu, 4 phần" (55:14). */
export function OnboardingFlow() {
  const flow = useOnboardingFlow();
  const { step, answers } = flow;

  if (flow.redirecting || !flow.ready) return <FlowStatus flow={flow} />;

  if (step === "welcome") {
    return (
      <WelcomeScreen
        name={flow.greetingName}
        questionCount={visibleSteps(answers).length}
        startHref={flow.stepHref(firstInvalidStep(answers, flow.currentYear) ?? "name")}
        required={flow.required}
      />
    );
  }

  if (step === "done") {
    return (
      <DoneScreen
        name={flow.greetingName}
        goal={answers.goal}
        nextStep={flow.nextStep}
        continueHref={flow.continueHref}
        editHref={flow.stepHref("name")}
        summary={profileSummary(answers, flow.currentYear)}
        onLeave={flow.finish}
        profileWarning={flow.profileWarning}
        profileRetrying={flow.profileRetrying}
        onRetryProfile={() => void flow.retryProfile()}
        onFixProfile={flow.fixProfile}
      />
    );
  }

  // `key`: each question starts with fresh local state (search box, focus).
  return <QuestionScreen key={step} step={step} flow={flow} />;
}
