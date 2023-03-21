const { RedisQueueClient } = require("redis-ordered-queue");
const Redis = require("ioredis");
const { updateSortFieldsForDocument, generateSortIdForAllDocuments } = require("./utils");
const redisKeyPrefix = "mongoose-sort-encrypted-field";
let modelsQueue;
class ModelsQueue {
  client: typeof RedisQueueClient;
  modelNameToModelMap = {};
  constructor(redisOptions) {
    const redis = new Redis(redisOptions);
    this.client = new RedisQueueClient({
      redis,
      batchSize: 1,
      groupVisibilityTimeoutMs: 60000,
      pollingTimeoutMs: 10000,
      consumerCount: 1,
      redisKeyPrefix,
    });

    this.client.startConsumers({ handleMessage: this.handleMessage });
  }

  async handleMessage({
    data,
    context: {
      lock: { groupId },
    },
  }) {
    data.model = modelsQueue.modelNameToModelMap[groupId];
    if (!data.model.schema.options.sortEncryptedFieldsOptions.silent) {
      const noOfPendingJobs = (await modelsQueue.client.getMetrics(100)).topMessageGroupsMessageBacklogLength;
      console.log(`mongoose-sort-encrypted-field -> handleMessage() -> noOfPendingJobs: ${noOfPendingJobs}`);
    }
    if (data.generateSortIdForAllDocuments) {
      await generateSortIdForAllDocuments(data);
      return;
    }
    await updateSortFieldsForDocument(data);
  }

  async addJob(modelName, data) {
    await this.client.send({ data, groupId: modelName });
  }

  registerModel(model) {
    if (!this.modelNameToModelMap[model.modelName]) {
      this.modelNameToModelMap[model.modelName] = model;
    }
  }

  async removeAllJobs(modelName) {
    const keys = await this.client.redis.keys(`${redisKeyPrefix}::msg-group-queue::${modelName}`);
    var pipeline = this.client.redis.pipeline();
    keys.forEach(function (key) { pipeline.del(key) });
    pipeline.exec();
  }
}

function getModelsQueue(redisOptions) {
  if (!modelsQueue) {
    modelsQueue = new ModelsQueue(redisOptions);
  }
  return modelsQueue;
}

export = getModelsQueue;
