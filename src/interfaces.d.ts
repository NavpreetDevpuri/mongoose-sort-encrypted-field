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
  isSilent?: boolean;
  noOfCharsForSortId?: number;
  noOfCharsToIncreaseOnSaturation?: number;
  revaluateAllThreshold?: number;
  revaluateAllCountThreshold?: number;
}

interface SortEncryptedFieldsOptions extends PluginOptions {
  modelsQueue?: typeof ModelsQueue;
  sortFields?: { [fieldName: string]: string };
  decrypters?: { [fieldName: string]: function };
}

// dependecies interfaces
interface Schema {
  pre: function;
  post: function;
  add: function;
  options: { sortEncryptedFieldsOptions };
  paths: {
    [fieldName: string]: {
      options: { get: Function; sortFieldName: string };
    };
  };
}

interface Update {
  $set: { [key: string]: string };
}
