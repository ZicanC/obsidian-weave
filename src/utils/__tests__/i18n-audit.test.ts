import { execFileSync } from 'node:child_process';
import path from 'node:path';

interface I18nAuditReport {
  duplicateKeys: string[];
  nonStringValues: string[];
  missingByLang: Record<string, string[]>;
  placeholderMismatches: Array<{ key: string }>;
}

describe('i18n audit', () => {
  it('keeps locale resources structurally consistent', () => {
    const rootDir = process.cwd();
    const scriptPath = path.join(rootDir, 'scripts', 'audit-i18n.mjs');
    const rawOutput = execFileSync(process.execPath, [scriptPath, '--json'], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    const report = JSON.parse(rawOutput) as I18nAuditReport;

    expect(report.duplicateKeys).toEqual([]);
    expect(report.nonStringValues).toEqual([]);
    expect(Object.values(report.missingByLang).flat()).toEqual([]);
    expect(report.placeholderMismatches).toEqual([]);
  });
});
