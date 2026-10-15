import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import { VoucherCodeRepositoryPort } from '../application/ports/voucher-code-repository.port';

@Injectable()
export class PrismaVoucherCodeRepository implements VoucherCodeRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  async listCodes(voucherId: string): Promise<string[]> {
    const rows = await currentClient(this.prisma).voucherCode.findMany({
      where: { voucherId },
      select: { code: true },
    });
    return rows.map((row) => row.code);
  }
  async countAvailable(voucherId: string): Promise<number> {
    return currentClient(this.prisma).voucherCode.count({
      where: { voucherId, redemptionId: null, issueReportId: null },
    });
  }
  async importCodes(voucherId: string, codes: string[]): Promise<void> {
    if (!codes.length) return;
    await currentClient(this.prisma).voucherCode.createMany({
      data: codes.map((code) => ({ voucherId, code })),
      skipDuplicates: false,
    });
  }
  async removeAvailable(voucherId: string, count: number): Promise<number> {
    if (count <= 0) return 0;
    return currentClient(this.prisma).$executeRaw`
      DELETE FROM voucher_codes WHERE id IN (
        SELECT id FROM voucher_codes WHERE voucher_id = ${voucherId}::uuid AND redemption_id IS NULL AND issue_report_id IS NULL
        ORDER BY created_at, id LIMIT ${count}
      )`;
  }
  async hasIssued(voucherId: string): Promise<boolean> {
    return (
      (await currentClient(this.prisma).voucherCode.count({
        where: { voucherId, redemptionId: { not: null } },
      })) > 0
    );
  }
}
