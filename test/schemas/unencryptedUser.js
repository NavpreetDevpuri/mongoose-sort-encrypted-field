const mongoose = require("mongoose");

const unencryptedUserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
  },
  middleName: {
    type: String,
  },
  lastName: {
    type: String,
    required: true,
  },
});

unencryptedUserSchema.statics.createUser = async function createUser(data) {
  const user = new this(data);
  const userData = await user.save();
  return userData;
};

module.exports = unencryptedUserSchema;
