"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useSession } from "@/lib/session/SessionProvider";
import {
  TOP_UP_MIN_POINTS,
  TOP_UP_PACKAGES,
  TOP_UP_STEP_POINTS,
  checkTopUpPoints,
  formatPoints,
  formatVnd,
  topUpVnd,
} from "@/lib/wallet/top-up";
import { useCreateTopUp } from "../hooks/use-create-top-up";
import { PackageOptions } from "./PackageOptions";
import { TopUpFrame } from "./TopUpFrame";

const FORM_ID = "top-up-choose-form";

const RULES = [
  `Tối thiểu ${TOP_UP_MIN_POINTS} điểm (${formatVnd(topUpVnd(TOP_UP_MIN_POINTS))}).`,
  "Nạp là một chiều: điểm không đổi lại thành tiền và không chuyển cho tài khoản khác.",
  "Admin đối chiếu chuyển khoản thủ công trước khi cộng điểm.",
];

/**
 * Figma 14a "Nạp điểm · chọn gói" (62:2806, mobile only). Desktop is derived
 * from the 14b dialog (ASSUMED): same content in a 600px card, CTA in the
 * card footer.
 */
export function ChoosePackageScreen() {
  const { balance } = useSession();
  const [selected, setSelected] = useState<number | null>(TOP_UP_PACKAGES[0]);
  const [custom, setCustom] = useState("");
  const [touched, setTouched] = useState(false);
  const { create, submitting, error, resumeHref } = useCreateTopUp();

  const customCheck = custom.trim() ? checkTopUpPoints(custom) : null;
  const points = customCheck ? (customCheck.ok ? customCheck.points : null) : selected;
  const customError = customCheck && !customCheck.ok && touched ? customCheck.message : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (points !== null) void create(points);
  }

  const cta = (
    <Button type="submit" form={FORM_ID} size="lg" radius="field" fullWidth loading={submitting} loadingLabel="Đang tạo yêu cầu…">
      Tiếp tục: thông tin chuyển khoản
    </Button>
  );

  return (
    <TopUpFrame
      mobileTitle="Nạp điểm"
      exitHref="/wallet"
      width={600}
      desktopHeader={
        <>
          <h1 id="top-up-dialog-title" className="text-[22px] font-extrabold text-ink">
            Nạp điểm
          </h1>
          <p className="mt-1 text-body-sm text-ink-muted">Chọn gói rồi chuyển khoản, Admin duyệt thủ công.</p>
        </>
      }
      mobileFooter={cta}
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col lg:mt-6">
        <p className="text-label font-normal text-ink-muted">Số dư khả dụng</p>
        <p className="text-[30px] font-extrabold text-ink">{balance ? `${formatPoints(balance.available)} điểm` : "Chưa có"}</p>

        <div className="mt-4">
          <PackageOptions
            name="top-up-package"
            legend="Chọn gói"
            legendClassName="mb-3 text-body font-bold text-ink"
            value={custom.trim() ? null : selected}
            onChange={(value) => {
              setSelected(value);
              setCustom("");
              setTouched(false);
            }}
            size="large"
          />
        </div>

        <TextField
          id="top-up-custom-points"
          className="mt-4"
          label={`Hoặc nhập số điểm (bội số của ${TOP_UP_STEP_POINTS})`}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Ví dụ 300"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onBlur={() => setTouched(true)}
          error={customError}
        />

        <dl className="mt-4.5 flex flex-col gap-1.5 rounded-2xl border border-line bg-surface px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-label font-normal text-ink-muted">Số điểm nhận</dt>
            <dd className="text-label font-bold text-ink">{points !== null ? `${formatPoints(points)} điểm` : "Chưa có"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-label font-normal text-ink-muted">Số tiền chuyển</dt>
            <dd className="text-[16px] font-extrabold text-ink">{points !== null ? formatVnd(topUpVnd(points)) : "Chưa có"}</dd>
          </div>
        </dl>

        <ul className="mt-4 list-disc pl-[18px] text-caption-relaxed leading-[20.8px] text-ink-strong">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>

        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
            {resumeHref ? (
              <>
                {" "}
                <Link href={resumeHref} className="font-bold underline">
                  Xem yêu cầu đang chờ
                </Link>
              </>
            ) : null}
          </Alert>
        ) : null}

        <div className="mt-6 hidden items-center justify-end gap-3 border-t border-line-subtle pt-4 lg:flex">
          <Link href="/wallet" className={buttonClassName({ variant: "secondary", size: "base", radius: "field" })}>
            Để sau
          </Link>
          <Button type="submit" size="base" radius="field" loading={submitting} loadingLabel="Đang tạo yêu cầu…">
            Tiếp tục: thông tin chuyển khoản
          </Button>
        </div>
      </form>
    </TopUpFrame>
  );
}
