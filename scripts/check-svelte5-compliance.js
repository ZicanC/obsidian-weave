#!/usr/bin/env node

/**
 * Svelte 5 规范检查工具
 * 检查代码中是否包含不符合 Svelte 5 规范的模式
 * 
 * 主要检查：
 * 1. stopPropagation 的使用（除了白名单文件）
 * 2. 其他 Svelte 5 不兼容的模式
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const config = {
  srcDir: path.join(__dirname, '../src'),
  // 白名单：这些文件允许使用 stopPropagation
  whitelist: [
    'utils/svelte5-event-handler.ts', // 工具库示例
    'components/examples/Svelte5ModalExample.svelte', // 示例组件
    'components/tables/components/ColumnResizer.svelte', // 列调整器（特殊场景）
    'components/tables/components/DraggableCheckboxWrapper.svelte', // 拖拽包装器
    'services/image-mask/MaskRenderer.ts', // 图像遮罩渲染器
    'modals/ImageMaskEditorModal.ts', // 图像遮罩编辑器
    'hooks/useModal.ts', // 模态框钩子
    'utils/study/studyInterfaceUtils.ts', // 学习界面工具
    'services/obsidian-navigation-service.ts', // 导航服务
  ],
  // 检查规则
  rules: [
    {
      name: 'no-stopPropagation',
      pattern: /\.stopPropagation\s*\(/g,
      message: '禁止使用 stopPropagation，请使用 preventDefault 或条件判断',
      severity: 'error'
    }
  ]
};

// 统计
const stats = {
  filesScanned: 0,
  violations: [],
  whitelistedFiles: 0
};

/**
 * 检查文件是否在白名单中
 */
function isWhitelisted(filePath) {
  const relativePath = path.relative(config.srcDir, filePath).replace(/\\/g, '/');
  return config.whitelist.some(whitelistPath => 
    relativePath.includes(whitelistPath) || relativePath.endsWith(whitelistPath)
  );
}

/**
 * 检查单个文件
 */
function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(config.srcDir, filePath);
  stats.filesScanned++;
  
  // 检查是否在白名单中
  if (isWhitelisted(filePath)) {
    stats.whitelistedFiles++;
    return;
  }
  
  // 应用检查规则
  for (const rule of config.rules) {
    const matches = content.matchAll(rule.pattern);
    
    for (const match of matches) {
      // 计算行号
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;
      
      // 获取代码片段
      const lines = content.split('\n');
      const codeLine = lines[lineNumber - 1];
      
      stats.violations.push({
        file: relativePath,
        line: lineNumber,
        rule: rule.name,
        message: rule.message,
        severity: rule.severity,
        code: codeLine.trim()
      });
    }
  }
}

/**
 * 输出报告
 */
function printReport() {
  console.log('\n🔍 Svelte 5 规范检查报告');
  console.log('=' .repeat(60));
  console.log(`\n📁 扫描文件: ${stats.filesScanned}`);
  console.log(`✅ 白名单文件: ${stats.whitelistedFiles}`);
  console.log(`❌ 发现问题: ${stats.violations.length}\n`);
  
  if (stats.violations.length === 0) {
    console.log('🎉 恭喜！所有文件都符合 Svelte 5 规范！\n');
    return 0;
  }
  
  // 按文件分组显示违规
  const violationsByFile = {};
  for (const violation of stats.violations) {
    if (!violationsByFile[violation.file]) {
      violationsByFile[violation.file] = [];
    }
    violationsByFile[violation.file].push(violation);
  }
  
  for (const [file, violations] of Object.entries(violationsByFile)) {
    console.log(`\n📄 ${file}`);
    for (const violation of violations) {
      const icon = violation.severity === 'error' ? '❌' : '⚠️';
      console.log(`  ${icon} Line ${violation.line}: ${violation.message}`);
      console.log(`     ${violation.code}`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('💡 提示：');
  console.log('  - 请使用 e.preventDefault() 代替 e.stopPropagation()');
  console.log('  - 或使用条件判断: if (e.target === e.currentTarget) { ... }');
  console.log('  - 查看文档: SVELTE5_MIGRATION_GUIDE.md\n');
  
  return 1; // 返回错误码
}

async function main() {
  console.log('🚀 开始 Svelte 5 规范检查...\n');
  
  // 扫描所有相关文件
  const patterns = [
    path.join(config.srcDir, '**/*.svelte').replace(/\\/g, '/'),
    path.join(config.srcDir, '**/*.ts').replace(/\\/g, '/')
  ];
  
  const files = [];
  for (const pattern of patterns) {
    const matched = await glob(pattern, {
      ignore: ['**/node_modules/**', '**/dist/**']
    });
    files.push(...matched);
  }
  
  console.log(`📂 发现 ${files.length} 个文件\n`);
  
  // 检查每个文件
  files.forEach(checkFile);
  
  // 输出报告
  const exitCode = printReport();
  process.exit(exitCode);
}

main().catch(error => {
  console.error('❌ 检查失败:', error);
  process.exit(1);
});
