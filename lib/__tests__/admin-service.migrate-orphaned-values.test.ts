import { beforeAll, describe, expect, test, vi } from "vitest";

type MigrateOrphanedMergedEntityValuesFn = (options?: {
  db?: unknown;
}) => Promise<{ migratedModels: number; migratedBenchmarks: number }>;

type MigrateOrphanedMergedModelValuesFn = (options?: {
  db?: unknown;
}) => Promise<{ migratedCount: number }>;

let migrateOrphanedMergedEntityValuesForTest: MigrateOrphanedMergedEntityValuesFn;
let migrateOrphanedMergedModelValuesForTest: MigrateOrphanedMergedModelValuesFn;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  migrateOrphanedMergedEntityValuesForTest =
    adminServiceModule.migrateOrphanedMergedEntityValues as MigrateOrphanedMergedEntityValuesFn;
  migrateOrphanedMergedModelValuesForTest =
    adminServiceModule.migrateOrphanedMergedModelValues as MigrateOrphanedMergedModelValuesFn;
});

describe("migrateOrphanedMergedModelValues", () => {
  test("当没有已合并实体时返回 0", async () => {
    const mockExecutor = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([])
        }))
      })),
      update: vi.fn()
    };

    const result = await migrateOrphanedMergedModelValuesForTest({ db: mockExecutor });
    expect(result.migratedCount).toBe(0);
    expect(mockExecutor.update).not.toHaveBeenCalled();
  });

  test("单跳合并：将指向已合并模型 A 的 benchmark_values 迁移到目标 B", async () => {
    const mergedModels = [{ id: 10, mergedIntoModelId: 20 }];
    const mergedBenchmarks: unknown[] = [];

    const mockSelect = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(mergedModels) })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(mergedBenchmarks) })
      });

    const updateWhere = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 101 }, { id: 102 }])
    });
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const mockUpdate = vi.fn(() => ({ set: updateSet }));

    const mockExecutor = {
      select: mockSelect,
      update: mockUpdate
    };

    const result = await migrateOrphanedMergedModelValuesForTest({ db: mockExecutor });

    expect(result.migratedCount).toBe(2);
    expect(updateSet).toHaveBeenCalledWith({ modelId: 20 });
  });

  test("多跳合并：A -> B 且 B -> C 时，将挂在 A 上的历史值直接迁移到最终活跃目标 C", async () => {
    const mergedModels = [
      { id: 10, mergedIntoModelId: 20 },
      { id: 20, mergedIntoModelId: 30 }
    ];
    const mergedBenchmarks: unknown[] = [];

    const mockSelect = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(mergedModels) })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(mergedBenchmarks) })
      });

    const updateWhere = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 101 }])
    });
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const mockUpdate = vi.fn(() => ({ set: updateSet }));

    const mockExecutor = {
      select: mockSelect,
      update: mockUpdate
    };

    const result = await migrateOrphanedMergedEntityValuesForTest({ db: mockExecutor });

    expect(result.migratedModels).toBe(2);
    expect(updateSet).toHaveBeenCalledWith({ modelId: 30 });
  });

  test("环路保护：A -> B -> A 遇到环路时终止避免死循环", async () => {
    const mergedModels = [
      { id: 10, mergedIntoModelId: 20 },
      { id: 20, mergedIntoModelId: 10 }
    ];
    const mergedBenchmarks: unknown[] = [];

    const mockSelect = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(mergedModels) })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(mergedBenchmarks) })
      });

    const updateWhere = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([])
    });
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const mockUpdate = vi.fn(() => ({ set: updateSet }));

    const mockExecutor = {
      select: mockSelect,
      update: mockUpdate
    };

    const result = await migrateOrphanedMergedModelValuesForTest({ db: mockExecutor });
    expect(result.migratedCount).toBe(0);
  });
});

