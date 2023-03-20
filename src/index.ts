const Base2N = require('@navpreetdevpuri/base-2-n');

function sortEncryptedFields(
  schema: {
    post: Function;
    add: Function;
    paths: {
      [fieldName: string]: {
        options: { get: Function; sortFieldName: string };
      };
    };
  },
  options
) {
  const {
    noOfDividePartsForSearching = 100,
    noOfCharsToIncreaseOnSaturation = 2,
  } = options;
  options.noOfDividePartsForSearching = noOfDividePartsForSearching;
  options.noOfCharsToIncreaseOnSaturation = noOfCharsToIncreaseOnSaturation;

  const sortFields: { [key: string]: string } = {};
  const decrypters = {};

  function documentsBinarySearch(documents, fieldName, value) {
    let start = 0;
    let end = documents.length - 1;

    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      const decryptedMidValue = decrypters[fieldName](
        documents[mid][fieldName]
      ).toLowerCase();
      if (value < decryptedMidValue) {
        end = mid - 1;
      } else if (decryptedMidValue <= value) {
        start = mid + 1;
      }
    }

    return start;
  }

  function getAverageSortId(predecessorSortId, successorSortId) {
    if (!predecessorSortId) {
      predecessorSortId = ''.padEnd(successorSortId.length, '\0');
    }

    if (!successorSortId) {
      successorSortId = ''.padEnd(predecessorSortId.length, '\uffff');
    }

    let predecessorNumber;
    let successorNumber;

    if (predecessorSortId.length == predecessorSortId.length) {
      predecessorNumber = new Base2N(predecessorSortId);
      successorNumber = new Base2N(successorSortId);
      const averageNumber = predecessorNumber.average(successorNumber);
      if (averageNumber.toString() != predecessorNumber.toString()) {
        return averageNumber.toString();
      }
      predecessorNumber = new Base2N(
        predecessorSortId.padEnd(
          averageNumber.length + noOfCharsToIncreaseOnSaturation,
          '\0'
        )
      );
      successorNumber = new Base2N(
        successorSortId.padEnd(
          averageNumber.length + noOfCharsToIncreaseOnSaturation,
          '\0'
        )
      );
      return predecessorNumber.average(successorNumber).toString();
    }

    const bigger =
      predecessorSortId.length > successorSortId.length
        ? predecessorSortId
        : successorSortId;
    const smaller =
      successorSortId.length > predecessorSortId.length
        ? predecessorSortId
        : successorSortId;

    const biggerNumber = new Base2N(bigger);
    const smallerNumber = new Base2N(smaller.padEnd(bigger.length, '\0'));

    return biggerNumber.average(smallerNumber).toString();
  }

  async function getMatchForAggregate(
    documents,
    fieldName,
    fieldValue,
    sortFieldName
  ) {
    const index = documentsBinarySearch(documents, fieldName, fieldValue);
    const gteIndex = index - 1;
    const lteIndex = index;
    const match = {
      $and: [
        { [sortFieldName]: { $ne: null } },
        {
          [sortFieldName]: {
            $gte:
              gteIndex == -1 ? undefined : documents[gteIndex][sortFieldName],
            $lte:
              lteIndex == documents.length
                ? undefined
                : documents[lteIndex][sortFieldName],
          },
        },
      ],
    };

    return match;
  }

  async function updateSortFieldsForDocument(
    objectId,
    model,
    fieldName,
    fieldValue,
    sortFieldName
  ) {
    console.time(`Total time took to update orderId: ${objectId}`);
    const pipeline = [];
    let currN = Math.round(
      (await model.find({}).count().exec()) / noOfDividePartsForSearching
    );
    let match: {} = { $and: { [sortFieldName]: { $ne: null } } };
    let documents;
    while (true) {
      documents = await model.aggregate([
        { $match: match },
        {
          $setWindowFields: {
            sortBy: { [sortFieldName]: 1 },
            output: {
              index: { $rank: {} },
            },
          },
        },
        {
          $match: {
            $expr: {
              $eq: [{ $mod: ['$index', currN] }, 0],
            },
          },
        },
        { $project: { [fieldName]: 1, [sortFieldName]: 1 } },
      ]);

      if (currN < noOfDividePartsForSearching) {
        break;
      }
      match = await getMatchForAggregate(
        documents,
        fieldName,
        fieldValue,
        sortFieldName
      );
      currN = Math.round(currN / noOfDividePartsForSearching);
    }

    const index = documentsBinarySearch(documents, fieldName, fieldValue);
    let gteIndex = index - 1;
    let lteIndex = index;
    const predecessorSortId = documents[gteIndex][sortFieldName];
    const successorSortId = documents[lteIndex][sortFieldName];
    const newSortId = getAverageSortId(predecessorSortId, successorSortId);
    await model.updateOne(
      { _id: objectId },
      { $set: { [sortFieldName]: newSortId.toString() } }
    );
    const documentsCountWithSameSortId = await model
      .find({ [sortFieldName]: newSortId.toString() })
      .count()
      .exec();
    if (documentsCountWithSameSortId > 1) {
      const documentsWithSameSortId = await model
        .find(
          { [sortFieldName]: newSortId.toString() },
          { _id: 1, [fieldName]: 1 }
        )
        .exec();
      console.log(
        `mongoose-sort-encrypted-field -> Got collions, retrying... ${documentsWithSameSortId}`
      );
      for (const document of documentsWithSameSortId) {
        // Retrigering sortId generation due to collion
        await model.updateOne(
          { _id: document._id },
          { $set: { [fieldName]: document[fieldName] } }
        );
      }
    }
    console.timeEnd(`Total time took to update orderId: ${objectId}`);
  }

  async function updateSortFieldsForUpdateOne(
    filter,
    model,
    fieldName,
    fieldValue,
    sortFieldName
  ) {
    const document = await model.findOne(filter, { _id: 1 }).exec();
    if (document) {
      await updateSortFieldsForDocument(
        document._id,
        model,
        fieldName,
        fieldValue,
        sortFieldName
      );
    }
  }

  async function updateSortFieldsForUpdateMany(
    filter,
    model,
    fieldName,
    fieldValue,
    sortFieldName
  ) {
    const documents = await model.find(filter, { _id: 1 }).exec();
    if (documents && documents.length > 0) {
      for (let i = 0; i < documents.length; i += 1) {
        await updateSortFieldsForDocument(
          documents[i]._id,
          model,
          fieldName,
          fieldValue,
          sortFieldName
        );
      }
    }
  }

  for (const [fieldName, field] of Object.entries(schema.paths)) {
    if (field.options.sortFieldName) {
      sortFields[fieldName] = field.options.sortFieldName;
      decrypters[fieldName] = field.options.get;
      schema.add({
        [field.options.sortFieldName]: {
          type: String,
          default: null,
        },
      });
    }
  }

  options.sortFields = sortFields;
  options.decrypters = decrypters;

  schema.post('save', async function (doc, next) {
    for (const [fieldName, sortFieldName] of Object.entries(sortFields)) {
      updateSortFieldsForDocument(
        doc._id,
        this.constructor,
        fieldName,
        doc[fieldName],
        sortFieldName
      );
    }
    next();
  });

  schema.post('updateOne', function (res, next) {
    const update: { $set: { [key: string]: string } } = this.getUpdate();
    for (const [fieldName, sortFieldName] of Object.entries(sortFields)) {
      if (update.$set && update.$set[sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update.$set && update.$set[fieldName]) {
        updateSortFieldsForUpdateOne(
          this.getFilter(),
          this.constructor,
          fieldName,
          update.$set[fieldName],
          sortFieldName
        );
      }
    }
    next();
  });

  schema.post('updateMany', function (res, next) {
    const update = this.getUpdate();
    for (const fieldName of Object.keys(sortFields)) {
      const sortFieldName = sortFields[fieldName];
      if (update.$set && update.$set[sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update.$set && update.$set[fieldName]) {
        updateSortFieldsForUpdateMany(
          this.getFilter(),
          this.constructor,
          fieldName,
          update.$set[fieldName],
          sortFieldName
        );
      }
    }
    next();
  });
}

async function evaluateMissedSortFields(model) {
  const pluginOptions = model.schema.plugins.find(
    (plugin) => plugin.fn.name == 'sortEncryptedFields'
  );
  if (!pluginOptions) {
    throw 'Plugin is not enabled on this model, Try ModelSchema.plugin(sortEncryptedFields), brefore creating Model.';
  }
  for (const fieldName of Object.keys(pluginOptions.sortFields)) {
    const sortFieldName = pluginOptions.sortFields[fieldName];
    const documents = await model.find({ [sortFieldName]: { $eq: null } });
    for (const document of documents) {
      // Retrigering sortId generation
      await model.updateOne(
        { _id: document._id },
        { $set: { [fieldName]: document[fieldName] } }
      );
    }
  }
}
module.exports = { sortEncryptedFields, evaluateMissedSortFields };
