<script lang="ts">
  import { tick } from 'svelte';
  import type { App } from 'obsidian';
  import type { ObsidianFileInfo } from '../../types/ai-types';
  import { formatFileSize } from '../../utils/file-utils';
  import { DetachedLeafEditor } from '../../services/editor/DetachedLeafEditor';
  import { logger } from '../../utils/logger';
  import ObsidianIcon from '../ui/ObsidianIcon.svelte';

  interface Props {
    content: string;
    selectedFile: ObsidianFileInfo | null;
    app: App;
    onClear: () => void;
    onReload: () => void;
    keyboardVisible?: boolean;
  }

  let { content = $bindable(), selectedFile, app, onClear, onReload, keyboardVisible = false }: Props = $props();

  // 计算字符数
  let charCount = $derived(content.length);
  let lineCount = $derived(content.split('\n').length);
  
  // Obsidian编辑器
  let editorContainer: HTMLDivElement | null = $state(null);
  let embeddedEditor: DetachedLeafEditor | null = null;
  let editorInitialized = $state(false);
  let lastSyncedContent = '';  // 追踪上次同步的内容，避免循环更新
  let lastSelectedFilePath = '';  // 追踪上次选择的文件路径
  let pendingContent: string | null = null;
  let editorInitToken = 0;
  let layoutRefreshCleanup: (() => void) | null = null;

  function refreshEmbeddedEditorLayout() {
    if (!embeddedEditor || !editorInitialized) return;

    const runRefresh = () => {
      try {
        embeddedEditor?.refresh();
      } catch (error) {
        logger.debug('[ContentEditor] 刷新编辑器布局失败:', error);
      }
    };

    runRefresh();
    window.requestAnimationFrame(runRefresh);
    window.setTimeout(runRefresh, 60);
    window.setTimeout(runRefresh, 180);
  }
  
  // 销毁编辑器
  function destroyEditor() {
    if (embeddedEditor) {
      embeddedEditor.destroy();
      embeddedEditor = null;
    }
    editorInitialized = false;
    lastSyncedContent = '';
  }
  
  // 创建编辑器
  async function createEditor() {
    if (!editorContainer) return;
    
    try {
      // 清空容器
      editorContainer.replaceChildren();
      
      // 创建Obsidian原生编辑器
      const initToken = ++editorInitToken;
      const editor = new DetachedLeafEditor(
        app,
        editorContainer,
        {
          value: content,
          placeholder: selectedFile 
            ? '在此编辑内容，AI将基于此内容生成卡片...' 
            : '请先选择文件，或直接在此输入内容...',
          sourcePath: selectedFile?.path,
          sessionId: `content-editor-${Date.now()}`,
          onChange: (editor) => {
            // 实时同步内容到父组件
            const newValue = editor.value;
            lastSyncedContent = newValue;
            content = newValue;
          }
        }
      );

      embeddedEditor = editor;

      // 手动加载组件
      editor.load();

      editor.whenReady().then(() => {
        if (embeddedEditor !== editor) return;
        if (editorInitToken !== initToken) return;

        if (!editor.getEditor()) {
          logger.warn('[ContentEditor] Obsidian编辑器未就绪（editor实例为空）');
          return;
        }

        const nextContent = pendingContent ?? content;
        pendingContent = null;

        editorInitialized = true;
        editor.setValue(nextContent);
        lastSyncedContent = nextContent;
        logger.debug('[ContentEditor] Obsidian编辑器创建成功');
      });
    } catch (error) {
      logger.error('[ContentEditor] 编辑器创建失败:', error);
    }
  }
  
  // 监听selectedFile变化，切换文件时重建编辑器（解决YAML属性不更新问题）
  $effect(() => {
    const currentFilePath = selectedFile?.path || '';
    
    if (currentFilePath !== lastSelectedFilePath) {
      logger.debug('[ContentEditor] 文件切换:', lastSelectedFilePath, '->', currentFilePath);
      lastSelectedFilePath = currentFilePath;
      
      // 切换文件时重建编辑器以正确显示YAML属性
      if (embeddedEditor) {
        destroyEditor();
        // 等待DOM更新后重建
        tick().then(() => createEditor());
      }
    }
  });
  
  // 当外部content变化时（非文件切换），更新编辑器内容
  $effect(() => {
    const currentContent = content;
    
    if (embeddedEditor && editorInitialized && currentContent !== lastSyncedContent) {
      logger.debug('[ContentEditor] 外部内容变化，更新编辑器:', currentContent.length, '字符');
      embeddedEditor.setValue(currentContent);
      lastSyncedContent = currentContent;
    } else if (embeddedEditor && !editorInitialized && currentContent !== lastSyncedContent) {
      pendingContent = currentContent;
    }
  });
  
  // 容器就绪时初始化编辑器
  $effect(() => {
    if (editorContainer && !embeddedEditor) {
      createEditor();
    }
  });

  $effect(() => {
    keyboardVisible;
    refreshEmbeddedEditorLayout();
  });

  $effect(() => {
    if (!embeddedEditor || !editorInitialized) {
      if (layoutRefreshCleanup) {
        layoutRefreshCleanup();
        layoutRefreshCleanup = null;
      }
      return;
    }

    const viewport = window.visualViewport;
    const handleLayoutChange = () => {
      refreshEmbeddedEditorLayout();
    };

    viewport?.addEventListener('resize', handleLayoutChange);
    viewport?.addEventListener('scroll', handleLayoutChange);
    window.addEventListener('resize', handleLayoutChange);
    window.addEventListener('orientationchange', handleLayoutChange);

    layoutRefreshCleanup = () => {
      viewport?.removeEventListener('resize', handleLayoutChange);
      viewport?.removeEventListener('scroll', handleLayoutChange);
      window.removeEventListener('resize', handleLayoutChange);
      window.removeEventListener('orientationchange', handleLayoutChange);
    };

    return () => {
      if (layoutRefreshCleanup) {
        layoutRefreshCleanup();
        layoutRefreshCleanup = null;
      }
    };
  });
  
  // 清理：组件卸载时销毁编辑器
  $effect(() => {
    return () => {
      if (layoutRefreshCleanup) {
        layoutRefreshCleanup();
        layoutRefreshCleanup = null;
      }
      if (embeddedEditor) {
        embeddedEditor.destroy();
        embeddedEditor = null;
        editorInitialized = false;
      }
    };
  });
</script>

<div class="content-editor-container inline-editor-container" class:mobile-keyboard-active={keyboardVisible}>
  <!-- Obsidian原生编辑器 -->
  <div 
    class="obsidian-editor-wrapper embedded-editor-host" 
    bind:this={editorContainer}
  ></div>
</div>

<style>
  .content-editor-container {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    height: 100%;
    min-height: 0;
    background: var(--background-primary);
    border: 1px solid rgba(128, 128, 128, 0.3);
    border-radius: 8px;
    overflow: hidden;
  }

  .obsidian-editor-wrapper {
    flex: 1 1 auto;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .obsidian-editor-wrapper :global(.markdown-source-view) {
    display: flex;
    flex-direction: column;
    padding: 16px;
    height: 100%;
    min-height: 0;
    flex: 1 1 auto;
  }

  .obsidian-editor-wrapper :global(.cm-editor) {
    flex: 1 1 auto;
    height: 100%;
    min-height: 0;
  }

  .obsidian-editor-wrapper :global(.cm-content) {
    padding: 8px 0;
  }
  
  .obsidian-editor-wrapper :global(.cm-scroller) {
    flex: 1 1 auto;
    height: 100%;
    overflow: auto;
    font-family: var(--font-monospace);
    font-size: 0.9em;
    line-height: 1.6;
  }

  :global(body.is-mobile) .content-editor-container,
  :global(body.is-phone) .content-editor-container {
    min-height: 0 !important;
    height: auto !important;
  }

  :global(body.is-mobile) .obsidian-editor-wrapper,
  :global(body.is-phone) .obsidian-editor-wrapper {
    min-height: 0 !important;
    height: auto !important;
  }

  :global(body.is-mobile) .obsidian-editor-wrapper :global(.markdown-source-view),
  :global(body.is-phone) .obsidian-editor-wrapper :global(.markdown-source-view) {
    padding: 12px;
    height: auto !important;
    flex: 1 1 auto !important;
    min-height: 0 !important;
  }

  :global(body.is-mobile) .obsidian-editor-wrapper :global(.cm-editor),
  :global(body.is-phone) .obsidian-editor-wrapper :global(.cm-editor),
  :global(body.is-mobile) .obsidian-editor-wrapper :global(.cm-scroller),
  :global(body.is-phone) .obsidian-editor-wrapper :global(.cm-scroller) {
    min-height: 0 !important;
    height: auto !important;
    flex: 1 1 auto !important;
  }

  :global(body.is-mobile) .content-editor-container.mobile-keyboard-active,
  :global(body.is-phone) .content-editor-container.mobile-keyboard-active {
    min-height: 0 !important;
    height: auto !important;
    overflow: hidden !important;
  }

  :global(body.is-mobile) .content-editor-container.mobile-keyboard-active :global(.markdown-source-view),
  :global(body.is-phone) .content-editor-container.mobile-keyboard-active :global(.markdown-source-view),
  :global(body.is-mobile) .content-editor-container.mobile-keyboard-active :global(.cm-editor),
  :global(body.is-phone) .content-editor-container.mobile-keyboard-active :global(.cm-editor),
  :global(body.is-mobile) .content-editor-container.mobile-keyboard-active :global(.cm-scroller),
  :global(body.is-phone) .content-editor-container.mobile-keyboard-active :global(.cm-scroller) {
    min-height: 0 !important;
    height: auto !important;
    flex: 1 1 auto !important;
  }
</style>

