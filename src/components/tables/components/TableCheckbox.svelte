<script lang="ts">
  /**
   * 纯复选框组件
   * 只负责复选框的UI渲染和checked/indeterminate状态管理
   * 不包含任何复杂交互逻辑（拖拽等由DraggableCheckboxWrapper处理）
   */
  
  interface Props {
    checked: boolean;
    indeterminate?: boolean;
    onchange: (checked: boolean) => void;
  }
  
  let { 
    checked, 
    indeterminate = false, 
    onchange
  }: Props = $props();
  
  function handleChange(event: Event) {
    const target = event.target as HTMLInputElement;
    onchange(target.checked);
  }
</script>

<label class="weave-checkbox-label">
  <input
    type="checkbox"
    {checked}
    {indeterminate}
    onchange={handleChange}
    aria-label="选择"
  />
  <span class="weave-checkbox-custom"></span>
</label>

<style>
  .weave-checkbox-label {
    --weave-checkbox-border-color: var(
      --checkbox-border-color,
      color-mix(in srgb, var(--background-modifier-border) 88%, var(--text-faint))
    );
    --weave-checkbox-hover-color: var(--interactive-accent-hover, var(--interactive-accent));
    --weave-checkbox-surface-color: var(--weave-table-page-bg, var(--background-primary));
    --weave-checkbox-mark-color: var(--text-on-accent);
    --weave-checkbox-focus-color: var(--interactive-accent);
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    position: relative;
  }

  .weave-checkbox-label input[type="checkbox"] {
    position: absolute;
    opacity: 0;
    cursor: pointer;
    width: 18px;
    height: 18px;
  }

  /*  移除 !important：使用更具体的选择器 */
  .weave-checkbox-label .weave-checkbox-custom {
    width: 18px;
    height: 18px;
    /*  终极方案：使用box-shadow模拟边框，绕过Obsidian全局边框重置 */
    border: none;
    box-shadow: inset 0 0 0 2px var(--weave-checkbox-border-color);
    border-radius: 4px;
    background: var(--weave-checkbox-surface-color);
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .weave-checkbox-label input[type="checkbox"]:checked + .weave-checkbox-custom {
    background: var(--color-accent);
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }

  .weave-checkbox-label input[type="checkbox"]:checked + .weave-checkbox-custom::after {
    content: "✓";
    color: var(--weave-checkbox-mark-color);
    font-size: 12px;
    font-weight: bold;
  }

  .weave-checkbox-label input[type="checkbox"]:indeterminate + .weave-checkbox-custom {
    background: var(--color-accent);
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }

  .weave-checkbox-label input[type="checkbox"]:indeterminate + .weave-checkbox-custom::after {
    content: "−";
    color: var(--weave-checkbox-mark-color);
    font-size: 14px;
    font-weight: bold;
    line-height: 1;
  }

  /*  移除 !important：Hover状态使用更具体的选择器 */
  .weave-checkbox-label:hover .weave-checkbox-custom {
    box-shadow: 
      inset 0 0 0 2px var(--weave-checkbox-hover-color),
      0 0 0 1px color-mix(in srgb, var(--weave-checkbox-hover-color) 58%, transparent);
  }

  /* Focus状态 - 清晰的焦点指示 */
  .weave-checkbox-label input[type="checkbox"]:focus + .weave-checkbox-custom {
    outline: 2px solid var(--weave-checkbox-focus-color);
    outline-offset: 2px;
  }

  /* 拖拽相关样式已移至DraggableCheckboxWrapper */
</style>
