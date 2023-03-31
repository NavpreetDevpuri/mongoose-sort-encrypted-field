const encryptedUserSchema = require("../schemas/encryptedUser");
const { getModelWithSortEncryptedFieldsPlugin } = require("../../lib/index");
const { getRedis } = require("../utils/databases");
const redis = getRedis();

const encryptedUser = getModelWithSortEncryptedFieldsPlugin("EncryptedUser", encryptedUserSchema, {
  redisQueueClientOptions: { redis },
  ignoreCases: true,
  revaluateAllCountThreshold: -1,
  // silent: true,
});

module.exports = encryptedUser;
