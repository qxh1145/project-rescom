import { defineConfig } from '@prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: {
    kind: 'single',
    filePath: 'prisma/schema.prisma',
  },
  studio: {
    port: 5555,
  },
  migrate: {
    url: process.env.DATABASE_URL,
  },
})
