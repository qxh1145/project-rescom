import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import { SurveyCompletionPort } from '../../rewards/application/ports/account-standing.port';

/** Read-only `survey_attempts` fact for Rewards Flash eligibility (BR-02). */
@Injectable()
export class PrismaSurveyCompletionReader implements SurveyCompletionPort {
  constructor(private readonly prisma: PrismaService) {}

  async completedSurveyInLastDays(
    userId: string,
    days: number,
    now: Date,
  ): Promise<boolean> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const attempt = await currentClient(this.prisma).surveyAttempt.findFirst({
      where: {
        respondentId: userId,
        status: 'COMPLETED',
        submittedAt: { gte: cutoff },
      },
      select: { id: true },
    });
    return attempt !== null;
  }
}
