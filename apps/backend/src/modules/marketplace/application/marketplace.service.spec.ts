import { MarketplaceService } from './marketplace.service';
import { InMemoryFormRepository } from '../../forms/infrastructure/in-memory-form.repository';
import { InMemoryDemographicProfileRepository } from '../../users/infrastructure/in-memory-demographic-profile.repository';
import { InMemorySurveyResponseRepository } from '../infrastructure/in-memory-survey-response.repository';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let responseRepo: InMemorySurveyResponseRepository;

  const publisherId = '11111111-1111-4111-8111-111111111111';
  const respondentHanoiId = '22222222-2222-4222-8222-222222222222';
  const respondentHcmcId = '33333333-3333-4333-8333-333333333333';
  const respondentNoProfileId = '44444444-4444-4444-8444-444444444444';

  beforeEach(async () => {
    formRepo = new InMemoryFormRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    responseRepo = new InMemorySurveyResponseRepository();
    service = new MarketplaceService(formRepo, demoRepo, responseRepo);

    // Setup respondent profiles
    await demoRepo.upsert(respondentHanoiId, {
      age: 22,
      gender: 'MALE',
      location: 'Hanoi',
      occupation: 'Student',
      fieldOfStudy: 'Computer Science',
    });

    await demoRepo.upsert(respondentHcmcId, {
      age: 28,
      gender: 'FEMALE',
      location: 'Ho Chi Minh City',
      occupation: 'Designer',
      fieldOfStudy: 'Graphic Design',
    });
  });

  it('should return empty feed when no published surveys exist', async () => {
    const feed = await service.getFeed(respondentHanoiId);
    expect(feed.surveys).toEqual([]);
    expect(feed.total).toBe(0);
    expect(feed.profileCompleted).toBe(true);
  });

  it('should return open survey to all respondents, including those without a profile', async () => {
    const now = new Date();
    const openForm = new FormEntity(
      'form-open',
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Open Survey for Everyone',
      'No targeting restrictions',
      15,
      100,
      now,
      now,
    );
    const openVersion = new FormVersionEntity(
      'ver-open',
      'form-open',
      1,
      { title: 'Open Survey', blocks: [] } as any,
      null, // targetingJson is null
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(openForm, openVersion);

    // Hanoi respondent receives it
    const feedHanoi = await service.getFeed(respondentHanoiId);
    expect(feedHanoi.total).toBe(1);
    expect(feedHanoi.surveys[0].id).toBe('form-open');
    expect(feedHanoi.surveys[0].hasTargeting).toBe(false);

    // Respondent without profile also receives open survey
    const feedNoProfile = await service.getFeed(respondentNoProfileId);
    expect(feedNoProfile.total).toBe(1);
    expect(feedNoProfile.surveys[0].id).toBe('form-open');
    expect(feedNoProfile.profileCompleted).toBe(false);
  });

  it('should filter surveys by demographic targeting criteria', async () => {
    const now = new Date();

    // Survey 1: Open to all
    const form1 = new FormEntity(
      'form-1',
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Survey All',
      null,
      10,
      50,
      now,
      now,
    );
    const ver1 = new FormVersionEntity(
      'ver-1',
      'form-1',
      1,
      { title: 'All', blocks: [] } as any,
      null,
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(form1, ver1);

    // Survey 2: Hanoi only
    const form2 = new FormEntity(
      'form-2',
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Hanoi Student Survey',
      null,
      20,
      50,
      now,
      now,
    );
    const ver2 = new FormVersionEntity(
      'ver-2',
      'form-2',
      1,
      { title: 'Hanoi Survey', blocks: [] } as any,
      { locations: ['Hanoi'], occupations: ['Student'] },
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(form2, ver2);

    // Survey 3: HCMC + Female only
    const form3 = new FormEntity(
      'form-3',
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'HCMC Female Survey',
      null,
      30,
      50,
      now,
      now,
    );
    const ver3 = new FormVersionEntity(
      'ver-3',
      'form-3',
      1,
      { title: 'HCMC Survey', blocks: [] } as any,
      { locations: ['Ho Chi Minh City'], genders: ['FEMALE'] },
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(form3, ver3);

    // Survey 4: DRAFT status (should never show in marketplace feed)
    const form4 = new FormEntity(
      'form-4',
      publisherId,
      'INTERNAL',
      'DRAFT',
      'Draft Survey',
      null,
      10,
      50,
      now,
      now,
    );
    const ver4 = new FormVersionEntity(
      'ver-4',
      'form-4',
      1,
      { title: 'Draft', blocks: [] } as any,
      null,
      false,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(form4, ver4);

    // ── Hanoi respondent feed ─────────────────────────────────────────────
    const feedHanoi = await service.getFeed(respondentHanoiId);
    expect(feedHanoi.total).toBe(2);
    const hanoiIds = feedHanoi.surveys.map((s) => s.id);
    expect(hanoiIds).toContain('form-1');
    expect(hanoiIds).toContain('form-2');
    expect(hanoiIds).not.toContain('form-3');
    expect(hanoiIds).not.toContain('form-4');

    // ── HCMC respondent feed ──────────────────────────────────────────────
    const feedHcmc = await service.getFeed(respondentHcmcId);
    expect(feedHcmc.total).toBe(2);
    const hcmcIds = feedHcmc.surveys.map((s) => s.id);
    expect(hcmcIds).toContain('form-1');
    expect(hcmcIds).toContain('form-3');
    expect(hcmcIds).not.toContain('form-2');
    expect(hcmcIds).not.toContain('form-4');

    // ── User with no profile feed ─────────────────────────────────────────
    const feedNoProfile = await service.getFeed(respondentNoProfileId);
    expect(feedNoProfile.total).toBe(1);
    expect(feedNoProfile.surveys[0].id).toBe('form-1');
  });

  describe('Story 4.3: Completed Survey Auto-Hide & Quota', () => {
    const now = new Date();

    beforeEach(async () => {
      const f1 = new FormEntity(
        'form-alpha',
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Alpha Survey',
        'Description Alpha',
        20,
        10,
        now,
        now,
      );
      const v1 = new FormVersionEntity(
        'v-alpha',
        'form-alpha',
        1,
        { title: 'Alpha', blocks: [] } as any,
        null,
        true,
        null,
        null,
        now,
        now,
      );
      await formRepo.create(f1, v1);

      const f2 = new FormEntity(
        'form-beta',
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Beta Survey',
        'Description Beta',
        50,
        5,
        now,
        now,
      );
      const v2 = new FormVersionEntity(
        'v-beta',
        'form-beta',
        1,
        { title: 'Beta', blocks: [] } as any,
        null,
        true,
        null,
        null,
        now,
        now,
      );
      await formRepo.create(f2, v2);
    });

    it('should automatically hide survey completed by the current user when hideCompleted is true (default)', async () => {
      // Record user completion for form-alpha
      await responseRepo.recordResponse({
        formId: 'form-alpha',
        formVersionId: 'v-alpha',
        respondentId: respondentHanoiId,
        status: 'SUBMITTED',
      });

      // Hanoi user should only see form-beta
      const feedHanoi = await service.getFeed(respondentHanoiId);
      expect(feedHanoi.total).toBe(1);
      expect(feedHanoi.surveys[0].id).toBe('form-beta');

      // HCMC user has NOT completed form-alpha, so they see both
      const feedHcmc = await service.getFeed(respondentHcmcId);
      expect(feedHcmc.total).toBe(2);
    });

    it('should show completed surveys with isCompletedByCurrentUser=true when hideCompleted is false', async () => {
      await responseRepo.recordResponse({
        formId: 'form-alpha',
        formVersionId: 'v-alpha',
        respondentId: respondentHanoiId,
        status: 'VALIDATED',
      });

      const feed = await service.getFeed(respondentHanoiId, {
        hideCompleted: false,
        sortBy: 'best_match',
        type: 'ALL',
      });

      expect(feed.total).toBe(2);
      const alphaCard = feed.surveys.find((s) => s.id === 'form-alpha');
      expect(alphaCard).toBeDefined();
      expect(alphaCard?.isCompletedByCurrentUser).toBe(true);

      const betaCard = feed.surveys.find((s) => s.id === 'form-beta');
      expect(betaCard?.isCompletedByCurrentUser).toBe(false);
    });

    it('should NOT hide survey if response status is IN_PROGRESS', async () => {
      await responseRepo.recordResponse({
        formId: 'form-alpha',
        formVersionId: 'v-alpha',
        respondentId: respondentHanoiId,
        status: 'IN_PROGRESS',
      });

      const feed = await service.getFeed(respondentHanoiId);
      expect(feed.total).toBe(2);
    });

    it('should automatically hide survey when sample quota is completed (FR-38)', async () => {
      // form-beta expectedCompletions is 5. Record 5 completed responses
      for (let i = 0; i < 5; i++) {
        await responseRepo.recordResponse({
          formId: 'form-beta',
          formVersionId: 'v-beta',
          respondentId: `other-user-${i}`,
          status: 'SUBMITTED',
        });
      }

      // form-beta has reached quota, so it is hidden for everyone
      const feed = await service.getFeed(respondentHanoiId);
      expect(feed.total).toBe(1);
      expect(feed.surveys[0].id).toBe('form-alpha');
    });
  });

  describe('Story 4.3: Manual Sorting Options', () => {
    beforeEach(async () => {
      // 3 surveys with different rewards, durations, and published dates
      const s1 = new FormEntity(
        's-low-reward-fast',
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Quick Survey',
        null,
        10, // reward 10
        100,
        new Date('2026-09-01T00:00:00Z'),
        new Date('2026-09-01T00:00:00Z'),
      );
      const v1 = new FormVersionEntity(
        'v1',
        's-low-reward-fast',
        1,
        { metadata: { expectedEffortSeconds: 60 } } as any, // 60s
        null,
        true,
        null,
        null,
        new Date('2026-09-01T00:00:00Z'),
        new Date('2026-09-01T00:00:00Z'),
      );
      await formRepo.create(s1, v1);

      const s2 = new FormEntity(
        's-high-reward-slow',
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Comprehensive Survey',
        null,
        100, // reward 100
        100,
        new Date('2026-09-10T00:00:00Z'),
        new Date('2026-09-10T00:00:00Z'),
      );
      const v2 = new FormVersionEntity(
        'v2',
        's-high-reward-slow',
        1,
        { metadata: { expectedEffortSeconds: 600 } } as any, // 600s
        null,
        true,
        null,
        null,
        new Date('2026-09-10T00:00:00Z'),
        new Date('2026-09-10T00:00:00Z'),
      );
      await formRepo.create(s2, v2);

      const s3 = new FormEntity(
        's-mid-reward-mid',
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Standard Survey',
        null,
        50, // reward 50
        100,
        new Date('2026-09-05T00:00:00Z'),
        new Date('2026-09-05T00:00:00Z'),
      );
      const v3 = new FormVersionEntity(
        'v3',
        's-mid-reward-mid',
        1,
        { metadata: { expectedEffortSeconds: 180 } } as any, // 180s
        null,
        true,
        null,
        null,
        new Date('2026-09-05T00:00:00Z'),
        new Date('2026-09-05T00:00:00Z'),
      );
      await formRepo.create(s3, v3);
    });

    it('should sort by highest reward first (reward_desc)', async () => {
      const feed = await service.getFeed(respondentHanoiId, {
        sortBy: 'reward_desc',
        hideCompleted: true,
        type: 'ALL',
      });
      const ids = feed.surveys.map((s) => s.id);
      expect(ids).toEqual([
        's-high-reward-slow',
        's-mid-reward-mid',
        's-low-reward-fast',
      ]);
    });

    it('should sort by lowest reward first (reward_asc)', async () => {
      const feed = await service.getFeed(respondentHanoiId, {
        sortBy: 'reward_asc',
        hideCompleted: true,
        type: 'ALL',
      });
      const ids = feed.surveys.map((s) => s.id);
      expect(ids).toEqual([
        's-low-reward-fast',
        's-mid-reward-mid',
        's-high-reward-slow',
      ]);
    });

    it('should sort by shortest duration first (duration_asc)', async () => {
      const feed = await service.getFeed(respondentHanoiId, {
        sortBy: 'duration_asc',
        hideCompleted: true,
        type: 'ALL',
      });
      const ids = feed.surveys.map((s) => s.id);
      expect(ids).toEqual([
        's-low-reward-fast',
        's-mid-reward-mid',
        's-high-reward-slow',
      ]);
    });

    it('should sort by longest duration first (duration_desc)', async () => {
      const feed = await service.getFeed(respondentHanoiId, {
        sortBy: 'duration_desc',
        hideCompleted: true,
        type: 'ALL',
      });
      const ids = feed.surveys.map((s) => s.id);
      expect(ids).toEqual([
        's-high-reward-slow',
        's-mid-reward-mid',
        's-low-reward-fast',
      ]);
    });

    it('should sort by newest first (newest)', async () => {
      const feed = await service.getFeed(respondentHanoiId, {
        sortBy: 'newest',
        hideCompleted: true,
        type: 'ALL',
      });
      const ids = feed.surveys.map((s) => s.id);
      expect(ids).toEqual([
        's-high-reward-slow', // Sept 10
        's-mid-reward-mid', // Sept 5
        's-low-reward-fast', // Sept 1
      ]);
    });
  });

  describe('Story 4.3: Search and Advanced Filtering', () => {
    const now = new Date();

    beforeEach(async () => {
      const fInternal = new FormEntity(
        'form-ai-internal',
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Artificial Intelligence Research',
        'Study on developer tooling and AI productivity',
        40,
        100,
        now,
        now,
      );
      const vInternal = new FormVersionEntity(
        'v-ai-internal',
        'form-ai-internal',
        1,
        { metadata: { expectedEffortSeconds: 120 } } as any,
        null,
        true,
        null,
        null,
        now,
        now,
      );
      await formRepo.create(fInternal, vInternal);

      const fExternal = new FormEntity(
        'form-climate-external',
        publisherId,
        'EXTERNAL',
        'PUBLISHED',
        'Climate Change Awareness',
        'External academic survey hosted on Google Forms',
        15,
        200,
        now,
        now,
      );
      const vExternal = new FormVersionEntity(
        'v-climate-external',
        'form-climate-external',
        1,
        { metadata: { expectedEffortSeconds: 300 } } as any,
        null,
        true,
        null,
        null,
        now,
        now,
      );
      await formRepo.create(fExternal, vExternal);
    });

    it('should filter by search query matching title or description case-insensitively', async () => {
      const feed1 = await service.getFeed(respondentHanoiId, {
        search: 'intelligence',
        hideCompleted: true,
        sortBy: 'best_match',
        type: 'ALL',
      });
      expect(feed1.total).toBe(1);
      expect(feed1.surveys[0].id).toBe('form-ai-internal');

      const feed2 = await service.getFeed(respondentHanoiId, {
        search: 'CLIMATE',
        hideCompleted: true,
        sortBy: 'best_match',
        type: 'ALL',
      });
      expect(feed2.total).toBe(1);
      expect(feed2.surveys[0].id).toBe('form-climate-external');

      const feed3 = await service.getFeed(respondentHanoiId, {
        search: 'nonexistent keyword',
        hideCompleted: true,
        sortBy: 'best_match',
        type: 'ALL',
      });
      expect(feed3.total).toBe(0);
    });

    it('should filter by survey type', async () => {
      const feedInternal = await service.getFeed(respondentHanoiId, {
        type: 'INTERNAL',
        hideCompleted: true,
        sortBy: 'best_match',
      });
      expect(feedInternal.total).toBe(1);
      expect(feedInternal.surveys[0].type).toBe('INTERNAL');

      const feedExternal = await service.getFeed(respondentHanoiId, {
        type: 'EXTERNAL',
        hideCompleted: true,
        sortBy: 'best_match',
      });
      expect(feedExternal.total).toBe(1);
      expect(feedExternal.surveys[0].type).toBe('EXTERNAL');
    });

    it('should filter by minReward and maxDuration', async () => {
      const feedReward = await service.getFeed(respondentHanoiId, {
        minReward: 25,
        hideCompleted: true,
        sortBy: 'best_match',
        type: 'ALL',
      });
      expect(feedReward.total).toBe(1);
      expect(feedReward.surveys[0].id).toBe('form-ai-internal');

      const feedDuration = await service.getFeed(respondentHanoiId, {
        maxDuration: 180,
        hideCompleted: true,
        sortBy: 'best_match',
        type: 'ALL',
      });
      expect(feedDuration.total).toBe(1);
      expect(feedDuration.surveys[0].id).toBe('form-ai-internal');
    });
  });
});
