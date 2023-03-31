const mongoose = require("mongoose");
const unencryptedUserSchema = require("../schemas/unencryptedUser");

const unencryptedUser = mongoose.model("unencryptedUser", unencryptedUserSchema);
module.exports = unencryptedUser;
