# INCREMENTAL READING SERVICES KNOWLEDGE BASE

## OVERVIEW
This subtree owns IR storage, scheduling kernels, queues, materials, tag groups, bookmark tasks, analytics, and state-machine behavior.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Scheduling facade | `IRSchedulingFacade.ts` | Common routing point into scheduler logic |
| Core kernels / generators | `IRScheduleKernel.ts`, `IRQueueGenerator*.ts`, `IRSchedulerV3.ts`, `IRV4SchedulerService.ts` | Versioned scheduler hotspots |
| State machine | `IRStateMachineV4.ts` | Core transition rules |
| Storage | `IRStorageService.ts`, `IRStorageV4.ts`, `IRStorageAdapterV4.ts` | Persisted IR state |
| Materials | `ReadingMaterialManager.ts`, `ReadingMaterialStorage.ts` | Material lifecycle |

## CONVENTIONS
- Versioned IR logic coexists (`V3`, `V4`); keep compatibility explicit.
- Many files encode scheduler invariants; tests are an important part of understanding intent.
- `__tests__/` is a real subdomain here, not a token folder.

## ANTI-PATTERNS
- Do not collapse versioned scheduling code without understanding compatibility impact.
- Do not duplicate state-transition logic in UI or wrappers.
- Do not treat import scheduling as isolated from material, queue, and bookmark-task flows.
