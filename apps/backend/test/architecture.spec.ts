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

  it('only the Notifications context imports its repository port, read-side service and adapters (Epic 9 review P11)', () => {
    const notificationsDir = path.join(modulesDir, 'notifications');
    // Static `from '…'`, dynamic `import('…')` and `require('…')`.
    const privateNotificationImport =
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*notifications\/(?:application\/(?:ports\/notification-repository\.port|notifications\.service)|infrastructure\/)[^'"]*['"]/;
    const offenders = getFiles(srcDir)
      .filter(
        (filePath) =>
          !filePath.startsWith(notificationsDir + path.sep) &&
          privateNotificationImport.test(fs.readFileSync(filePath, 'utf-8')),
      )
      .map((filePath) => path.relative(srcDir, filePath));

    expect(offenders).toEqual([]);
    expect(
      privateNotificationImport.test(
        "import { NotificationsService } from '../../notifications/application/notifications.service';",
      ),
    ).toBe(true);
    expect(
      privateNotificationImport.test(
        "const { PrismaNotificationRepository } = require('../notifications/infrastructure/prisma-notification.repository');",
      ),
    ).toBe(true);
    expect(
      privateNotificationImport.test(
        "await import('../../notifications/application/ports/notification-repository.port');",
      ),
    ).toBe(true);
    expect(
      privateNotificationImport.test(
        "import { NOTIFICATION_PUBLISHER_PORT } from '../../notifications/application/ports/notification-publisher.port';",
      ),
    ).toBe(false);
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

  it('every controller registers both a plain route prefix and its api/ twin (Bug 1.3)', () => {
    const controllerFiles = getFiles(srcDir).filter((filePath) =>
      filePath.endsWith('.controller.ts'),
    );
    expect(controllerFiles.length).toBeGreaterThan(0);

    const violations = controllerFiles.flatMap((filePath) => {
      const relFile = path.relative(srcDir, filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      const match = content.match(/@Controller\(\s*(\[[\s\S]*?\])\s*\)/);

      if (!match) {
        return [
          `${relFile}: @Controller must register an array of ['prefix', 'api/prefix']`,
        ];
      }

      const prefixes = Array.from(
        match[1].matchAll(/'([^']*)'|"([^"]*)"/g),
      ).map((literal) => literal[1] ?? literal[2] ?? '');

      if (prefixes.length !== 2) {
        return [
          `${relFile}: expected exactly 2 route prefixes, found ${JSON.stringify(prefixes)}`,
        ];
      }

      const [plainPrefix, apiPrefix] = prefixes;
      const expectedApiPrefix =
        plainPrefix === '' ? 'api' : `api/${plainPrefix}`;

      if (apiPrefix !== expectedApiPrefix) {
        return [
          `${relFile}: expected ['${plainPrefix}', '${expectedApiPrefix}'], found ${JSON.stringify(prefixes)}`,
        ];
      }

      return [];
    });

    expect(violations).toEqual([]);
  });
});
