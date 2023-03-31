import { RedisQueueClient, Redis } from "redis-ordered-queue";

import { REDIS_QUEUE_CLIENT_OPTIONS } from "./constants";
import { SortIdManager } from "./sortIdManager";

const defaultRedisKeyPrefix = "mongoose-sort-encrypted-field";
let modelsQueue;

async function handleMessage({
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
    const pendingJobsCount = await modelsQueue.getPendingJobsCount();
    console.log(`mongoose-sort-encrypted-field -> handleMessage() -> noOfPendingJobs: ${pendingJobsCount}`);
  }
  if (data.updateSortIdForAllDocuments) {
    await sortIdManger.updateSortIdForAllDocuments();
    return;
  }
  await sortIdManger.updateSortFieldsForDocument(data.objectId, data.fieldValue);
}

class ModelsQueue {
  client: RedisQueueClient;
  noOfGroups: number;
  groupIdToSortIdManagerMap = {};
  redisClient: Redis;
  constructor(redisQueueClientOptions) {
    this.groupIdToSortIdManagerMap = {};
    redisQueueClientOptions = {
      ...REDIS_QUEUE_CLIENT_OPTIONS,
      ...redisQueueClientOptions,
    };
    const { redis } = redisQueueClientOptions;
    if (!redis) {
      this.redisClient = new Redis();
    } else if (redis instanceof Redis) {
      this.redisClient = redis;
    } else {
      this.redisClient = new Redis(redis);
    }

    this.client = new RedisQueueClient({
      ...redisQueueClientOptions,
      redis: this.redisClient,
    });

    this.client.startConsumers({ handleMessage });
  }

  async getPendingJobsCount() {
    const metrics = await this.client.getMetrics({ topMessageGroupsLimit: 100 });
    const pendingJobsCount = metrics.topMessageGroupsMessageBacklogLength;
    return pendingJobsCount;
  }

  async addJob(groupId: string, data: any) {
    await this.client.send({ groupId, data, priority: 1 });
  }

  registerGroup(model, fieldName, sortFieldName) {
    const groupId = `${model.modelName}::${fieldName}::${sortFieldName}`;
    if (!this.groupIdToSortIdManagerMap[groupId]) {
      this.groupIdToSortIdManagerMap[groupId] = new SortIdManager(model, fieldName, sortFieldName);
    }
  }

  async removeAllJobs(modelName) {
    const keys = await this.redisClient.keys(`${defaultRedisKeyPrefix}::msg-group-queue::${modelName}`);
    var pipeline = this.redisClient.pipeline();
    keys.forEach(function (key) {
      pipeline.del(key);
    });
    await pipeline.exec();
  }
}

function getModelsQueue(redisOptions) {
  if (!modelsQueue) {
    modelsQueue = new ModelsQueue(redisOptions);
  }
  return modelsQueue;
}

export { getModelsQueue };
