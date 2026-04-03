<script lang="ts">
  import type { ConnectionStatus } from '../../../../types/ankiconnect-types';
  import { tr } from '../../../../utils/i18n';

  let t = $derived($tr);

  interface Props {
    connectionStatus: ConnectionStatus | null;
    isTesting: boolean;
    endpoint: string;
    onTestConnection: () => Promise<void>;
    onEndpointChange: (endpoint: string) => void;
  }

  let {
    connectionStatus,
    isTesting,
    endpoint,
    onTestConnection,
    onEndpointChange
  }: Props = $props();
</script>

<div class="connection-manager">
  <div class="setting-item connection-item">
    <div class="setting-info">
      <div class="setting-label">{t('ankiConnect.connection.endpointLabel')}</div>
      <div class="setting-description">
        {#if isTesting}
          {t('ankiConnect.connection.testing')}
        {:else if connectionStatus === null}
          {t('ankiConnect.connection.notTested')}
        {:else if connectionStatus.isConnected}
          {t('ankiConnect.connection.connected')}
          {#if connectionStatus.apiVersion}
            <span class="connection-meta">API v{connectionStatus.apiVersion}</span>
          {/if}
        {:else}
          {t('ankiConnect.connection.disconnected')}
        {/if}
      </div>
    </div>

    <div class="setting-control endpoint-control">
      <input
        type="text"
        class="text-input"
        bind:value={endpoint}
        onblur={() => onEndpointChange(endpoint)}
        placeholder="http://localhost:8765"
      />
      <button
        class="btn btn-primary"
        type="button"
        onclick={onTestConnection}
        disabled={isTesting}
      >
        {isTesting ? t('ankiConnect.connection.testingButton') : t('ankiConnect.connection.testButton')}
      </button>
    </div>
  </div>

  {#if connectionStatus?.error}
    <div class="error-banner">
      <div class="error-text">{connectionStatus.error.message}</div>
      {#if connectionStatus.error.suggestion}
        <div class="error-suggestion">{connectionStatus.error.suggestion}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .connection-manager {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .setting-item {
    margin: 0;
    padding: 14px 16px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--background-secondary) 90%, transparent);
  }

  .connection-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
  }

  .setting-control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .endpoint-control {
    gap: 12px;
  }

  .connection-meta {
    margin-left: 6px;
    opacity: 0.7;
  }

  .error-banner {
    padding: 14px 16px;
    background: color-mix(in srgb, var(--text-error) 10%, transparent);
    border-radius: 12px;
    border-left: 3px solid var(--text-error);
  }

  .error-text {
    font-size: 14px;
    color: var(--text-error);
    margin-bottom: 4px;
  }

  .error-suggestion {
    font-size: 12px;
    color: var(--text-muted);
  }

  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .btn-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .text-input {
    width: min(360px, 100%);
    padding: 8px 12px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    color: var(--text-normal);
    font-size: 14px;
    transition: border-color 0.2s;
  }

  .text-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px var(--interactive-accent-hover);
  }

  @media (max-width: 768px) {
    .connection-item {
      grid-template-columns: 1fr;
    }

    .setting-control {
      justify-content: flex-start;
    }

    .endpoint-control {
      width: 100%;
      flex-wrap: wrap;
    }

    .text-input {
      width: 100%;
    }
  }
</style>
