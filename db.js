const { MongoClient } = require('mongodb');

const DATABASE_NAME = 'art_em_foco';
let client;
let database;
let connecting;

async function getDatabase() {
  if (database) return database;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI não configurada');
  if (!connecting) {
    connecting = (async () => {
      client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 7000 });
      try {
        await client.connect();
        database = client.db(DATABASE_NAME);
        return database;
      } catch (error) {
        await client.close().catch(() => {});
        client = undefined;
        throw error;
      }
    })().finally(() => { connecting = undefined; });
  }
  return connecting;
}

async function checkDatabase() {
  const db = await getDatabase();
  await db.command({ ping: 1 });
  return { connected: true, database: DATABASE_NAME };
}

module.exports = { getDatabase, checkDatabase, DATABASE_NAME };
