<script lang="ts">
  import { PRODUCT_INFO, getAcknowledgments } from '../constants/settings-constants';
  import { ACTIVATION_HELP_TEXT } from '../constants/activation-constants';
  import ActivationModal from './ActivationModal.svelte';
  import { tr } from '../../../utils/i18n';
  import { formatVersion } from '../../../utils/format-utils';

  interface Props {
    compact?: boolean;
    plugin?: any;
    onSave?: () => Promise<void>;
  }

  let { compact = false, plugin, onSave }: Props = $props();

  let t = $derived($tr);

  let acknowledgments = $derived(getAcknowledgments());
  let productVersion = $derived(
    plugin?.manifest?.version ? formatVersion(plugin.manifest.version) : PRODUCT_INFO.VERSION
  );

  let baseInfoItems = $derived([
    {
      label: t('about.product.version'),
      value: productVersion
    },
    {
      label: t('about.product.algorithm'),
      value: t('about.product.algorithmValue')
    },
    {
      label: t('about.product.platform'),
      value: t('about.product.platformValue')
    },
    {
      label: t('about.product.developer'),
      value: t('about.product.developerValue')
    },
    {
      label: t('about.product.licenseMode'),
      value: t('about.product.licenseModeValue')
    }
  ]);
</script>

<div class="product-info-section" class:compact>
  <div class="section-header">
    <div class="header-content">
      <div class="product-logo">
        <div class="logo-icon" aria-hidden="true">🎴</div>
        <div class="logo-text">
          <h2 class="product-title">Weave</h2>
          <p class="product-tagline">{t('about.product.description')}</p>
        </div>
      </div>
    </div>
  </div>

  <div class="base-info-card">
    <div class="base-info-header">
      <h3 class="base-info-title">{t('about.product.baseInfoTitle')}</h3>
    </div>

    <div class="base-info-list">
      {#each baseInfoItems as item, index}
        <div class="base-info-row" class:base-info-row-divider={index < baseInfoItems.length - 1}>
          <div class="base-info-label">{item.label}</div>
          <div class="base-info-value">{item.value}</div>
        </div>
      {/each}
    </div>
  </div>

  <div class="quick-links">
    <a
      href="https://github.com/zhuzhige123/obsidian---Weave"
      target="_blank"
      class="quick-link opensource-link"
    >
      <span class="link-text">{t('about.quickLinks.openSource')}</span>
    </a>
    <a
      href="https://iwi05cktlph.feishu.cn/wiki/space/7602663447460891839?ccm_open_type=lark_wiki_spaceLink&open_tab_from=wiki_home"
      target="_blank"
      class="quick-link"
    >
      <span class="link-text">{t('about.quickLinks.documentation')}</span>
    </a>
    <a
      href={`${ACTIVATION_HELP_TEXT.CONTACT_INFO.github}/releases`}
      target="_blank"
      class="quick-link"
    >
      <span class="link-text">{t('about.quickLinks.changelog')}</span>
    </a>
    <a
      href={`mailto:${ACTIVATION_HELP_TEXT.CONTACT_INFO.email}?subject=${ACTIVATION_HELP_TEXT.CONTACT_INFO.subject}`}
      class="quick-link"
    >
      <span class="link-text">{t('about.quickLinks.support')}</span>
    </a>
  </div>

  <div class="acknowledgments-section">
    <h3 class="section-title">{t('about.acknowledgments.title')}</h3>
    <div class="acknowledgments-grid">
      {#each acknowledgments as item}
        <a
          href={item.url}
          target={item.url ? '_blank' : undefined}
          rel={item.url ? 'noopener noreferrer' : undefined}
          class="acknowledgment-card"
          title={item.description}
        >
          <div class="ack-name">{item.name}</div>
          <div class="ack-description">{item.description}</div>
        </a>
      {/each}
    </div>
  </div>

  {#if plugin && onSave}
    <ActivationModal {plugin} {onSave} />
  {/if}
</div>

<style>
  .product-info-section {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 1rem;
    padding: 2rem;
    margin-bottom: 2rem;
    position: relative;
    overflow: hidden;
    width: 100%;
    max-width: none;
    box-sizing: border-box;
  }

  .product-info-section.compact {
    padding: 1.5rem;
  }

  .section-header {
    margin-bottom: 2rem;
  }

  .header-content {
    display: flex;
    justify-content: flex-start;
  }

  .product-logo {
    display: flex;
    align-items: flex-start;
    gap: 1.25rem;
    width: 100%;
    max-width: 56rem;
  }

  .logo-icon {
    font-size: 4.5rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 5rem;
    height: 5rem;
    flex-shrink: 0;
  }

  .logo-text {
    text-align: left;
    padding-top: 0.125rem;
    flex: 1;
    min-width: 0;
  }

  .product-title {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    background: linear-gradient(135deg, var(--color-accent) 0%, var(--color-blue) 100%);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    line-height: 1.2;
  }

  .product-tagline {
    margin: 0.25rem 0 0 0;
    font-size: 1rem;
    color: var(--text-muted);
    font-weight: 500;
    line-height: 1.7;
    max-width: 42rem;
  }

  .base-info-card {
    margin-bottom: 2rem;
    padding: 1.25rem 1.5rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 0.9rem;
  }

  .base-info-header {
    display: flex;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .base-info-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text-normal);
  }

  .base-info-list {
    width: 100%;
  }

  .base-info-row {
    display: grid;
    grid-template-columns: minmax(7rem, 10rem) minmax(0, 1fr);
    gap: 1rem;
    align-items: center;
    padding: 0.85rem 0;
  }

  .base-info-row-divider {
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .base-info-label {
    font-size: 0.875rem;
    color: var(--text-muted);
    min-width: 0;
  }

  .base-info-value {
    font-size: 0.95rem;
    color: var(--text-normal);
    font-weight: 600;
    text-align: right;
    word-break: break-word;
  }

  .quick-links {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
    margin: 2rem 0;
    padding-top: 2rem;
    border-top: 1px solid var(--background-modifier-border);
    width: 100%;
  }

  .quick-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 0.5rem;
    color: var(--text-normal);
    text-decoration: none;
    font-weight: 500;
    transition: all 0.2s ease;
    flex: 1;
    min-width: 0;
  }

  .quick-link:hover {
    border-color: var(--color-accent);
    background: color-mix(in oklab, var(--color-accent), transparent 95%);
    transform: translateY(-1px);
  }

  .link-text {
    font-size: 0.875rem;
  }

  .opensource-link {
    background: linear-gradient(
      135deg,
      color-mix(in oklab, var(--color-green), transparent 85%) 0%,
      color-mix(in oklab, var(--color-blue), transparent 85%) 100%
    );
    border-color: color-mix(in oklab, var(--color-green), transparent 60%);
    color: var(--color-green);
    font-weight: 600;
  }

  .opensource-link:hover {
    background: linear-gradient(
      135deg,
      color-mix(in oklab, var(--color-green), transparent 75%) 0%,
      color-mix(in oklab, var(--color-blue), transparent 75%) 100%
    );
    border-color: var(--color-green);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px color-mix(in oklab, var(--color-green), transparent 70%);
  }

  .acknowledgments-section {
    margin: 2rem 0;
    padding-top: 2rem;
    border-top: 1px solid var(--background-modifier-border);
  }

  .section-title {
    margin: 0 0 1.25rem 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-muted);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .acknowledgments-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
    width: 100%;
  }

  .acknowledgment-card {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 1rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 0.75rem;
    color: var(--text-normal);
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .acknowledgment-card:hover {
    border-color: var(--color-accent);
    background: color-mix(in oklab, var(--color-accent), transparent 96%);
    transform: translateY(-1px);
  }

  .ack-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .ack-description {
    font-size: 0.84rem;
    line-height: 1.6;
    color: var(--text-muted);
  }

  @media (max-width: 768px) {
    .product-info-section {
      padding: 1.5rem;
    }

    .product-logo {
      flex-direction: column;
      gap: 0.9rem;
    }

    .logo-icon {
      font-size: 3.75rem;
      width: 4.25rem;
      height: 4.25rem;
    }

    .product-title {
      font-size: 1.75rem;
    }

    .base-info-card {
      padding: 1rem 1.125rem;
    }

    .base-info-row {
      grid-template-columns: 1fr;
      gap: 0.375rem;
    }

    .base-info-value {
      text-align: left;
    }

    .quick-links {
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
    }

    .quick-link {
      flex: none;
    }

    .acknowledgments-grid {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }
  }

  @media (max-width: 480px) {
    .quick-links {
      grid-template-columns: 1fr;
    }
  }
</style>
