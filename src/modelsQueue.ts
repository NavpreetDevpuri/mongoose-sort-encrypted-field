const { RedisQueueClient } = require("redis-ordered-queue");
const Redis = require("ioredis");
const defaultRedisKeyPrefix = "mongoose-sort-encrypted-field";

const { REDIS_QUEUE_CLIENT_OPTIONS } = require("./constants");
const { updateSortFieldsForDocument, generateSortIdForAllDocuments } = require("./utils");

let modelsQueue;

class ModelsQueue {
  client: typeof RedisQueueClient;
  noOfGroups: number;
  groupIdToModelMap = {};
  constructor(redisQueueClientOptions) {
    this.groupIdToModelMap = {};
    redisQueueClientOptions = {
      ...REDIS_QUEUE_CLIENT_OPTIONS,
      ...redisQueueClientOptions,
    };
    const { redis } = redisQueueClientOptions;

    let redisClient = redis;
    if (!(redis instanceof Redis)) {
      redisClient = new Redis(redis);
    }

    this.client = new RedisQueueClient({
      ...redisQueueClientOptions,
      redis: redisClient,
    });

    this.client.startConsumers({
      handleMessage: async function handleMessage({
        data,
        context: {
          lock: { groupId },
        },
      }) {
        data.model = modelsQueue.groupIdToModelMap[groupId];
        const { silent } = data.model.schema.options.sortEncryptedFieldsOptions;
        if (!silent) {
          const noOfPendingJobs = (await modelsQueue.client.getMetrics(100)).topMessageGroupsMessageBacklogLength;
          console.log(`mongoose-sort-encrypted-field -> handleMessage() -> noOfPendingJobs: ${noOfPendingJobs}`);
        }
        if (data.generateSortIdForAllDocuments) {
          await generateSortIdForAllDocuments(data);
          return;
        }
        await updateSortFieldsForDocument(data);
      },
    });
  }

  async addJob(groupId, data) {
    await this.client.send({ groupId, data });
  }

  registerGroup(groupId, model) {
    if (!this.groupIdToModelMap[groupId]) {
      this.groupIdToModelMap[groupId] = model;
    }
  }

  async removeAllJobs(modelName) {
    const keys = await this.client.redis.keys(`${defaultRedisKeyPrefix}::msg-group-queue::${modelName}`);
    var pipeline = this.client.redis.pipeline();
    keys.forEach(function (key) {
      pipeline.del(key);
    });
    pipeline.exec();
  }
}

function getModelsQueue(redisOptions) {
  if (!modelsQueue) {
    modelsQueue = new ModelsQueue(redisOptions);
  }
  return modelsQueue;
}

export { getModelsQueue };
