"use client";

import { useEffect, useRef, useCallback } from "react";
import type { IntegrityEventType, TelemetryEventItem } from "@rescom/schemas";
import {
  createTelemetryQueue,
  enqueueEvent,
  drainBatch,
  formatTelemetryPayload,
  requeueBatch,
  classifyTelemetryResponse,
  resolveTelemetryUrl,
  createClientEventId,
  TELEMETRY_QUEUE_MAX,
} from "./telemetry-buffer.mjs";

interface UseSurveyTelemetryOptions {
  formId?: string;
  attemptId?: string;
  responseId?: string | null;
  formVersionId?: string;
  enabled?: boolean;
  /**
   * `consentNoticeVersion` sent with each batch: the integrity notice version
   * the respondent accepted. `null` = unknown (omitted from the payload);
   * left out = the legacy renderer's "v1.0".
   */
  consentNoticeVersion?: string | number | null;
}

const LEGACY_NOTICE_VERSION = "v1.0";

export function useSurveyTelemetry({
  formId,
  attemptId,
  responseId,
  formVersionId,
  enabled = true,
  consentNoticeVersion = LEGACY_NOTICE_VERSION,
}: UseSurveyTelemetryOptions) {
  // Read at flush time: the accepted version may load after the first events.
  const noticeVersionRef = useRef(consentNoticeVersion);
  useEffect(() => {
    noticeVersionRef.current = consentNoticeVersion;
  }, [consentNoticeVersion]);
  const queueRef = useRef<TelemetryEventItem[]>(
    createTelemetryQueue(TELEMETRY_QUEUE_MAX),
  );
  const sequenceRef = useRef<number>(0);
  const isFlushingRef = useRef<boolean>(false);
  // After a retryable failure, early (size-triggered) flushes wait for the
  // periodic flush instead of hitting the backend on every new event.
  const retryBackoffUntilRef = useRef<number>(0);

  const isEnabled = Boolean(enabled && attemptId && formVersionId);

  // Dispatch a batch of events to backend safely
  const flushQueue = useCallback(async () => {
    if (!isEnabled || !attemptId || isFlushingRef.current) return;
    if (queueRef.current.length === 0) return;

    // Epic 5 review P15: resolve the URL before draining so a missing target
    // keeps the events queued.
    const url = resolveTelemetryUrl({ responseId, formId, attemptId });
    if (!url) return;

    const batch = drainBatch(queueRef.current, 25);
    if (batch.length === 0) return;

    isFlushingRef.current = true;
    let outcome: "ok" | "retry" | "drop" = "retry";
    try {
      const payload = formatTelemetryPayload(batch, noticeVersionRef.current ?? undefined);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      outcome = classifyTelemetryResponse(res.status);
    } catch {
      // Network error: keep the batch for the next flush (fail-open for the UI)
      outcome = "retry";
    } finally {
      // Network error / 5xx / 429 → re-queue at the front (bounded, oldest
      // dropped); any other 4xx → the batch is invalid, drop it.
      if (outcome === "retry") {
        requeueBatch(queueRef.current, batch, TELEMETRY_QUEUE_MAX);
        retryBackoffUntilRef.current = Date.now() + 5000;
      } else {
        retryBackoffUntilRef.current = 0;
      }
      isFlushingRef.current = false;
    }
  }, [isEnabled, attemptId, responseId, formId]);

  // Record an event to the queue
  const recordEvent = useCallback(
    (
      eventType: IntegrityEventType,
      questionId?: string,
      metadata?: Record<string, unknown>,
    ) => {
      if (!isEnabled || !attemptId || !formVersionId) return;

      // Always a UUID v4 (the backend validates `z.string().uuid()`).
      const clientEventId = createClientEventId();

      sequenceRef.current += 1;

      const eventItem: TelemetryEventItem = {
        clientEventId,
        eventType,
        attemptId,
        formVersionId,
        responseId: responseId || undefined,
        questionId,
        sequence: sequenceRef.current,
        occurredAt: new Date().toISOString(),
        metadata,
      };

      enqueueEvent(queueRef.current, eventItem, TELEMETRY_QUEUE_MAX);

      // If queue exceeds 10 items, flush early (unless backing off after a failure)
      if (
        queueRef.current.length >= 10 &&
        Date.now() >= retryBackoffUntilRef.current
      ) {
        void flushQueue();
      }
    },
    [isEnabled, attemptId, formVersionId, responseId, flushQueue],
  );

  // Periodic flush every 5 seconds
  useEffect(() => {
    if (!isEnabled) return;

    const timer = setInterval(() => {
      void flushQueue();
    }, 5000);

    return () => clearInterval(timer);
  }, [isEnabled, flushQueue]);

  // Flush on unload
  useEffect(() => {
    if (!isEnabled) return;

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        recordEvent("PAGE_HIDDEN");
        void flushQueue();
      } else if (document.visibilityState === "visible") {
        recordEvent("PAGE_VISIBLE");
      }
    }

    function handleBeforeUnload() {
      void flushQueue();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void flushQueue();
    };
  }, [isEnabled, recordEvent, flushQueue]);

  return {
    isEnabled,
    recordEvent,
    flushQueue,
  };
}
