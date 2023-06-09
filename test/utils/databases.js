const { RedisMemoryServer } = require("redis-memory-server");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { Redis } = require("redis-ordered-queue");
const mongoose = require("mongoose");

const redisServer = new RedisMemoryServer();
const mongod = new MongoMemoryServer();
let redis = null;

async function initiateRedisMemoryServer() {
  await redisServer.start();
  const host = await redisServer.getHost();
  const port = await redisServer.getPort();
  redis = new Redis({ host, port });
}

async function connectMongoose() {
  await mongod.start();
  const uri = await mongod.getUri();
  await mongoose.connect(uri);
}

async function stopDatabases() {
  redisServer.stop();
  mongod.stop();
}

function getRedis() {
  return redis;
}

module.exports = {
  initiateRedisMemoryServer,
  connectMongoose,
  stopDatabases,
  getRedis,
};
