const { getModelWithSortEncryptedFieldsPlugin } = require("../../lib/index");
const { getRedis } = require("../utils/databases");
const mongoose = require("mongoose");

const redis = getRedis();
const unencryptedUserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    sortFieldName: "firstNameSort",
  },
  middleName: {
    type: String,
    sortFieldName: "middleNameSort",
  },
  lastName: {
    type: String,
    required: true,
    sortFieldName: "lastNameSort",
  },
});

unencryptedUserSchema.statics.createUser = async function (data) {
  const user = new this(data);
  const userData = await user.save();
  return userData;
};

const UnencryptedUser = mongoose.model("unencryptedUser", unencryptedUserSchema);
module.exports = UnencryptedUser;
