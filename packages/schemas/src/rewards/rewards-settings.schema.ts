import { z } from "zod";

export const rewardsSettingsSchema = z.object({
  dailyPointsLimit: z.number().int().min(1).max(1_000_000),
  updatedAt: z.string().datetime().optional(),
});

export const updateRewardsSettingsSchema = z.object({
  dailyPointsLimit: z.number().int().min(1).max(1_000_000),
});

export type RewardsSettingsDto = z.infer<typeof rewardsSettingsSchema>;
export type UpdateRewardsSettingsDto = z.infer<typeof updateRewardsSettingsSchema>;
