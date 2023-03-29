const { encrypt, decrypt } = require("../utils/encryption");
const { getModelWithSortEncryptedFieldsPlugin } = require("../../lib/index");
const { getRedis } = require("../utils/databases");
const mongoose = require("mongoose");
const redis = getRedis();

const encryptedUserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    set: encrypt,
    get: decrypt,
    sortFieldName: "firstNameSort",
  },
  middleName: {
    type: String,
    set: encrypt,
    get: decrypt,
    sortFieldName: "middleNameSort",
  },
  lastName: {
    type: String,
    required: true,
    set: encrypt,
    get: decrypt,
    sortFieldName: "lastNameSort",
  },
  // firstNameSort: {
  //   type: Buffer,
  // },
});

encryptedUserSchema.statics.createUser = async function createUser(data) {
  const user = new this(data);
  const userData = await user.save();
  return userData;
};

// const EncryptedUser = mongoose.model("EncryptedUser", encryptedUserSchema);
const EncryptedUser = getModelWithSortEncryptedFieldsPlugin("EncryptedUser", encryptedUserSchema, {
  redisQueueClientOptions: { redis },
  ignoreCases: true,
  revaluateAllCountThreshold: -1,
  // silent: true,
});

module.exports = EncryptedUser;
