const REDIS_QUEUE_CLIENT_OPTIONS: RedisQueueClientOptions = {
  redis: new Redis(),
  batchSize: 10,
  groupVisibilityTimeoutMs: 60000,
  pollingTimeoutMs: 10000,
  consumerCount: 1,
  redisKeyPrefix: "mongoose-sort-encrypted-field",
};

const PLUGIN_OPTIONS: PluginOptions = {
  redisQueueClientOptions: REDIS_QUEUE_CLIENT_OPTIONS,
  noOfCharsToIncreaseOnSaturation: 2,
  ignoreCases: false,
  silent: false,
  revaluateAllThreshold: 0.5,
  revaluateAllCountThreshold: 100,
};
