import { ConflictException } from '@nestjs/common';
import { AdminPublishedSurveysService } from './admin-published-surveys.service';
import { FormNotFoundException } from '../../forms/application/exceptions/form.exceptions';

const FORM_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

function setup(status: string | null) {
  const forms = {
    listPublished: jest.fn(),
    findStatus: jest.fn().mockResolvedValue(status),
    setPinned: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const directory = { findLabels: jest.fn().mockResolvedValue(new Map()) };
  const service = new AdminPublishedSurveysService({
    forms,
    directory,
    audit: audit as never,
  });
  return { service, forms, audit, directory };
}

describe('AdminPublishedSurveysService', () => {
  it('pins a PUBLISHED survey and audits it', async () => {
    const { service, forms, audit } = setup('PUBLISHED');
    await expect(service.setPinned(ADMIN_ID, FORM_ID, true)).resolves.toEqual({
      formId: FORM_ID,
      isPinned: true,
    });
    expect(forms.setPinned).toHaveBeenCalledWith(FORM_ID, true);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SURVEY_PINNED', userId: ADMIN_ID }),
    );
  });

  it('refuses to pin a survey that is not PUBLISHED', async () => {
    const { service, forms } = setup('CLOSED');
    await expect(service.setPinned(ADMIN_ID, FORM_ID, true)).rejects.toThrow(
      ConflictException,
    );
    expect(forms.setPinned).not.toHaveBeenCalled();
  });

  it('unpins a closed survey', async () => {
    const { service, forms, audit } = setup('CLOSED');
    await service.setPinned(ADMIN_ID, FORM_ID, false);
    expect(forms.setPinned).toHaveBeenCalledWith(FORM_ID, false);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SURVEY_UNPINNED' }),
    );
  });

  it('404s an unknown survey', async () => {
    const { service } = setup(null);
    await expect(service.setPinned(ADMIN_ID, FORM_ID, true)).rejects.toThrow(
      FormNotFoundException,
    );
  });

  it('lists with publisher e-mails and hasMore', async () => {
    const { service, forms, directory } = setup('PUBLISHED');
    forms.listPublished.mockResolvedValue({
      items: [
        {
          formId: FORM_ID,
          title: 'A',
          publisherId: ADMIN_ID,
          updatedAt: new Date('2026-10-09T00:00:00Z'),
          isPinned: true,
        },
      ],
      total: 2,
    });
    directory.findLabels.mockResolvedValue(
      new Map([[ADMIN_ID, { displayName: null, email: 'p@x.vn' }]]),
    );
    const page = await service.list({ limit: 1, offset: 0 });
    expect(page.items[0]).toMatchObject({
      publisherEmail: 'p@x.vn',
      isPinned: true,
    });
    expect(page.hasMore).toBe(true);
  });
});
