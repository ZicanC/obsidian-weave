<script lang="ts">
  import type { GenerationConfig, CustomSystemPrompt, PromptTemplate } from '../../types/ai-types';
  import type { WeavePlugin } from '../../main';
  import ObsidianIcon from '../ui/ObsidianIcon.svelte';
  import ObsidianDropdown from '../ui/ObsidianDropdown.svelte';
  import { PromptBuilderService } from '../../services/ai/PromptBuilderService';
  import { OFFICIAL_SYSTEM_PROMPTS, getOfficialSystemPromptById } from '../../constants/official-system-prompts';
  import { Notice } from 'obsidian';
  import { showObsidianConfirm } from '../../utils/obsidian-confirm';
  import { focusManager } from '../../utils/focus-manager';

  interface Props {
    plugin: WeavePlugin;
    config: GenerationConfig;
    isOpen: boolean;
    onClose: () => void;
    onSave: (config: GenerationConfig) => void;
    useObsidianModal?: boolean;
  }

  let {
    plugin,
    config,
    isOpen,
    onClose,
    onSave,
    useObsidianModal = false,
  }: Props = $props();
  let modalEl = $state<HTMLElement | null>(null);
  let lastTrapEl: HTMLElement | null = null;
  let wasOpen = false;

  type TabType = 'system-prompt' | 'ai-config' | 'user-prompt';
  let activeTab = $state<TabType>('ai-config');

  let customSystemPrompts = $state<CustomSystemPrompt[]>([]);
  let selectedSystemPromptId = $state<string | null>(null);
  let editingSystemPromptId = $state<string | null>(null);

  let officialPrompts = $state<PromptTemplate[]>([]);
  let customUserPrompts = $state<PromptTemplate[]>([]);
  let selectedUserPromptId = $state<string | null>(null);
  let editingUserPromptId = $state<string | null>(null);

  function initializeConfig(sourceConfig: GenerationConfig): GenerationConfig {
    const initialized = JSON.parse(JSON.stringify(sourceConfig));

    if (!initialized.provider) {
      initialized.provider = plugin.settings.aiConfig?.defaultProvider || 'zhipu';
    }

    if (!initialized.model) {
      initialized.model = config.model || 'gpt-4';
    }

    if (!initialized.temperature) {
      initialized.temperature = 0.7;
    }
    if (!initialized.maxTokens) {
      initialized.maxTokens = 4000;
    }
    return initialized;
  }
  
  let localConfig = $state<GenerationConfig>(initializeConfig(config));
  
  let validationErrors = $state<string[]>([]);

  function resetConfig() {
    localConfig = initializeConfig(config);
    validationErrors = [];
  }

  function resetToDefaults() {
    localConfig = {
      ...localConfig,
      cardCount: 10,
      difficulty: 'medium',
      typeDistribution: { qa: 50, cloze: 30, choice: 20 },
      autoTags: [],
      enableHints: true
    };
  }

  $effect(() => {
    if (isOpen && !wasOpen) {
      focusManager.saveFocus();
      setTimeout(() => {
        if (modalEl) {
          lastTrapEl = modalEl;
          const firstFocusable = modalEl.querySelector(
            'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ) as HTMLElement | null;
          focusManager.trapFocus(modalEl, firstFocusable ?? undefined);
        }
      }, 0);
    } else if (!isOpen && wasOpen) {
      if (lastTrapEl) {
        focusManager.releaseTrap(lastTrapEl);
      }
      focusManager.restoreFocus();
      lastTrapEl = null;
    }

    wasOpen = isOpen;
  });

  function updateTypeDistribution(type: 'qa' | 'cloze' | 'choice', value: number) {
    const newConfig = { ...localConfig.typeDistribution };
    newConfig[type] = value;
    const others = (['qa', 'cloze', 'choice'] as const).filter(t => t !== type);
    const remaining = 100 - value;
    const currentOthersTotal = others.reduce((sum, t) => sum + newConfig[t], 0);
    
    if (currentOthersTotal > 0) {
      others.forEach(t => {
        newConfig[t] = Math.round((newConfig[t] / currentOthersTotal) * remaining);
      });
    } else {
      newConfig[others[0]] = Math.floor(remaining / 2);
      newConfig[others[1]] = remaining - newConfig[others[0]];
    }

    const total = newConfig.qa + newConfig.cloze + newConfig.choice;
    const diff = 100 - total;
    if (diff !== 0) {
      const adjustable = (['qa', 'cloze', 'choice'] as const).filter(t => t !== type);
      const target = adjustable.reduce((best, cur) => (newConfig[cur] > newConfig[best] ? cur : best), adjustable[0]);
      newConfig[target] = Math.max(0, Math.min(100, newConfig[target] + diff));
    }
    localConfig.typeDistribution = newConfig;
  }

  const visualTypeDistribution = $derived(() => {
    const dist = localConfig.typeDistribution;
    const qa = Number(dist.qa) || 0;
    const cloze = Number(dist.cloze) || 0;
    const choice = Number(dist.choice) || 0;
    const sum = qa + cloze + choice;
    if (sum <= 0) {
      return { qa: 0, cloze: 0, choice: 0 };
    }

    const qaPct = Math.max(0, (qa / sum) * 100);
    const clozePct = Math.max(0, (cloze / sum) * 100);
    const choicePct = Math.max(0, 100 - qaPct - clozePct);
    return { qa: qaPct, cloze: clozePct, choice: choicePct };
  });

  function validateConfig(): boolean {
    const errors: string[] = [];
    if (localConfig.cardCount < 1 || localConfig.cardCount > 50) {
      errors.push('卡片数量必须在 1-50 之间');
    }
    const total = Object.values(localConfig.typeDistribution).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 1) {
      errors.push(`题型分布总和必须为 100%（当前: ${total}%）`);
    }
    validationErrors = errors;
    return errors.length === 0;
  }

  function handleSave() {
    if (validateConfig()) onSave(localConfig);
  }

  function handleClose() {
    resetConfig();
    onClose();
  }

  const headerTabs: { id: TabType; label: string }[] = [
    { id: 'system-prompt', label: '系统提示词' },
    { id: 'ai-config', label: '制卡设置' },
    { id: 'user-prompt', label: '用户提示词' }
  ];

  interface PromptSelectorOption {
    id: string;
    label: string;
    description?: string;
  }

  const BUILTIN_SYSTEM_PROMPT_VALUE = '__builtin_system_prompt__';

  function createUniqueDraftName(existingNames: string[], baseName: string): string {
    const normalized = new Set(existingNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
    let nextIndex = 1;
    let nextName = baseName;
    while (normalized.has(nextName.toLowerCase())) {
      nextIndex += 1;
      nextName = `${baseName} ${nextIndex}`;
    }
    return nextName;
  }

  function isEmptyDraftName(name: string, baseName: string): boolean {
    const normalized = name.trim();
    return normalized === baseName || normalized.startsWith(`${baseName} `);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) handleSave();
  }

  function handleHeaderTabKeydown(event: KeyboardEvent, currentTab: TabType) {
    const currentIndex = headerTabs.findIndex((tab) => tab.id === currentTab);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      nextIndex = currentIndex > 0 ? currentIndex - 1 : headerTabs.length - 1;
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      nextIndex = currentIndex < headerTabs.length - 1 ? currentIndex + 1 : 0;
    } else if (event.key === 'Home') {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      nextIndex = headerTabs.length - 1;
    } else {
      return;
    }

    activeTab = headerTabs[nextIndex].id;

    const container = (event.currentTarget as HTMLElement | null)?.parentElement;
    const nextButton = container?.querySelectorAll<HTMLButtonElement>('.header-tab')[nextIndex];
    nextButton?.focus();
  }

  $effect(() => {
    if (isOpen) {
      const systemConfig = plugin.settings.aiConfig?.systemPromptConfig;
      customSystemPrompts = systemConfig?.customSystemPrompts || [];
      selectedSystemPromptId = systemConfig?.selectedSystemPromptId || null;

      officialPrompts = (plugin.settings.aiConfig?.promptTemplates?.official || []).map(p => ({
        ...p,
        category: 'official' as const,
        useBuiltinSystemPrompt: p.useBuiltinSystemPrompt ?? true
      }));
      customUserPrompts = plugin.settings.aiConfig?.promptTemplates?.custom || [];

      editingSystemPromptId = null;
      editingUserPromptId = null;
    }
  });

  const currentSystemPrompt = $derived(() => {
    return resolveSystemPromptContent(selectedSystemPromptId);
  });

  const currentSystemPromptName = $derived(() => {
    return resolveSystemPromptName(selectedSystemPromptId);
  });

  const currentSystemPromptMeta = $derived(() => {
    if (selectedSystemPromptId === null) {
      return { label: '内置', tone: 'builtin' as const, description: '插件内置默认系统提示词' };
    }

    const official = getOfficialSystemPromptById(selectedSystemPromptId);
    if (official) {
      return { label: '官方', tone: 'official' as const, description: official.description || '官方系统提示词模板' };
    }

    return { label: '自定义', tone: 'custom' as const, description: '你创建的自定义系统提示词' };
  });

  const activeCustomSystemPrompt = $derived(() => {
    if (!selectedSystemPromptId) return null;
    return customSystemPrompts.find((prompt) => prompt.id === selectedSystemPromptId) || null;
  });

  const systemPromptOptions = $derived((): PromptSelectorOption[] => [
    {
      id: BUILTIN_SYSTEM_PROMPT_VALUE,
      label: '内置系统提示词',
      description: '插件内置默认模板'
    },
    ...OFFICIAL_SYSTEM_PROMPTS.map((prompt) => ({
      id: prompt.id,
      label: prompt.name,
      description: prompt.description || '官方系统提示词'
    })),
    ...customSystemPrompts.map((prompt) => ({
      id: prompt.id,
      label: prompt.name,
      description: prompt.description || '自定义系统提示词'
    }))
  ]);

  const selectedSystemPromptValue = $derived(() => selectedSystemPromptId ?? BUILTIN_SYSTEM_PROMPT_VALUE);

  function resolveSystemPromptContent(promptId: string | null): string {
    if (promptId) {
      const official = getOfficialSystemPromptById(promptId);
      if (official) return PromptBuilderService.replaceVariables(official.content, localConfig);
      const custom = customSystemPrompts.find(p => p.id === promptId);
      if (custom) return custom.content;
    }
    return PromptBuilderService.getBuiltinSystemPrompt(localConfig);
  }

  function resolveSystemPromptName(promptId: string | null): string {
    if (promptId) {
      const official = getOfficialSystemPromptById(promptId);
      if (official) return official.name;
      const custom = customSystemPrompts.find(p => p.id === promptId);
      if (custom) return custom.name;
    }
    return '内置系统提示词';
  }

  function handleSystemPromptDropdownChange(nextValue: string) {
    selectSystemPrompt(nextValue === BUILTIN_SYSTEM_PROMPT_VALUE ? null : nextValue);
  }

  function createSystemPrompt() {
    if (customSystemPrompts.length >= 5) {
      new Notice('最多只能创建5个自定义系统提示词');
      return;
    }
    const nextName = createUniqueDraftName(
      customSystemPrompts.map((prompt) => prompt.name),
      '新系统提示词'
    );
    const newPrompt: CustomSystemPrompt = {
      id: `custom-system-prompt-${Date.now()}`,
      name: nextName,
      content: PromptBuilderService.getBuiltinSystemPrompt(localConfig),
      description: '',
      createdAt: new Date().toISOString()
    };
    customSystemPrompts = [...customSystemPrompts, newPrompt];
    selectedSystemPromptId = newPrompt.id;
    editingSystemPromptId = newPrompt.id;
    saveSystemPrompts();
  }

  function editSystemPrompt(id: string) {
    selectedSystemPromptId = id;
    editingSystemPromptId = id;
  }

  async function deleteSystemPrompt(id: string) {
    const promptName = customSystemPrompts.find(p => p.id === id)?.name || '此提示词';
    const confirmed = await showObsidianConfirm(plugin.app, `确定要删除"${promptName}"吗？`, { title: '确认删除' });
    if (confirmed) {
      customSystemPrompts = customSystemPrompts.filter(p => p.id !== id);
      if (selectedSystemPromptId === id) {
        selectedSystemPromptId = null;
      }
      if (editingSystemPromptId === id) {
        editingSystemPromptId = null;
      }
      saveSystemPrompts();
      new Notice(`已删除“${promptName}”`);
    }
  }

  function selectSystemPrompt(id: string | null) {
    selectedSystemPromptId = id;
    editingSystemPromptId = null;
    saveSystemPrompts();
  }

  function updateSystemPrompt(id: string, updates: Partial<CustomSystemPrompt>) {
    const index = customSystemPrompts.findIndex(p => p.id === id);
    if (index >= 0) {
      const nextName = typeof updates.name === 'string' ? updates.name.trim() : '';
      if (nextName) {
        const hasDuplicate = customSystemPrompts.some((prompt) =>
          prompt.id !== id && prompt.name.trim().toLowerCase() === nextName.toLowerCase()
        );
        if (hasDuplicate) {
          new Notice('自定义系统提示词名称不能重复，请换一个名称');
          return;
        }
      }

      customSystemPrompts[index] = {
        ...customSystemPrompts[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      customSystemPrompts = [...customSystemPrompts];
      saveSystemPrompts();
    }
  }

  function cancelSystemPromptEdit() {
    if (editingSystemPromptId) {
      const prompt = customSystemPrompts.find(p => p.id === editingSystemPromptId);
      if (prompt && !prompt.updatedAt && isEmptyDraftName(prompt.name, '新系统提示词') && !prompt.content.trim()) {
        customSystemPrompts = customSystemPrompts.filter(p => p.id !== editingSystemPromptId);
        if (selectedSystemPromptId === editingSystemPromptId) {
          selectedSystemPromptId = null;
        }
        saveSystemPrompts();
      }
    }
    editingSystemPromptId = null;
  }

  async function saveSystemPrompts() {
    if (!plugin.settings.aiConfig) return;
    if (!plugin.settings.aiConfig.systemPromptConfig) {
      plugin.settings.aiConfig.systemPromptConfig = {
        useBuiltin: true,
        customPrompt: ''
      };
    }
    plugin.settings.aiConfig.systemPromptConfig.customSystemPrompts = customSystemPrompts;
    plugin.settings.aiConfig.systemPromptConfig.selectedSystemPromptId = selectedSystemPromptId || undefined;
    await plugin.saveSettings();
  }

  function copySystemPromptToClipboard(promptId: string | null = selectedSystemPromptId) {
    const text = resolveSystemPromptContent(promptId);
    navigator.clipboard.writeText(text).then(() => {
      new Notice(`已复制：${resolveSystemPromptName(promptId)}`);
    }).catch(() => {
      new Notice('复制失败');
    });
  }

  const allUserPrompts = $derived([...officialPrompts, ...customUserPrompts]);
  const currentUserPrompt = $derived(() => {
    if (selectedUserPromptId) {
      return allUserPrompts.find(p => p.id === selectedUserPromptId) || null;
    }
    return null;
  });

  const activeCustomUserPrompt = $derived(() => {
    if (!selectedUserPromptId) return null;
    return customUserPrompts.find((prompt) => prompt.id === selectedUserPromptId) || null;
  });

  const currentUserPromptMeta = $derived(() => {
    const prompt = currentUserPrompt();
    if (!prompt) return null;

    if (prompt.category === 'official') {
      return { label: '官方', tone: 'official' as const, description: '官方提示词模板' };
    }

    return { label: '自定义', tone: 'custom' as const, description: '你创建的自定义提示词' };
  });

  const userPromptOptions = $derived((): PromptSelectorOption[] => [
    ...officialPrompts.map((prompt) => ({
      id: prompt.id,
      label: prompt.name,
      description: '官方提示词'
    })),
    ...customUserPrompts.map((prompt) => ({
      id: prompt.id,
      label: prompt.name,
      description: '自定义提示词'
    }))
  ]);

  const selectedUserPromptValue = $derived(() => selectedUserPromptId ?? '');

  function handleUserPromptDropdownChange(nextValue: string) {
    if (!nextValue) return;
    viewUserPrompt(nextValue);
  }

  function createUserPrompt() {
    const nextName = createUniqueDraftName(
      customUserPrompts.map((prompt) => prompt.name),
      '新提示词'
    );

    const newPrompt: PromptTemplate = {
      id: `custom-prompt-${Date.now()}`,
      name: nextName,
      prompt: '请根据以下内容生成学习卡片',
      variables: ['count', 'difficulty'],
      useBuiltinSystemPrompt: true,
      category: 'custom',
      createdAt: new Date().toISOString()
    };
    customUserPrompts = [...customUserPrompts, newPrompt];
    selectedUserPromptId = newPrompt.id;
    editingUserPromptId = newPrompt.id;
    saveUserPrompts();
  }

  function editUserPrompt(id: string) {
    const prompt = allUserPrompts.find(p => p.id === id);
    if (prompt?.category === 'official') {
      new Notice('官方提示词不可编辑');
      return;
    }
    selectedUserPromptId = id;
    editingUserPromptId = id;
  }

  function viewUserPrompt(id: string) {
    selectedUserPromptId = id;
    editingUserPromptId = null;
  }

  async function deleteUserPrompt(id: string) {
    const prompt = allUserPrompts.find(p => p.id === id);
    if (prompt?.category === 'official') {
      new Notice('官方提示词不可删除');
      return;
    }
    const promptName = prompt?.name || '此提示词';
    const confirmed = await showObsidianConfirm(plugin.app, `确定要删除"${promptName}"吗？`, { title: '确认删除' });
    if (confirmed) {
      customUserPrompts = customUserPrompts.filter(p => p.id !== id);
      if (selectedUserPromptId === id) {
        selectedUserPromptId = null;
      }
      if (editingUserPromptId === id) {
        editingUserPromptId = null;
      }
      saveUserPrompts();
      new Notice(`已删除“${promptName}”`);
    }
  }

  function updateUserPrompt(id: string, updates: Partial<PromptTemplate>) {
    const index = customUserPrompts.findIndex(p => p.id === id);
    if (index >= 0) {
      const nextName = typeof updates.name === 'string' ? updates.name.trim() : '';
      if (nextName) {
        const hasDuplicate = customUserPrompts.some((prompt) =>
          prompt.id !== id && prompt.name.trim().toLowerCase() === nextName.toLowerCase()
        );
        if (hasDuplicate) {
          new Notice('自定义提示词名称不能重复，请换一个名称');
          return;
        }
      }

      customUserPrompts[index] = {
        ...customUserPrompts[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      customUserPrompts = [...customUserPrompts];
      saveUserPrompts();
    }
  }

  function cancelUserPromptEdit() {
    if (editingUserPromptId) {
      const prompt = customUserPrompts.find(p => p.id === editingUserPromptId);
      if (prompt && !prompt.updatedAt && isEmptyDraftName(prompt.name, '新提示词') && !prompt.prompt.trim()) {
        customUserPrompts = customUserPrompts.filter(p => p.id !== editingUserPromptId);
        if (selectedUserPromptId === editingUserPromptId) {
          selectedUserPromptId = null;
        }
        saveUserPrompts();
      }
    }
    editingUserPromptId = null;
  }

  async function saveUserPrompts() {
    if (!plugin.settings.aiConfig) return;
    if (!plugin.settings.aiConfig.promptTemplates) {
      plugin.settings.aiConfig.promptTemplates = {
        official: [],
        custom: []
      };
    }
    plugin.settings.aiConfig.promptTemplates.custom = customUserPrompts as PromptTemplate[];
    await plugin.saveSettings();
    window.dispatchEvent(new CustomEvent('Weave:ai-prompt-templates-updated'));
  }

  function copyUserPromptToClipboard(prompt: PromptTemplate) {
    navigator.clipboard.writeText(prompt.prompt).then(() => {
      new Notice('已复制到剪贴板');
    }).catch(() => {
      new Notice('复制失败');
    });
  }

  function applyUserPrompt(prompt: PromptTemplate) {
    window.dispatchEvent(new CustomEvent('Weave:ai-prompt-template-select', {
      detail: { id: prompt.id }
    }));
    new Notice(`已应用提示词：${prompt.name}`);
    handleClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet modalContent(nativeMode: boolean)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="ai-config-modal"
    class:ai-config-modal-native={nativeMode}
    bind:this={modalEl}
    role="dialog"
    tabindex="-1"
  >
      <div class="modal-header" class:modal-header-native={nativeMode}>
        {#if !nativeMode}
          <h2 class="modal-title">
            AI制卡配置
          </h2>
        {/if}

        <div class="header-tabs" role="tablist" aria-label="AI制卡配置导航">
          {#each headerTabs as tab}
            <button
              type="button"
              class="header-tab"
              class:active={activeTab === tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`${tab.id}-panel`}
              tabindex={activeTab === tab.id ? 0 : -1}
              onclick={() => activeTab = tab.id}
              onkeydown={(event) => handleHeaderTabKeydown(event, tab.id)}
            >
              <span class="header-tab-label">{tab.label}</span>
            </button>
          {/each}
        </div>

        {#if !nativeMode}
          <button
            class="close-btn clickable-icon"
            type="button"
            onclick={handleClose}
            title="关闭"
            aria-label="关闭"
          >
            <ObsidianIcon name="x" size={18} />
          </button>
        {/if}
      </div>

      {#if validationErrors.length > 0}
        <div class="validation-errors">
          {#each validationErrors as error}
            <div class="error-item">{error}</div>
          {/each}
        </div>
      {/if}

      {#if activeTab === 'system-prompt'}
        <div
          class="tab-panel system-prompt-panel"
          id="system-prompt-panel"
          role="tabpanel"
          aria-labelledby="tab-system-prompt"
        >
          <div class="prompt-workspace">
            <div class="prompt-toolbar">
              <div class="prompt-toolbar-main">
                <div class="prompt-selector-control">
                  <ObsidianDropdown
                    options={systemPromptOptions()}
                    value={selectedSystemPromptValue()}
                    placeholder="选择系统提示词"
                    className="prompt-selector-dropdown"
                    onchange={handleSystemPromptDropdownChange}
                  />
                </div>
                <span class={`prompt-meta-badge ${currentSystemPromptMeta().tone}`}>
                  {currentSystemPromptMeta().label}
                </span>
              </div>

              <div class="prompt-toolbar-actions setting-item-control">
                <button
                  type="button"
                  class="toolbar-btn obsidian-action-btn"
                  onclick={() => copySystemPromptToClipboard(selectedSystemPromptId)}
                  title="复制当前系统提示词"
                >
                  <ObsidianIcon name="copy" size={14} />
                  <span>复制</span>
                </button>
                <button
                  type="button"
                  class="toolbar-btn obsidian-action-btn"
                  onclick={createSystemPrompt}
                  disabled={customSystemPrompts.length >= 5}
                  title={customSystemPrompts.length >= 5 ? '最多创建5个自定义系统提示词' : '新建系统提示词'}
                >
                  <ObsidianIcon name="plus" size={14} />
                  <span>新建</span>
                </button>
                {#if activeCustomSystemPrompt()}
                  <button
                    type="button"
                    class="toolbar-btn obsidian-action-btn"
                    onclick={() => editSystemPrompt(activeCustomSystemPrompt()!.id)}
                    title="编辑当前系统提示词"
                  >
                    <ObsidianIcon name="edit" size={14} />
                    <span>编辑</span>
                  </button>
                  <button
                    type="button"
                    class="toolbar-btn obsidian-action-btn mod-warning"
                    onclick={() => deleteSystemPrompt(activeCustomSystemPrompt()!.id)}
                    title="删除当前系统提示词"
                  >
                    <ObsidianIcon name="trash" size={14} />
                    <span>删除</span>
                  </button>
                {/if}
              </div>
            </div>

            <div class="content-area prompt-content-area">
              {#if editingSystemPromptId}
                {@const editingPrompt = customSystemPrompts.find(p => p.id === editingSystemPromptId)}
                {#if editingPrompt}
                  <div class="edit-form">
                    <div class="form-group">
                      <div class="form-label-row">
                        <label class="form-label" for="system-prompt-name">名称</label>
                        <div class="instant-save-badge">
                          <ObsidianIcon name="zap" size={12} />
                          <span>更改即时保存</span>
                        </div>
                      </div>
                      <input 
                        id="system-prompt-name"
                        type="text" 
                        value={editingPrompt.name}
                        oninput={(e) => updateSystemPrompt(editingPrompt.id, { name: (e.target as HTMLInputElement).value })}
                        placeholder="请输入提示词名称"
                        class="form-input"
                      />
                    </div>
                    
                    <div class="form-group">
                      <label class="form-label" for="system-prompt-content">内容</label>
                      <textarea 
                        id="system-prompt-content"
                        value={editingPrompt.content}
                        oninput={(e) => updateSystemPrompt(editingPrompt.id, { content: (e.target as HTMLTextAreaElement).value })}
                        placeholder="请输入系统提示词内容..."
                        class="form-textarea"
                        rows="15"
                      ></textarea>
                    </div>
                    
                    <div class="form-actions">
                      <button class="btn btn-secondary" onclick={cancelSystemPromptEdit}>完成编辑</button>
                    </div>
                  </div>
                {/if}
              {:else}
                <div class="preview-mode">
                  <div class="preview-header prompt-preview-header">
                    <div class="preview-title-block">
                      <h4>{currentSystemPromptName()}</h4>
                      <div class="preview-meta-line">
                        <span class={`prompt-meta-badge ${currentSystemPromptMeta().tone}`}>
                          {currentSystemPromptMeta().label}
                        </span>
                        <span class="preview-description">{currentSystemPromptMeta().description}</span>
                      </div>
                    </div>
                  </div>
                  <pre class="preview-content">{currentSystemPrompt()}</pre>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}

        {#if activeTab === 'ai-config'}
          <div
            class="tab-panel ai-config-panel"
            id="ai-config-panel"
            role="tabpanel"
            aria-labelledby="tab-ai-config"
          >
        <section class="config-section difficulty">
          <div class="section-header">
            <div class="section-indicator difficulty-indicator"></div>
            <h3 class="section-title">难度级别</h3>
          </div>
          <div class="config-item">
            <fieldset class="config-fieldset">
              <legend class="visually-hidden">难度级别</legend>
              <div class="radio-group">
              <label class="radio-item">
                <input
                  type="radio"
                  name="difficulty"
                  value="easy"
                  bind:group={localConfig.difficulty}
                />
                <span class="radio-label">简单</span>
              </label>
              <label class="radio-item">
                <input
                  type="radio"
                  name="difficulty"
                  value="medium"
                  bind:group={localConfig.difficulty}
                />
                <span class="radio-label">中等</span>
              </label>
              <label class="radio-item">
                <input
                  type="radio"
                  name="difficulty"
                  value="hard"
                  bind:group={localConfig.difficulty}
                />
                <span class="radio-label">困难</span>
              </label>
              <label class="radio-item">
                <input
                  type="radio"
                  name="difficulty"
                  value="mixed"
                  bind:group={localConfig.difficulty}
                />
                <span class="radio-label">混合</span>
              </label>
              </div>
            </fieldset>
          </div>
        </section>

        <section class="config-section card-count">
          <div class="section-header">
            <div class="section-indicator count-indicator"></div>
            <h3 class="section-title">生成数量</h3>
          </div>
          <div class="config-item">
            <label class="config-label visually-hidden" for="card-count-slider">
              生成数量 ({localConfig.cardCount} 张)
            </label>
            <div class="slider-row">
              <input
                id="card-count-slider"
                type="range"
                min="1"
                max="50"
                bind:value={localConfig.cardCount}
                class="config-slider full-width"
              />
              <span class="slider-value-inline">{localConfig.cardCount} 张</span>
            </div>
          </div>
        </section>

        <section class="config-section type-distribution">
          <div class="section-header">
            <div class="section-indicator distribution-indicator"></div>
            <h3 class="section-title">题型分布</h3>
          </div>
          <div class="config-item">
            <fieldset class="config-fieldset">
              <legend class="visually-hidden">题型分布</legend>
              <div class="distribution-controls">
                <div class="distribution-item">
                  <label class="distribution-label" for="qa-distribution-slider">
                    <span class="type-dot qa-dot"></span>
                    问答题
                  </label>
                  <div class="slider-container">
                    <input
                      id="qa-distribution-slider"
                      type="range"
                      min="0"
                      max="100"
                      value={localConfig.typeDistribution.qa}
                      oninput={(e) => updateTypeDistribution('qa', parseInt((e.target as HTMLInputElement).value))}
                      class="config-slider qa-slider"
                    />
                    <span class="slider-value">{localConfig.typeDistribution.qa}%</span>
                  </div>
                </div>

                <div class="distribution-item">
                  <label class="distribution-label" for="cloze-distribution-slider">
                    <span class="type-dot cloze-dot"></span>
                    挖空题
                  </label>
                  <div class="slider-container">
                    <input
                      id="cloze-distribution-slider"
                      type="range"
                      min="0"
                      max="100"
                      value={localConfig.typeDistribution.cloze}
                      oninput={(e) => updateTypeDistribution('cloze', parseInt((e.target as HTMLInputElement).value))}
                      class="config-slider cloze-slider"
                    />
                    <span class="slider-value">{localConfig.typeDistribution.cloze}%</span>
                  </div>
                </div>

                <div class="distribution-item">
                  <label class="distribution-label" for="choice-distribution-slider">
                    <span class="type-dot choice-dot"></span>
                    选择题
                  </label>
                  <div class="slider-container">
                    <input
                      id="choice-distribution-slider"
                      type="range"
                      min="0"
                      max="100"
                      value={localConfig.typeDistribution.choice}
                      oninput={(e) => updateTypeDistribution('choice', parseInt((e.target as HTMLInputElement).value))}
                      class="config-slider choice-slider"
                    />
                    <span class="slider-value">{localConfig.typeDistribution.choice}%</span>
                  </div>
                </div>
              </div>
              
              <div class="distribution-visual">
                <div class="stacked-bar">
                  <div class="bar-segment qa-segment" style="width: {visualTypeDistribution().qa}%"></div>
                  <div class="bar-segment cloze-segment" style="width: {visualTypeDistribution().cloze}%"></div>
                  <div class="bar-segment choice-segment" style="width: {visualTypeDistribution().choice}%"></div>
                </div>
                <div class="bar-legend">
                  <span class="legend-item">
                    <span class="legend-dot qa-dot"></span>
                    问答 {localConfig.typeDistribution.qa}%
                  </span>
                  <span class="legend-item">
                    <span class="legend-dot cloze-dot"></span>
                    挖空 {localConfig.typeDistribution.cloze}%
                  </span>
                  <span class="legend-item">
                    <span class="legend-dot choice-dot"></span>
                    选择 {localConfig.typeDistribution.choice}%
                  </span>
                </div>
              </div>
            </fieldset>
          </div>
        </section>

        <section class="config-section advanced-options">
          <div class="section-header">
            <div class="section-indicator advanced-indicator"></div>
            <h3 class="section-title">高级选项</h3>
          </div>

          <div class="config-item">
            <label class="config-label" for="auto-tags-input">自动添加标签</label>
            <input
              id="auto-tags-input"
              type="text"
              value={localConfig.autoTags.join(', ')}
              oninput={(e) => {
                const value = (e.target as HTMLInputElement).value;
                localConfig.autoTags = value.split(',').map(t => t.trim()).filter(t => t);
              }}
              placeholder="标签1, 标签2, ..."
              class="config-input"
            />
          </div>

        </section>
          </div>
        {/if}

        {#if activeTab === 'user-prompt'}
          <div
            class="tab-panel user-prompt-panel"
            id="user-prompt-panel"
            role="tabpanel"
            aria-labelledby="tab-user-prompt"
          >
            <div class="prompt-workspace">
              <div class="prompt-toolbar">
                <div class="prompt-toolbar-main">
                  <div class="prompt-selector-control">
                    <ObsidianDropdown
                      options={userPromptOptions()}
                      value={selectedUserPromptValue()}
                      placeholder="选择用户提示词"
                      className="prompt-selector-dropdown"
                      disabled={userPromptOptions().length === 0}
                      onchange={handleUserPromptDropdownChange}
                    />
                  </div>
                  {#if currentUserPromptMeta()}
                    <span class={`prompt-meta-badge ${currentUserPromptMeta()!.tone}`}>
                      {currentUserPromptMeta()!.label}
                    </span>
                  {/if}
                </div>

                <div class="prompt-toolbar-actions setting-item-control">
                  <button
                    type="button"
                    class="toolbar-btn obsidian-action-btn"
                    onclick={createUserPrompt}
                    title="新建自定义提示词"
                  >
                    <ObsidianIcon name="plus" size={14} />
                    <span>新建</span>
                  </button>
                  {#if currentUserPrompt()}
                    <button
                      type="button"
                      class="toolbar-btn obsidian-action-btn"
                      onclick={() => copyUserPromptToClipboard(currentUserPrompt()!)}
                      title="复制当前提示词"
                    >
                      <ObsidianIcon name="copy" size={14} />
                      <span>复制</span>
                    </button>
                    <button
                      type="button"
                      class="toolbar-btn obsidian-action-btn mod-cta"
                      onclick={() => applyUserPrompt(currentUserPrompt()!)}
                      title="使用当前提示词"
                    >
                      <ObsidianIcon name="check" size={14} />
                      <span>使用</span>
                    </button>
                  {/if}
                  {#if activeCustomUserPrompt()}
                    <button
                      type="button"
                      class="toolbar-btn obsidian-action-btn"
                      onclick={() => editUserPrompt(activeCustomUserPrompt()!.id)}
                      title="编辑当前提示词"
                    >
                      <ObsidianIcon name="edit" size={14} />
                      <span>编辑</span>
                    </button>
                    <button
                      type="button"
                      class="toolbar-btn obsidian-action-btn mod-warning"
                      onclick={() => deleteUserPrompt(activeCustomUserPrompt()!.id)}
                      title="删除当前提示词"
                    >
                      <ObsidianIcon name="trash" size={14} />
                      <span>删除</span>
                    </button>
                  {/if}
                </div>
              </div>

              <div class="content-area prompt-content-area">
                {#if editingUserPromptId}
                  {@const editingPrompt = customUserPrompts.find(p => p.id === editingUserPromptId)}
                  {#if editingPrompt}
                    <div class="edit-form">
                      <div class="form-group">
                        <div class="form-label-row">
                          <label class="form-label" for="user-prompt-name">名称</label>
                          <div class="instant-save-badge">
                            <ObsidianIcon name="zap" size={12} />
                            <span>更改即时保存</span>
                          </div>
                        </div>
                        <input 
                          id="user-prompt-name"
                          type="text" 
                          value={editingPrompt.name}
                          oninput={(e) => updateUserPrompt(editingPrompt.id, { name: (e.target as HTMLInputElement).value })}
                          placeholder="请输入提示词名称"
                          class="form-input"
                        />
                      </div>
                      
                      <div class="form-group">
                        <label class="form-label" for="user-prompt-content">提示词内容</label>
                        <textarea 
                          id="user-prompt-content"
                          value={editingPrompt.prompt}
                          oninput={(e) => updateUserPrompt(editingPrompt.id, { prompt: (e.target as HTMLTextAreaElement).value })}
                          placeholder="请输入提示词内容..."
                          class="form-textarea"
                          rows="10"
                        ></textarea>
                        <div class="form-hint">
                          可以使用变量：{'{count}'}（卡片数量）、{'{difficulty}'}（难度）等
                        </div>
                      </div>
                      
                      <div class="form-actions">
                        <button class="btn btn-secondary" onclick={cancelUserPromptEdit}>完成编辑</button>
                      </div>
                    </div>
                  {/if}
                {:else if currentUserPrompt()}
                  <div class="preview-mode">
                    <div class="preview-header prompt-preview-header">
                      <div class="preview-title-block">
                        <h4>{currentUserPrompt()!.name}</h4>
                        <div class="preview-meta-line">
                          {#if currentUserPromptMeta()}
                            <span class={`prompt-meta-badge ${currentUserPromptMeta()!.tone}`}>
                              {currentUserPromptMeta()!.label}
                            </span>
                            <span class="preview-description">{currentUserPromptMeta()!.description}</span>
                          {/if}
                        </div>
                      </div>
                    </div>
                    <pre class="preview-content">{currentUserPrompt()!.prompt}</pre>
                  </div>
                {:else}
                  <div class="empty-preview">
                    <ObsidianIcon name="file-text" size={48} />
                    <p>请从顶部下拉菜单选择一个提示词</p>
                    <p class="hint-text">或者点击上方“新建”创建一个自定义提示词</p>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/if}

      <div class="modal-footer">
        <button class="reset-btn obsidian-action-btn" type="button" onclick={resetToDefaults}>
          <ObsidianIcon name="rotate-ccw" size={14} />
          <span class="btn-label">重置默认</span>
        </button>
        <div class="footer-actions setting-item-control">
          <button class="save-btn obsidian-action-btn mod-cta" type="button" onclick={handleSave}>
            <ObsidianIcon name="check" size={16} />
            <span class="btn-label">保存并应用</span>
          </button>
        </div>
      </div>
  </div>
{/snippet}

{#if isOpen}
  {#if useObsidianModal}
    {@render modalContent(true)}
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="modal-overlay"
      onclick={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
      role="presentation"
    >
      {@render modalContent(false)}
    </div>
  {/if}
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75); /* 增加透明度，确保内容清晰可见 */
    backdrop-filter: blur(4px); /* 添加模糊效果 */
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--layer-modal, 50); /* AI配置模态窗，高于菜单层级(5000) */
    overscroll-behavior: contain;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .ai-config-modal {
    width: 95%;
    max-width: 1000px;
    height: min(85vh, 760px);
    max-height: 85vh;
    background: var(--background-primary);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    overscroll-behavior: contain;
    animation: slideUp 0.3s ease;
  }

  .ai-config-modal.ai-config-modal-native {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
    box-shadow: none;
    animation: none;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* 头部 */
  .modal-header {
    display: grid;
    grid-template-columns: minmax(0, max-content) minmax(0, 1fr) auto;
    align-items: center;
    gap: 18px;
    padding: 20px 24px;
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border-bottom: 1px solid var(--weave-border-visible);
    flex-shrink: 0;
  }

  .modal-header.modal-header-native {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    padding: 12px 24px;
    gap: 0;
  }

  .modal-header.modal-header-native .header-tabs {
    justify-self: center;
  }

  .modal-title {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: 1.3em;
    font-weight: 600;
    color: var(--text-normal);
    min-width: 0;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--clickable-icon-size, 32px);
    height: var(--clickable-icon-size, 32px);
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--clickable-icon-radius, 4px);
    box-shadow: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
    justify-self: end;
  }

  .close-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .close-btn:active {
    background: var(--background-modifier-active-hover, var(--background-modifier-hover));
    color: var(--text-normal);
  }

  .close-btn:focus-visible {
    outline: none;
    color: var(--text-normal);
    box-shadow: 0 0 0 2px var(--background-modifier-border-focus, rgba(var(--interactive-accent-rgb), 0.22));
  }

  .header-tabs {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 4px;
    min-width: 0;
    max-width: 100%;
    justify-self: center;
    background: var(--background-secondary);
    border: 1px solid var(--weave-border-visible);
    border-radius: 999px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .header-tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding: 9px 18px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.88rem;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.22s ease;
  }

  .header-tab:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .header-tab:focus-visible {
    outline: 2px solid rgba(var(--interactive-accent-rgb), 0.28);
    outline-offset: 2px;
  }

  .header-tab.active {
    color: var(--text-normal);
    background: var(--background-primary);
    box-shadow:
      0 10px 24px rgba(15, 23, 42, 0.08),
      0 1px 2px rgba(15, 23, 42, 0.06);
  }

  .header-tab.active::after {
    content: '';
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 5px;
    height: 2px;
    border-radius: 999px;
    background: var(--interactive-accent);
    opacity: 0.9;
  }

  .header-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-panel {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .prompt-workspace {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--background-primary);
  }

  .prompt-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--weave-border-visible);
    background: var(--background-primary);
  }

  .prompt-toolbar-main {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  .prompt-selector-control {
    min-width: 0;
    width: min(420px, 100%);
  }

  :global(.prompt-selector-dropdown.obsidian-dropdown-trigger) {
    width: 100%;
    min-height: var(--input-height, 36px);
    padding: 0.5rem 0.75rem;
    background: var(--background-modifier-form-field);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--input-radius, 8px);
    box-shadow: none;
  }

  :global(.prompt-selector-dropdown.obsidian-dropdown-trigger:hover:not(.disabled)) {
    background: var(--background-modifier-form-field);
    border-color: var(--background-modifier-border-hover);
  }

  :global(.prompt-selector-dropdown.obsidian-dropdown-trigger:focus-visible) {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
  }

  :global(.prompt-selector-dropdown.obsidian-dropdown-trigger .dropdown-icon) {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .prompt-meta-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 54px;
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  .prompt-meta-badge.builtin {
    background: rgba(148, 163, 184, 0.16);
    color: var(--text-muted);
    border-color: rgba(148, 163, 184, 0.2);
  }

  .prompt-meta-badge.official {
    background: rgba(245, 158, 11, 0.14);
    color: rgb(180, 83, 9);
    border-color: rgba(245, 158, 11, 0.2);
  }

  .prompt-meta-badge.custom {
    background: rgba(59, 130, 246, 0.12);
    color: rgb(37, 99, 235);
    border-color: rgba(59, 130, 246, 0.18);
  }

  .prompt-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .obsidian-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: var(--input-height, 36px);
    padding: 0.45rem 0.85rem;
    background: var(--interactive-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--button-radius, var(--input-radius, 8px));
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    font-weight: 500;
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: none;
    transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
  }

  .obsidian-action-btn:hover:not(:disabled) {
    background: var(--interactive-hover);
    border-color: var(--background-modifier-border-hover);
  }

  .obsidian-action-btn:focus-visible {
    outline: 2px solid var(--background-modifier-border-focus, rgba(var(--interactive-accent-rgb), 0.22));
    outline-offset: 1px;
  }

  .obsidian-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .obsidian-action-btn.mod-cta {
    background: var(--interactive-accent);
    color: var(--text-on-accent, white);
    border-color: var(--interactive-accent);
  }

  .obsidian-action-btn.mod-cta:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
    border-color: var(--interactive-accent-hover);
  }

  .obsidian-action-btn.mod-warning {
    background: var(--background-primary);
    color: var(--text-error);
    border-color: rgba(239, 68, 68, 0.18);
  }

  .obsidian-action-btn.mod-warning:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.28);
  }

  /* 右侧内容区 */
  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .preview-mode {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border-bottom: 1px solid var(--weave-border-visible);
    background: var(--background-primary);
  }

  .preview-header h4 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .prompt-preview-header {
    align-items: flex-start;
    justify-content: flex-start;
  }

  .preview-title-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .preview-meta-line {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .preview-description {
    font-size: 0.8125rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .preview-content {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    margin: 20px 24px;
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border: 1px solid var(--weave-border-visible);
    border-radius: 8px;
    color: var(--text-normal);
    font-family: var(--font-monospace);
    font-size: 0.8125rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .prompt-content-area {
    min-height: 0;
  }

  /* 编辑表单 */
  .edit-form {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 24px;
    overflow-y: auto;
  }

  .form-group {
    margin-bottom: 16px;
  }

  .form-label {
    display: block;
    margin-bottom: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-normal);
  }

  /* 表单标签行 - 标签和徽章在同一行 */
  .form-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .form-label-row .form-label {
    margin-bottom: 0;
  }

  .form-input {
    width: 100%;
    padding: 8px 12px;
    background: var(--background-primary); /* 🔧 显式使用主背景色，覆盖Obsidian全局样式 */
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border: 1px solid var(--weave-border-visible);
    border-radius: 6px;
    color: var(--text-normal);
    font-size: 0.875rem;
    transition: all 0.2s ease;
  }

  .form-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 3px rgba(var(--interactive-accent-rgb), 0.1);
  }

  .form-textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--background-primary); /* 🔧 显式使用主背景色，覆盖Obsidian全局样式 */
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border: 1px solid var(--weave-border-visible);
    border-radius: 6px;
    color: var(--text-normal);
    font-size: 0.875rem;
    font-family: var(--font-monospace);
    line-height: 1.6;
    resize: vertical;
    transition: all 0.2s ease;
  }

  .form-textarea:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 3px rgba(var(--interactive-accent-rgb), 0.1);
  }

  .form-hint {
    margin-top: 8px;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: auto;
    padding-top: 16px;
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border-top: 1px solid var(--weave-border-visible);
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-secondary {
    background: transparent;
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border: 1px solid var(--weave-border-visible);
    color: var(--text-normal);
  }

  .btn-secondary:hover {
    background: var(--background-modifier-hover);
  }

  /* 空状态 */
  .empty-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
    text-align: center;
    padding: 60px 40px;
  }

  .empty-preview p {
    margin: 12px 0;
    font-size: 0.875rem;
  }

  /*  移除 !important：使用更具体的选择器 */
  .ai-config-modal .hint-text {
    font-size: 0.75rem;
    opacity: 0.6;
  }

  /* AI配置面板专用样式 */
  .ai-config-panel {
    overflow-y: auto;
    padding: 20px 24px;
  }

  .validation-errors {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    margin: 16px 20px;
    background: var(--background-modifier-error);
    border: 1px solid var(--text-error);
    border-radius: 6px;
    color: var(--text-error);
    font-size: 0.85em;
  }

  .error-item {
    margin: 0;
  }

  /* 配置分组 */
  .config-section {
    margin-bottom: 20px;
    padding: 20px;
    border-radius: 8px;
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border: 1px solid var(--weave-border-visible);
  }

  /* 标题行 - 带彩色侧边条 */
  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    position: relative;
    padding-left: 20px;
  }

  .section-header::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 1.2em;
    border-radius: 2px;
  }

  .section-title {
    flex: 1;
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  /* 多彩侧边条 - 不同配置区域使用不同颜色（已被section-indicator替代） */

  /* 底部按钮 */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border-top: 1px solid var(--weave-border-visible);
    background: var(--background-primary);
    flex-shrink: 0;
  }

  .reset-btn {
    font-size: 0.9em;
  }

  .footer-actions {
    display: flex;
    gap: 8px;
  }

  .save-btn {
    font-size: 0.9em;
    font-weight: 500;
  }

  .instant-save-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 12px;
    color: rgb(139, 92, 246);
    font-size: 0.75em;
    font-weight: 500;
  }

  .instant-save-badge :global(svg) {
    color: rgb(139, 92, 246);
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  /* 响应式 */
  @media (max-width: 768px) {
    .ai-config-modal {
      width: 95%;
      max-height: 95vh;
    }

    .modal-header {
      padding: 12px 16px;
      gap: 12px;
    }

    .modal-header:not(.modal-header-native) {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .modal-header.modal-header-native {
      grid-template-columns: minmax(0, 1fr);
      justify-items: stretch;
      padding: 10px 16px;
    }

    .modal-title {
      font-size: 1.1em;
    }

    .header-tabs {
      grid-column: 1 / -1;
      justify-self: stretch;
      width: 100%;
      overflow-x: auto;
      justify-content: flex-start;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    .header-tabs::-webkit-scrollbar {
      display: none;
    }

    .header-tab {
      flex: 1 0 auto;
      padding: 8px 14px;
      font-size: 0.82rem;
    }

    /* 移动端：底部按钮只显示图标 */
    .modal-footer .btn-label {
      display: none;
    }
    
    .reset-btn,
    .save-btn {
      padding: 10px 16px;
    }

    .prompt-toolbar {
      padding: 14px 16px;
      flex-direction: column;
      align-items: stretch;
    }

    .prompt-toolbar-main,
    .prompt-toolbar-actions {
      width: 100%;
    }

    .prompt-toolbar-main {
      flex-wrap: wrap;
    }

    .prompt-selector-control {
      width: 100%;
    }

    .prompt-toolbar-actions {
      justify-content: flex-start;
    }

    .ai-config-panel {
      padding: 12px 16px;
    }

    .config-section {
      padding: 12px;
      margin-bottom: 16px;
    }

    .radio-group {
      flex-direction: row;
      gap: 6px;
    }

    .radio-item {
      flex: 1;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 10px 6px;
      justify-content: center;
    }

    .radio-item .radio-label {
      font-size: 0.8rem;
    }

    .validation-errors {
      margin: 12px 16px;
    }
  }

  @media (max-width: 900px) {
    .prompt-selector-control {
      width: min(360px, 100%);
    }

    .ai-config-panel {
      padding: 16px 16px;
    }
  }

  /* ========================================
     Phase 1 重构：桌面端样式增强
     ======================================== */
  
  /* 题型颜色变量 */
  .ai-config-modal {
    --qa-color: #3b82f6;
    --cloze-color: #10b981;
    --choice-color: #f59e0b;
    --difficulty-color: #8b5cf6;
    --count-color: #06b6d4;
    --distribution-color: #ec4899;
    --advanced-color: #6366f1;
    
    /*  修复Obsidian原生主题下边框不显示的问题 */
    /* 原生主题的 --background-modifier-border 可能是透明或与背景色相同 */
    --weave-border-color: var(--background-modifier-border, rgba(255, 255, 255, 0.1));
    --weave-border-visible: rgba(128, 128, 128, 0.3);
  }

  /* 卡片数量滑块全宽布局 */
  .slider-row {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
  }

  .config-slider.full-width {
    flex: 1;
  }

  .slider-value-inline {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-normal);
    min-width: 60px;
    text-align: right;
  }

  /* ========================================
     配置区域指示器
     ======================================== */
  .section-indicator {
    width: 4px;
    height: 24px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .difficulty-indicator { background: var(--difficulty-color); }
  .count-indicator { background: var(--count-color); }
  .distribution-indicator { background: var(--distribution-color); }
  .advanced-indicator { background: var(--advanced-color); }

  /* 更新section-header样式以适配指示器 */
  .config-section .section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    padding-left: 0;
  }

  .config-section .section-header::before {
    display: none;
  }

  /* ========================================
     配置项样式
     ======================================== */
  .config-item {
    margin-bottom: 16px;
  }

  .config-label {
    display: block;
    margin-bottom: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-normal);
  }

  .config-input {
    width: 100%;
    padding: 8px 12px;
    background: var(--background-primary); /* 🔧 显式使用主背景色，覆盖Obsidian全局样式 */
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border: 1px solid var(--weave-border-visible);
    border-radius: 6px;
    color: var(--text-normal);
    font-size: 0.875rem;
    transition: all 0.2s ease;
  }

  .config-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 3px rgba(var(--interactive-accent-rgb), 0.1);
  }

  /* ========================================
     单选按钮组样式
     ======================================== */
  .radio-group {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .radio-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: var(--background-primary);
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border: 1px solid var(--weave-border-visible);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .radio-item:hover {
    border-color: var(--interactive-accent);
    background: var(--background-modifier-hover);
  }

  .radio-item input[type="radio"] {
    appearance: none;
    width: 16px;
    height: 16px;
    border: 2px solid var(--text-muted);
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    margin: 0;
  }

  .radio-item input[type="radio"]:checked {
    border-color: var(--interactive-accent);
    background: var(--interactive-accent);
  }

  .radio-item input[type="radio"]:checked::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 6px;
    height: 6px;
    background: white;
    border-radius: 50%;
  }

  .radio-item:has(input:checked) {
    border-color: var(--interactive-accent);
    background: rgba(124, 58, 237, 0.1);
  }

  .radio-label {
    font-size: 0.875rem;
    color: var(--text-normal);
  }

  /* ========================================
     题型分布样式
     ======================================== */
  .distribution-controls {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 20px;
  }

  .distribution-item {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .distribution-label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 80px;
    font-size: 0.875rem;
    color: var(--text-normal);
  }

  .type-dot, .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .qa-dot { background: var(--qa-color); }
  .cloze-dot { background: var(--cloze-color); }
  .choice-dot { background: var(--choice-color); }

  .slider-container {
    display: flex;
    align-items: center;
    gap: 16px;
    flex: 1;
  }

  .slider-value {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-normal);
    min-width: 50px;
    text-align: right;
  }

  /*  移除 !important：题型滑块颜色使用更具体的选择器 */
  .ai-config-modal .qa-slider::-webkit-slider-thumb { background: var(--qa-color); }
  .ai-config-modal .cloze-slider::-webkit-slider-thumb { background: var(--cloze-color); }
  .ai-config-modal .choice-slider::-webkit-slider-thumb { background: var(--choice-color); }

  .ai-config-modal .qa-slider::-moz-range-thumb { background: var(--qa-color); }
  .ai-config-modal .cloze-slider::-moz-range-thumb { background: var(--cloze-color); }
  .ai-config-modal .choice-slider::-moz-range-thumb { background: var(--choice-color); }

  /* 可视化堆叠条形图 */
  .distribution-visual {
    padding-top: 16px;
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    border-top: 1px solid var(--weave-border-visible);
  }

  .stacked-bar {
    display: flex;
    height: 24px;
    border-radius: 6px;
    overflow: hidden;
    /*  使用可见边框色，修复原生主题下不显示的问题 */
    background: var(--weave-border-visible);
  }

  .bar-segment {
    height: 100%;
    transition: width 0.3s ease;
  }

  .qa-segment { background: var(--qa-color); }
  .cloze-segment { background: var(--cloze-color); }
  .choice-segment { background: var(--choice-color); }

  .bar-legend {
    display: flex;
    justify-content: center;
    gap: 24px;
    margin-top: 12px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  /* ========================================
     滑块基础样式
     ======================================== */
  .config-slider {
    flex: 1;
    height: 6px;
    appearance: none;
    /*  使用可见边框色，修复原生主题下滑块轨道不显示的问题 */
    background: var(--weave-border-visible);
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .config-slider::-webkit-slider-thumb {
    appearance: none;
    width: 18px;
    height: 18px;
    background: var(--interactive-accent);
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    transition: all 0.2s ease;
  }

  .config-slider::-webkit-slider-thumb:hover {
    transform: scale(1.1);
    box-shadow: 0 2px 8px rgba(124, 58, 237, 0.4);
  }

  .config-slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    background: var(--interactive-accent);
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  /* 可访问性：隐藏但保留屏幕阅读器访问 */
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .config-fieldset {
    border: none;
    padding: 0;
    margin: 0;
  }

  /* ========================================
     🔧 修复色差问题：覆盖Obsidian全局样式
     ======================================== */
  
  /* AI配置标签页中的输入框 - 使用主背景色 */
  .ai-config-panel .config-input {
    background: var(--background-primary);
  }

  .ai-config-panel .config-input:focus {
    background: var(--background-primary);
  }

  /* 预览内容区 - 确保与模态窗背景一致 */
  .preview-content {
    background: var(--background-primary);
  }

  .prompt-toolbar {
    background: var(--background-primary);
  }

  /* ========================================
     Obsidian 移动端适配
     ======================================== */
  
  :global(body.is-mobile) .ai-config-modal {
    width: 100%;
    max-width: 100%;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
    padding-top: env(safe-area-inset-top, 0);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  :global(body.is-mobile) .modal-header {
    padding-top: max(12px, env(safe-area-inset-top, 0));
  }

  
  :global(body.is-mobile) .modal-footer {
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0));
  }
  
  :global(body.is-mobile) .modal-footer .btn-label {
    display: none;
  }
  
  :global(body.is-mobile) .reset-btn,
  :global(body.is-mobile) .save-btn {
    padding: 12px 20px;
    min-width: 48px;
  }

  :global(body.is-mobile) .prompt-toolbar {
    padding: 14px 16px;
  }

</style>



