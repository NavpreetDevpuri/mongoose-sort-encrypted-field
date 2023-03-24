const Redis = require("ioredis");

const REDIS_QUEUE_CLIENT_OPTIONS: RedisQueueClientOptions = {
  redis: new Redis(),
  batchSize: 10,
  groupVisibilityTimeoutMs: 60000,
  pollingTimeoutMs: 10000,
  consumerCount: 3,
  redisKeyPrefix: "mongoose-sort-encrypted-field",
};

const PLUGIN_OPTIONS: PluginOptions = {
  redisQueueClientOptions: REDIS_QUEUE_CLIENT_OPTIONS,
  ignoreCases: false,
  isSilent: false,
  noOfCharsForSortId: 50,
  noOfCharsToIncreaseOnSaturation: 2,
  revaluateAllThreshold: 0.5,
  revaluateAllCountThreshold: 100,
};

export { REDIS_QUEUE_CLIENT_OPTIONS, PLUGIN_OPTIONS };
