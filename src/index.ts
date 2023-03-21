const { documentsBinarySearch, getAverageSortId, updateSortFieldsForDocument } = require("./utils");
const getModelsQueue = require("./modelsQueue");
const mongoose = require("mongoose");
function sortEncryptedFields(
  schema: {
    pre: Function;
    post: Function;
    add: Function;
    options: { sortFields: {}; decrypters: {}; modelsQueue: any };
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
    maxRedisConsumerCount?: number;
  } = {
    redisOptions: null,
    noOfCharsToIncreaseOnSaturation: 2,
    ignoreCases: true,
    maxRedisConsumerCount: 1,
  }
) {
  const { redisOptions = null, noOfCharsToIncreaseOnSaturation = 2, ignoreCases = true, maxRedisConsumerCount = 1 } = options;

  if (!redisOptions) {
    throw "Please provide redisOptions in plugin options. Which is same as constructor of ioredis npm package";
  }

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

  schema.options.sortFields = sortFields;
  schema.options.decrypters = decrypters;

  const modelsQueue = getModelsQueue(redisOptions);
  schema.options.modelsQueue = modelsQueue;

  schema.post("save", async function (doc, next) {
    for (const [fieldName, sortFieldName] of Object.entries(sortFields)) {
      await modelsQueue.addJob(this.constructor, {
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
          await modelsQueue.addJob(this.model, {
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
            await modelsQueue.addJob(this.model, {
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

function evaluateMissedSortFields(model) {
  const plugin = model.schema.plugins.find((plugin) => plugin.fn.name == "sortEncryptedFields");
  if (!plugin) {
    throw "Plugin is not enabled on this model, Try ModelSchema.plugin(sortEncryptedFields), brefore creating Model.";
  }
  model.schema.options.model = model;
  const { sortFields, decrypters } = model.schema.options;
  for (const fieldName of Object.keys(sortFields)) {
    const sortFieldName = sortFields[fieldName];
    model.find({ [sortFieldName]: { $eq: null } }).then(async (documents) => {
      for (const document of documents) {
        // Retrigering sortId generation
        await model.updateOne({ _id: document._id }, { $set: { [fieldName]: decrypters[fieldName](document[fieldName]) } });
      }
    });
  }
}

function getModelWithSortEncryptedFieldsPlugin(documentName, schema, pluginOptions) {
  schema.plugin(sortEncryptedFields, pluginOptions);
  const modelsQueue = schema.options.modelsQueue;
  const model = mongoose.model(documentName, schema);
  modelsQueue.registerModel(model);
  return model;
}

module.exports = { getModelWithSortEncryptedFieldsPlugin };
