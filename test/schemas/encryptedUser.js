const { encrypt, decrypt } = require("../utils/encryption");
const mongoose = require("mongoose");

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

module.exports = encryptedUserSchema;
