import { MongoMemoryServer } from 'mongodb-memory-server'
import { writeFileSync } from 'fs'
import { join } from 'path'

export default async function globalSetup(): Promise<() => Promise<void>> {
  const memory = await MongoMemoryServer.create({
    binary: { version: '6.0.19' },
  })
  const uri = memory.getUri()
  writeFileSync(join(__dirname, '.mongo-uri'), uri, 'utf8')
  process.env.MONGODB_URI = uri

  return async () => {
    await memory.stop()
  }
}
