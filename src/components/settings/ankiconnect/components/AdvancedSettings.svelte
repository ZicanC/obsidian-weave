<!--
  AnkiConnect 媒体同步设置组件
  职责：控制卡片内容中的图片、音频等媒体文件是否上传到 Anki
-->
<script lang="ts">
  import { tr } from '../../../../utils/i18n';

  let t = $derived($tr);

  interface MediaSyncSettings {
    enabled: boolean;
  }

  interface Props {
    mediaSync: MediaSyncSettings;
    onMediaSyncChange: () => void;
  }

  let { 
    mediaSync, 
    onMediaSyncChange
  }: Props = $props();
</script>

<div class="advanced-settings">
  <div class="setting-item">
    <div class="setting-info">
      <div class="setting-label">{t('ankiConnect.advanced.mediaSyncLabel')}</div>
      <div class="setting-description">
        {t('ankiConnect.advanced.mediaSyncDesc')}
      </div>
    </div>
    <div class="setting-control">
      <label class="toggle-switch">
        <input
          type="checkbox"
          bind:checked={mediaSync.enabled}
          onchange={onMediaSyncChange}
        />
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>
</div>

<style>
  .advanced-settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
