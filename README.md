# mongoose-sort-encrypted-field

Mongoose plugin to enable sorting on encrypted fields

# Install

```
npm i mongoose-sort-encrypted-field
```

## Example

We are having a user with an encrypted email, We just need to add the `sortFieldName` option to that field

```javascript
const { encrypt, decrypt } = require("./encryption.js");
const { getModelWithSortEncryptedFieldsPlugin } = require("mongoose-sort-encrypted-field");

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
  redisQueueClientOptions: { redis: "redis://localhost:6379" },
  ignoreCases: true,
});

module.exports = User;
```

Then we can sort all records by email from the 'emailSort' field. For performance, we can create a MongoDB index for that field.

```javascript
const sortedUsers = await User.find({}).sort({ emailSort: 1 }).exec();
```

Note: For values equal to `null` or `undefined`, It consider those as `''` empty strings to support proper sorting if we do multiple fields sorting.
Example:

```javascript
// by default mongodb/javascript sort those as follow
documents = [
  { firstName: "a", middleName: "", lastName: "b" },
  { firstName: "a", middleName: "b", lastName: "b" },
  { firstName: "a", middleName: "b", lastName: "b" },
  { firstName: "a", middleName: null, lastName: "b" },
  { firstName: "a", middleName: undefined, lastName: "b" },
];

// If we sort as { $sort: { firstName: 1, middleName: 1, lastName: 1 } }
// For full name then it will be wrong according to default behaviour
["aa", "abb", "ab", "ab"];

// So, in our plugin we are doing as follow
documents = [
  { firstName: "a", middleName: "", lastName: "b" },
  { firstName: "a", middleName: null, lastName: "b" },
  { firstName: "a", middleName: undefined, lastName: "b" },
  { firstName: "a", middleName: "b", lastName: "b" },
  { firstName: "a", middleName: "b", lastName: "b" },
];
// Now it is corrent
["aa", "ab", "ab", "abb"];
```

### pluginOptions:

1. `redisQueueClientOptions: RedisQueueClientOptions;` default:

   ```
   {
     redis: new Redis(), // It can be an instance of [ioredis](https://www.npmjs.com/package/ioredis) or any value that we can pass to ioredis constructor
     batchSize: 10,
     groupVisibilityTimeoutMs: 60000,
     pollingTimeoutMs: 10000,
     consumerCount: 3, // Better to have consumerCount in a balance of maximum fields we have to sort vs resources usage for multiple consumers
     redisKeyPrefix: "mongoose-sort-encrypted-field",
   }
   ```

   Any options which we can pass to [redis-ordered-queue](https://www.npmjs.com/package/redis-ordered-queue) constructor and redis options can be an instance of [ioredis](https://www.npmjs.com/package/ioredis) or any value that we can pass to ioredis constructor

2. `noOfCharsForSortId?: number` default: `50`
   Number of characters for sort ID, bigger number is mathematically better.

3. `noOfCharsToIncreaseOnSaturation?: number;` default: `2` <br>
   Number of chars to increase on saturation, for example,
   for `04` and `05`, first, we can see there is no whole number between those
   so, It appends an extra digit at the end and it becomes `040` and `050` and the average is `045`.
   In the base `2^16` number system, getting a saturation like that is mathematically very unlikely.

4. `ignoreCases?: boolean;` default: `false` <br>
   To ignore cases.

5. `silent?: boolean;` default: `false` <br>
   Flag to turn on/off console info logs

6. `selectSortFields?: boolean;` default: `false` <br>
   Flag for `select` option for sort fields. If set `false` then the sort fields will be removed from any query result.

7. `revaluateAllThreshold?: number;` default: `0.5` <br>
   If the number of documents without sort ID divided by the total number of documents is less than this threshold
   Then it will get all values, sort them, and generate sort ID for all at equal distances 0 to 2^16
   For example, if we have 3 documents and we can 00 to 20 sort ID
   then those documents will have 05 10 15 sort ID

8. `revaluateAllCountThreshold?: number;` default: `100` <br>
   If the total number of documents is less than this value
   then it will regenerate the sort ID the same way as revaluateAllThreshold

# How does it work?

We create a sort order ID which is just a number in base `2^16`, which is a huge number system as compared to the 10 base number system. We search in DB using binary search. For `1 lakh` documents, it queries and decrypts only `18` documents (first+last+log(1lakh)) to generate a sort ID. It generates a sort order ID in `O(1)`.

To generate a sort order ID it only needs to know the previous and next sort ID, and it just averages out those to get the current sort order ID, for example in the base 10 system if need to insert between `03` and `07` then `(03+07)/02` which is `05`. for `04` and `05`, first we can see there is no whole number between those so, It append extra digit at the end and it becomes `040` and `050` and the average is `045`. In the base `2^16` number system, getting a saturation like that is mathematically very unlikely.

It uses [redis-ordered-queue](https://www.npmjs.com/package/redis-ordered-queue) to generate a sort ID. It means it only processes one document at a time as per the mathematical requirement of the sort ID generation algorithm even when we are running multiple instances of our service.
