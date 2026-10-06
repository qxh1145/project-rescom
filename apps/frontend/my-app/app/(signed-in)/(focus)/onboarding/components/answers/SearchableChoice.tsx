"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { searchOptions } from "@/lib/onboarding/option-search";
import { ChoiceAnswer } from "./ChoiceAnswer";
import { TextAnswer } from "./TextAnswer";

interface CustomEntry {
  /** "Không thấy trường của bạn? Nhập tên trường" (63:4524). */
  linkLabel: string;
  inputLabel: string;
  placeholder?: string;
}

interface SearchableChoiceProps {
  name: string;
  labelledBy: string;
  errorId?: string;
  catalog: readonly string[];
  /** Shown while the search box is empty. */
  popular: readonly string[];
  value: string | null;
  onChange: (value: string) => void;
  searchLabel: string;
  layout: "grid" | "list";
  formatOption?: (option: string) => string;
  /** Free-text answer for values outside the catalog. */
  custom?: CustomEntry;
}

/**
 * 12.4 Tỉnh/thành (63:3643) and 12.6 Trường (63:4506): search box + radio
 * cards. Accents are optional while searching ("da nang").
 */
export function SearchableChoice({
  name,
  labelledBy,
  errorId,
  catalog,
  popular,
  value,
  onChange,
  searchLabel,
  layout,
  formatOption = (option) => option,
  custom,
}: SearchableChoiceProps) {
  const [query, setQuery] = useState("");
  const [customOpen, setCustomOpen] = useState(() => Boolean(custom && value && !catalog.includes(value)));

  const results = searchOptions(catalog, query, popular);
  // Keep the current answer visible even when the list no longer contains it.
  const shown = value && !customOpen && !results.includes(value) && !query ? [...results, value] : results;
  const searchId = `${name}-search`;

  return (
    <>
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          {searchLabel}
        </label>
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted lg:left-4"
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter picks the first match instead of submitting the step.
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (query.trim() && results.length > 0) {
              setCustomOpen(false);
              onChange(results[0]);
            }
          }}
          placeholder={searchLabel}
          autoComplete="off"
          className="h-13 w-full rounded-control border border-line-strong bg-surface pr-4 pl-11 text-button font-normal text-ink transition-colors [--focus-ring-color:transparent] placeholder:text-ink-placeholder hover:border-ink-strong focus:border-2 focus:border-primary focus:pr-[15px] focus:pl-[43px] lg:h-14 lg:pl-11.5 lg:focus:pl-[45px]"
        />
      </div>

      {/* Always mounted so screen readers hear the "no match" text when it appears. */}
      <p role="status" className={shown.length > 0 ? "sr-only" : "text-body text-ink-muted"}>
        {shown.length > 0
          ? ""
          : `Không tìm thấy “${query.trim()}”.${custom ? " Bạn có thể nhập tên bên dưới." : ""}`}
      </p>

      {shown.length > 0 ? (
        <ChoiceAnswer
          name={name}
          labelledBy={labelledBy}
          errorId={errorId}
          options={shown.map((option) => ({ value: option, label: formatOption(option) }))}
          value={customOpen ? null : value}
          onChange={(next) => {
            setCustomOpen(false);
            onChange(next);
          }}
          layout={layout}
        />
      ) : null}

      {custom ? (
        customOpen ? (
          <TextAnswer
            id={`${name}-custom`}
            label={custom.inputLabel}
            placeholder={custom.placeholder}
            value={value ?? ""}
            onValueChange={onChange}
            errorId={errorId}
            maxLength={100}
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setCustomOpen(true);
              onChange(query.trim());
            }}
            className="self-start py-1.5 text-left text-body font-bold text-primary hover:underline"
          >
            {custom.linkLabel}
          </button>
        )
      ) : null}
    </>
  );
}
