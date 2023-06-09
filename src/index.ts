// mongoose is not in package.json to avoid compatibility issues with npm package user
import mongoose from "mongoose";

import { PLUGIN_OPTIONS } from "./constants";
import { getModelsQueue } from "./modelsQueue";

function sortEncryptedFields(schema: mongoose.Schema, pluginOptions: PluginOptions) {
  const sortEncryptedFieldsOptions: SortEncryptedFieldsOptions = {
    ...PLUGIN_OPTIONS,
    ...pluginOptions,
  };

  const { redisQueueClientOptions, selectSortFields } = sortEncryptedFieldsOptions;

  const sortFields: SortEncryptedFieldsOptions["sortFields"] = {};
  const decrypters: SortEncryptedFieldsOptions["decrypters"] = {};

  for (const [fieldName, field] of Object.entries(schema.paths)) {
    if (!field.options.sortFieldName) continue;
    if (!sortFields[fieldName]) sortFields[fieldName] = field.options.sortFieldName;
    if (!decrypters[fieldName]) decrypters[fieldName] = field.options.get;
    schema.add({
      [field.options.sortFieldName]: {
        type: String,
        default: null,
        select: selectSortFields,
      },
    });
  }

  sortEncryptedFieldsOptions.sortFields = sortFields;
  sortEncryptedFieldsOptions.decrypters = decrypters;

  const modelsQueue = getModelsQueue(redisQueueClientOptions);
  sortEncryptedFieldsOptions.modelsQueue = modelsQueue;

  schema["options"].sortEncryptedFieldsOptions = sortEncryptedFieldsOptions;

  async function preUpdateOne(next) {
    const update = this.getUpdate();
    for (const fieldName in sortFields) {
      const sortFieldName = sortFields[fieldName];
      if (update["$set"] && update["$set"][sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update["$set"] && update["$set"][fieldName]) {
        update["$set"][sortFieldName] = null;
      }
    }
    next();
  }

  async function postUpdateOne(res, next) {
    const update = this.getUpdate();
    for (const fieldName in sortFields) {
      const sortFieldName = sortFields[fieldName];
      if (update["$set"] && update["$set"][sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update["$set"] && update["$set"][fieldName]) {
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
  }

  async function postSave(doc, next) {
    for (const [fieldName, sortFieldName] of Object.entries(sortFields)) {
      await modelsQueue.addJob(`${this.constructor["modelName"]}::${fieldName}::${sortFieldName}`, {
        objectId: doc._id,
        fieldValue: doc[fieldName],
      });
    }
    next();
  }

  async function postUpdateMany(res, next) {
    const update = this.getUpdate();
    for (const fieldName in sortFields) {
      const sortFieldName = sortFields[fieldName];
      if (update["$set"] && update["$set"][sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update["$set"] && update["$set"][fieldName]) {
        const fieldValue = update["$set"][fieldName];
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
  }

  schema.pre("updateOne", preUpdateOne);
  schema.post("updateOne", postUpdateOne);
  schema.pre("findOneAndUpdate", preUpdateOne);
  schema.post("findOneAndUpdate", postUpdateOne);
  schema.pre("updateMany", preUpdateOne);
  schema.post("save", postSave);
  schema.post("updateMany", postUpdateMany);
}

function getModelWithSortEncryptedFieldsPlugin(documentName, schema, pluginOptions) {
  schema.plugin(sortEncryptedFields, pluginOptions);
  const { sortFields, modelsQueue, revaluateAllThreshold, revaluateAllCountThreshold } = schema.options.sortEncryptedFieldsOptions;
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
        if (noOfTotalDocuments === 0) {
          return;
        }
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

export default getModelWithSortEncryptedFieldsPlugin;
export { getModelWithSortEncryptedFieldsPlugin };
