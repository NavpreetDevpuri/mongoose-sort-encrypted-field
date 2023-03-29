const crypto = require("crypto");

const algorithm = "aes-256-cbc";
const key = crypto.randomBytes(32);
const iv = crypto.randomBytes(16);

const decrypt = function (encrypted) {
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

const encrypt = function (plain) {
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(plain, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
};

module.exports = { encrypt, decrypt };


// console.log(encrypt("yess"))
// console.log(encrypt("yess"))
// console.log(encrypt("yess"))
// console.log(encrypt("yess"))
// console.log(encrypt("yess"))
// console.log(encrypt("yess"))