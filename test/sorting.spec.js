const assert = require("assert");
const generateName = require("project-name-generator");
const { getModelsQueue } = require("../lib/modelsQueue");
const { initiateRedisMemoryServer, connectMongoose, stopDatabases } = require("./utils/databases");

describe("mongoose-sort-encrypted-field tests", async function () {
  const users = require("./data/users.json");
  const n = 90;
  const silent = true;
  const pluginSilent = true;

  describe(`Testing sorting after creating new documents with ${n} random users and ${users.length} predefined users`, async function () {
    let unencryptedUserModel;
    let encryptedUserModel;
    let modelsQueue;
    before(async function () {
      await connectMongoose();
      await initiateRedisMemoryServer();
      unencryptedUserModel = require("./models/unencryptedUser");
      const encryptedUserSchema = require("./schemas/encryptedUser");

      const { getModelWithSortEncryptedFieldsPlugin } = require("../lib/index");
      const { getRedis } = require("./utils/databases");
      const redis = getRedis();
      encryptedUserModel = getModelWithSortEncryptedFieldsPlugin("EncryptedUser", encryptedUserSchema, {
        redisQueueClientOptions: { redis, consumerCount: 3 },
        noOfCharsForSortId: 1,
        silent: pluginSilent,
        selectSortFields: true,
        revaluateAllCountThreshold: -1,
      });
      modelsQueue = getModelsQueue();
    });
    after(async () => {
      await stopDatabases();
    });
    it(`creating new documents with ${n} random users and ${users.length} predefined users`, async function () {
      for (let i = 0; i < n; i += 1) {
        const [firstName, middleName] = generateName().raw;
        const [lastName] = generateName().raw;
        users.push({ firstName, middleName, lastName });
      }
      await unencryptedUserModel.deleteMany({}).exec();
      await encryptedUserModel.deleteMany({}).exec();

      await Promise.all(users.map(async (user) => {
        await unencryptedUserModel.createUser(user);
        await encryptedUserModel.createUser(user);
      }));
      assert.equal(await unencryptedUserModel.find({}).count().exec(), users.length);
      assert.equal(await encryptedUserModel.find({}).count().exec(), users.length);
    });
    it("Sorting check for { firstName: 1 }", async function () {
      if (!silent) {
        console.log("Waiting for sort ID to be generated...");
      }
      let pendingJobsCount = -1;
      while (pendingJobsCount !== 0) {
        pendingJobsCount = await modelsQueue.getPendingJobsCount();
        await new Promise((r) => setTimeout(r, 1000));
      }
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ firstName: 1 }).lean().exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ firstNameSort: 1 }).lean().exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          if (!silent) {
            console.log(unencryptedUser.firstName, " == ", encryptedUsers[i].firstName);
          }
          assert.equal(unencryptedUser.firstName, encryptedUsers[i].firstName);
        })
      );
    });
    it("Sorting check for { middleName: 1 }", async function () {
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ middleName: 1 }).lean().exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ middleNameSort: 1 }).lean().exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          if (!silent) {
            console.log(unencryptedUser.middleName, " == ", encryptedUsers[i].middleName);
          }
          assert.equal(unencryptedUser.middleName, encryptedUsers[i].middleName);
        })
      );
    });
    it("Sorting check for { lastName: 1 }", async function () {
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ lastName: 1 }).lean().exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ lastNameSort: 1 }).lean().exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          if (!silent) {
            console.log(unencryptedUser.lastName, " == ", encryptedUsers[i].lastName);
          }
          assert.equal(unencryptedUser.lastName, encryptedUsers[i].lastName);
        })
      );
    });
    it("Sorting check for { firstName: 1, middleName: 1, lastName: 1 }", async function () {
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ firstName: 1, middleName: 1, lastName: 1 }).lean().exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ firstNameSort: 1, middleNameSort: 1, lastNameSort: 1 }).lean().exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          const name1 = `${unencryptedUser.firstName} ${unencryptedUser.middleName} ${unencryptedUser.lastName}`;
          const name2 = `${encryptedUsers[i].firstName} ${encryptedUsers[i].middleName} ${encryptedUsers[i].lastName}`;
          if (!silent) {
            console.log(name1, " == ", name2);
          }
          assert.equal(name1, name2);
        })
      );
    });
    it("Sorting check for { lastName: 1, firstName: 1, middleName: 1 }", async function () {
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ lastName: 1, firstName: 1, middleName: 1 }).lean().exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ lastNameSort: 1, firstNameSort: 1, middleNameSort: 1 }).lean().exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          const name1 = `${unencryptedUser.firstName} ${unencryptedUser.middleName} ${unencryptedUser.lastName}`;
          const name2 = `${encryptedUsers[i].firstName} ${encryptedUsers[i].middleName} ${encryptedUsers[i].lastName}`;
          if (!silent) {
            console.log(name1, " == ", name2);
          }
          assert.equal(name1, name2);
        })
      );
    });
    it("Sorting check for { firstName: 1, middleName: 1, lastName: 1 } after rebuilding for all documents", async function () {
      await Promise.all(
        Object.values(modelsQueue.groupIdToSortIdManagerMap).map(async (sortIdManger) => sortIdManger.updateSortIdForAllDocuments())
      );
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ firstName: 1, middleName: 1, lastName: 1 }).lean().exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ firstNameSort: 1, middleNameSort: 1, lastNameSort: 1 }).lean().exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          const name1 = `${unencryptedUser.firstName} ${unencryptedUser.middleName} ${unencryptedUser.lastName}`;
          const name2 = `${encryptedUsers[i].firstName} ${encryptedUsers[i].middleName} ${encryptedUsers[i].lastName}`;
          if (!silent) {
            console.log(name1, " == ", name2);
          }
          assert.equal(name1, name2);
        })
      );
    });
    it("Sorting check for { firstName: 1, middleName: 1, lastName: 1 } after inserting users in sorted order to reach saturation", async function () {
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ firstName: 1, middleName: 1, lastName: 1 }).lean().exec();
      await encryptedUserModel.deleteMany({}).exec();
      await Promise.all(unencryptedUsers.map((user) => encryptedUserModel.createUser(user)));
      if (!silent) {
        console.log("Waiting for sort ID to be generated...");
      }
      let pendingUsers = -1;
      while (pendingUsers !== 0) {
        pendingUsers = await encryptedUserModel
          .find({ $or: [{ firstNameSort: null }, { middleNameSort: null }, { lastNameSort: null }] })
          .count();
        await new Promise((r) => setTimeout(r, 1000));
      }

      const encryptedUsers = await encryptedUserModel.find({}).sort({ firstNameSort: 1, middleNameSort: 1, lastNameSort: 1 }).lean().exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          const name1 = `${unencryptedUser.firstName} ${unencryptedUser.middleName} ${unencryptedUser.lastName}`;
          const name2 = `${encryptedUsers[i].firstName} ${encryptedUsers[i].middleName} ${encryptedUsers[i].lastName}`;
          if (!silent) {
            console.log(name1, " == ", name2);
          }
          assert.equal(name1, name2);
        })
      );
    });
  });
});
