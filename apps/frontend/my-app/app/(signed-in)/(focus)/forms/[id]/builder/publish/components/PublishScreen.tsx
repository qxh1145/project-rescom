"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { MAX_PUBLISHABLE_DURATION_MINUTES, type Gender, type RewardBandDefinitionLike } from "@rescom/schemas";
import { Mascot } from "@/components/brand/Mascot";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconLink } from "@/components/ui/IconButton";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { hasIssues, summarizeDoc, validateForPublish } from "@/lib/forms/builder-blocks";
import { loadFormErrorMessage, PENDING_ATTENTION_BLOCKER, publishErrorMessage } from "@/lib/forms/builder-messages";
import { loadLocalDraft } from "@/lib/forms/builder-offline";
import {
  buildTargeting,
  estimateEscrow,
  FROZEN_REWARD_HINT,
  GENDER_LABELS,
  internalPriceHint,
  isValidDurationInput,
  PUBLISH_READINESS_NOTICE,
  publishReadiness,
  validatePublishSettings,
  type PublishReadiness,
  type PublishSettingsErrors,
} from "@/lib/forms/builder-publish";
import {
  docFromForm,
  getBuilderForm,
  getPricingQuote,
  publishBuilderForm,
  saveBuilderDraft,
  type BuilderForm,
  type PricingQuote,
} from "@/lib/forms/builder-service";
import { useSession } from "@/lib/session/SessionProvider";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { BuilderStepper } from "../../components/BuilderBits";

const GENDERS = Object.keys(GENDER_LABELS) as Gender[];

function pendingSuggestionCount(formId: string): number {
  try {
    return loadLocalDraft(window.localStorage, formId)?.pending.length ?? 0;
  } catch {
    return 0;
  }
}

function hasUnsavedLocalEdits(formId: string): boolean {
  try {
    return loadLocalDraft(window.localStorage, formId)?.dirty === true;
  } catch {
    return false;
  }
}

/**
 * Builder steps 2 "Đối tượng" and 3 "Số mẫu & điểm" → publish.
 * ASSUMED layout: Figma page 13 only draws step 1; these steps follow the
 * builder header and 13a's price hint. Publishing = `PATCH /forms/:id/draft`
 * (targeting, sample size, reward, duration) → `GET /forms/:id/pricing-quote`
 * → `POST /forms/:id/publish` (escrow reserved, status MODERATION_QUEUE).
 */
export function PublishScreen() {
  const { id: formId } = useParams<{ id: string }>();
  const router = useRouter();
  // Set by the builder's "Tiếp tục" after it validated and saved: never bounce back again.
  const checked = useSearchParams().get("checked") === "1";
  const { refresh, balance } = useSession();
  const [form, setForm] = useState<BuilderForm | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [limited, setLimited] = useState(false);
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [genders, setGenders] = useState<Gender[]>([]);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [values, setValues] = useState({ expectedCompletions: "", rewardPerResponse: "", estimatedDurationMinutes: "" });
  const [errors, setErrors] = useState<PublishSettingsErrors>({});
  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<unknown>(null);
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [published, setPublished] = useState<BuilderForm | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [notReady, setNotReady] = useState<Exclude<PublishReadiness, "ready"> | null>(null);
  const sessionLost = useSessionLossRedirect(loadError, publishError);

  useEffect(() => {
    const controller = new AbortController();
    getBuilderForm(formId, controller.signal)
      .then((loaded) => {
        const minutes = summarizeDoc(docFromForm(loaded).doc).minutes;
        setForm(loaded);
        setPendingCount(pendingSuggestionCount(formId));
        // C4: unsaved edits on this device or a definition that fails the publish rules go
        // back through the builder's "Tiếp tục" (validate + save) first.
        const readiness =
          loaded.status === "DRAFT"
            ? publishReadiness({ doc: docFromForm(loaded).doc, localDirty: hasUnsavedLocalEdits(formId) })
            : "ready";
        if (readiness !== "ready") {
          setNotReady(readiness);
          if (!checked) router.replace(`/forms/${formId}/builder?continue=1`);
        }
        setValues({
          expectedCompletions: String(loaded.expectedCompletions),
          rewardPerResponse: String(loaded.rewardPerResponse),
          estimatedDurationMinutes: String(loaded.estimatedDurationMinutes ?? minutes),
        });
        const targeting = (loaded.currentVersion.targetingJson ?? {}) as { ageRange?: { min: number; max: number }; genders?: Gender[] };
        if (targeting.ageRange || targeting.genders?.length) {
          setLimited(true);
          setAgeMin(targeting.ageRange ? String(targeting.ageRange.min) : "");
          setAgeMax(targeting.ageRange ? String(targeting.ageRange.max) : "");
          setGenders(targeting.genders ?? []);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error);
      });
    return () => controller.abort();
  }, [formId, checked, router]);

  if (sessionLost || (!form && !loadError)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-muted" role="status">
        <Spinner className="size-8 text-primary" />
        <span className="sr-only">Đang tải…</span>
      </div>
    );
  }
  if (!form) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-4 px-4">
        <Alert tone="danger">{loadFormErrorMessage(loadError)}</Alert>
        <Link href={`/forms/${formId}/builder`} className="text-label font-bold text-primary">
          Quay lại Form Builder
        </Link>
      </main>
    );
  }

  const doc = docFromForm(form).doc;
  const summary = summarizeDoc(doc);
  const parsedSettings = validatePublishSettings(values);
  const storedDefinition = form.currentVersion.schemaJson;
  // FR-14 price hint: an empty field still prices off the doc's own estimate (`summary.minutes`,
  // today's behaviour), but a non-empty out-of-range or non-numeric value ("0", "99999", "abc")
  // hides the hint instead of recomputing a price band for a duration that could never publish.
  const durationRaw = values.estimatedDurationMinutes;
  const durationInputValid = isValidDurationInput(durationRaw);
  const showDurationHint = durationRaw.trim() === "" || durationInputValid;
  const hint = internalPriceHint(
    durationInputValid ? Number(durationRaw) : summary.minutes,
    typeof storedDefinition === "object" && storedDefinition !== null ? (storedDefinition as RewardBandDefinitionLike) : null,
  );
  const escrow = parsedSettings.ok ? estimateEscrow(parsedSettings.value) : null;
  // A new version of a survey that already ran (Phiên bản → "Gửi duyệt vN"): the backend
  // (`coordinatePublish`) locks only the shortfall — open slots × draw minus the Escrow the
  // survey still holds — which no route exposes before publishing, so the full cost is an upper bound.
  const reversioned = form.currentVersion.versionNumber > 1;

  if (published) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[520px] flex-col items-center justify-center gap-4 px-4 text-center">
        <Mascot name="cheer" height={140} />
        <h1 className="text-title font-extrabold text-ink">Đã gửi duyệt</h1>
        <p className="text-body text-ink-muted">
          “{published.title}” đang chờ Admin duyệt.{" "}
          {escrow
            ? reversioned
              ? `Phần ký quỹ còn thiếu (tối đa ${escrow} điểm) đã chuyển vào Ký quỹ; `
              : `${escrow} điểm đã chuyển vào Ký quỹ; `
            : ""}
          nếu bị từ chối, điểm được hoàn lại.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={`/forms/${formId}`} className={buttonClassName({ size: "lg", radius: "field" })}>
            Xem khảo sát
          </Link>
          <Link href="/forms" className={buttonClassName({ variant: "secondary", size: "lg", radius: "field" })}>
            Về Khảo sát của tôi
          </Link>
        </div>
      </main>
    );
  }

  const goToSettings = () => {
    const targeting = buildTargeting({ limited, ageMin, ageMax, genders });
    if (!targeting.ok) {
      setTargetError(targeting.error);
      return;
    }
    setTargetError(null);
    setStep(2);
  };

  const submit = async () => {
    setPublishError(null);
    const settings = validatePublishSettings(values);
    const targeting = buildTargeting({ limited, ageMin, ageMax, genders });
    if (!settings.ok) {
      setErrors(settings.errors);
      return;
    }
    setErrors({});
    // C1 / P2: the publish rules on the saved definition with the chosen duration
    // (the settings schema already caps the duration at the reservation window).
    if (hasIssues(validateForPublish(doc, { estimatedDurationMinutes: settings.value.estimatedDurationMinutes }))) {
      setNotReady("invalid");
      return;
    }
    if (!targeting.ok) {
      setStep(1);
      setTargetError(targeting.error);
      return;
    }
    setBusy(true);
    try {
      const saved = await saveBuilderDraft(
        formId,
        {
          targetingJson: targeting.value,
          expectedCompletions: settings.value.expectedCompletions,
          // C3: a re-versioned draft keeps the published reward (409 FORM_PUBLISHED_FIELDS_IMMUTABLE).
          ...(reversioned ? {} : { rewardPerResponse: settings.value.rewardPerResponse }),
          estimatedDurationMinutes: settings.value.estimatedDurationMinutes,
        },
        form.updatedAt,
      );
      setForm(saved);
      const nextQuote = await getPricingQuote(formId);
      setQuote(nextQuote);
      if (nextQuote.bandCheck === "OUT_OF_BAND" && nextQuote.pricingBand) {
        setErrors({
          rewardPerResponse: `Với thời lượng này, điểm mỗi lượt cần từ ${nextQuote.pricingBand.min} đến ${nextQuote.pricingBand.max}.`,
        });
        return;
      }
      const result = await publishBuilderForm(formId, { estimatedDurationMinutes: settings.value.estimatedDurationMinutes });
      setPublished(result);
      refresh();
    } catch (error) {
      setPublishError(error);
    } finally {
      setBusy(false);
    }
  };

  const setValue = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="flex items-center gap-3 px-4 py-3 lg:h-17 lg:px-5 lg:py-0">
          <IconLink href={`/forms/${formId}/builder`} icon="chevron-left" label="Quay lại soạn form" />
          <div className="min-w-0 flex-1 lg:w-[380px] lg:flex-none">
            <p className="truncate text-body font-extrabold text-ink lg:text-lead">{form.title}</p>
            <p className="text-[12px] text-ink-muted">
              <span className="lg:hidden">Bước {step + 1}/3 · </span>
              {summary.questionCount} câu · khoảng {summary.minutes} phút
            </p>
          </div>
          <div className="hidden flex-1 justify-center lg:flex">
            <BuilderStepper current={step} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 py-6">
        {form.status !== "DRAFT" ? (
          <Alert tone="info">Khảo sát này đã được gửi duyệt.</Alert>
        ) : notReady ? (
          <Alert tone="danger">
            {PUBLISH_READINESS_NOTICE[notReady]}{" "}
            <Link href={`/forms/${formId}/builder?continue=1`} className="font-bold underline">
              Quay lại Form Builder
            </Link>
          </Alert>
        ) : pendingCount > 0 ? (
          <Alert tone="danger">
            {PENDING_ATTENTION_BLOCKER}{" "}
            <Link href={`/forms/${formId}/builder`} className="font-bold underline">
              Quay lại Form Builder
            </Link>
          </Alert>
        ) : null}

        {step === 1 ? (
          <section aria-labelledby="step-target" className="rounded-card border border-line bg-surface p-5 lg:p-6">
            <h1 id="step-target" className="text-title-sm font-extrabold text-ink">
              Ai sẽ làm khảo sát?
            </h1>
            <p className="mt-1.5 text-body-sm text-ink-muted">Khảo sát chỉ hiện ở Khám phá cho người phù hợp với đối tượng bạn chọn.</p>
            <fieldset className="mt-4 flex flex-col gap-2.5">
              <legend className="sr-only">Phạm vi đối tượng</legend>
              {[
                [false, "Mọi người dùng Rescom", "Nhanh đủ mẫu nhất."],
                [true, "Giới hạn theo độ tuổi, giới tính", "Ít người phù hợp hơn nên có thể lâu đủ mẫu."],
              ].map(([value, label, hintText]) => (
                <label
                  key={String(value)}
                  className={`flex cursor-pointer items-start gap-3 rounded-[14px] border p-4 ${
                    limited === value ? "border-primary bg-tone-green-tint" : "border-line"
                  }`}
                >
                  <input
                    type="radio"
                    name="target-scope"
                    checked={limited === value}
                    onChange={() => setLimited(value as boolean)}
                    className="mt-1 size-4.5 accent-primary"
                  />
                  <span>
                    <span className="block text-body font-bold text-ink">{label as string}</span>
                    <span className="block text-caption text-ink-muted">{hintText as string}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {limited ? (
              <div className="mt-4 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <TextField id="age-min" label="Tuổi từ" inputMode="numeric" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder="13" />
                  <TextField id="age-max" label="Đến" inputMode="numeric" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder="100" />
                </div>
                <fieldset>
                  <legend className="text-label font-semibold text-ink">Giới tính (bỏ trống = tất cả)</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {GENDERS.map((gender) => {
                      const on = genders.includes(gender);
                      return (
                        <button
                          key={gender}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setGenders((current) => (on ? current.filter((g) => g !== gender) : [...current, gender]))}
                          className={`h-10 rounded-full border px-4 text-body-sm font-semibold ${
                            on ? "border-primary bg-tone-green-bg text-tone-green-fg" : "border-line-strong text-ink"
                          }`}
                        >
                          {GENDER_LABELS[gender]}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
            ) : null}
            {targetError ? (
              <p role="alert" className="mt-3 text-caption text-danger">
                {targetError}
              </p>
            ) : null}
            <Button fullWidth size="lg" radius="field" className="mt-5 gap-2" onClick={goToSettings}>
              Tiếp tục: số mẫu & điểm
              <Icon name="arrow-right" size={18} />
            </Button>
          </section>
        ) : (
          <section aria-labelledby="step-price" className="rounded-card border border-line bg-surface p-5 lg:p-6">
            <h1 id="step-price" className="text-title-sm font-extrabold text-ink">
              Số mẫu & điểm thưởng
            </h1>
            {showDurationHint ? (
              <>
                <p className="mt-1.5 text-body-sm text-ink-muted">
                  Giá gợi ý <b className="text-tone-green-fg">{hint.label}</b> cho khoảng {durationRaw || summary.minutes} phút — người làm nhận đủ số điểm này.
                </p>
                <p className="mt-0.5 text-body-sm text-ink-muted">
                  Nhờ ưu đãi form tạo trong Rescom, <b className="text-ink">{hint.paidLabel}</b> (rẻ hơn 20% so với Google Forms).
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-body-sm text-ink-muted">Nhập thời lượng từ 1–{MAX_PUBLISHABLE_DURATION_MINUTES} phút để xem giá gợi ý.</p>
            )}
            <div className="mt-4 flex flex-col gap-4">
              <TextField id="pub-completions" label="Số mẫu cần thu" inputMode="numeric" value={values.expectedCompletions} onChange={setValue("expectedCompletions")} error={errors.expectedCompletions} />
              <TextField
                id="pub-reward"
                label="Điểm thưởng mỗi lượt"
                inputMode="numeric"
                value={values.rewardPerResponse}
                onChange={setValue("rewardPerResponse")}
                error={errors.rewardPerResponse}
                disabled={reversioned}
                hint={reversioned ? FROZEN_REWARD_HINT : "Người làm nhận đủ số điểm này; bạn trả 80% nhờ ưu đãi form tạo trong Rescom."}
              />
              <TextField
                id="pub-duration"
                label="Thời lượng dự kiến (phút)"
                inputMode="numeric"
                min={1}
                max={MAX_PUBLISHABLE_DURATION_MINUTES}
                value={values.estimatedDurationMinutes}
                onChange={setValue("estimatedDurationMinutes")}
                error={errors.estimatedDurationMinutes}
              />
            </div>
            <dl className="mt-5 flex flex-col gap-2 rounded-[14px] bg-surface-muted p-4 text-body-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">{reversioned ? "Ký quỹ tối đa" : "Ký quỹ dự kiến"}</dt>
                <dd className="font-bold text-ink">{escrow !== null ? `${escrow} điểm` : "—"}</dd>
              </div>
              {reversioned ? (
                <p className="text-[12px] text-ink-muted">
                  Phiên bản mới chỉ khoá phần còn thiếu: số lượt còn trống × điểm mỗi lượt, trừ số điểm khảo sát đang giữ
                  trong ký quỹ.
                </p>
              ) : null}
              {quote ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Báo giá từ máy chủ</dt>
                  <dd className="font-bold text-ink">{quote.effectiveCost} điểm (giảm {quote.discountAmount})</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-ink-muted">Điểm khả dụng của bạn</dt>
                <dd className="font-bold text-ink">{balance ? `${balance.available} điểm` : "—"}</dd>
              </div>
            </dl>
            {balance && escrow !== null && escrow > balance.available ? (
              <p className="mt-3 text-caption text-danger">
                {reversioned ? "Số điểm khả dụng có thể chưa đủ để ký quỹ." : "Số điểm khả dụng chưa đủ để ký quỹ."}{" "}
                <Link href="/wallet/top-up" className="font-bold underline">
                  Nạp thêm điểm
                </Link>
              </p>
            ) : null}
            {publishError ? (
              <Alert tone="danger" className="mt-4">
                {publishErrorMessage(publishError)}
              </Alert>
            ) : null}
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" size="lg" radius="field" onClick={() => setStep(1)}>
                Quay lại
              </Button>
              <Button
                size="lg"
                radius="field"
                className="flex-1"
                loading={busy}
                loadingLabel="Đang gửi duyệt…"
                disabled={form.status !== "DRAFT" || pendingCount > 0 || notReady !== null}
                onClick={() => void submit()}
              >
                Gửi duyệt
              </Button>
            </div>
            <p className="mt-3 text-caption text-ink-muted">
              Sau khi gửi duyệt, muốn sửa sẽ tạo phiên bản mới; câu trả lời cũ vẫn gắn với phiên bản cũ.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
