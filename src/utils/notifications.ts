export function showNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') {
  const n = document.createElement('div');
  n.className = `weave-notification notification-${type}`;

  // 获取主题相关的颜色
  const getThemeColors = () => {
    const isDark = document.body.classList.contains('theme-dark') ||
                   document.documentElement.classList.contains('theme-dark') ||
                   window.matchMedia('(prefers-color-scheme: dark)').matches;

    const colors = {
      success: isDark ? '#10b981' : '#059669',
      error: isDark ? '#ef4444' : '#dc2626',
      warning: isDark ? '#f59e0b' : '#d97706',
      info: isDark ? '#3b82f6' : '#2563eb'
    };

    return colors[type] || colors.info;
  };

  Object.assign(n.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    background: getThemeColors(),
    color: 'white',
    padding: '12px 16px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    zIndex: '1000001',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    transform: 'translateX(100%)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    fontSize: '14px',
    fontWeight: '500',
    maxWidth: '400px',
    minWidth: '200px',
    wordWrap: 'break-word',
    fontFamily: 'var(--font-interface, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)'
  } as CSSStyleDeclaration);

  // 添加图标
  const icon = document.createElement('span');
  icon.style.fontSize = '16px';
  icon.style.flexShrink = '0';

  const iconMap = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  icon.textContent = iconMap[type] || iconMap.info;
  n.appendChild(icon);

  // 添加消息文本
  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  textSpan.style.flex = '1';
  n.appendChild(textSpan);

  document.body.appendChild(n);

  // 样式已迁移到 styles/dynamic-injected.css

  // 动画进入
  setTimeout(() => {
    n.style.transform = 'translateX(0)';
  }, 10);

  // 自动消失
  setTimeout(() => {
    n.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (n.parentNode) {
        n.remove();
      }
    }, 300);
  }, 3000);
}
