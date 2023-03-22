const { documentsBinarySearch, getAverageSortId, updateSortFieldsForDocument } = require("./utils");
const getModelsQueue = require("./modelsQueue");
const mongoose = require("mongoose");
const Base2N = require("@navpreetdevpuri/base-2-n");

/*
options:
  redisOptions: 
    default: null; 
      Any options which we can pass to ioredis constructor; (https://www.npmjs.com/package/ioredis) 
  noOfCharsToIncreaseOnSaturation?: number; 
    default: 2; 
      Number of chars to increase on saturation, for example, 
      for `04` and `05`, first we can see there is no whole number between those 
      so, It append extra digit at the end and it becomes `040` and `050` and the average is `045`. 
      In the base `2^16` number system, getting a saturation like that is mathematically very unlikely.
  ignoreCases?: boolean; 
    default: false;
      To ignore cases.
  silent: boolean; 
    default: false;
      Flag to turn on/off console info logs
  revaluateAllThreshold: number;
    default: 0.5
      If number of documents without sort ID divides by total number of documents is less then this threshold
      Then it will get all values, sort them, generate sort ID for all at equal distance 0 to 2^16
      For example if we have 3 documents and we can 00 to 20 sort ID 
      then those documents will have 05 10 15 sort ID
  revaluateAllCountThreshold: number;
    default: 100
      If total number of documents are less then this value 
      then it will regenerat sort ID same way as revaluateAllThreshold
*/
function sortEncryptedFields(
  schema: {
    pre: Function;
    post: Function;
    add: Function;
    options: { sortEncryptedFieldsOptions };
    paths: {
      [fieldName: string]: {
        options: { get: Function; sortFieldName: string };
      };
    };
  },
  options: {
    redisOptions: any;
    noOfCharsToIncreaseOnSaturation?: number;
    ignoreCases?: boolean;
    silent: boolean;
    revaluateAllThreshold?: number;
    revaluateAllCountThreshold?: number;
  } = {
    redisOptions: null,
    noOfCharsToIncreaseOnSaturation: 2,
    ignoreCases: false,
    silent: false,
    revaluateAllThreshold: 0.5,
    revaluateAllCountThreshold: 100,
  }
) {
  const {
    redisOptions = null,
    noOfCharsToIncreaseOnSaturation = 2,
    ignoreCases = false,
    silent = false,
    revaluateAllThreshold = 0.5,
    revaluateAllCountThreshold = 100,
  } = options;

  if (!redisOptions) {
    throw "Please provide redisOptions in plugin options. Which is same as constructor of ioredis npm package";
  }

  const sortEncryptedFieldsOptions: {
    redisOptions?: any;
    sortFields?: {};
    decrypters?: {};
    modelsQueue?: typeof modelsQueue;
    noOfCharsToIncreaseOnSaturation?: number;
    ignoreCases?: boolean;
    silent?: boolean;
    revaluateAllThreshold: number;
  } = { redisOptions: null, noOfCharsToIncreaseOnSaturation: 2, ignoreCases: false, silent: false, revaluateAllThreshold: 0.5, ...options };

  const sortFields = {};
  const decrypters = {};

  for (const [fieldName, field] of Object.entries(schema.paths)) {
    if (!field.options.sortFieldName) continue;
    if (!sortFields[fieldName]) sortFields[fieldName] = field.options.sortFieldName;
    if (!decrypters[fieldName]) decrypters[fieldName] = field.options.get;
    schema.add({
      [field.options.sortFieldName]: {
        type: String,
        default: null,
      },
    });
  }

  sortEncryptedFieldsOptions.sortFields = sortFields;
  sortEncryptedFieldsOptions.decrypters = decrypters;

  const modelsQueue = getModelsQueue(redisOptions);
  sortEncryptedFieldsOptions.modelsQueue = modelsQueue;

  schema.options.sortEncryptedFieldsOptions = sortEncryptedFieldsOptions;

  schema.post("save", async function (doc, next) {
    for (const [fieldName, sortFieldName] of Object.entries(sortFields)) {
      await modelsQueue.addJob(this.constructor.modelName, {
        objectId: doc._id,
        fieldName,
        fieldValue: ignoreCases ? doc[fieldName].toLowerCase() : doc[fieldName],
        sortFieldName,
        ignoreCases,
        noOfCharsToIncreaseOnSaturation,
      });
    }
    next();
  });

  schema.pre("updateOne", async function (res, next) {
    const update: { $set: { [key: string]: string } } = this.getUpdate();
    for (const fieldName of Object.keys(sortFields)) {
      const sortFieldName = sortFields[fieldName];
      if (update.$set && update.$set[sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update.$set && update.$set[fieldName]) {
        update.$set[sortFieldName] = null;
      }
    }
    next();
  });

  schema.post("updateOne", async function (res, next) {
    const update: { $set: { [key: string]: string } } = this.getUpdate();
    for (const fieldName of Object.keys(sortFields)) {
      const sortFieldName = sortFields[fieldName];
      if (update.$set && update.$set[sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update.$set && update.$set[fieldName]) {
        const document = await this.model.findOne(this.getFilter(), { _id: 1, [fieldName]: 1 }).exec();
        if (document) {
          const fieldValue = document[fieldName];
          await modelsQueue.addJob(this.modelName.model, {
            objectId: document._id,
            fieldName,
            fieldValue: ignoreCases ? fieldValue.toLowerCase() : fieldValue,
            sortFieldName,
            ignoreCases,
            noOfCharsToIncreaseOnSaturation,
          });
        }
      }
    }
    next();
  });

  schema.pre("updateMany", async function (res, next) {
    const update = this.getUpdate();
    for (const fieldName of Object.keys(sortFields)) {
      const sortFieldName = sortFields[fieldName];
      if (update.$set && update.$set[sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update.$set && update.$set[fieldName]) {
        update.$set[sortFieldName] = null;
      }
    }
    next();
  });

  schema.post("updateMany", async function (res, next) {
    const update = this.getUpdate();
    for (const fieldName of Object.keys(sortFields)) {
      const sortFieldName = sortFields[fieldName];
      if (update.$set && update.$set[sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update.$set && update.$set[fieldName]) {
        const fieldValue = update.$set[fieldName];
        const documents = await this.model.find(this.getFilter(), { _id: 1 }).exec();
        if (documents && documents.length > 0) {
          for (let i = 0; i < documents.length; i += 1) {
            await modelsQueue.addJob(this.model.modelName, {
              objectId: documents[i]._id,
              fieldName,
              fieldValue: ignoreCases ? fieldValue.toLowerCase() : fieldValue,
              sortFieldName,
              ignoreCases,
              noOfCharsToIncreaseOnSaturation,
            });
          }
        }
      }
    }
    next();
  });
}

function getModelWithSortEncryptedFieldsPlugin(documentName, schema, pluginOptions) {
  schema.plugin(sortEncryptedFields, pluginOptions);
  const { ignoreCases, noOfCharsToIncreaseOnSaturation, sortFields, modelsQueue, revaluateAllThreshold, revaluateAllCountThreshold } =
    schema.options.sortEncryptedFieldsOptions;
  const model = mongoose.model(documentName, schema);
  modelsQueue.registerModel(model);
  model
    .find({})
    .count()
    .exec()
    .then(async (noOfTotalDocuments) => {
      const {} = model.schema.options;
      for (const fieldName of Object.keys(sortFields)) {
        const sortFieldName = sortFields[fieldName];
        const noOfDocumentsWithoutSortId = await model
          .find({ [sortFieldName]: { $eq: null } })
          .count()
          .exec();
        if (
          noOfDocumentsWithoutSortId <= revaluateAllCountThreshold ||
          noOfDocumentsWithoutSortId / noOfTotalDocuments > revaluateAllThreshold
        ) {
          await modelsQueue.removeAllJobs(model.modelName);
          await modelsQueue.addJob(model.modelName, {
            generateSortIdForAllDocuments: true,
            fieldName,
            sortFieldName,
            ignoreCases,
          });
        } else {
          const documents = await model.find({ [sortFieldName]: { $eq: null } }, { _id: 1, [fieldName]: 1 }).exec();
          if (documents && documents.length > 0) {
            for (let i = 0; i < documents.length; i += 1) {
              const fieldValue = documents[i][fieldName];
              await modelsQueue.addJob(model.modelName, {
                objectId: documents[i]._id,
                fieldName,
                fieldValue,
                sortFieldName,
                ignoreCases,
                noOfCharsToIncreaseOnSaturation,
              });
            }
          }
        }
      }
    });
  return model;
}

module.exports = { getModelWithSortEncryptedFieldsPlugin };
