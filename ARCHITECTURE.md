# Weave 实现逻辑总览

> 本文档对 `obsidian-weave` 这一仓库的实现进行系统化梳理：从插件定位、技术栈、目录结构，到三大核心领域（记忆牌组 / 刷题牌组 / 增量阅读）的运转方式，再到周边功能（EPUB、图片遮罩、AI 助手、AnkiConnect、批量解析等）和基础设施（数据持久化、迁移、备份、许可证、启动编排）。
>
> 适用版本：`manifest.json` 中标注的 `0.7.7.3`（最低 Obsidian 版本 1.7.0）。

---

## 1. 项目定位

Weave 是一款 **运行于 Obsidian 内部的学习工作流插件**，目标是把"读 → 记 → 测"三个学习环节连成一个可追溯、可验证、可复盘的闭环：

| 环节 | 牌组 | 核心算法 | 目的 |
|---|---|---|---|
| 读 | 阅读牌组（IR） | TVP-DS / FSRS-V4 派生 | 外部材料 → 内部知识文档 |
| 记 | 记忆牌组 | FSRS6 | 主观记忆与复习调度 |
| 测 | 刷题牌组 | EWMA | 客观验证与趋势追踪 |

闭环依赖 Obsidian 的 **块引用 / 双链** 系统：所有摘录笔记、记忆卡片、测试题目都通过块链接互相定位，使一张卡可在多个牌组中复用，也能从测试反向追溯到原文。

源代码遵循 **GPL-3.0-or-later**，仓库地址见 [`package.json`](package.json) 中的 `repository` 字段。

---

## 2. 技术栈

- **语言**：TypeScript（strict 模式，bundler resolution）
- **UI 框架**：Svelte 5（启用 `runes`，已在 lint 中禁止 `stopPropagation`/`stopImmediatePropagation` 等模式）
- **构建工具**：Vite 5 + `vite-plugin-commonjs`，产物为 Obsidian 插件三件套（`main.js`、`manifest.json`、`styles.css`，可选 `sql-wasm.wasm`）
- **测试**：Vitest（jsdom）+ `@testing-library/svelte`，并通过 alias 注入 Obsidian mock
- **Lint/Format**：Biome（主）+ ESLint（专门用于 Obsidian 与 Promise 规则）
- **数据库 / WASM**：`sql.js`（用于离线索引、报表等）
- **可视化**：`echarts`（曲线图、热力图、负荷图）
- **EPUB 引擎**：`foliate-js@1.0.1`
- **样式工具**：UnoCSS（`virtual:uno.css`）
- **CSS 编辑器**：CodeMirror 6（多语言模式，集成于卡片/笔记编辑器）

热重载链路：`scripts/dev-watch.cjs` → `.desktop-hot-reload/` 暂存 → 原子拷贝至 `${OBSIDIAN_VAULT_PATH}/plugins/weave/`，避免 Obsidian 读插件时碰到半写入文件。

---

## 3. 目录结构（src）

```text
src/
├── main.ts                 # WeavePlugin 主入口（≈9200 行的总编排器）
├── algorithms/             # FSRS6、增强版 FSRS（个性化）
├── application/            # 应用层用例（轻量）
├── components/             # Svelte UI（含 WeaveApp 主壳与各功能子模块）
├── config/paths.ts         # 数据路径单一事实源（SSOT）
├── constants/              # 常量
├── data/                   # 持久化模型 & 适配器（storage.ts、analytics.ts、types.ts…）
├── domain/                 # 领域模型
├── events/                 # 事件总线
├── extensions/             # CodeMirror / 编辑器扩展
├── hooks/                  # 共享钩子
├── icons/                  # SVG / 图标资源
├── importers/              # 外部导入器
├── infrastructure/         # 基础设施层
├── modals/                 # Obsidian 模态包装器
├── parsers/                # Markdown ↔ 字段解析（卡片类型）
├── parsing/                # 高层解析协调
├── services/               # 业务逻辑核心层（最重）
├── stores/                 # Svelte 响应式状态
├── styles/                 # 全局/局部 CSS
├── tests/                  # 全局测试 setup（jsdom、Obsidian mock）
├── types/                  # 跨模块类型契约
├── utils/                  # 含产品规则的工具集（不仅是 helper）
└── views/                  # Obsidian ItemView 包装器
```

> 说明：仓库采用 **混合架构**——既按功能（feature folders）切分，也按层级（`application` / `domain` / `infrastructure` / `services` / `utils` / `types`）切分；`main.ts` 故意保持单文件巨型化，方便集中查阅 "X 是在哪里注册的" 这一类问题。

---

## 4. 插件入口与生命周期（[`src/main.ts`](src/main.ts)）

`WeavePlugin extends Plugin`（Obsidian Plugin 基类）。`onload()` 内分四阶段编排：

### 阶段 1：layout-ready 之前（同步注册）
- `registerWorkspaceViews()`：注册全部 8 个 `ItemView`（见下表）
- `loadSettings()`：反序列化用户配置（[`src/main.ts:212-699+`](src/main.ts) 的 `WeaveSettings` + `DEFAULT_SETTINGS`）
- `hydratePluginLocalState()`：从 `.obsidian/plugins/weave/state/` 恢复运行期状态
- 立即可用的静态服务：`FSRS`、`logger`、`focusManager`、`aiConfigStore`、`tablet-detection`
- 注册 Markdown 处理器（`weave-decks` 代码块）、协议处理器、DOM 事件 patch

### 阶段 2：layout-ready 后 → `initializeDataStorage()`
- 运行 **统一数据迁移**（v3.0 schema、`.tuanki/` 等遗留路径兼容）
- 初始化 `WeaveDataStorage`（金库内的牌组 / 卡片 / 学习会话读写主路径）
- 预热 `CardFileService`（参考牌组）和 `BlockLinkCleanupService`（块链清理）

### 阶段 3：`initializeServicesAfterStorage()`（≤8 s 超时）
- **核心同步服务**：`DeckHierarchyService`、`MediaManagementService`、`CardRelationService`
- **并行（不阻塞）**：`QuestionBankService`、IR 服务簇、`GlobalDataCache.preload()`、`ReferenceDeckService` 等
- **延后（≥1 s 后异步）**：`BatchParsingFileWatcher`、`DirectFileCardReader`、热门牌组预取

### 阶段 4：`onunload()` → `cleanupServices()`
- Flush `dataStorage` / `vaultStorage` 的待写入数据
- 销毁 AI 配置、编辑器临时文件、嵌入式编辑器池、AI 工具栏
- 关停外部同步监听、批量解析 watcher、索引服务
- 清理全局 `window` 上挂的钩子

### 注册的 ItemView（[`src/views/`](src/views)）
| `VIEW_TYPE_*` | 视图 | 作用 |
|---|---|---|
| `WEAVE` | [`WeaveView.ts`](src/views/WeaveView.ts) | 主壳：卡片管理 / 牌组学习 / 设置入口 |
| `STUDY` | [`StudyView.ts`](src/views/StudyView.ts) | FSRS 复习交互界面 |
| `QUESTION_BANK` | [`QuestionBankView.ts`](src/views/QuestionBankView.ts) | 测试 / 刷题视图 |
| `IR_FOCUS` | [`IRFocusView.ts`](src/views/IRFocusView.ts) | 增量阅读聚焦学习 |
| `IR_CALENDAR` | [`IRCalendarView.ts`](src/views/IRCalendarView.ts) | IR 日历 / 时间线 |
| `EPUB` | [`EpubView.ts`](src/views/EpubView.ts) | EPUB 阅读 + 标注 |
| `EPUB_BOOKSHELF_SIDEBAR` | [`EpubBookshelfSidebarView.ts`](src/views/EpubBookshelfSidebarView.ts) | EPUB 书架侧栏 |
| `EPUB_SIDEBAR` | [`EpubSidebarView.ts`](src/views/EpubSidebarView.ts) | EPUB 标注 / 书签侧栏 |

UI 主壳是 [`src/components/WeaveApp.svelte`](src/components/WeaveApp.svelte)：负责响应式容器（侧栏 / 主面板检测）、页面路由（`DeckStudyPage` / `WeaveCardManagementPage` / `AIAssistantPage` / 设置）、移动端 / 平板适配、主题监听。

---

## 5. 数据层与存储边界

[`src/config/paths.ts`](src/config/paths.ts) 是 **所有数据路径的单一事实源**，并明确分两类：

### 5.1 Vault 内数据（`weave/`，建议跨设备同步）

```text
weave/
├── memory/                 # 记忆牌组：decks.json、cards/、learning/sessions/、media/
├── incremental-reading/    # IR：blocks.json、chunks.json、sources.json、materials/、IR/
└── question-bank/          # 题库：banks.json、question-stats.json、test-history.json、error-book.json…
```

- 用户主动可见、可读、可修改；卡片本体是带 YAML frontmatter 的 Markdown 文件。
- 支持自定义父目录（`plugin.settings.weaveParentFolder`），如 `projects/Weave/`。

### 5.2 插件目录数据（`.obsidian/plugins/weave/`，建议本地保存）

```text
.obsidian/plugins/weave/
├── state/                  # user-profile.json、import-mappings.json、study-session.json、quality-inbox.json…
├── cache/                  # indices/、migration/、editor-temp/
└── backups/                # 自动 / 手动备份快照
```

- 仅本机使用；与 vault 数据严格隔离，避免备份意外被同步删除。

### 5.3 关键服务

| 服务 | 文件 | 角色 |
|---|---|---|
| `WeaveDataStorage` | [`src/data/storage.ts`](src/data/storage.ts) | 核心 I/O：通过 Obsidian Vault API 读写 cards / decks / sessions；含 300 ms 防抖 flush |
| `DeckStorageAdapter` | [`src/services/storage/DeckStorageAdapter.ts`](src/services/storage/DeckStorageAdapter.ts) | 牌组缓存层（`Map<deckId, DeckInfo>`） |
| `UUIDStorageImpl` | [`src/services/storage/UUIDStorageImpl.ts`](src/services/storage/UUIDStorageImpl.ts) | 全局 UUID 持久化（解析 / 同步去重） |
| `CardIndexService` | [`src/services/data/CardIndexService.ts`](src/services/data/CardIndexService.ts) | 反向索引 `UUID → deckId`，60 s TTL；批量删卡 2500 ms → 5 ms |
| `DirectFileCardReader` | [`src/services/data/DirectFileCardReader.ts`](src/services/data/DirectFileCardReader.ts) | 跳过 API 直读文件，单卡 60×、批量 10× 提速；双索引（uuid + blockId） |
| `GlobalDataCache` | [`src/services/GlobalDataCache.ts`](src/services/GlobalDataCache.ts) | 启动后预热的全局缓存 |
| `PluginLocalStateService` | [`src/services/plugin-state/PluginLocalStateService.ts`](src/services/plugin-state/PluginLocalStateService.ts) | 本机状态：会话续学、视图偏好、AI 历史 |

### 5.4 Markdown 卡片解析

[`src/parsers/`](src/parsers/) 提供卡片类型双向解析：
- `MarkdownFieldsConverter.ts`：Markdown ↔ 结构化字段的抽象基类
- `card-type-parsers/`：`QACardParser`（基础问答）、`ChoiceCardParser`（单/多选）、`ClozeCardParser`（挖空）
- `regex-patterns.ts`：元数据 / 关联链接的正则集合

---

## 6. 三大核心领域

### 6.1 记忆牌组：FSRS6 调度

#### `FSRS6CoreAlgorithm`（[`src/algorithms/fsrs6-core.ts`](src/algorithms/fsrs6-core.ts)）
- 版本 6.1.1，21 个权重参数（`w` 数组）。
- 卡片状态 `FSRS6Card`：`due / stability / difficulty / elapsedDays / scheduledDays / reps / lapses / state / retrievability`。
- 评分 `Rating`：Again(1) / Hard(2) / Good(3) / Easy(4)。
- 状态机：`New → Learning / Review`；失败时进入 `Relearning`。
- 进阶因子：
  - **短期记忆因子**（`w17 / w18`）：1–3 天内复习的奖励；
  - **长期稳定因子**（`w19 / w20`）：30 天以上间隔的奖励；
  - **Fuzz 抖动**：>2.5 天间隔时 ±5% 随机化，避免大量卡同日到期。
- 自带参数验证（越界自动修正）、难度 `[1, 10]` 钳制。

#### `EnhancedFSRS`（[`src/algorithms/enhanced-fsrs.ts`](src/algorithms/enhanced-fsrs.ts)）
- 在基础 FSRS 上叠加 **个性化层**：当用户历史 ≥50 次复习时，重新拟合权重。
- `MemoryCurvePoint`：预测第 N 天的留存率 + 置信区间。
- `PersonalizedInsight`：可执行建议（性能 / 排程 / 难度 / 方法 / 焦点 5 个维度，按优先级与置信度排序）。
- `LearningPattern`：最佳学习时段、单次时长、稳定性分数、留存趋势（前半段 vs 后半段，差异 ≥10% 才视为显著）。

#### `StudySessionManager`（[`src/services/StudySessionManager.ts`](src/services/StudySessionManager.ts)）
- 单例，分离 **运行期会话状态** 与 **持久化卡片数据**——避免会话内的临时步骤污染 FSRS 字段。
- 关键字段：`learningStepIndex / interactionCount / startTime / currentState`。
- 流程：`createSession` → `getSessionState / updateStepIndex` → `finalizeSession`（产出 `FSRSUpdateData` 再落盘）→ `dispose`（2 小时自动过期）。
- 配套 `persistSession` / `restoreSession` 支持暂停续学。

### 6.2 刷题牌组：EWMA 趋势追踪

#### `AccuracyCalculator`（[`src/services/question-bank/AccuracyCalculator.ts`](src/services/question-bank/AccuracyCalculator.ts)）
- **指数加权移动平均**：`R_t = α × result_t + (1 − α) × R_{t−1}`。
- 参数：`BASE_ALPHA = 0.2`、`MODE_WEIGHT = 1.5`、`CONFIDENCE_SCALE = 20`。
- 输出 `MasteryMetrics`：
  - `currentAccuracy`（EWMA，强调近期）、`historicalAccuracy`（简单平均，作对照）；
  - `confidence`：sigmoid 形式按样本量缩放（n=20 ≈ 63%）；
  - `status`：`mastered`（≥90% + 连续 3 次）/ `proficient`（≥75%）/ `learning` / `struggling` / `needs_review` / `insufficient_data`；
  - `trend`：前/后半段对比（improving / stable / declining）；
  - `effectiveSampleSize ≈ 1/α ≈ 5` 次等效测试。

#### `TestSessionManager`（[`src/services/question-bank/TestSessionManager.ts`](src/services/question-bank/TestSessionManager.ts)）
- 配置 `bankId / mode / questionCount / timeLimit`，记录 `AnswerSubmission`，落盘成历史以供 EWMA 计算。

#### 题型支持（[`src/types/question-bank-types.ts`](src/types/question-bank-types.ts)）
`single_choice / multiple_choice / cloze / short_answer`，含 `choices / correctAnswer / distractors / explanation`，`clozeOptions` 把每个挖空序号映射到选择列表。

### 6.3 增量阅读：TVP-DS / FSRS-V4 派生调度

[`src/services/incremental-reading/`](src/services/incremental-reading/) 是仓库最深的服务域之一：

| 子模块 | 职责 |
|---|---|
| `IRStorageService.ts` | 持久化层（`blocks.json` / `history.json` / `sync-state.json`） |
| `ReadingMaterialManager.ts` | 材料导入（分类、优先级、标签、来源追踪） |
| `IRScheduleKernel.ts` | 排程内核：监听状态变化（`complete_block / change_priority / manual_reschedule / import_materials / settings_changed / ui_refresh`）触发重算 |
| `IRV4SchedulerService.ts` + `IRCoreAlgorithmsV4.ts` | 基于 FSRS 的间隔调度 + 认知画像；优先级 = 手动覆盖 + 有效优先级 + 截止日期分 |
| `IREpubBookmarkTaskService.ts` | EPUB 书签任务（`epubbm-` 前缀）：TOC href、CFI 续读点、目录深度 |
| `IRPdfBookmarkTaskService.ts` | PDF 书签任务（`pdfbm-` 前缀）：页码链接 + 注释元数据 |
| `IRQueueGenerator.ts` + `IRInterleaveScheduler.ts` | 队列生成与穿插策略 |
| `ContentObserver.ts` | 监听 DOM 变化（图片加载、折叠开合、滚动、视口尺寸）以维护位置 |
| `IRAnalyticsService.ts` | 分析：触发 `recomputeScheduleForDeck("ui_refresh")` 等 |

数据落点：`weave/incremental-reading/`（`blocks / chunks / sources / materials / IR/` markdown 输出）。

---

## 7. 周边功能

### 7.1 EPUB 阅读器（[`src/services/epub/`](src/services/epub/) + [`src/components/epub/`](src/components/epub/)）
- 核心引擎：`FoliateReaderService.ts`（实现 `EpubReaderEngine` 接口）+ `FoliateVaultPublicationParser.ts`（基于 `foliate-js/epub.js` 解析 EPUB、转换 HTML、维护元数据）。
- 标注：`EpubAnnotationService.ts` 记录 `ReaderHighlight`（颜色、位置、选区、时间戳），明暗主题各自一套色板。
- 反向链接：`EpubBacklinkHighlightService.ts`（约 30 KB）把高亮文字与 vault 双链关联。
- 截图：`EpubScreenshotService.ts` + `ScreenshotOverlay.svelte` 把视口截图存为附件，与标注元数据并存。
- 书架：`BookshelfView.svelte` 列出已导入 EPUB；`EpubCanvasService.ts` 可生成对应 `.canvas` 图。
- UI：`EpubReaderApp.svelte`、`EpubReaderView.svelte`、`SelectionToolbar / EpubHighlightToolbar / TableOfContents / BookmarkPanel / NotesPanel`。

### 7.2 AnkiConnect 同步（[`src/services/ankiconnect/`](src/services/ankiconnect/)）
- 协议层：`AnkiConnectClient.ts` 通过 `localhost:8765` 调用 AnkiConnect API；`ConnectionManager.ts` 处理版本/连接状态。
- 双向同步：
  - **Weave → Anki**（`CardExporter.ts`）：字段别名（如 `front → ["question","Q","问题"]`）；模板不匹配时归档至 `Weave::模型迁移存档` 牌组；
  - **Anki → Weave**（`CardImporter.ts` + `AnkiImportAdapter` + `ImportMappingManager` + `BackupManager`）：导入前先备份 Anki 状态。
- 格式转换：`ObsidianToAnkiConverter.ts` / `AnkiTemplateConverter.ts` / `ContentFormatConverter.ts`（HTML/Markdown）+ `WeaveNativeTemplates.ts`（标准模板映射）。
- 增量：`SyncStateTracker.ts`、`IncrementalSyncTracker.ts`（diff 自上次同步以来的字段改动）、`MediaSyncService.ts`（媒体附件）。

### 7.3 AI 助手（[`src/services/ai/`](src/services/ai/) + [`src/components/ai-assistant/`](src/components/ai-assistant/)）
- 工厂模式：`AIServiceFactory.ts` 按设置实例化具体 Provider；现有 `AnthropicService / OpenAIService / GeminiService / DeepSeekService / SiliconFlowService / ZhipuService`。
- HTTP：经 `ObsidianRequestAdapter.ts` 走 Obsidian 的 HTTP API。
- 功能：
  - 卡片生成 `AICardGenerationService.ts`（按 60 字前缀大小写不敏感去重、限流告警、`onProgress / onCardsUpdate` 回调）；
  - 卡片切分 `AISplitService.ts`（长内容拆多卡）；
  - 字段标准化 `CardConverter.ts`；
  - 提示词 `PromptBuilderService.ts` + `PromptVariableResolver.ts`（变量插值）。
- UI：`EditorAICardToolbar.svelte`（编辑器内联工具栏）、`SelectedTextAICardPanel.svelte`、`AIConfigModal.svelte`、`CardPreviewModal.svelte`。

### 7.4 批量解析（Markdown → 卡片）
两套互补的触发器：

1. **自动触发**：[`src/services/BatchParsingFileWatcher.ts`](src/services/BatchParsingFileWatcher.ts) 监听 `vault.on('modify')`，按 includeFolders / excludeFolders 过滤，配合防抖；命中"批量解析范围"标记后调用 `SimplifiedCardParser`。
2. **手动触发**：`BatchParsingManager` + 命令面板（`batch-parse-current-file` / `batch-parse-all-mappings`）。

三种解析架构（[`src/services/batch-parsing/`](src/services/batch-parsing/) + [`src/utils/simplifiedParser/`](src/utils/simplifiedParser/)）：
- **单卡场景**：`SingleCardParser` + `SingleCardSyncEngine`，UUID 写入 frontmatter、按 mtime 同步；
- **多卡正则**：`RegexCardParser` + `RegexPresets`（自定义分隔符 / 分隔符预设）；
- **遗留兼容**：`SimplifiedCardParser`（LRU 1000 / 5 min TTL）。

主编排：`SimpleBatchParsingService.ts`（约 54 KB）→ `FolderDeckMapping` → `DeckMappingService` → `UUIDManager`（去重 + 位置追踪）→ `ThreeWayMergeEngine`（vault / Anki / 本地编辑三向合并）→ `FrontmatterManager` 注入 YAML、`CardDeletionMarker` 标删、`ContentModifier` 重写正文。

### 7.5 图片遮罩（[`src/services/image-mask/`](src/services/image-mask/) + [`src/components/image-mask/`](src/components/image-mask/)）
- 解析：`MaskDataParser.ts` 从 HTML 注释里读出遮罩数据；支持 Wiki/Markdown 图片链接、PNG/JPG/JPEG/GIF/BMP/WebP/SVG/AVIF/TIFF/HEIC/ICO 等多格式。
- 操作：`mask-operations.ts` 提供形状创建 / 更新 / 变换。
- 渲染：`MaskRenderer.ts`（≈18 KB，SVG 渲染）。
- UI：`ImageMaskModal.svelte`（≈21 KB 主模态）、`MaskEditorSVG.svelte`（≈16 KB SVG 编辑器，刷子 / 选择工具）、`MaskShape / MaskShapeV2.svelte`。

### 7.6 渐进式挖空（[`src/services/progressive-cloze/`](src/services/progressive-cloze/)）
- 分析：`ProgressiveClozeAnalyzer.ts` 提取 `{{c1::text}}` / `{{c1::text::hint}}` 语法（兼容 Anki），输出 `ClozeData[]` 与 `shouldSplit`（≥2 个挖空时建议切分），支持 `validateClozeNumbers`（连续性、空缺、重复检测）。
- UUID：哈希式 `cloze-{ord}-{hash}`，编辑后仍稳定可追踪。
- 网关：`ProgressiveClozeGateway.ts` 双闸门——
  - 闸门 1：新建卡片时自动检测多挖空 → 转为父卡 + 子卡集合；
  - 闸门 2：内容编辑时检测类型变化（progressive ↔ simple、ord 变化）。
- 类型：`ProgressiveClozeParentCard / ProgressiveClozeChildCard`（v2 扁平结构，无嵌套）；`ClozeMap` 存父卡元数据、`ChildClozeMetadata` 存子卡当前激活的 ord/UUID/text/hint。

### 7.7 引入式牌组（一卡多组）
[`src/services/reference-deck/ReferenceDeckService.ts`](src/services/reference-deck/ReferenceDeckService.ts)：
- 多对多："`Deck.cardUUIDs`" 仅作缓存，**真值在 `Card.metadata.we_decks`**（YAML 字段）。
- 操作：`createDeckFromCards` / `addCardsToDeck` / `removeCardsFromDeck` / `dissolveDeck`（解散后孤儿卡入库追踪）。
- 冲突解决永远偏向 `Card.we_decks`，缓存只是次级索引。

### 7.8 卡片质量收件箱（[`src/services/card-quality/CardQualityInboxService.ts`](src/services/card-quality/CardQualityInboxService.ts)）
- 扫描重复、空内容、格式问题、孤儿卡。
- 输出 `QualityIssue[]`（severity high/medium/low、type、resolved），落盘为 `PersistedInboxData`。
- API：`scanCards(cards, config) → ScanResult`、`getInboxState() → { issues, unresolvedCount }`。

---

## 8. 基础设施

### 8.1 启动编排（[`src/services/ServiceInitializer.ts`](src/services/ServiceInitializer.ts)）
四阶段：
1. **CORE**（串行）；2. **INDEPENDENT**（并行）；3. **DEPENDENT**（按依赖图序）；4. **OPTIONAL**（容错）。
追踪 `success / duration / errors`，关键失败会阻断启动；并行化使启动加速 30–50%。

### 8.2 数据迁移（[`src/services/data-migration/`](src/services/data-migration/)）
- `UnifiedDataMigrationService.ts`：识别数据来源（`configured-root / legacy-plugin-root / legacy-hidden-root (.tuanki/) / legacy-machine-root (weave/_data/)`），返回 `DataLayoutResolution`（父目录 / v2 路径 / 插件路径 / IR 导入目录）。
- `LegacyWeaveFolderMigration.ts`：折叠级搬迁（如 `deck-graphs/` → `memory/deck-graphs`、`epub-reading/` → `ir/epub/`），通过 `DirectoryUtils.ensureDirRecursive` 原子创建。
- 路径重写：`rewriteKnownPathReferences` 在迁移后修复链接引用。
- 状态：迁移过程记录于 `.obsidian/plugins/weave/cache/migration/`。

### 8.3 备份（[`src/services/backup/`](src/services/backup/)）
- `SmartBackupEngine`：触发源 `AUTO_IMPORT / AUTO_SYNC / SCHEDULED / PRE_UPDATE / MANUAL_REQUEST`；保留策略 3 自动 + 3 手动；进度回调推送 UI。
- `AutoBackupScheduler`：周期性备份。
- 备份落点 `.obsidian/plugins/weave/backups/`，故意与 `weave/` 数据目录隔离。

### 8.4 许可证与高级功能门槛
- [`src/services/premium/PremiumFeatureGuard.ts`](src/services/premium/PremiumFeatureGuard.ts)：枚举 `GRID_VIEW / KANBAN_VIEW / TIMELINE_VIEW / AI_ASSISTANT / INCREMENTAL_READING / BATCH_PARSING / QUESTION_BANK / DECK_ANALYTICS / PROGRESSIVE_CLOZE / CSV_IMPORT / CLIPBOARD_IMPORT / VIEW_SOURCE`，并附名称 / 描述 / 图标。
- [`src/utils/licenseManager.ts`](src/utils/licenseManager.ts)：RSA 公钥校验签名（私钥在服务端）；设备指纹（OS / 屏幕 / 时区 / 硬件细节）；设备数限制；类型 `lifetime / subscription`。
- [`src/types/license.ts`](src/types/license.ts)：`LicenseInfo` + `CloudSyncInfo`（同步状态、最后校验时间、设备 ID 与上限）。
- 网络面：仅在用户手动激活 / AI 调用 / AnkiConnect 时联网，AnkiConnect 仅 `localhost`。

### 8.5 响应式状态（[`src/stores/`](src/stores/)）
| Store | 用途 |
|---|---|
| `CardEditStore.ts` | 编辑器内卡片内容 / 元数据 |
| `ai-config.store.ts` | AI 模型 / 提供商 / 生成配置 |
| `study-mode-store.ts` | 当前学习会话与卡片复习态 |
| `unified-state-manager.ts` | 全局状态聚合（≈14 KB） |
| `mask-store.ts` | 挖空 / 遮罩展示态 |
| `BackupReactiveStore.ts` | 备份进度与历史 |
| `EditorStore.ts` / `ir-active-document-store.ts` / `epub-active-document-store.ts` | 模块自有上下文 |

---

## 9. 跨域联动：闭环如何形成

```
   ┌───────────────────────────────┐
   │       外部材料 (PDF/EPUB/Web) │
   └──────────────┬────────────────┘
                  │ 导入
                  ▼
   ┌───────────────────────────────┐
   │ 阅读牌组 IR                    │
   │  · ReadingMaterialManager     │
   │  · IRScheduleKernel (TVP-DS)  │
   │  · 摘录笔记 (块引用)          │
   └──────────────┬────────────────┘
                  │ 选中 → 创建卡片
                  ▼
   ┌───────────────────────────────┐
   │ 记忆牌组 (Memory)              │
   │  · FSRS6 调度                 │
   │  · ReferenceDeckService       │
   │    （一张卡进多个牌组）        │
   │  · ProgressiveCloze / 图片遮罩│
   └──────────────┬────────────────┘
                  │ 卡片 → 出题
                  ▼
   ┌───────────────────────────────┐
   │ 刷题牌组 (Question Bank)       │
   │  · TestSessionManager         │
   │  · AccuracyCalculator (EWMA)  │
   │  · 错题本、趋势图              │
   └──────────────┬────────────────┘
                  │ 反向定位
                  ▼
        块链接 / 双链 / 知识图谱
```

- **块引用** 把摘录、卡片、题目两两挂钩：从一张错题能跳回原始摘录；从摘录能列出全部派生卡片。
- **关联文档** 模式（侧栏）以当前编辑文档为锚，自动筛出由它衍生的全部摘录 / 卡片 / 题目。
- **引入式牌组**：卡片不属于单一牌组，可被多组同时使用，牌组解散重组不损失卡片。

---

## 10. 命令与设置面板

`main.ts` 注册了 30+ 命令，覆盖：

| 类别 | 代表命令 |
|---|---|
| 批量解析 | `batch-parse-current-file`、`batch-parse-all-mappings` |
| 学习 | `open-study-view`、`open-deck-study` |
| 增量阅读 | `import-ir-materials`、`open-ir-focus` |
| 卡片操作 | `create-card`、`edit-card`、`bulk-edit-cards` |
| 数据 | `sync-ankiconnect`、`export-apkg`、`repair-data` |
| 管理 | `open-settings`、`run-migration`、`backup-data` |

`WeaveSettings`（[`src/main.ts:212`](src/main.ts) 起）覆盖：每日新卡 / 复习量、学习步、FSRS 参数与个性化开关、IR 配置（call-out 信号、IR 输出目录、chunk/topic）、题库（牌组配对、错题本、进行中追踪）、AI（多 Provider Keys、提示词模板、卡片切分、系统提示）、AnkiConnect（同步、字段映射、牌组）、许可证、自动备份、UI（视图风格、浮动创建按钮）、批量解析（分隔符、挖空标记、符号驱动解析）。

---

## 11. 开发与构建

```bash
npm install
npm run dev          # Vite watch；若 .env 设置 OBSIDIAN_VAULT_PATH 会自动同步到 plugins/weave/
npm run build        # 生产构建（4 GB heap），postbuild 复制 manifest
npm run test         # Vitest 一次性
npm run check        # svelte-check 类型检查
npm run lint:check   # Biome lint
npm run format       # Biome format
```

辅助脚本：
- [`scripts/dev-watch.cjs`](scripts/dev-watch.cjs)：开发监听 + 暂存式热同步
- [`scripts/hot-reload-utils.cjs`](scripts/hot-reload-utils.cjs)：暂存到目标目录的原子拷贝工具
- [`scripts/copy-manifest.cjs`](scripts/copy-manifest.cjs)：postbuild 拷贝 manifest
- [`scripts/clean-cache.cjs`](scripts/clean-cache.cjs)：清理 Vite / 构建缓存
- [`scripts/kill-vite.cjs`](scripts/kill-vite.cjs)：杀掉残留 vite 进程

---

## 12. 设计原则速记

1. **单一事实源**：每份数据只有一处权威——`Card.metadata.we_decks` 高于 `Deck.cardUUIDs` 缓存；YAML frontmatter 高于运行期字段；`config/paths.ts` 高于散落的路径常量。
2. **同步数据 vs 本地状态严格隔离**：`weave/` 跨设备同步；`.obsidian/plugins/weave/` 仅本机。
3. **可观测的迁移**：每次启动都跑统一迁移；状态写入缓存；路径引用在迁移后被 `rewriteKnownPathReferences` 修复。
4. **性能优先的索引层**：`CardIndexService`（反向索引）+ `DirectFileCardReader`（直读 + 双索引）+ 文件 watcher，让大库下的查删保持 O(1)/常数时间。
5. **服务即业务**：`src/services/` 持有产品规则，不只是适配器；UI 不应跨服务直接改共享缓存。
6. **闸门式特性切分**：渐进式挖空、参考牌组、批量解析的"自动 vs 手动"双触发，都是先识别再决策的"网关"模式。
7. **付费与免费的功能门槛清晰**：`PremiumFeatureGuard` 用稳定的 feature ID 控制升级/降级体验，未授权时显示降级 UI 而不是隐藏。

---

> **备注**
> - 仓库内 `.idea/`、`.desktop-hot-reload/`、`node_modules/` 与构建产物 `dist/` 并非源码。
> - `package.json` 中部分 `dev:mobile` / `deploy:mobile` 等脚本所指向的辅助脚本未全部出现在 `scripts/` 目录中；若需要移动端流程请先核对路径。
> - README 引用的 `docs/RELEASE_GUIDE.md` 与 `docs/IMAGE_MASK_GUIDE.md` 未在当前 checkout 中提供；本文档不依赖它们。
