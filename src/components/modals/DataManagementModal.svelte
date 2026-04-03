<!--
  数据管理与质量扫描统一模态窗
  职责：通过标签页切换数据管理和卡片质量扫描功能
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Notice } from 'obsidian';
  import { logger } from '../../utils/logger';
  import type { WeavePlugin } from '../../main';
  import type { Card } from '../../data/types';
  import { 
    getDataManagementService,
    DEFAULT_BATCH_FIX_TYPES,
    HIGH_RISK_FIX_TYPES,
    isHighRiskFixType,
    type DataCheckResult,
    type DataFixResult,
    type CheckType
  } from '../../services/data-management/DataManagementService';
  import type { 
    ScanResult, 
    QualityIssue, 
    ScanConfig,
    QualityIssueType 
  } from '../../types/card-quality-types';
  import { DEFAULT_SCAN_CONFIG } from '../../types/card-quality-types';
  import { getCardQualityInboxService, CardQualityInboxService } from '../../services/card-quality/CardQualityInboxService';
  import type { IssueSeverity } from '../../types/card-quality-types';
  import EnhancedIcon from '../ui/EnhancedIcon.svelte';
  import EnhancedButton from '../ui/EnhancedButton.svelte';
  import { showDangerConfirm } from '../../utils/obsidian-confirm';

  // ===== Props =====
  interface Props {
    /** 插件实例 */
    plugin: WeavePlugin;
    /** 当前筛选的卡片（质量扫描用） */
    cards?: Card[];
    /** 全部卡片（用于“扫描全部”范围） */
    allCards?: Card[];
    /** 初始标签页 */
    initialTab?: 'data' | 'quality';
  }

  let {
    plugin,
    cards = [],
    allCards = [],
    initialTab = 'data'
  }: Props = $props();
  
  // 扫描范围
  type ScanScope = 'filtered' | 'all';
  let scanScope = $state<ScanScope>('filtered');
  let scanTargetCards = $derived(scanScope === 'all' ? allCards : cards);

  // ===== 标签页 =====
  type TabId = 'data' | 'quality';
  let activeTab = $state<TabId>(initialTab);
  
  function handleTabChange(tabId: TabId) {
    activeTab = tabId;
  }

  // ===== 数据管理 State =====
  let isChecking = $state(false);
  let isFixing = $state(false);
  let isMigrating = $state(false);
  let checkResults = $state<DataCheckResult[]>([]);
  let fixResults = $state<DataFixResult[]>([]);
  let migrationResults = $state<DataCheckResult[]>([]);
  let latestMigrationSummary = $state<{ targetRoot: string; movedFiles: number; conflicts: number; rewrittenReferences: number; remainingLegacyRoots: number; reportTime: string } | null>(null);
  let logs = $state<string[]>([]);
  let progressMessage = $state('');
  let progressCurrent = $state(0);
  let progressTotal = $state(0);
  let progressPercent = $derived(progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0);

  // ===== 质量扫描 State =====
  let isScanning = $state(false);
  let scanProgress = $state({ current: 0, total: 0, phase: 'preparing' as string, message: '' });
  let scanResult = $state<ScanResult | null>(null);
  let scanConfig = $state<ScanConfig>({ ...DEFAULT_SCAN_CONFIG });
  let scanView = $state<'config' | 'scanning' | 'result'>('config');
  let selectedIssues = $state(new Set<string>());
  
  // 筛选和排序状态
  let filterSeverity = $state<IssueSeverity | 'all'>('all');
  let filterType = $state<QualityIssueType | 'all'>('all');
  let sortBy = $state<'severity' | 'type'>('severity');

  // 问题类型标签映射
  const issueTypeLabels: Record<QualityIssueType, string> = {
    duplicate_exact: '完全重复',
    duplicate_similar: '内容相似',
    empty_content: '内容为空',
    too_short: '内容过短',
    too_long: '内容过长',
    missing_answer: '缺少答案',
    missing_question: '缺少问题',
    low_retention: '低保留率',
    high_difficulty: '高难度',
    orphan_card: '孤儿卡片',
    invalid_format: '格式无效',
    source_missing: '源文档缺失'
  };

  // 严重程度颜色
  const severityColors = {
    error: 'var(--color-red)',
    warning: 'var(--color-yellow)',
    info: 'var(--color-blue)'
  };

  // 按卡片UUID分组问题
  interface GroupedIssue {
    cardUuid: string;
    issues: QualityIssue[];
    issueIds: string[];
  }

  // 基于当前 issues 动态计算统计，忽略项目变化后会自动更新
  let currentIssues = $derived(scanResult?.issues ?? []);
  let computedStats = $derived.by(() => {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = { error: 0, warning: 0, info: 0 };
    for (const issue of currentIssues) {
      byType[issue.type] = (byType[issue.type] || 0) + 1;
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }
    return { byType, bySeverity };
  });
  
  // 筛选后的问题列表
  let filteredIssues = $derived.by(() => {
    if (!scanResult) return [];
    return scanResult.issues.filter(issue => {
      if (filterSeverity !== 'all' && issue.severity !== filterSeverity) return false;
      if (filterType !== 'all' && issue.type !== filterType) return false;
      return true;
    });
  });
  
  let groupedIssues = $derived.by(() => {
    if (!filteredIssues.length) return [];
    const groups = new Map<string, GroupedIssue>();
    for (const issue of filteredIssues) {
      if (!groups.has(issue.cardUuid)) {
        groups.set(issue.cardUuid, { cardUuid: issue.cardUuid, issues: [], issueIds: [] });
      }
      const group = groups.get(issue.cardUuid)!;
      group.issues.push(issue);
      group.issueIds.push(issue.id);
    }
    
    // 排序
    const result = Array.from(groups.values());
    if (sortBy === 'severity') {
      const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
      result.sort((a, b) => {
        const aMin = Math.min(...a.issues.map(i => severityOrder[i.severity] ?? 3));
        const bMin = Math.min(...b.issues.map(i => severityOrder[i.severity] ?? 3));
        return aMin - bMin;
      });
    }
    return result;
  });

  // ===== Service =====
  const dataService = getDataManagementService(plugin);

  async function refreshLatestMigrationSummary() {
    const report = await dataService.getLatestMigrationReport();
    if (!report) {
      latestMigrationSummary = null;
      return;
    }

    latestMigrationSummary = {
      targetRoot: report.plan.targetRoot,
      movedFiles: report.movedFiles,
      conflicts: report.conflicts,
      rewrittenReferences: report.rewrittenReferences,
      remainingLegacyRoots: report.verification?.remainingLegacyRoots.length ?? report.untouchedLegacyRoots.length,
      reportTime: report.completedAt || report.startedAt,
    };
  }

  // ===== Methods =====
  function addLog(message: string) {
    const time = new Date().toLocaleTimeString();
    logs = [...logs, `[${time}] ${message}`];
  }

  function getHighRiskFixWarning(type: CheckType): string {
    switch (type) {
      case 'duplicate_cards':
        return '这会删除重复卡片，并重写牌组里的卡片引用。';
      case 'ir_material_consistency':
        return '这会清理失效的增量阅读材料记录、孤立块和无效引用。';
      case 'filename_compatibility':
        return '这会重命名真实文件和文件夹，并同步回写内部路径引用。';
      case 'sync_conflict_files':
        return '这会处理云同步冲突副本：能恢复或合并的会恢复，不能自动合并的会转存到插件备份目录。';
      case 'progressive_cloze_unconverted':
        return '这会把符合渐进挖空格式的卡片转换成父子卡片结构。';
      case 'legacy_cleanup':
        return '这会删除旧版数据目录，只应在迁移完成并核对无误后执行。';
      default:
        return '这项修复会直接改写真实数据，请在确认后执行。';
    }
  }

  async function confirmHighRiskFix(type: CheckType): Promise<boolean> {
    return showDangerConfirm(
      plugin.app,
      `${getTypeName(type)} 将直接修改真实数据。\n${getHighRiskFixWarning(type)}\n建议先完成检查并确认结果无误。`,
      `确认执行 ${getTypeName(type)}`
    );
  }

  async function handleCheckAll() {
    isChecking = true;
    checkResults = [];
    addLog('开始全面检测...');

    try {
      checkResults = await dataService.checkAll((current, total, msg) => {
        progressCurrent = current;
        progressTotal = total;
        progressMessage = msg;
      });

      const totalIssues = checkResults.reduce((sum, r) => sum + r.count, 0);
      addLog(`检测完成，发现 ${totalIssues} 个问题`);
    } catch (e) {
      addLog(`检测失败: ${e}`);
    } finally {
      isChecking = false;
      progressMessage = '';
      progressCurrent = 0;
      progressTotal = 0;
    }
  }

  async function handleFixAll() {
    isFixing = true;
    fixResults = [];
    addLog('开始一键修复...');

    try {
      fixResults = await dataService.fixAll((current, total, msg) => {
        progressCurrent = current;
        progressTotal = total;
        progressMessage = msg;
      });

      const totalSuccess = fixResults.reduce((sum, r) => sum + r.success, 0);
      const totalFailed = fixResults.reduce((sum, r) => sum + r.failed, 0);
      addLog(`修复完成，成功 ${totalSuccess}，失败 ${totalFailed}`);

      // 重新检测
      addLog(`一键修复仅执行安全项：${DEFAULT_BATCH_FIX_TYPES.map(type => getTypeName(type)).join('、')}`);
      addLog(`以下高风险项需单独确认：${HIGH_RISK_FIX_TYPES.map(type => getTypeName(type)).join('、')}`);
      await handleCheckAll();
    } catch (e) {
      addLog(`修复失败: ${e}`);
    } finally {
      isFixing = false;
      progressMessage = '';
      progressCurrent = 0;
      progressTotal = 0;
    }
  }

  async function handleCheck(type: CheckType) {
    isChecking = true;
    addLog(`检测 ${getTypeName(type)}...`);

    try {
      const result = await dataService.check(type);
      
      // 更新或添加结果
      const existingIndex = checkResults.findIndex(r => r.type === type);
      if (existingIndex >= 0) {
        checkResults[existingIndex] = result;
        checkResults = [...checkResults];
      } else {
        checkResults = [...checkResults, result];
      }

      addLog(result.message);
    } catch (e) {
      addLog(`检测失败: ${e}`);
    } finally {
      isChecking = false;
    }
  }

  async function handleFix(type: CheckType) {
    if (isHighRiskFixType(type)) {
      const confirmed = await confirmHighRiskFix(type);
      if (!confirmed) {
        addLog(`已取消 ${getTypeName(type)}`);
        return;
      }
    }

    isFixing = true;
    progressCurrent = 0;
    progressTotal = 1;
    progressMessage = `修复 ${getTypeName(type)}...`;
    addLog(`修复 ${getTypeName(type)}...`);

    try {
      const result = await dataService.fix(type, { allowHighRisk: isHighRiskFixType(type) });
      progressCurrent = 1;
      addLog(`修复完成: 成功 ${result.success}，失败 ${result.failed}`);

      // 重新检测该项
      progressMessage = `重新检测 ${getTypeName(type)}...`;
      await handleCheck(type);
    } catch (e) {
      addLog(`修复失败: ${e}`);
    } finally {
      isFixing = false;
      progressMessage = '';
      progressCurrent = 0;
      progressTotal = 0;
    }
  }

  // ===== 迁移检测方法 =====
  async function handleCheckMigration() {
    isMigrating = true;
    migrationResults = [];
    addLog('开始迁移相关检测...');

    try {
      // 检测 Schema 迁移状态
      const schemaResult = await dataService.checkSchemaMigration();
      migrationResults = [...migrationResults, schemaResult];
      
      // 检测目录结构
      const structureResult = await dataService.checkStructure();
      migrationResults = [...migrationResults, structureResult];
      
      // 检测旧目录
      const legacyResult = await dataService.checkLegacyDirectories();
      migrationResults = [...migrationResults, legacyResult];

      await refreshLatestMigrationSummary();

      const totalIssues = migrationResults.reduce((sum, r) => sum + r.count, 0);
      addLog(`迁移检测完成，发现 ${totalIssues} 个问题`);
    } catch (e) {
      addLog(`迁移检测失败: ${e}`);
    } finally {
      isMigrating = false;
    }
  }

  async function handleExecuteMigration() {
    const confirmed = await showDangerConfirm(
      plugin.app,
      '这会移动真实数据到当前标准目录，并重写内部路径引用。\n迁移过程中会保留冲突副本并生成迁移报告。',
      '确认执行数据迁移'
    );
    if (!confirmed) {
      addLog('已取消 Schema V2 数据迁移');
      return;
    }

    isMigrating = true;
    addLog('开始执行 Schema V2 迁移...');

    try {
      const result = await dataService.executeSchemaMigration({ confirmed: true });
      await refreshLatestMigrationSummary();
      addLog(`迁移完成: 成功 ${result.success}，失败 ${result.failed}`);
      
      // 重新检测
      await handleCheckMigration();
    } catch (e) {
      addLog(`迁移执行失败: ${e}`);
    } finally {
      isMigrating = false;
    }
  }

  async function handleFixStructure() {
    isMigrating = true;
    addLog('开始修复目录结构...');

    try {
      const result = await dataService.fixStructure();
      addLog(`修复完成: 成功创建 ${result.success} 个目录，失败 ${result.failed} 个`);
      
      // 重新检测目录结构
      const structureResult = await dataService.checkStructure();
      const existingIndex = migrationResults.findIndex(r => r.type === 'structure_check');
      if (existingIndex >= 0) {
        migrationResults[existingIndex] = structureResult;
        migrationResults = [...migrationResults];
      }
    } catch (e) {
      addLog(`修复失败: ${e}`);
    } finally {
      isMigrating = false;
    }
  }

  async function handleCleanupLegacy() {
    const confirmed = await showDangerConfirm(
      plugin.app,
      '这会删除旧版数据目录。\n只有在最新迁移已经完成并核对无误后才应该执行。',
      '确认清理旧目录'
    );
    if (!confirmed) {
      addLog('已取消旧目录清理');
      return;
    }

    isMigrating = true;
    addLog('开始清理旧目录...');

    try {
      const result = await dataService.cleanupLegacyDirectories({ allowHighRisk: true });
      addLog(`清理完成: 成功删除 ${result.success} 个目录，失败 ${result.failed} 个`);
      
      // 重新检测旧目录
      const legacyResult = await dataService.checkLegacyDirectories();
      const existingIndex = migrationResults.findIndex(r => r.type === 'legacy_cleanup');
      if (existingIndex >= 0) {
        migrationResults[existingIndex] = legacyResult;
        migrationResults = [...migrationResults];
      }
    } catch (e) {
      addLog(`清理失败: ${e}`);
    } finally {
      isMigrating = false;
    }
  }

  function getTypeName(type: CheckType): string {
    if (type === 'ir_topic_migration') return '增量阅读专题迁移';
    const names: Record<string, string> = {
      'yaml_migration': 'YAML 元数据迁移',
      'we_decks_fix': 'we_decks 牌组 ID',
      'we_block_migration': 'we_block 合并迁移',
      'deprecated_fields': '弃用字段',
      'card_deck_consistency': '引用式牌组一致性',
      'ir_material_consistency': '导入材料一致性',
      'orphan_cards': '孤立卡片',
      'duplicate_cards': '重复卡片',
      'invalid_refs': '无效引用',
      'schema_migration': 'Schema V2 数据迁移',
      'structure_check': '目录结构核对',
      'legacy_cleanup': '旧目录清理',
      'filename_compatibility': '文件名云同步兼容性',
      'sync_conflict_files': '云同步冲突副本',
      'progressive_cloze_unconverted': '渐进式挖空未转换',
      'progressive_cloze_orphan': '渐进式挖空孤儿子卡片',
      'progressive_cloze_missing_children': '渐进式挖空缺少子卡片',
      'progressive_cloze_extra_children': '渐进式挖空多余子卡片'
    };
    return names[type] || type;
  }

  function getStatusClass(status: string): string {
    switch (status) {
      case 'ok': return 'status-ok';
      case 'warning': return 'status-warning';
      case 'error': return 'status-error';
      default: return '';
    }
  }

  function getResultCountText(result: DataCheckResult): string {
    return result.count > 0 ? `发现 ${result.count} 项` : '正常';
  }

  // ===== 质量扫描方法 =====
  // 通过服务层剥离 YAML frontmatter 后再显示内容
  function getCardDisplayContent(card: Card | undefined, maxLen: number = 50): string {
    if (!card) return '(无内容)';
    return CardQualityInboxService.getDisplayContent(card, maxLen);
  }

  function truncateUUID(uuid: string, maxLen: number = 12): string {
    return uuid.length > maxLen ? uuid.slice(0, maxLen) + '...' : uuid;
  }

  function isGroupSelected(group: GroupedIssue): boolean {
    return group.issueIds.every(id => selectedIssues.has(id));
  }

  function toggleGroupSelection(group: GroupedIssue) {
    const allSelected = isGroupSelected(group);
    if (allSelected) {
      group.issueIds.forEach(id => selectedIssues.delete(id));
    } else {
      group.issueIds.forEach(id => selectedIssues.add(id));
    }
    selectedIssues = new Set(selectedIssues);
  }

  function toggleSelectAll() {
    if (scanResult) {
      if (selectedIssues.size === scanResult.issues.length) {
        selectedIssues.clear();
      } else {
        selectedIssues = new Set(scanResult.issues.map(i => i.id));
      }
      selectedIssues = new Set(selectedIssues);
    }
  }

  async function startScan() {
    isScanning = true;
    scanView = 'scanning';
    scanResult = null;
    
    try {
      const service = getCardQualityInboxService(plugin);
      const cardsToScan = scanScope === 'all' ? allCards : cards;
      const result = await service.scanCards(cardsToScan, scanConfig, (progress) => {
        scanProgress = progress;
      });
      
      scanResult = result;
      scanView = 'result';
      
      if (result.issues.length === 0) {
        new Notice('扫描完成，未发现质量问题');
      } else {
        new Notice(`扫描完成，发现 ${result.issues.length} 个问题`);
      }
    } catch (error) {
      logger.error('[DataManagement] 扫描失败:', error);
      new Notice('扫描失败: ' + (error instanceof Error ? error.message : String(error)));
      scanView = 'config';
    } finally {
      isScanning = false;
    }
  }

  function rescan() {
    scanView = 'config';
    scanResult = null;
  }

  async function batchIgnoreSelected() {
    if (selectedIssues.size === 0) return;
    if (scanResult) {
      scanResult = {
        ...scanResult,
        issues: scanResult.issues.filter(i => !selectedIssues.has(i.id))
      };
    }
    new Notice(`已忽略 ${selectedIssues.size} 个问题`);
    selectedIssues.clear();
    selectedIssues = new Set(selectedIssues);
  }


  async function viewCard(cardUuid: string) {
    try {
      const card = await plugin.directFileReader.getCardByUUID(cardUuid);
      if (card) {
        plugin.openViewCardModal(card);
      } else {
        new Notice('找不到该卡片');
      }
    } catch (error) {
      logger.error('[DataManagement] 查看卡片失败:', error);
      new Notice('查看卡片失败');
    }
  }
  
  // 编辑卡片
  async function editCard(cardUuid: string) {
    try {
      const card = await plugin.directFileReader.getCardByUUID(cardUuid);
      if (card) {
        if (typeof plugin.openEditCardModal === 'function') {
          plugin.openEditCardModal(card);
        } else {
          new Notice('编辑功能不可用');
        }
      } else {
        new Notice('找不到该卡片');
      }
    } catch (error) {
      logger.error('[DataManagement] 编辑卡片失败:', error);
      new Notice('编辑卡片失败');
    }
  }
  
  // 删除卡片
  async function deleteCard(cardUuid: string) {
    try {
      const card = await plugin.directFileReader.getCardByUUID(cardUuid);
      if (!card) {
        new Notice('找不到该卡片');
        return;
      }
      if (plugin.dataStorage) {
        await plugin.dataStorage.deleteCard(cardUuid);
        // 从扫描结果中移除该卡片的所有问题
        if (scanResult) {
          scanResult = {
            ...scanResult,
            issues: scanResult.issues.filter(i => i.cardUuid !== cardUuid)
          };
        }
        new Notice('卡片已删除');
      }
    } catch (error) {
      logger.error('[DataManagement] 删除卡片失败:', error);
      new Notice('删除卡片失败');
    }
  }
  
  // 重置筛选
  function resetFilters() {
    filterSeverity = 'all';
    filterType = 'all';
  }

  // 初始化时自动检测
  onMount(() => {
    if (activeTab === 'data') {
      handleCheckAll();
      void refreshLatestMigrationSummary();
    }
  });
</script>

<div class="unified-management-modal">
    <!-- 顶部导航栏：分段标签 + 上下文操作 -->
    <div class="modal-header-bar">
      <div class="segmented-tabs">
        <button
          class="seg-tab"
          class:active={activeTab === 'data'}
          onclick={() => handleTabChange('data')}
        >
          <EnhancedIcon name="database" size={14} />
          数据管理
        </button>
        <button
          class="seg-tab"
          class:active={activeTab === 'quality'}
          onclick={() => handleTabChange('quality')}
        >
          <EnhancedIcon name="search" size={14} />
          质量扫描
        </button>
      </div>
      <div class="header-actions">
        {#if activeTab === 'data'}
          <button
            class="header-action-btn"
            onclick={handleCheckAll}
            disabled={isChecking || isFixing}
            title="检测全部"
          >
            {#if isChecking}
              <EnhancedIcon name="loader" size={14} animation="spin" />
            {:else}
              <EnhancedIcon name="refresh-cw" size={14} />
            {/if}
            <span>检测全部</span>
          </button>
          <button
            class="header-action-btn fix"
            onclick={handleFixAll}
            disabled={isChecking || isFixing || checkResults.every(r => r.count === 0)}
            title="一键修复"
          >
            {#if isFixing}
              <EnhancedIcon name="loader" size={14} animation="spin" />
            {:else}
              <EnhancedIcon name="wrench" size={14} />
            {/if}
            <span>一键修复</span>
          </button>
        {:else if activeTab === 'quality' && scanView === 'result'}
          <button
            class="header-action-btn"
            onclick={rescan}
            title="重新扫描"
          >
            <EnhancedIcon name="refresh-cw" size={14} />
            <span>重新扫描</span>
          </button>
        {/if}
      </div>
    </div>

    <!-- 标签页内容 -->
    <div class="modal-tab-content">
      {#if activeTab === 'data'}
        <!-- 数据管理标签页 -->
        <div class="data-management-content">
          <!-- 检测状态 -->
          <section class="section">
            <h3 class="section-title">数据检测</h3>
      <div class="check-results">
        {#if checkResults.length === 0 && !isChecking}
          <div class="empty-state">点击"检测全部"开始检测</div>
        {/if}

        {#each checkResults as result}
          <div class="check-item {getStatusClass(result.status)}">
            <div class="check-info">
              <div class="check-title-row">
                <span class="check-name">{getTypeName(result.type)}</span>
                <div class="check-badges">
                  <span class={`check-status-pill ${getStatusClass(result.status)}`}>{getResultCountText(result)}</span>
                  {#if result.count > 0 && isHighRiskFixType(result.type)}
                    <span class="check-risk-pill">高风险</span>
                  {/if}
                </div>
              </div>
              <span class="check-message">{result.message}</span>
              {#if result.items.length > 0 && (result.type === 'filename_compatibility' || result.type === 'sync_conflict_files')}
                <div class="check-details">
                  {#each result.items.slice(0, 5) as item}
                    <span class="detail-item">{item}</span>
                  {/each}
                  {#if result.items.length > 5}
                    <span class="detail-more">...还有 {result.items.length - 5} 个</span>
                  {/if}
                </div>
              {/if}
            </div>
            <div class="check-actions">
              <EnhancedButton
                variant="ghost"
                size="sm"
                onclick={() => handleCheck(result.type)}
                disabled={isChecking || isFixing}
                tooltip="重新检测"
              >
                <EnhancedIcon name="refresh-cw" size={14} />
              </EnhancedButton>
              {#if result.count > 0}
                <EnhancedButton
                  variant="ghost"
                  size="sm"
                  onclick={() => handleFix(result.type)}
                  disabled={isChecking || isFixing}
                  tooltip="修复"
                >
                  <EnhancedIcon name="wrench" size={14} />
                </EnhancedButton>
              {/if}
            </div>
          </div>
        {/each}

        {#if isChecking || isFixing}
          <div class="batch-progress-container">
            <div class="batch-progress-header">
              <EnhancedIcon name="loader" size={14} animation="spin" />
              <span class="batch-progress-label">{isFixing ? '修复中' : '检测中'}...</span>
              <span class="batch-progress-count">{progressCurrent}/{progressTotal}</span>
            </div>
            <div class="batch-progress-bar">
              <div class="batch-progress-fill" style="width: {progressPercent}%"></div>
            </div>
            <span class="batch-progress-message">{progressMessage}</span>
          </div>
        {/if}
            </div>
          </section>

          <!-- 数据迁移与结构核对 -->
          <section class="section">
            <h3 class="section-title">数据迁移与结构核对</h3>
            <div class="migration-actions">
              <EnhancedButton
                variant="secondary"
                size="sm"
                onclick={handleCheckMigration}
                disabled={isMigrating || isChecking || isFixing}
              >
                {#if isMigrating}
                  <EnhancedIcon name="loader" size={14} animation="spin" />
                {:else}
                  <EnhancedIcon name="folder-search" size={14} />
                {/if}
                检测迁移状态
              </EnhancedButton>
            </div>
            {#if latestMigrationSummary}
              <div class="check-item latest-migration-summary">
                <div class="check-info">
                  <span class="check-name">最近一次迁移报告</span>
                  <span class="check-message">目标路径：{latestMigrationSummary.targetRoot}</span>
                  <div class="check-details">
                    <span class="detail-item">迁移文件 {latestMigrationSummary.movedFiles}</span>
                    <span class="detail-item">冲突 {latestMigrationSummary.conflicts}</span>
                    <span class="detail-item">重写引用 {latestMigrationSummary.rewrittenReferences}</span>
                    <span class="detail-item">剩余旧路径 {latestMigrationSummary.remainingLegacyRoots}</span>
                    <span class="detail-item">时间 {latestMigrationSummary.reportTime}</span>
                  </div>
                </div>
              </div>
            {/if}
            <div class="check-results">
              {#each migrationResults as result}
                <div class="check-item {getStatusClass(result.status)}">
                  <div class="check-info">
                    <div class="check-title-row">
                      <span class="check-name">{getTypeName(result.type)}</span>
                      <div class="check-badges">
                        <span class={`check-status-pill ${getStatusClass(result.status)}`}>{getResultCountText(result)}</span>
                        {#if result.count > 0 && isHighRiskFixType(result.type)}
                          <span class="check-risk-pill">高风险</span>
                        {/if}
                      </div>
                    </div>
                    <span class="check-message">{result.message}</span>
                    {#if result.items.length > 0 && result.type === 'legacy_cleanup'}
                      <div class="check-details">
                        {#each result.items.slice(0, 3) as item}
                          <span class="detail-item">{item}</span>
                        {/each}
                        {#if result.items.length > 3}
                          <span class="detail-more">...还有 {result.items.length - 3} 个</span>
                        {/if}
                      </div>
                    {/if}
                  </div>
                  <div class="check-actions">
                    {#if result.type === 'schema_migration' && result.count > 0}
                      <EnhancedButton
                        variant="primary"
                        size="sm"
                        onclick={handleExecuteMigration}
                        disabled={isMigrating}
                        tooltip="执行迁移"
                      >
                        <EnhancedIcon name="play" size={14} />
                        迁移
                      </EnhancedButton>
                    {/if}
                    {#if result.type === 'structure_check' && result.count > 0}
                      <EnhancedButton
                        variant="ghost"
                        size="sm"
                        onclick={handleFixStructure}
                        disabled={isMigrating}
                        tooltip="创建缺失目录"
                      >
                        <EnhancedIcon name="folder-plus" size={14} />
                      </EnhancedButton>
                    {/if}
                    {#if result.type === 'legacy_cleanup' && result.count > 0}
                      <EnhancedButton
                        variant="ghost"
                        size="sm"
                        onclick={handleCleanupLegacy}
                        disabled={isMigrating}
                        tooltip="清理旧目录"
                      >
                        <EnhancedIcon name="trash-2" size={14} />
                      </EnhancedButton>
                    {/if}
                  </div>
                </div>
              {/each}

              {#if isMigrating}
                <div class="progress-indicator">
                  <EnhancedIcon name="loader" size={16} animation="spin" />
                  <span>处理中...</span>
                </div>
              {/if}
            </div>
          </section>

          <!-- 操作日志 -->
          <section class="section">
            <h3 class="section-title">操作日志</h3>
            <div class="log-container">
              {#each logs as log}
                <div class="log-item">{log}</div>
              {/each}
              {#if logs.length === 0}
                <div class="empty-state">暂无日志</div>
              {/if}
            </div>
          </section>
        </div>
      {:else if activeTab === 'quality'}
        <!-- 质量扫描标签页 -->
        <div class="quality-scan-content">
          {#if scanView === 'config'}
            <!-- 配置视图 -->
            <div class="scan-info">
              <EnhancedIcon name="info" size={18} />
              <div class="scan-scope-area">
                <span>扫描范围:</span>
                <label class="scope-option">
                  <input type="radio" name="scan-scope" value="filtered" bind:group={scanScope} />
                  <span>当前筛选 ({cards.length})</span>
                </label>
                {#if allCards.length > 0 && allCards.length !== cards.length}
                <label class="scope-option">
                  <input type="radio" name="scan-scope" value="all" bind:group={scanScope} />
                  <span>全部卡片 ({allCards.length})</span>
                </label>
                {/if}
              </div>
            </div>
            
            <div class="config-section">
              <h3 class="section-title">扫描选项</h3>
              <div class="config-grid">
                <label class="config-item">
                  <input type="checkbox" bind:checked={scanConfig.detectDuplicates} />
                  <span>检测重复卡片</span>
                </label>
                <label class="config-item">
                  <input type="checkbox" bind:checked={scanConfig.detectEmpty} />
                  <span>检测空内容</span>
                </label>
                <label class="config-item">
                  <input type="checkbox" bind:checked={scanConfig.detectShort} />
                  <span>检测过短内容</span>
                </label>
                <label class="config-item">
                  <input type="checkbox" bind:checked={scanConfig.detectLong} />
                  <span>检测过长内容</span>
                </label>
                <label class="config-item">
                  <input type="checkbox" bind:checked={scanConfig.detectOrphans} />
                  <span>检测孤儿卡片</span>
                </label>
                <label class="config-item">
                  <input type="checkbox" bind:checked={scanConfig.detectMissingSource} />
                  <span>检测源文档缺失</span>
                </label>
                <label class="config-item">
                  <input type="checkbox" bind:checked={scanConfig.detectFSRSIssues} />
                  <span>检测学习问题</span>
                </label>
              </div>
            </div>
            
            {#if scanConfig.detectDuplicates}
            <div class="config-section">
              <h3 class="section-title">重复检测阈值</h3>
              <div class="slider-container">
                <input type="range" min="0.5" max="1" step="0.05" bind:value={scanConfig.similarityThreshold} />
                <span class="slider-value">{(scanConfig.similarityThreshold * 100).toFixed(0)}%</span>
              </div>
              <p class="hint">相似度达到此阈值的卡片将被标记为相似</p>
            </div>
            {/if}
            
            {#if scanConfig.detectShort || scanConfig.detectLong}
            <div class="config-section">
              <h3 class="section-title">内容长度阈值</h3>
              <div class="threshold-row">
                {#if scanConfig.detectShort}
                <label class="threshold-item">
                  <span>最短字符数</span>
                  <input type="number" min="1" max="100" bind:value={scanConfig.minContentLength} class="threshold-input" />
                </label>
                {/if}
                {#if scanConfig.detectLong}
                <label class="threshold-item">
                  <span>最长字符数</span>
                  <input type="number" min="100" max="10000" step="100" bind:value={scanConfig.maxContentLength} class="threshold-input" />
                </label>
                {/if}
              </div>
            </div>
            {/if}
            
            <div class="action-buttons">
              <EnhancedButton variant="primary" onclick={startScan} disabled={scanTargetCards.length === 0}>
                <EnhancedIcon name="search" size={16} />
                扫描 {scanTargetCards.length} 张卡片
              </EnhancedButton>
            </div>
            
          {:else if scanView === 'scanning'}
            <!-- 扫描进度视图 -->
            <div class="scanning-view">
              <div class="scan-spinner"></div>
              <div class="progress-info">
                <p class="phase-text">{scanProgress.message}</p>
                <div class="progress-bar">
                  <div class="progress-fill" style="width: {scanProgress.total > 0 ? (scanProgress.current / scanProgress.total * 100) : 0}%"></div>
                </div>
                <p class="progress-text">{scanProgress.current} / {scanProgress.total}</p>
              </div>
            </div>
            
          {:else if scanView === 'result'}
            <!-- 结果视图 -->
            {#if scanResult}
              <!-- Bug#4: 使用动态计算的统计数据 -->
              <div class="result-summary">
                <div class="summary-item">
                  <span class="summary-label">扫描卡片</span>
                  <span class="summary-value">{scanResult.totalCards}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">发现问题</span>
                  <span class="summary-value" class:has-issues={currentIssues.length > 0}>{currentIssues.length}</span>
                </div>
                <div class="summary-item error">
                  <span class="summary-label">严重</span>
                  <span class="summary-value">{computedStats.bySeverity.error}</span>
                </div>
                <div class="summary-item warning">
                  <span class="summary-label">警告</span>
                  <span class="summary-value">{computedStats.bySeverity.warning}</span>
                </div>
                <div class="summary-item info">
                  <span class="summary-label">提示</span>
                  <span class="summary-value">{computedStats.bySeverity.info}</span>
                </div>
              </div>
              
              {#if currentIssues.length === 0}
                <div class="no-issues">
                  <EnhancedIcon name="check-circle" size={48} />
                  <h3>未发现质量问题</h3>
                  <p>所有卡片均符合质量标准</p>
                </div>
              {:else}
                <!-- UX#12: 筛选栏 -->
                <div class="scan-filter-bar">
                  <select class="scan-filter-select" bind:value={filterSeverity}>
                    <option value="all">全部严重程度</option>
                    <option value="error">严重 ({computedStats.bySeverity.error})</option>
                    <option value="warning">警告 ({computedStats.bySeverity.warning})</option>
                    <option value="info">提示 ({computedStats.bySeverity.info})</option>
                  </select>
                  <select class="scan-filter-select" bind:value={filterType}>
                    <option value="all">全部类型</option>
                    {#each Object.entries(computedStats.byType) as [type, count]}
                      <option value={type}>{issueTypeLabels[type as QualityIssueType]} ({count})</option>
                    {/each}
                  </select>
                  {#if filterSeverity !== 'all' || filterType !== 'all'}
                    <button class="scan-filter-reset" onclick={resetFilters}>清除筛选</button>
                  {/if}
                  <span class="scan-filter-count">{filteredIssues.length}/{currentIssues.length}</span>
                </div>
                
                <div class="issues-table-container">
                  <table class="issues-table">
                    <thead>
                      <tr>
                        <th class="col-checkbox">
                          <input type="checkbox" checked={selectedIssues.size === filteredIssues.length && filteredIssues.length > 0} onchange={toggleSelectAll} />
                        </th>
                        <th class="col-id">卡片ID</th>
                        <th class="col-content">卡片内容</th>
                        <th class="col-issue">存在问题</th>
                        <th class="col-action">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each groupedIssues as group}
                        {@const card = cards.find(c => c.uuid === group.cardUuid)}
                        <tr class:selected={isGroupSelected(group)}>
                          <td class="col-checkbox">
                            <input type="checkbox" checked={isGroupSelected(group)} onchange={() => toggleGroupSelection(group)} />
                          </td>
                          <td class="col-id">
                            <span class="uuid-text" title={group.cardUuid}>{truncateUUID(group.cardUuid)}</span>
                          </td>
                          <td class="col-content">
                            <span class="content-text" title={card ? CardQualityInboxService.getDisplayContent(card, 200) : ''}>{getCardDisplayContent(card)}</span>
                          </td>
                          <td class="col-issue">
                            <div class="issue-badges">
                              {#each group.issues as issue}
                                <span class="issue-badge" style="border-left: 3px solid {severityColors[issue.severity]}">{issueTypeLabels[issue.type]}</span>
                              {/each}
                            </div>
                          </td>
                          <td class="col-action">
                            <div class="action-btn-group">
                              <button class="view-card-btn" onclick={() => viewCard(group.cardUuid)} title="查看卡片">
                                <EnhancedIcon name="eye" size={14} />
                              </button>
                              <button class="view-card-btn" onclick={() => editCard(group.cardUuid)} title="编辑卡片">
                                <EnhancedIcon name="edit" size={14} />
                              </button>
                              <button class="view-card-btn delete-btn" onclick={() => deleteCard(group.cardUuid)} title="删除卡片">
                                <EnhancedIcon name="trash-2" size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
              
              {#if selectedIssues.size > 0}
              <div class="result-actions">
                <EnhancedButton variant="secondary" onclick={batchIgnoreSelected}>
                  <EnhancedIcon name="x" size={14} />
                  忽略选中 ({selectedIssues.size})
                </EnhancedButton>
              </div>
              {/if}
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  </div>

<style>
  .unified-management-modal {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background-primary);
  }

  .modal-header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
    gap: 12px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent),
      var(--background-primary);
  }

  .segmented-tabs {
    display: flex;
    align-items: center;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    padding: 4px;
    gap: 4px;
  }

  .seg-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0.45rem 0.95rem;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .seg-tab:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .seg-tab.active {
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    box-shadow:
      0 8px 18px rgba(15, 23, 42, 0.08),
      0 1px 2px rgba(15, 23, 42, 0.06);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 36px;
    padding: 0.45rem 0.9rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    background: var(--interactive-normal);
    color: var(--text-normal);
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .header-action-btn:hover:not(:disabled) {
    background: var(--interactive-hover);
    border-color: var(--background-modifier-border-hover);
  }

  .header-action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .header-action-btn.fix {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
  }

  .header-action-btn.fix:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
    border-color: var(--interactive-accent-hover);
  }

  .modal-tab-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }

  .data-management-content {
    padding: 18px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .quality-scan-content {
    padding: 18px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .scan-info {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 16px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.015), transparent), var(--background-secondary-alt, var(--background-secondary));
    border: 1px solid var(--background-modifier-border);
    border-radius: 14px;
    font-size: 13px;
  }

  .scan-scope-area {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .scope-option {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    cursor: pointer;
    font-size: 13px;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .scope-option:hover {
    background: var(--background-modifier-hover);
    border-color: var(--background-modifier-border-hover);
  }

  .scope-option input[type="radio"] {
    margin: 0;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.015), transparent), var(--background-secondary-alt, var(--background-secondary));
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .section-title::before {
    content: '';
    width: 4px;
    height: 15px;
    border-radius: 999px;
    background: var(--interactive-accent);
    opacity: 0.85;
  }

  .check-results {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .check-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 13px 14px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 14px;
    transition: border-color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
  }

  .check-item:hover {
    border-color: var(--background-modifier-border-hover);
    background: color-mix(in srgb, var(--background-primary) 92%, var(--background-modifier-hover));
  }

  .check-item.latest-migration-summary {
    background: color-mix(in srgb, var(--background-primary) 88%, var(--background-secondary));
  }

  .check-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .check-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .check-name {
    font-weight: 650;
    font-size: 0.92rem;
    color: var(--text-normal);
  }

  .check-message {
    font-size: 0.79rem;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .check-badges {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .check-status-pill,
  .check-risk-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  .check-status-pill.status-ok {
    background: rgba(34, 197, 94, 0.1);
    color: rgb(21, 128, 61);
    border-color: rgba(34, 197, 94, 0.16);
  }

  .check-status-pill.status-warning {
    background: rgba(245, 158, 11, 0.12);
    color: rgb(180, 83, 9);
    border-color: rgba(245, 158, 11, 0.18);
  }

  .check-status-pill.status-error {
    background: rgba(239, 68, 68, 0.12);
    color: rgb(185, 28, 28);
    border-color: rgba(239, 68, 68, 0.18);
  }

  .check-risk-pill {
    background: rgba(168, 85, 247, 0.12);
    color: rgb(126, 34, 206);
    border-color: rgba(168, 85, 247, 0.18);
  }

  .check-actions {
    display: flex;
    gap: 6px;
    align-self: flex-start;
    flex-shrink: 0;
    padding-top: 2px;
  }

  .batch-progress-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    background: var(--background-primary);
    border-radius: 14px;
    border: 1px solid var(--background-modifier-border);
  }

  .batch-progress-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-normal);
  }

  .batch-progress-label {
    font-weight: 500;
  }

  .batch-progress-count {
    margin-left: auto;
    font-family: var(--font-monospace);
    font-size: 12px;
    color: var(--text-muted);
  }

  .batch-progress-bar {
    width: 100%;
    height: 6px;
    background: var(--background-modifier-border);
    border-radius: 3px;
    overflow: hidden;
  }

  .batch-progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .batch-progress-message {
    font-size: 12px;
    color: var(--text-muted);
  }


  .log-container {
    max-height: 150px;
    overflow-y: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 14px;
    padding: 10px 14px;
    font-family: var(--font-monospace);
    font-size: 11px;
  }

  .log-item {
    padding: 4px 0;
    color: var(--text-muted);
    border-bottom: 1px dashed rgba(128, 128, 128, 0.12);
  }

  .log-item:last-child {
    border-bottom: none;
  }

  .empty-state {
    padding: 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }

  :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ===== 质量扫描样式 ===== */
  .config-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.015), transparent), var(--background-secondary-alt, var(--background-secondary));
  }

  .config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .config-item {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 10px 12px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .config-item:hover {
    background: var(--background-modifier-hover);
    border-color: var(--background-modifier-border-hover);
  }

  .config-item input[type="checkbox"] {
    margin: 0;
  }

  .slider-container {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .slider-container input[type="range"] {
    flex: 1;
  }

  .slider-value {
    min-width: 50px;
    text-align: right;
    font-weight: 600;
    color: var(--text-accent);
  }

  .hint {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.45;
  }

  .action-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: auto;
    padding-top: 14px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .scanning-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
    flex: 1;
    min-height: 200px;
    padding: 24px;
    border-radius: 16px;
    border: 1px solid var(--background-modifier-border);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.015), transparent), var(--background-secondary-alt, var(--background-secondary));
  }

  .scan-spinner {
    width: 48px;
    height: 48px;
    border: 4px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .progress-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    width: 100%;
    max-width: 400px;
  }

  .phase-text {
    font-size: 14px;
    color: var(--text-muted);
    margin: 0;
  }

  .progress-bar {
    width: 100%;
    height: 8px;
    background: var(--background-secondary);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
  }

  .result-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
  }

  .summary-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 14px 16px;
    background: var(--background-secondary-alt, var(--background-secondary));
    border: 1px solid var(--background-modifier-border);
    border-radius: 14px;
    min-width: 0;
  }

  .summary-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .summary-value {
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--text-normal);
    line-height: 1;
  }

  .summary-value.has-issues {
    color: var(--color-red);
  }

  .summary-item.error .summary-value {
    color: var(--color-red);
  }

  .summary-item.warning .summary-value {
    color: var(--color-yellow);
  }

  .no-issues {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex: 1;
    color: var(--color-green);
    min-height: 150px;
  }

  .no-issues h3 {
    margin: 0;
    color: var(--text-normal);
  }

  .no-issues p {
    margin: 0;
    color: var(--text-muted);
  }

  .issues-table-container {
    flex: 1;
    overflow-y: auto;
    border: 1px solid var(--background-modifier-border);
    border-radius: 14px;
    background: var(--background-secondary-alt, var(--background-secondary));
    max-height: 300px;
  }

  .issues-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .issues-table thead {
    position: sticky;
    top: 0;
    background: var(--background-secondary);
    z-index: 1;
    box-shadow: inset 0 -1px 0 var(--background-modifier-border);
  }

  .issues-table th {
    padding: 11px 12px;
    text-align: left;
    font-weight: 600;
    color: var(--text-muted);
    border-bottom: 1px solid var(--background-modifier-border);
    white-space: nowrap;
    font-size: 0.74rem;
    letter-spacing: 0.02em;
  }

  .issues-table td {
    padding: 11px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    vertical-align: middle;
  }

  .issues-table tbody tr {
    transition: background 0.15s ease;
  }

  .issues-table tbody tr:hover {
    background: var(--background-modifier-hover);
  }

  .issues-table tbody tr.selected {
    background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-primary));
  }

  .col-checkbox { width: 40px; text-align: center; }
  .col-id { width: 120px; }
  .col-content { min-width: 200px; }
  .col-issue { width: 150px; }
  .col-action { width: 100px; text-align: center; }

  .uuid-text {
    font-family: var(--font-monospace);
    font-size: 12px;
    color: var(--text-muted);
  }

  .content-text {
    color: var(--text-normal);
    display: block;
    max-width: 250px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .issue-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .issue-badge {
    display: inline-block;
    padding: 4px 8px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-normal);
    white-space: nowrap;
  }

  .view-card-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .view-card-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-accent);
  }

  .delete-btn:hover {
    color: var(--color-red);
  }

  .action-btn-group {
    display: flex;
    gap: 2px;
  }

  /* info 级别摘要颜色 */
  .summary-item.info .summary-value {
    color: var(--color-blue);
  }

  /* 筛选栏 */
  .scan-filter-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    flex-wrap: wrap;
    background: var(--background-secondary-alt, var(--background-secondary));
    border: 1px solid var(--background-modifier-border);
    border-radius: 14px;
  }

  .scan-filter-select {
    min-height: 32px;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 12px;
  }

  .scan-filter-reset {
    min-height: 32px;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: pointer;
    font-size: 12px;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .scan-filter-reset:hover {
    background: var(--background-modifier-hover);
    border-color: var(--background-modifier-border-hover);
  }

  .scan-filter-count {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 600;
  }

  /* 长度阈值配置 */
  .threshold-row {
    display: flex;
    gap: 16px;
  }

  .threshold-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-normal);
  }

  .threshold-input {
    width: 80px;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 13px;
  }

  .result-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 14px;
    border-top: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
  }

  .action-spacer {
    flex: 1;
  }

  /* 迁移相关样式 */
  .migration-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
  }

  .check-details {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }

  .detail-item {
    font-size: 11px;
    padding: 4px 8px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    color: var(--text-muted);
    font-family: var(--font-monospace);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .detail-more {
    font-size: 11px;
    color: var(--text-faint);
    font-style: italic;
  }

  /* ==================== 移动端适配 ==================== */

  /* 顶部导航栏：换行为两行，tabs上 actions下 */
  :global(body.is-mobile) .modal-header-bar {
    flex-wrap: wrap;
    padding: 12px 14px;
    gap: 8px;
  }

  :global(body.is-mobile) .segmented-tabs {
    flex: 1 1 100%;
  }

  :global(body.is-mobile) .seg-tab {
    flex: 1;
    justify-content: center;
    padding: 8px 10px;
    min-height: 36px;
  }

  /* 操作按钮：隐藏文字只保留图标，增大触控区域 */
  :global(body.is-mobile) .header-actions {
    margin-left: auto;
    gap: 8px;
  }

  :global(body.is-mobile) .header-action-btn {
    padding: 8px 12px;
    min-height: 36px;
    min-width: 36px;
    justify-content: center;
  }

  :global(body.is-mobile) .header-action-btn span {
    display: none;
  }

  /* 内容区间距 */
  :global(body.is-mobile) .data-management-content,
  :global(body.is-mobile) .quality-scan-content {
    padding: 12px;
    gap: 12px;
  }

  :global(body.is-mobile) .section,
  :global(body.is-mobile) .config-section {
    padding: 14px;
  }

  /* 检测项：垂直堆叠 info 和 actions */
  :global(body.is-mobile) .check-item {
    flex-wrap: wrap;
    padding: 12px;
    gap: 8px;
  }

  :global(body.is-mobile) .check-info {
    flex: 1 1 0;
    min-width: 0;
  }

  :global(body.is-mobile) .check-name {
    font-size: 12px;
  }

  :global(body.is-mobile) .check-message {
    font-size: 11px;
    word-break: break-all;
  }

  :global(body.is-mobile) .check-actions {
    margin-left: auto;
    gap: 6px;
  }

  :global(body.is-mobile) .check-title-row {
    gap: 8px;
  }

  /* 迁移按钮 */
  :global(body.is-mobile) .migration-actions {
    margin-bottom: 8px;
  }

  /* 日志区域 */
  :global(body.is-mobile) .log-container {
    max-height: 120px;
    padding: 8px 10px;
    font-size: 10px;
  }

  /* 进度条 */
  :global(body.is-mobile) .batch-progress-container {
    padding: 10px;
  }

  :global(body.is-mobile) .batch-progress-header {
    font-size: 12px;
  }

  :global(body.is-mobile) .result-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
</style>
