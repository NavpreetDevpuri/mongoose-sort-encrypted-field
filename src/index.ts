// mongoose is not in package.json to avoid compatibility issues with npm package user
const mongoose = require("mongoose");

const { REDIS_QUEUE_CLIENT_OPTIONS, PLUGIN_OPTIONS } = require("./constants");
const { getModelsQueue } = require("./modelsQueue");
const { generateSortIdForAllDocuments } = require("./utils");

function sortEncryptedFields(schema: Schema, pluginOptions: PluginOptions) {
  const sortEncryptedFieldsOptions: SortEncryptedFieldsOptions = {
    ...PLUGIN_OPTIONS,
    ...pluginOptions,
  };

  const { redisQueueClientOptions, ignoreCases, noOfCharsToIncreaseOnSaturation } = sortEncryptedFieldsOptions;

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

  const modelsQueue = getModelsQueue(redisQueueClientOptions);
  sortEncryptedFieldsOptions.modelsQueue = modelsQueue;

  schema.options.sortEncryptedFieldsOptions = sortEncryptedFieldsOptions;

  schema.post("save", async function (doc, next) {
    for (const [fieldName, sortFieldName] of Object.entries(sortFields)) {
      await modelsQueue.addJob(`${this.constructor.modelName}${sortFieldName}`, {
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
    const update: Update = this.getUpdate();
    for (const fieldName in sortFields) {
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
    const update: Update = this.getUpdate();
    for (const fieldName in sortFields) {
      const sortFieldName = sortFields[fieldName];
      if (update.$set && update.$set[sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update.$set && update.$set[fieldName]) {
        const document = await this.model.findOne(this.getFilter(), { _id: 1, [fieldName]: 1 }).exec();
        if (document) {
          const fieldValue = document[fieldName];
          await modelsQueue.addJob(`${this.modelName.model}${sortFieldName}`, {
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
    for (const fieldName in sortFields) {
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
    for (const fieldName in sortFields) {
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
            await modelsQueue.addJob(`${this.model.modelName}${sortFieldName}`, {
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

  for (const fieldName in sortFields) {
    modelsQueue.registerGroup(`${model.modelName}${sortFields[fieldName]}`, model);
  }

  model
    .find({})
    .count()
    .exec()
    .then(async (noOfTotalDocuments) => {
      for (const fieldName in sortFields) {
        const sortFieldName = sortFields[fieldName];
        const noOfDocumentsWithoutSortId = await model
          .find({ $or: [{ [sortFieldName]: null }, { [sortFieldName]: { $exists: false } }] })
          .count()
          .exec();
        if (noOfTotalDocuments <= revaluateAllCountThreshold || noOfDocumentsWithoutSortId / noOfTotalDocuments > revaluateAllThreshold) {
          await modelsQueue.removeAllJobs(`${model.modelName}${sortFieldName}`);
          await modelsQueue.addJob(`${model.modelName}${sortFieldName}`, {
            generateSortIdForAllDocuments: true,
            fieldName,
            sortFieldName,
            ignoreCases,
          });
        } else {
          const documents = await model
            .find({ $or: [{ [sortFieldName]: null }, { [sortFieldName]: { $exists: false } }] }, { _id: 1, [fieldName]: 1 })
            .exec();
          if (documents && documents.length > 0) {
            for (let i = 0; i < documents.length; i += 1) {
              const fieldValue = documents[i][fieldName];
              await modelsQueue.addJob(`${model.modelName}${sortFieldName}`, {
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
