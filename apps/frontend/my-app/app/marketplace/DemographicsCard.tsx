"use client";

import { useState } from "react";
import {
  GENDER_OPTIONS,
  Gender,
  DemographicProfileDto,
  UpdateDemographicProfileInput,
} from "@rescom/schemas";
import { formMutationFetch } from "./marketplace-api";

interface DemographicsCardProps {
  profile: DemographicProfileDto | null;
  isComplete: boolean;
  onProfileUpdated: (newProfile: DemographicProfileDto, complete: boolean) => void;
}

export function DemographicsCard({
  profile,
  isComplete,
  onProfileUpdated,
}: DemographicsCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [age, setAge] = useState<number | string>(profile?.age ?? "");
  const [gender, setGender] = useState<Gender | "">(profile?.gender ?? "");
  const [location, setLocation] = useState(profile?.location ?? "");
  const [occupation, setOccupation] = useState(profile?.occupation ?? "");
  const [fieldOfStudy, setFieldOfStudy] = useState(profile?.fieldOfStudy ?? "");
  const [householdIncome, setHouseholdIncome] = useState(
    profile?.householdIncome ?? "",
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const payload: UpdateDemographicProfileInput = {
        age: age === "" ? null : Number(age),
        gender: gender === "" ? null : gender,
        location: location.trim() === "" ? null : location.trim(),
        occupation: occupation.trim() === "" ? null : occupation.trim(),
        fieldOfStudy: fieldOfStudy.trim() === "" ? null : fieldOfStudy.trim(),
        householdIncome: householdIncome.trim() === "" ? null : householdIncome.trim(),
      };

      const res = await formMutationFetch("/api/demographics", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || "Failed to update profile");
      }

      const json = await res.json();
      const updatedProfile = json.data?.profile as DemographicProfileDto;
      const completeStatus = Boolean(json.data?.isComplete);

      onProfileUpdated(updatedProfile, completeStatus);
      setIsEditing(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update demographics";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm mb-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 dark:border-zinc-800/80 pb-4 mb-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
              Respondent Demographic Profile
            </h2>
            {isComplete ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Matching Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-900">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                Incomplete Profile
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Surveys on the Marketplace are automatically matched against these criteria.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsEditing(!isEditing);
            setError(null);
          }}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
        >
          {isEditing ? "Cancel" : "Edit Demographics"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-xs border border-red-200 dark:border-red-900">
          {error}
        </div>
      )}

      {isEditing ? (
        <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Age (13–100)
            </label>
            <input
              type="number"
              min={13}
              max={100}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="e.g. 22"
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Gender
            </label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as Gender | "")}
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="" className="text-zinc-500">Select gender...</option>
              {GENDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="text-zinc-900 dark:text-zinc-100 dark:bg-zinc-800">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Location / City
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Hanoi, Ho Chi Minh City"
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Occupation
            </label>
            <input
              type="text"
              value={occupation}
              onChange={(e) => setOccupation(e.target.value)}
              placeholder="e.g. Student, Software Engineer"
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Field of Study
            </label>
            <input
              type="text"
              value={fieldOfStudy}
              onChange={(e) => setFieldOfStudy(e.target.value)}
              placeholder="e.g. Computer Science, Business"
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Household Income
            </label>
            <input
              type="text"
              value={householdIncome}
              onChange={(e) => setHouseholdIncome(e.target.value)}
              placeholder="e.g. 15M-30M VND"
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="sm:col-span-2 md:col-span-3 flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save & Update Feed"}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          <div className="bg-zinc-50 dark:bg-zinc-800/40 rounded-lg p-2.5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">Age</div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
              {profile?.age ? `${profile.age} yrs` : "—"}
            </div>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800/40 rounded-lg p-2.5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">Gender</div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
              {profile?.gender || "—"}
            </div>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800/40 rounded-lg p-2.5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">Location</div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5 truncate" title={profile?.location || undefined}>
              {profile?.location || "—"}
            </div>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800/40 rounded-lg p-2.5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">Occupation</div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5 truncate" title={profile?.occupation || undefined}>
              {profile?.occupation || "—"}
            </div>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800/40 rounded-lg p-2.5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">Field of Study</div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5 truncate" title={profile?.fieldOfStudy || undefined}>
              {profile?.fieldOfStudy || "—"}
            </div>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800/40 rounded-lg p-2.5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">Income</div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5 truncate" title={profile?.householdIncome || undefined}>
              {profile?.householdIncome || "—"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
