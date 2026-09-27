"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ProductTourId, ProductTourProgressDto, ProductTourStatus } from "@rescom/schemas";
import { useSession } from "@/lib/session/SessionProvider";
import { CONTEXT_INVITES, TOURS, tourById } from "@/lib/product-tour/tour-definitions";
import {
  completedCount,
  hasTouched,
  isTourLocked,
  resolveStepForPath,
  resumableTour,
  shouldShowWelcome,
} from "@/lib/product-tour/tour-logic";
import { getProductTours, saveProductTour } from "@/lib/product-tour/tour-service";
import { TourDoneDialog, TourStopDialog, TourWelcomeDialog } from "./TourDialogs";
import { TourHub } from "./TourHub";
import { TourOverlay } from "./TourOverlay";
import { TourBeacon, TourInviteCard, TourResumeToast } from "./TourWidgets";
import { findTourTarget, useIsDesktop, useTourTarget } from "./tour-dom";

interface ActiveTour {
  tourId: ProductTourId;
  step: number;
}

export interface ProductTourState {
  /** Desktop, signed in as a non-admin, progress loaded. */
  enabled: boolean;
  active: ActiveTour | null;
  hubOpen: boolean;
  completed: number;
  total: number;
  allDone: boolean;
  openHub: () => void;
  start: (tourId: ProductTourId, fromStep?: number) => void;
}

const ProductTourContext = createContext<ProductTourState | null>(null);

const HINTS_KEY = "rescom.product-tour.hints";
const RESUME_SHOWN_KEY = "rescom.product-tour.resume-shown";
const ACTIVE_KEY = "rescom.product-tour.active";

function readStorage(storage: "local" | "session", key: string): string | null {
  try {
    return (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: "local" | "session", key: string, value: string): void {
  try {
    (storage === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    // Blocked storage: the preference lasts for this page only.
  }
}

function readActive(): ActiveTour | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(readStorage("session", ACTIVE_KEY) || "null") as Partial<ActiveTour> | null;
    const tour = parsed && TOURS.find((item) => item.id === parsed.tourId);
    return tour && typeof parsed.step === "number" && parsed.step >= 0 && parsed.step < tour.steps.length
      ? { tourId: tour.id, step: parsed.step }
      : null;
  } catch {
    return null;
  }
}

/**
 * Interactive product tours (canvas section 20). Mounted once for the signed-in
 * route groups (`app/(signed-in)/layout.tsx`, inside `SessionProvider`) so a
 * tour survives moving between `(app)` and `(focus)` screens.
 *
 * Progress is saved per account through `PUT /product-tours/:tourId`
 * (optimistically; a failed save only means the tour may be offered again).
 */
export function ProductTourProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const desktop = useIsDesktop();
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const signedIn = session.status === "authenticated" && session.user !== null && session.user.role !== "ADMIN";
  const userId = signedIn ? session.user?.id ?? null : null;

  // Tagged with the account it belongs to: another sign-in never sees it.
  const [loaded, setLoaded] = useState<{ userId: string; tours: ProductTourProgressDto[] } | null>(null);
  // Kept in sessionStorage so a reload mid-tour picks up where it was.
  const [activeState, setActiveState] = useState<ActiveTour | null>(() => readActive());
  const setActive = useCallback((next: ActiveTour | null) => {
    setActiveState(next);
    writeStorage("session", ACTIVE_KEY, next ? JSON.stringify(next) : "");
  }, []);
  const [hubOpen, setHubOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [doneFor, setDoneFor] = useState<ProductTourId | null>(null);
  const [welcomeClosed, setWelcomeClosed] = useState(false);
  // Nothing renders before `enabled` (false on the server), so reading storage here cannot mismatch hydration.
  const [resumeHidden, setResumeHidden] = useState(
    () => typeof window !== "undefined" && readStorage("session", RESUME_SHOWN_KEY) === "1",
  );
  const [hintsEnabled, setHintsEnabled] = useState(
    () => typeof window === "undefined" || readStorage("local", HINTS_KEY) !== "off",
  );

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    getProductTours(controller.signal)
      .then((tours) => setLoaded({ userId, tours }))
      .catch(() => {
        // Tours are optional chrome: without progress nothing is offered.
      });
    return () => controller.abort();
  }, [userId]);

  const progress = userId && loaded?.userId === userId ? loaded.tours : null;
  const enabled = desktop && progress !== null;
  const list = useMemo(() => progress ?? [], [progress]);
  const availablePoints = session.balance?.available ?? null;

  const persist = useCallback((tourId: ProductTourId, status: ProductTourStatus, step: number) => {
    setLoaded((current) => {
      if (!current) return current;
      const rows = current.tours;
      const existing = rows.find((row) => row.tourId === tourId);
      const next: ProductTourProgressDto = {
        tourId,
        status: existing?.status === "COMPLETED" ? "COMPLETED" : status,
        step,
        updatedAt: new Date().toISOString(),
      };
      return { userId: current.userId, tours: [...rows.filter((row) => row.tourId !== tourId), next] };
    });
    saveProductTour(tourId, status, step).catch(() => undefined);
  }, []);

  const start = useCallback(
    (tourId: ProductTourId, fromStep = 0) => {
      const tour = tourById(tourId);
      const step = resolveStepForPath(tour, fromStep, pathname);
      setHubOpen(false);
      setDoneFor(null);
      setWelcomeClosed(true);
      setActive({ tourId, step });
      persist(tourId, "IN_PROGRESS", step);
      if (!tour.steps[step].route.test(pathname)) router.push(tour.startHref);
    },
    [pathname, persist, router, setActive],
  );

  // Follow the user through the flow: a later step on this route takes over.
  const active = useMemo<ActiveTour | null>(() => {
    if (!activeState || progress === null) return null;
    return { tourId: activeState.tourId, step: resolveStepForPath(tourById(activeState.tourId), activeState.step, pathname) };
  }, [activeState, progress, pathname]);
  const activeTourId = active?.tourId ?? null;
  const activeStep = active?.step ?? null;
  const storedStep = activeState?.step ?? null;
  // Sync the jump to the server only (the in-memory row catches up on the next Tiếp/Quay lại).
  useEffect(() => {
    if (activeTourId !== null && activeStep !== null && activeStep !== storedStep) {
      saveProductTour(activeTourId, "IN_PROGRESS", activeStep).catch(() => undefined);
    }
  }, [activeTourId, activeStep, storedStep]);

  const complete = useCallback(() => {
    if (!active) return;
    persist(active.tourId, "COMPLETED", active.step);
    if (active.tourId === "FIRST_SURVEY") setDoneFor("FIRST_SURVEY");
    setActive(null);
  }, [active, persist, setActive]);

  const next = useCallback(() => {
    if (!active) return;
    const tour = tourById(active.tourId);
    if (active.step >= tour.steps.length - 1) {
      complete();
      return;
    }
    const step = active.step + 1;
    setActive({ tourId: active.tourId, step });
    persist(active.tourId, "IN_PROGRESS", step);
  }, [active, complete, persist, setActive]);

  const back = useCallback(() => {
    if (!active) return;
    // Skip back over optional steps that were skipped because their target is gone.
    const steps = tourById(active.tourId).steps;
    let step = active.step - 1;
    while (step >= 0 && steps[step].optional && steps[step].route.test(pathname) && !findTourTarget(steps[step].target)) step -= 1;
    if (step < 0) return;
    setActive({ tourId: active.tourId, step });
    persist(active.tourId, "IN_PROGRESS", step);
  }, [active, pathname, persist, setActive]);

  const requestStop = useCallback(() => setConfirmStop(true), []);

  const stop = useCallback(() => {
    setConfirmStop(false);
    if (!active) return;
    persist(active.tourId, "DISMISSED", active.step);
    setActive(null);
  }, [active, persist, setActive]);

  const setHints = useCallback((on: boolean) => {
    setHintsEnabled(on);
    writeStorage("local", HINTS_KEY, on ? "on" : "off");
  }, []);

  const hideResume = useCallback(() => {
    setResumeHidden(true);
    writeStorage("session", RESUME_SHOWN_KEY, "1");
  }, []);

  // Canvas 20C.0 / D: first visit of a screen with its own tour.
  const invite = useMemo(() => {
    if (!enabled || active || hubOpen) return null;
    return CONTEXT_INVITES.find((item) => item.route.test(pathname) && !hasTouched(list, item.tourId)) ?? null;
  }, [enabled, active, hubOpen, pathname, list]);
  const inviteTarget = useTourTarget(invite?.target ?? null);

  const showWelcome = enabled && !active && !welcomeClosed && shouldShowWelcome(list, pathname);
  const resume = enabled && !active && !hubOpen && !invite && !resumeHidden && !showWelcome ? resumableTour(list) : null;

  const completed = completedCount(list);
  const value = useMemo<ProductTourState>(
    () => ({
      enabled,
      active,
      hubOpen,
      completed,
      total: TOURS.length,
      allDone: completed >= TOURS.length,
      openHub: () => setHubOpen(true),
      start,
    }),
    [enabled, active, hubOpen, completed, start],
  );

  const activeTour = active ? tourById(active.tourId) : null;

  return (
    <ProductTourContext.Provider value={value}>
      {children}
      {enabled ? (
        <>
          {activeTour && active ? (
            <TourOverlay
              key={`${active.tourId}:${active.step}`}
              tour={activeTour}
              index={active.step}
              onRoute={activeTour.steps[active.step].route.test(pathname) && !confirmStop}
              onNext={next}
              onBack={back}
              onStop={requestStop}
            />
          ) : null}

          {invite && inviteTarget ? (
            <>
              {hintsEnabled
                ? tourById(invite.tourId).steps.map((step, index) =>
                    step.route.test(pathname) ? (
                      <TourBeacon
                        key={step.target}
                        target={step.target}
                        label={`Giải thích: ${step.title}`}
                        onClick={() => start(invite.tourId, index)}
                      />
                    ) : null,
                  )
                : null}
              <TourInviteCard
                title={invite.title}
                body={invite.body}
                startLabel={`Xem nhanh · ${tourById(invite.tourId).steps.filter((step) => step.route.test(pathname)).length} bước`}
                onStart={() => start(invite.tourId)}
                onLater={() => persist(invite.tourId, "DISMISSED", 0)}
              />
            </>
          ) : null}

          {resume ? (
            <TourResumeToast
              text={`${tourById(resume.tourId).title} đang dừng ở bước ${resume.step + 1}/${tourById(resume.tourId).steps.length}.`}
              onResume={() => {
                hideResume();
                start(resume.tourId, resume.step);
              }}
              onDismiss={hideResume}
            />
          ) : null}

          <TourWelcomeDialog
            open={showWelcome}
            displayName={session.displayName}
            publishLocked={isTourLocked("FIRST_PUBLISH", availablePoints)}
            onStart={(tourId) => start(tourId)}
            onLater={() => {
              setWelcomeClosed(true);
              persist("FIRST_SURVEY", "DISMISSED", 0);
            }}
          />

          <TourDoneDialog
            open={doneFor !== null}
            completed={completed}
            total={TOURS.length}
            publishLocked={isTourLocked("FIRST_PUBLISH", availablePoints)}
            onNextTour={() => start("FIRST_PUBLISH")}
            onClose={() => setDoneFor(null)}
          />

          <TourStopDialog
            open={confirmStop}
            stepLabel={active && activeTour ? `bước ${active.step + 1}/${activeTour.steps.length}` : "bước này"}
            onContinue={() => setConfirmStop(false)}
            onStop={stop}
          />

          <TourHub
            open={hubOpen}
            progress={list}
            availablePoints={availablePoints}
            hintsEnabled={hintsEnabled}
            onHintsChange={setHints}
            onStart={start}
            onClose={() => setHubOpen(false)}
          />
        </>
      ) : null}
    </ProductTourContext.Provider>
  );
}

/** Tour controls for the launcher; a no-op state outside the provider (e.g. public pages). */
export function useProductTour(): ProductTourState {
  return (
    useContext(ProductTourContext) ?? {
      enabled: false,
      active: null,
      hubOpen: false,
      completed: 0,
      total: TOURS.length,
      allDone: false,
      openHub: () => undefined,
      start: () => undefined,
    }
  );
}
