import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { ACCOUNT_MESSAGES } from "@/lib/profile/account-messages";
import { profileEditHref, type ProfileFieldGroup } from "@/lib/profile/account-view";

/** "HỒ SƠ", "VỀ BẠN"… (63:1458): 13px bold, 0.5px tracking, uppercase. */
export function SectionLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-4 mb-2 px-1 text-caption font-bold tracking-[0.5px] text-ink-muted uppercase">
      {children}
    </h2>
  );
}

/** "Ul" 63:1459: white list, 16px radius, rows split by #EEF1F6. */
export function MenuList({ labelledBy, children }: { labelledBy?: string; children: ReactNode }) {
  return (
    <ul aria-labelledby={labelledBy} className="overflow-hidden rounded-2xl border border-line bg-surface">
      {children}
    </ul>
  );
}

interface MenuRowProps {
  icon: string;
  label: string;
  value?: string | null;
  /** Internal route, `mailto:` link, or a button action; none = information only (no chevron). */
  href?: string;
  onClick?: () => void;
  danger?: boolean;
  busy?: boolean;
}

/** "Link – Thông tin cá nhân" (63:1460): 56px, 20px icon, 15px label, 13px value, chevron. */
export function MenuRow({ icon, label, value, href, onClick, danger = false, busy = false }: MenuRowProps) {
  const interactive = Boolean(href || onClick);
  const content = (
    <>
      <Icon name={icon} size={20} className={danger ? "text-danger" : "text-ink-muted"} />
      <span className={`min-w-0 flex-1 text-body font-semibold ${danger ? "text-danger" : "text-ink"}`}>{label}</span>
      {value ? <span className="max-w-[118px] shrink-0 truncate text-right text-caption text-ink-muted">{value}</span> : null}
      {busy ? <Spinner className="size-4.5 text-danger" /> : null}
      {interactive && !danger ? <Icon name="chevron-right" size={18} className="text-line-strong" /> : null}
    </>
  );
  const className = `flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left ${
    interactive ? "transition-colors hover:bg-surface-muted" : ""
  }`;

  let control: ReactNode;
  if (href?.startsWith("mailto:")) {
    control = (
      <a href={href} className={className}>
        {content}
      </a>
    );
  } else if (href) {
    control = (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  } else if (onClick) {
    control = (
      <button type="button" onClick={onClick} disabled={busy} aria-busy={busy || undefined} className={className}>
        {content}
      </button>
    );
  } else {
    control = <div className={className}>{content}</div>;
  }
  return <li className="border-b border-line-subtle last:border-b-0">{control}</li>;
}

/** Loading / error states of the profile fields (VERIFIED `GET /demographics`). */
export function ProfileFieldsState({ error, onRetry }: { error: boolean; onRetry: () => void }) {
  if (error) {
    return (
      <Alert tone="danger">
        {ACCOUNT_MESSAGES.profileLoadFailed}{" "}
        <Button variant="ghost" size="sm" className="-my-2 inline-flex" onClick={onRetry}>
          Thử lại
        </Button>
      </Alert>
    );
  }
  return (
    <p role="status" className="flex items-center gap-3 py-8 text-body text-ink-muted">
      <Spinner className="size-5 text-primary" />
      Đang tải…
    </p>
  );
}

function EditLink({ field }: { field: ProfileFieldGroup["fields"][number] }) {
  return (
    <Link
      href={profileEditHref(field.step)}
      aria-label={`Sửa ${field.label.toLowerCase()}`}
      className="-mr-2 inline-flex min-h-11 shrink-0 items-center rounded-field px-2 text-label font-bold text-primary hover:bg-tone-green-bg"
    >
      Sửa
    </Link>
  );
}

/** 15h mobile (63:2482): one list per group, 60px rows with label, bold value and "Sửa". */
export function ProfileFieldList({ groups }: { groups: ProfileFieldGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.id} id={group.id} className="scroll-mt-20">
          <SectionLabel id={`profile-${group.id}`}>{group.title}</SectionLabel>
          <MenuList labelledBy={`profile-${group.id}`}>
            {group.fields.map((field) => (
              <li
                key={field.step}
                className="flex min-h-15 items-center gap-3 border-b border-line-subtle px-4 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-caption text-ink-muted">{field.label}</p>
                  <p className="mt-0.5 text-body font-bold text-ink">{field.value}</p>
                </div>
                <EditLink field={field} />
              </li>
            ))}
          </MenuList>
        </section>
      ))}
    </>
  );
}

/** 15g desktop "Hồ sơ nhân khẩu" (63:529): two 289px columns of 65px fields per group. */
export function ProfileFieldGrid({ groups }: { groups: ProfileFieldGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`profile-desktop-${group.id}`} className="mt-5">
          <h3 id={`profile-desktop-${group.id}`} className="text-label font-extrabold text-ink">
            {group.title}
          </h3>
          <ul className="mt-1 grid grid-cols-2 gap-x-8">
            {group.fields.map((field) => (
              <li key={field.step} className="flex h-16.25 items-center gap-3 border-b border-line-subtle">
                <div className="min-w-0 flex-1">
                  <p className="text-caption text-ink-muted">{field.label}</p>
                  <p className="mt-0.5 truncate text-body font-bold text-ink">{field.value}</p>
                </div>
                <EditLink field={field} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
