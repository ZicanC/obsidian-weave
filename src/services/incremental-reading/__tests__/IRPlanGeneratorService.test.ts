import { IRPlanGeneratorService } from '../IRPlanGeneratorService';
import { IRCognitiveProfileService } from '../IRCognitiveProfileService';
import type { IRPlannedScheduleItem } from '../IRScheduleKernel';

describe('IRPlanGeneratorService', () => {
  let planGenerator: IRPlanGeneratorService;
  let profileService: IRCognitiveProfileService;

  beforeEach(() => {
    profileService = new IRCognitiveProfileService();
    planGenerator = new IRPlanGeneratorService(profileService);
  });

  function createDate(dayOffset: number): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + dayOffset);
    return date;
  }

  function formatDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function createItem(input: {
    id: string;
    dayOffset: number;
    priority: number;
    estimatedMinutes?: number;
    sourceFile?: string;
  }): IRPlannedScheduleItem {
    const nextReviewDate = createDate(input.dayOffset);
    const estimatedMinutes = input.estimatedMinutes ?? 5;
    const profile = profileService.computeProfile({
      scheduleStatus: 'scheduled',
      nextRepDate: nextReviewDate.getTime(),
      manualPriority: input.priority,
      effectivePriority: input.priority,
      intervalDays: 1,
      estimatedMinutes,
      stats: {
        impressions: 1,
      },
      nowMs: createDate(0).getTime(),
      continuityHint: 0,
    });

    return {
      id: input.id,
      title: input.id,
      sourceFile: input.sourceFile ?? `/test/${input.id}.md`,
      priority: input.priority,
      intervalDays: 1,
      scheduleStatus: 'scheduled',
      nextRepDate: nextReviewDate.getTime(),
      nextReviewDate,
      estimatedMinutes,
      sourceType: 'chunk',
      explanation: {
        primaryReason: 'test',
        secondaryReasons: [],
        manualPriority: input.priority,
        effectivePriority: input.priority,
        isOverdue: false,
        overdueDays: 0,
        hasManualSchedule: true,
        estimatedMinutes,
        scoreBreakdown: profile,
        compositeScore: profile.compositeScore,
      },
    };
  }

  test('冻结窗口内的原定项目优先保留在原计划日', () => {
    const today = createDate(0);
    const tomorrow = createDate(1);
    const dayAfterTomorrow = createDate(2);
    const plan = planGenerator.generatePlan(
      [
        createItem({ id: 'today-top', dayOffset: 0, priority: 9, estimatedMinutes: 10 }),
        createItem({ id: 'carryover', dayOffset: 0, priority: 7, estimatedMinutes: 10 }),
        createItem({ id: 'tomorrow-slot', dayOffset: 1, priority: 5, estimatedMinutes: 10 }),
      ],
      {
        horizonDays: 3,
        dailyBudgetMinutes: 10,
      }
    );

    expect(plan.itemsByDate.get(formatDateKey(today))?.map(item => item.id)).toEqual(['today-top']);
    expect(plan.itemsByDate.get(formatDateKey(tomorrow))?.map(item => item.id)).toEqual(['tomorrow-slot']);
    expect(plan.itemsByDate.get(formatDateKey(dayAfterTomorrow))?.map(item => item.id)).toEqual(['carryover']);
  });

  test('同源连续性奖励会在分数接近时保持阅读上下文', () => {
    const today = createDate(0);
    const sourceA = '/test/source-a.md';
    const sourceB = '/test/source-b.md';
    const plan = planGenerator.generatePlan(
      [
        createItem({ id: 'a-1', dayOffset: 0, priority: 6, sourceFile: sourceA }),
        createItem({ id: 'a-2', dayOffset: 0, priority: 5, sourceFile: sourceA }),
        createItem({ id: 'b-1', dayOffset: 0, priority: 5.4, sourceFile: sourceB }),
      ],
      {
        horizonDays: 2,
        dailyBudgetMinutes: 10,
        continuityBonus: 0.8,
      }
    );

    expect(plan.itemsByDate.get(formatDateKey(today))?.map(item => item.id)).toEqual(['a-1', 'a-2']);
  });

  test('相邻日期二次平滑会把可移动项目推向次日以缓解过载', () => {
    const tomorrow = createDate(1);
    const dayAfterTomorrow = createDate(2);
    const plan = planGenerator.generatePlan(
      [
        createItem({ id: 'day1-heavy', dayOffset: 1, priority: 8, estimatedMinutes: 6 }),
        createItem({ id: 'day1-movable', dayOffset: 1, priority: 6, estimatedMinutes: 5 }),
      ],
      {
        horizonDays: 4,
        dailyBudgetMinutes: 10,
        freezeWindowHours: 0,
      }
    );

    expect(plan.itemsByDate.get(formatDateKey(tomorrow))?.map(item => item.id)).toEqual(['day1-heavy']);
    expect(plan.itemsByDate.get(formatDateKey(dayAfterTomorrow))?.map(item => item.id)).toEqual(['day1-movable']);
  });
});
