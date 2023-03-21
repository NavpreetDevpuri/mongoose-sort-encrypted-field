const { RedisQueueClient } = require("redis-ordered-queue");
const Redis = require("ioredis");
const { updateSortFieldsForDocument } = require("./utils");

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
      redisKeyPrefix: "mongoose-sort-encrypted-field",
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
    await updateSortFieldsForDocument(data);
  }

  async addJob(model, data) {
    const modelName = model.name;
    if (!this.modelNameToModelMap[modelName]) {
      this.modelNameToModelMap[modelName] = model;
    }
    await this.client.send({ data, groupId: model.modelName });
  }

  registerModel(model) {
    if (!this.modelNameToModelMap[model.modelName]) {
      this.modelNameToModelMap[model.modelName] = model;
    }
  }
}

function getModelsQueue(redisOptions) {
  if (!modelsQueue) {
    modelsQueue = new ModelsQueue(redisOptions);
  }
  return modelsQueue;
}

export = getModelsQueue;
