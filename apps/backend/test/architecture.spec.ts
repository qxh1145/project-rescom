import * as fs from 'fs';
import * as path from 'path';

describe('Clean Architecture Boundary Validation (AC8)', () => {
  const srcDir = path.resolve(__dirname, '../src');
  const modulesDir = path.join(srcDir, 'modules');
  const forbiddenPatternsInDomainAndApplication = [
    /@nestjs\//,
    /from ['"]express['"]/,
    /@prisma\/client/,
    /from ['"]bcrypt['"]/,
    /from ['"]bcryptjs['"]/,
    /google-auth-library/,
    /adapter/i,
  ];

  function getFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getFiles(fullPath));
      } else if (
        entry.isFile() &&
        fullPath.endsWith('.ts') &&
        !fullPath.endsWith('.spec.ts')
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  function findViolations(
    filePath: string,
    content: string,
  ): { file: string; forbidden: string }[] {
    const [, layer] = path.relative(modulesDir, filePath).split(path.sep);
    if (layer !== 'domain' && layer !== 'application') {
      return [];
    }

    return forbiddenPatternsInDomainAndApplication
      .filter((pattern) => pattern.test(content))
      .map((pattern) => ({
        file: path.relative(srcDir, filePath),
        forbidden: pattern.toString(),
      }));
  }

  it('domain and application layers must not import framework or infrastructure adapters', () => {
    const violations = getFiles(modulesDir).flatMap((filePath) =>
      findViolations(filePath, fs.readFileSync(filePath, 'utf-8')),
    );

    expect(violations).toEqual([]);
  });

  it('reports NestJS imports from application service files', () => {
    const applicationService = path.join(
      modulesDir,
      'example',
      'application',
      'example.service.ts',
    );

    expect(
      findViolations(
        applicationService,
        "import { Injectable } from '@nestjs/common';",
      ),
    ).toEqual([
      {
        file: path.join(
          'modules',
          'example',
          'application',
          'example.service.ts',
        ),
        forbidden: '/@nestjs\\//',
      },
    ]);
  });

  it('allows NestJS imports in module and infrastructure files', () => {
    const nestImport = "import { Injectable } from '@nestjs/common';";
    const moduleFile = path.join(modulesDir, 'example', 'example.module.ts');
    const infrastructureFile = path.join(
      modulesDir,
      'example',
      'infrastructure',
      'example.adapter.ts',
    );

    expect(findViolations(moduleFile, nestImport)).toEqual([]);
    expect(findViolations(infrastructureFile, nestImport)).toEqual([]);
  });
});
