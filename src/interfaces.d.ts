interface RedisQueueClientOptions {
  redis: typeof Redis | string;
  batchSize: number;
  groupVisibilityTimeoutMs: number;
  pollingTimeoutMs: number;
  consumerCount: number;
  redisKeyPrefix: "mongoose-sort-encrypted-field";
}

interface PluginOptions {
  redisQueueClientOptions?: RedisQueueClientOptions;
  ignoreCases?: boolean;
  silent?: boolean;
  selectSortFields?: boolean;
  noOfBytesForSortId?: number;
  noOfBytesToIncreaseOnSaturation?: number;
  revaluateAllThreshold?: number;
  revaluateAllCountThreshold?: number;
}

interface SortEncryptedFieldsOptions extends PluginOptions {
  modelsQueue?: typeof ModelsQueue;
  sortFields?: { [fieldName: string]: string };
  decrypters?: { [fieldName: string]: function };
}

// dependecies interfaces