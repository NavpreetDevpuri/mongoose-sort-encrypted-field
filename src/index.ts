// mongoose is not in package.json to avoid compatibility issues with npm package user
const mongoose = require("mongoose");

const { PLUGIN_OPTIONS } = require("./constants");
const { getModelsQueue } = require("./modelsQueue");

function sortEncryptedFields(schema: Schema, pluginOptions: PluginOptions) {
  const sortEncryptedFieldsOptions: SortEncryptedFieldsOptions = {
    ...PLUGIN_OPTIONS,
    ...pluginOptions,
  };

  const { redisQueueClientOptions } = sortEncryptedFieldsOptions;

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

  schema.post("save", async function save(doc, next) {
    for (const [fieldName, sortFieldName] of Object.entries(sortFields)) {
      await modelsQueue.addJob(`${this.constructor.modelName}::${fieldName}::${sortFieldName}`, {
        objectId: doc._id,
        fieldValue: doc[fieldName],
      });
    }
    next();
  });

  schema.pre("updateOne", async function preUpdateOne(res, next) {
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

  schema.post("updateOne", async function postUpdateOne(res, next) {
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
          await modelsQueue.addJob(`${this.model.modelName}::${fieldName}::${sortFieldName}`, {
            objectId: document._id,
            fieldValue,
          });
        }
      }
    }
    next();
  });

  schema.pre("updateMany", async function preUpdateMany(res, next) {
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

  schema.post("updateMany", async function postUpdateMany(res, next) {
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
            await modelsQueue.addJob(`${this.model.modelName}::${fieldName}::${sortFieldName}`, {
              objectId: documents[i]._id,
              fieldValue,
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
  const { ignoreCases, noOfCharsForSortId, sortFields, modelsQueue, revaluateAllThreshold, revaluateAllCountThreshold } =
    schema.options.sortEncryptedFieldsOptions;
  const model = mongoose.model(documentName, schema);

  for (const fieldName in sortFields) {
    modelsQueue.registerGroup(model, fieldName, sortFields[fieldName]);
  }

  model
    .find({})
    .count()
    .exec()
    .then(async (noOfTotalDocuments) => {
      for (const fieldName in sortFields) {
        const sortFieldName = sortFields[fieldName];
        const groupId = `${model.modelName}::${fieldName}::${sortFieldName}`;
        const noOfDocumentsWithoutSortId = await model
          .find({ $or: [{ [sortFieldName]: null }, { [sortFieldName]: { $exists: false } }] })
          .count()
          .exec();
        if (noOfTotalDocuments <= revaluateAllCountThreshold || noOfDocumentsWithoutSortId / noOfTotalDocuments > revaluateAllThreshold) {
          await modelsQueue.removeAllJobs(groupId);
          await modelsQueue.addJob(groupId, {
            updateSortIdForAllDocuments: true,
          });
        } else {
          const documents = await model
            .find({ $or: [{ [sortFieldName]: null }, { [sortFieldName]: { $exists: false } }] }, { _id: 1, [fieldName]: 1 })
            .exec();
          if (documents && documents.length > 0) {
            for (let i = 0; i < documents.length; i += 1) {
              const fieldValue = documents[i][fieldName];
              await modelsQueue.addJob(groupId, {
                objectId: documents[i]._id,
                fieldValue,
              });
            }
          }
        }
      }
    });
  return model;
}

module.exports = { getModelWithSortEncryptedFieldsPlugin };
