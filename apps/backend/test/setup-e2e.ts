import { NestApplication } from '@nestjs/core';

/**
 * supertest lazily calls `server.listen(0)` (all interfaces) and then connects
 * to `127.0.0.1:<port>`. When another local process already holds that port on
 * 127.0.0.1, macOS routes the request to that process, producing random
 * 400/404/501 responses or socket hang-ups. Binding the test server to
 * 127.0.0.1 during `init()` lets the OS pick a port that is free on that
 * address, and supertest reuses the already-listening server.
 */
const originalInit = NestApplication.prototype.init;

NestApplication.prototype.init = async function (
  this: NestApplication,
): Promise<NestApplication> {
  const app = await originalInit.call(this);
  const server = this.getHttpServer();
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  }
  return app;
};
