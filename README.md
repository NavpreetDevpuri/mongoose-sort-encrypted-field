# mongoose-sort-encrypted-field

Mongoose plugin to enable sorting on encrypted fields

# Install

```
npm i mongoose-sort-encrypted-field
```

# Example

## encryption.js
```javascript
const crypto = require('crypto');

const algorithm = 'aes-256-cbc';
const key = crypto.randomBytes(32);
const iv = crypto.randomBytes(16);

const decrypt = function (encrypted) {
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

const encrypt = function (plain) {
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(plain, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

module.exports = {
    decrypt,
    encrypt
}
```
## user.js
We are having user with encrypted email

```javascript
const { encrypt, decrypt } = require('./encryption.js');
const {
  sortEncryptedFields,
  evaluateMissedSortFields,
} = require('mongoose-sort-encrypted-field');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    set: encrypt,
    get: decrypt,
    sortFieldName: 'emailSort',
  },
});

userSchema.plugin(sortEncryptedFields);
const User = mongoose.model('User', userSchema);

// Sometimes some field could be missed 
// Due to server crash or anything 
// So, handling those.
evaluateMissedSortFields(User);

module.exports = User;
```

Then we can sort all records by email from 'emailSort' field. For proformace we can create mongoDB index for that field.

```javascript
const await sortedUsers = await User.find({}).sort({ emailSort: 1 }).exec();
```

# How does it work?

We create a sort order ID which is just a number in base 2^16, which is huge number system as compared to 10 base number system. We search in DB similar way to binary search but dividing the records into 100 parts intead of 2 parts in binary search. It generate sort order ID in O(1). 
