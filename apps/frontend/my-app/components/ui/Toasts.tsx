"use client";
import { useEffect, useRef } from "react";
export type CodeIssueToast = { id: number; title: string; body: string; tone: "success" | "error" | "info" | "warning"; action?: () => void; actionLabel?: string };
export function CodeIssueToasts({ items, dismiss }: { items: CodeIssueToast[]; dismiss: (id: number) => void }) {
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = timers.current;
    for (const item of items) if ((item.tone === "success" || item.tone === "info") && !live.has(item.id)) live.set(item.id, setTimeout(() => dismiss(item.id), 5000));
    for (const [id, timer] of live) if (!items.some(item => item.id === id)) { clearTimeout(timer); live.delete(id); }
  }, [items, dismiss]);
  useEffect(() => { const live = timers.current; return () => live.forEach(clearTimeout); }, []);
  return <div className="fixed bottom-5 right-5 z-50 flex w-[min(420px,calc(100vw-40px))] flex-col gap-2">
    {items.map(item => <div key={item.id} role={item.tone === "error" ? "alert" : "status"} className={`rounded-card border p-4 shadow-lg ${item.tone === "error" ? "border-danger bg-danger-soft text-danger" : item.tone === "warning" ? "border-tone-amber-accent bg-tone-amber-bg text-ink" : "border-tone-teal-accent bg-tone-teal-bg text-tone-teal-ink"}`}>
      <button type="button" className="float-right p-1" aria-label="Đóng" onClick={() => dismiss(item.id)}>×</button>
      <strong>{item.title}</strong><p>{item.body}</p>
      {item.action && <button type="button" className="mt-2 font-bold underline" onClick={() => { item.action?.(); dismiss(item.id); }}>{item.actionLabel ?? "Tải lại"}</button>}
    </div>)}
  </div>;
}
