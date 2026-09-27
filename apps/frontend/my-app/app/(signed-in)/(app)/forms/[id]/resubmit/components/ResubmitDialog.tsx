"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useFormHeader } from "@/lib/forms/manage-header-context";
import { resubmitCopyErrorMessage } from "@/lib/forms/manage-messages";
import type { PublisherForm } from "@/lib/forms/manage-service";
import { resubmitHref, statusViewOf } from "@/lib/forms/manage-status";
import { copyBuilderHref, copyRejectedForm } from "@/lib/forms/resubmit-service";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { SheetDialog } from "../../components/SheetDialog";

const POINTS = [
  "Khảo sát bị từ chối đã đóng nên không sửa trực tiếp được.",
  "Rescom tạo một bản nháp mới với cùng câu hỏi, đối tượng, số mẫu và điểm thưởng để bạn sửa theo góp ý.",
  "Gửi duyệt bản mới sẽ khoá lại ký quỹ; khảo sát cũ vẫn giữ trong danh sách.",
];

function ResubmitForm({
  form,
  onCancel,
  onBusyChange,
}: {
  form: PublisherForm;
  onCancel: () => void;
  /** Lets the sheet refuse Esc / backdrop / X while the copy is being made. */
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusyState] = useState(false);
  const setBusy = (value: boolean) => {
    setBusyState(value);
    onBusyChange(value);
  };
  const [error, setError] = useState<unknown>(null);
  // Guards a double click before React re-renders the disabled button.
  const running = useRef(false);
  const sessionLost = useSessionLossRedirect(error);

  async function start() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const copy = await copyRejectedForm(form);
      router.push(copyBuilderHref(copy));
    } catch (cause) {
      setError(cause);
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      {form.rejection?.reason ? (
        <div className="rounded-field bg-danger-soft px-3 py-2.5 text-caption leading-[18.9px]">
          <p className="font-bold text-danger-strong">Lý do từ Admin</p>
          <p className="mt-1 text-ink">{form.rejection.reason}</p>
        </div>
      ) : null}
      <ul className="mt-4 flex flex-col gap-2.5 text-caption leading-[18.9px] text-ink-strong lg:text-body-sm lg:leading-[20.3px]">
        {POINTS.map((point) => (
          <li key={point} className="flex items-start gap-2">
            <Icon name="check" size={16} className="mt-px shrink-0 text-primary" />
            {point}
          </li>
        ))}
      </ul>
      {error && !sessionLost ? (
        <Alert tone="danger" className="mt-4">
          {resubmitCopyErrorMessage(error)}
        </Alert>
      ) : null}
      <div className="mt-5 flex gap-3 lg:justify-end">
        <Button variant="secondary" size="xl" onClick={onCancel} disabled={busy}>
          Huỷ
        </Button>
        <Button
          size="lg"
          className="flex-1 lg:flex-none lg:px-7"
          loading={busy || sessionLost}
          loadingLabel="Đang tạo bản sao…"
          onClick={() => void start()}
        >
          Tạo bản sao &amp; sửa
        </Button>
      </div>
    </div>
  );
}

function ResubmitSheet({ form }: { form: PublisherForm }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (busy) return;
    router.replace(`/forms/${encodeURIComponent(form.id)}`, { scroll: false });
  };
  // Decided once: the page navigates away after a successful copy.
  const [rejected] = useState(() => statusViewOf(form) === "REJECTED");

  let body;
  if (rejected && form.type === "INTERNAL") {
    body = <ResubmitForm form={form} onCancel={close} onBusyChange={setBusy} />;
  } else if (rejected) {
    // Google Forms surveys are refilled in the creation wizard instead.
    body = (
      <Link
        href={resubmitHref(form)}
        className={buttonClassName({ size: "lg", radius: "field", fullWidth: true, className: "mt-5" })}
      >
        Mở mẫu tạo khảo sát Google Forms
      </Link>
    );
  } else {
    body = (
      <>
        <Alert tone="info" className="mt-4">
          Chỉ khảo sát bị Admin từ chối mới cần tạo bản sao để sửa.
        </Alert>
        <Button variant="secondary" size="xl" fullWidth className="mt-5" onClick={close}>
          Đóng
        </Button>
      </>
    );
  }

  return (
    <SheetDialog titleId="resubmit-title" title="Sửa & gửi lại" subtitle={form.title} onClose={close} dismissible={!busy}>
      {body}
    </SheetDialog>
  );
}

/** "Sửa & gửi lại" of a rejected in-Rescom survey: copy it into a new Form Builder draft. */
export function ResubmitDialog() {
  const { form } = useFormHeader();
  return form ? <ResubmitSheet form={form} /> : null;
}
