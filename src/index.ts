const { documentsBinarySearch, getAverageSortId, updateSortFieldsForDocument } = require("./utils");
const getModelsQueue = require("./modelsQueue");
const mongoose = require("mongoose");
const Base2N = require("@navpreetdevpuri/base-2-n");

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
    revaluateAllThreshold: number;
    revaluateAllCountThreshold: number;
  } = {
    redisOptions: null,
    noOfCharsToIncreaseOnSaturation: 2,
    ignoreCases: true,
    silent: true,
    revaluateAllThreshold: 0.5,
    revaluateAllCountThreshold: 100,
  }
) {
  const {
    redisOptions = null,
    noOfCharsToIncreaseOnSaturation = 2,
    ignoreCases = true,
    silent = true,
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
  } = { redisOptions: null, noOfCharsToIncreaseOnSaturation: 2, ignoreCases: true, silent: true, revaluateAllThreshold: 0.5, ...options };

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
