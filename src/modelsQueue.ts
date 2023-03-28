const { RedisQueueClient } = require("redis-ordered-queue");
const Redis = require("ioredis");

const { REDIS_QUEUE_CLIENT_OPTIONS } = require("./constants");
const { SortIdManager } = require("./sortIdManager");

const defaultRedisKeyPrefix = "mongoose-sort-encrypted-field";
let modelsQueue;

class ModelsQueue {
  client: typeof RedisQueueClient;
  noOfGroups: number;
  groupIdToSortIdManagerMap = {};
  constructor(redisQueueClientOptions) {
    this.groupIdToSortIdManagerMap = {};
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
        const sortIdManger = modelsQueue.groupIdToSortIdManagerMap[groupId];
        if (!sortIdManger) {
          console.log(
            `mongoose-sort-encrypted-field (Warining) -> Unable to find sortIdManager for groupId: ${groupId}, 
            It might be some old job for that sort field is no longer exists 
            Or you forgot to add sortFieldName option in schema field options.`
          );
          return;
        }
        if (!sortIdManger.silent) {
          const noOfPendingJobs = (await modelsQueue.client.getMetrics(100)).topMessageGroupsMessageBacklogLength;
          console.log(`mongoose-sort-encrypted-field -> handleMessage() -> noOfPendingJobs: ${noOfPendingJobs}`);
        }
        if (data.updateSortIdForAllDocuments) {
          await sortIdManger.updateSortIdForAllDocuments();
          return;
        }
        await sortIdManger.updateSortFieldsForDocument(data.objectId, data.fieldValue);
      },
    });
  }

  async addJob(groupId, data) {
    await this.client.send({ groupId, data });
  }

  registerGroup(model, fieldName, sortFieldName) {
    const groupId = `${model.modelName}::${fieldName}::${sortFieldName}`;
    if (!this.groupIdToSortIdManagerMap[groupId]) {
      this.groupIdToSortIdManagerMap[groupId] = new SortIdManager(model, fieldName, sortFieldName);
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
