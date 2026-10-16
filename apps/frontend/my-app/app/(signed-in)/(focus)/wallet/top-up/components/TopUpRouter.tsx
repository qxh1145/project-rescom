"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { PayosTopUpDto, TopUpRequestDto } from "@rescom/schemas";
import { FocusError, FocusLoading } from "@/app/(signed-in)/(focus)/_participation/FocusPageState";
import { getPayosTopUp } from "@/lib/wallet/payos-top-up-service";
import { getMyTopUpRequest } from "@/lib/wallet/top-up-service";
import { PayosTopUpScreen } from "./PayosTopUpScreen";
import { TransferScreen } from "./TransferScreen";

export function TopUpRouter() {
  const params = useParams();
  const rawId = params?.id;
  const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

  const [nonce, setNonce] = useState(0);
  const retry = () => setNonce((n) => n + 1);

  // Result is tagged with the request key, so a response for an older id/retry is
  // never shown and nothing needs clearing when the id changes.
  const key = `${id}:${nonce}`;
  const [result, setResult] = useState<{
    key: string;
    payos?: PayosTopUpDto;
    manual?: TopUpRequestDto;
    notFound?: boolean;
    error?: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const done = (r: Omit<NonNullable<typeof result>, "key">) => {
      if (!controller.signal.aborted) setResult({ key, ...r });
    };
    const isNotFound = (e: unknown) => {
      const err = e as { status?: number; code?: string };
      return err?.status === 404 || err?.code === "TOPUP_NOT_FOUND";
    };
    // 404 (PayOS id unknown) or 400 (manual ids are not PayOS UUIDs) -> try manual.
    const isFallThrough = (e: unknown) => {
      const err = e as { status?: number; code?: string };
      return isNotFound(e) || err?.status === 400 || err?.code === "VALIDATION_ERROR";
    };
    const loadError = "Không thể tải thông tin nạp điểm. Vui lòng thử lại.";

    (async () => {
      if (!id) return done({ notFound: true });
      try {
        done({ payos: await getPayosTopUp(id, controller.signal) });
      } catch (err: unknown) {
        if (!isFallThrough(err)) return done({ error: loadError });
        try {
          done({ manual: await getMyTopUpRequest(id) });
        } catch (manualErr: unknown) {
          done(isNotFound(manualErr) ? { notFound: true } : { error: loadError });
        }
      }
    })();

    return () => controller.abort();
  }, [id, key]);

  const current = result?.key === key ? result : null;
  const loading = current === null;
  const notFound = current?.notFound === true;
  const error = current?.error ?? null;
  const payosData = current?.payos ?? null;
  const manualData = current?.manual ?? null;

  if (loading) return <FocusLoading />;

  if (notFound) {
    return (
      <FocusError
        title="Không tìm thấy giao dịch"
        message="Giao dịch nạp điểm này không tồn tại hoặc thuộc về tài khoản khác."
        backHref="/wallet"
        backLabel="Về Ví điểm"
      />
    );
  }

  if (error) {
    return (
      <FocusError
        title="Không thể tải giao dịch"
        message={error}
        onRetry={retry}
        backHref="/wallet"
        backLabel="Về Ví điểm"
      />
    );
  }

  if (payosData) {
    return <PayosTopUpScreen key={payosData.id} initialTopUp={payosData} />;
  }

  if (manualData) {
    return <TransferScreen />;
  }

  return null;
}
