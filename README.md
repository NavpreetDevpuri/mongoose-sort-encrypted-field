# mongoose-sort-encrypted-field

Mongoose plugin to enable sorting on encrypted fields

# Install

```
npm i mongoose-sort-encrypted-field
```

# Example

We are having user with encrypted email, We just need to add `sortFieldName` option to that field

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
const sortedUsers = await User.find({}).sort({ emailSort: 1 }).exec();
```

# How does it work?

We create a sort order ID which is just a number in base 2^16, which is huge number system as compared to 10 base number system. We search in DB similar way to binary search but dividing the records into 100 parts intead of 2 parts in binary search. It generate sort order ID in O(1). 

Sort order generation is asynchronous using mongoose post middlewares.
