const assert = require("assert");
const generateName = require("project-name-generator");
const { getModelsQueue } = require("../lib/modelsQueue");
const fs = require("fs");
const { initiateRedisMemoryServer, connectMongoose, stopDatabases } = require("./utils/databases");

describe("mongoose-sort-encrypted-field tests", async function () {
  const newUsers = require("./data/newUsers.json");
  const n = 0;
  // const newUsers = [];//require("./data/newUsers.json");
  // const n = 50;
  //   it(`creating new documents with ${n} random users and ${newUsers.length} predefined users`, async function () {
  //     for (let i = 0; i < n; i += 1) {
  //       const [firstName, middleName] = generateName().raw;
  //       const [lastName] = generateName().raw;
  //       newUsers.push({ firstName, middleName, lastName });
  //     }
  //     await unencryptedUserModel.deleteMany({}).exec();
  //     await encryptedUserModel.deleteMany({}).exec();
  //     for (const newUser of newUsers) {
  //       await unencryptedUserModel.createUser(newUser);
  //       await encryptedUserModel.createUser(newUser);
  //     }
  //     const encryptedUsers = await encryptedUserModel.find({}).sort({ firstName: 1 }).exec();
  //     for (let i = 0; i < n; i += 1) {
  //       await encryptedUserModel.updateOne({ _id: encryptedUsers[i]._id }, { $set: { firstNameSort: Buffer.from(new Uint8Array([i])) } })
  //     }
  //     assert.equal(await unencryptedUserModel.find({}).count().exec(), newUsers.length);
  //     assert.equal(await encryptedUserModel.find({}).count().exec(), newUsers.length);
  //   });

  //   it("Sorting check for { firstName: 1 }", async function () {
  //     // console.log("Waiting for sort ID to be generated...");
  //     // let pendingJobsCount = -1;
  //     // while (pendingJobsCount !== 0) {
  //     //   pendingJobsCount = await modelsQueue.getPendingJobsCount();
  //     //   await new Promise((r) => setTimeout(r, 5000));
  //     // }
  //     const unencryptedUsers = await unencryptedUserModel.find({}).sort({ firstName: 1 }).exec();
  //     const encryptedUsers1 = await encryptedUserModel.find({}).sort({ firstNameSort: 1 }).exec();
  //     const encryptedUsers = await encryptedUserModel.find({}).sort({ firstNameSort: 1 }).exec();
  //     await Promise.all(
  //       unencryptedUsers.map(async (unencryptedUser, i) => {
  //         console.log(unencryptedUser.firstName, encryptedUsers[i].firstName);
  //         assert.equal(unencryptedUser.firstName, encryptedUsers[i].firstName);
  //       })
  //     );
  //   });

  describe(`Testing sorting after creating new documents with ${n} random users and ${newUsers.length} predefined users`, async function () {
    let unencryptedUserModel;
    let encryptedUserModel;
    let modelsQueue;
    before(async function () {
      await connectMongoose();
      await initiateRedisMemoryServer();
      unencryptedUserModel = require("./models/unencryptedUser");
      encryptedUserModel = require("./models/encryptedUser");
      modelsQueue = getModelsQueue();
    });

    after(async () => {
      await stopDatabases();
    });
    
    it(`creating new documents with ${n} random users and ${newUsers.length} predefined users`, async function () {
      for (let i = 0; i < n; i += 1) {
        const [firstName, middleName] = generateName().raw;
        const [lastName] = generateName().raw;
        newUsers.push({ firstName, middleName, lastName });
      }
      await unencryptedUserModel.deleteMany({}).exec();
      await encryptedUserModel.deleteMany({}).exec();
      await Promise.all(newUsers.map(async (newUser) => {
        await unencryptedUserModel.createUser(newUser);
        await encryptedUserModel.createUser(newUser);
      }));
      assert.equal(await unencryptedUserModel.find({}).count().exec(), newUsers.length);
      assert.equal(await encryptedUserModel.find({}).count().exec(), newUsers.length);
    });

    it("Sorting check for { firstName: 1 }", async function () {
      console.log("Waiting for sort ID to be generated...");
      let pendingJobsCount = -1;
      while (pendingJobsCount !== 0) {
        pendingJobsCount = await modelsQueue.getPendingJobsCount();
        await new Promise((r) => setTimeout(r, 1000));
      }
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ firstName: 1 }).exec();
      const encryptedUsers1 = await encryptedUserModel.find({}).sort({ firstNameSort: 1 }).exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ firstNameSort: 1 }).exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          console.log(unencryptedUser.firstName, encryptedUsers[i].firstName);
          assert.equal(unencryptedUser.firstName, encryptedUsers[i].firstName);
        })
      );
    });
    it("Sorting check for { middleName: 1 }", async function () {
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ middleName: 1 }).exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ middleNameSort: 1 }).exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          assert.equal(unencryptedUser.middleName, encryptedUsers[i].middleName);
        })
      );
    });
    it("Sorting check for { lastName: 1 }", async function () {
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ lastName: 1 }).exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ lastNameSort: 1 }).exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          assert.equal(unencryptedUser.lastName, encryptedUsers[i].lastName);
        })
      );
    });
    it("Sorting check for { firstName: 1, middleName: 1, lastName: 1 }", async function () {
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ firstName: 1, middleName: 1, lastName: 1 }).exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ firstNameSort: 1, middleNameSort: 1, lastNameSort: 1 }).exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          assert.equal(unencryptedUser.lastName, encryptedUsers[i].lastName);
        })
      );
    });
    it("Sorting check for { lastName: 1, firstName: 1, middleName: 1 }", async function () {
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ lastName: 1, firstName: 1, middleName: 1 }).exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ lastNameSort: 1, firstNameSort: 1, middleNameSort: 1 }).exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          assert.equal(unencryptedUser.lastName, encryptedUsers[i].lastName);
        })
      );
    });
    it("Sorting check for { firstName: 1, middleName: 1, lastName: 1 } after rebuilding for all documents", async function () {
      await Promise.all(
        Object.values(modelsQueue.groupIdToSortIdManagerMap).map(async (sortIdManger) => sortIdManger.updateSortIdForAllDocuments())
      );
      const unencryptedUsers = await unencryptedUserModel.find({}).sort({ firstName: 1, middleName: 1, lastName: 1 }).exec();
      const encryptedUsers = await encryptedUserModel.find({}).sort({ firstNameSort: 1, middleNameSort: 1, lastNameSort: 1 }).exec();
      await Promise.all(
        unencryptedUsers.map(async (unencryptedUser, i) => {
          assert.equal(unencryptedUser.lastName, encryptedUsers[i].lastName);
        })
      );
    });
  });
});
