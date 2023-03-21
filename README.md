# mongoose-sort-encrypted-field

Mongoose plugin to enable sorting on encrypted fields

# Install

```
npm i mongoose-sort-encrypted-field
```

# Example

We are having a user with an encrypted email, We just need to add the `sortFieldName` option to that field

```javascript
const { encrypt, decrypt } = require("./encryption.js");
const { sortEncryptedFields, evaluateMissedSortFields } = require("mongoose-sort-encrypted-field");

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    set: encrypt,
    get: decrypt,
    sortFieldName: "emailSort",
  },
});

const User = getModelWithSortEncryptedFieldsPlugin("User", userSchema, {
  redisOptions: { host: "localhost", port: 6379 },
});

module.exports = User;
```

Then we can sort all records by email from the 'emailSort' field. For performance, we can create a MongoDB index for that field.

```javascript
const sortedUsers = await User.find({}).sort({ emailSort: 1 }).exec();
```

# How does it work?

We create a sort order ID which is just a number in base 2^16, which is a huge number system as compared to the 10 base number system. We search in DB using binary search. For 1 lakh documents, it queries and decrypts only 16 documents to generate a sort ID. It generates a sort order ID in O(1).

It uses [redis-ordered-queue](https://www.npmjs.com/package/redis-ordered-queue) to generate a sort ID. It means it only processes one document at a time as per the mathematical requirement of the sort ID generation algorithm even when we are running multiple instances of our service. So, it works with multiple instances of our service.