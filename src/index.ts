const Base2N = require('@navpreetdevpuri/base-2-n');

function sortEncryptedFields(
  schema: {
    post: Function;
    add: Function;
    options: { sortFields: {}; decrypters: {} };
    paths: {
      [fieldName: string]: {
        options: { get: Function; sortFieldName: string };
      };
    };
  },
  options: {
    noOfDividePartsForSearching?: number;
    noOfCharsToIncreaseOnSaturation?: number;
  } = { noOfDividePartsForSearching: 100, noOfCharsToIncreaseOnSaturation: 2 }
) {
  const {
    noOfDividePartsForSearching = 100,
    noOfCharsToIncreaseOnSaturation = 2,
  } = options;

  const sortFields = {};
  const decrypters = {};

  for (const [fieldName, field] of Object.entries(schema.paths)) {
    if (!field.options.sortFieldName) continue;
    if (!sortFields[fieldName])
      sortFields[fieldName] = field.options.sortFieldName;
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
    sortFieldName,
    ignoreSortFieldValue
  ) {
    const index = documentsBinarySearch(documents, fieldName, fieldValue);
    const gteIndex = index - 1;
    const lteIndex = index;
    const match: any = {
      $and: [{ [sortFieldName]: { $ne: ignoreSortFieldValue } }],
    };

    if (gteIndex === -1 && lteIndex === documents.length) {
      return match;
    }

    match.$and.push({ [sortFieldName]: {} });

    if (gteIndex !== -1) {
      match.$and[1][sortFieldName].$gte = documents[gteIndex][sortFieldName];
    }
    if (lteIndex !== documents.length) {
      match.$and[1][sortFieldName].$lte = documents[lteIndex][sortFieldName];
    }

    return match;
  }

  async function updateSortFieldsForDocument(
    objectId,
    model,
    fieldName,
    fieldValue,
    sortFieldName,
    ignoreSortFieldValue = null
  ) {
    console.time(`Total time took to update orderId: ${objectId}`);
    const pipeline = [];
    let currN = Math.round(
      (await model.find({}).count().exec()) / noOfDividePartsForSearching
    );
    let match: {} = {
      $and: [{ [sortFieldName]: { $ne: ignoreSortFieldValue } }],
    };
    let documents = [];

    while (currN > 0) {
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

      match = await getMatchForAggregate(
        documents,
        fieldName,
        fieldValue,
        sortFieldName,
        ignoreSortFieldValue
      );
      currN = Math.round(currN / noOfDividePartsForSearching);
    }
    match = await getMatchForAggregate(
      documents,
      fieldName,
      fieldValue,
      sortFieldName,
      ignoreSortFieldValue
    );
    documents = await model
      .aggregate([
        { $match: match },
        { $project: { [fieldName]: 1, [sortFieldName]: 1 } },
        { $sort: { [sortFieldName]: 1 } },
      ])
      .exec();

    const index = documentsBinarySearch(documents, fieldName, fieldValue);
    let gteIndex = index - 1;
    let lteIndex = index;
    const predecessorSortId =
      documents[gteIndex] && documents[gteIndex][sortFieldName];
    const successorSortId =
      documents[lteIndex] && documents[lteIndex][sortFieldName];
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
      console.log(
        `mongoose-sort-encrypted-field -> Got collions, retrying... ${objectId}`
      );
      // Retrigering sortId generation due to collion

      console.timeEnd(`Total time took to update orderId: ${objectId}`);
      await model.updateOne(
        { _id: objectId },
        { $set: { [fieldName]: decrypters[fieldName][document[fieldName]] } }
      );
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
    const document = await model
      .findOne(filter, { _id: 1, [sortFieldName]: 1 })
      .exec();
    if (document) {
      await updateSortFieldsForDocument(
        document._id,
        model,
        fieldName,
        fieldValue,
        sortFieldName,
        document[sortFieldName]
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
    const documents = await model
      .find(filter, { _id: 1, [sortFieldName]: 1 })
      .exec();
    if (documents && documents.length > 0) {
      for (let i = 0; i < documents.length; i += 1) {
        await updateSortFieldsForDocument(
          documents[i]._id,
          model,
          fieldName,
          decrypters[fieldName](fieldValue),
          sortFieldName,
          documents[i][sortFieldName]
        );
      }
    }
  }

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
    for (const fieldName of Object.keys(sortFields)) {
      const sortFieldName = sortFields[fieldName];
      if (update.$set && update.$set[sortFieldName]) {
        // Bypass middleware internal call for updating any sortFieldName field
        break;
      }
      if (update.$set && update.$set[fieldName]) {
        updateSortFieldsForUpdateOne(
          this.getFilter(),
          this.model,
          fieldName,
          decrypters[fieldName](update.$set[fieldName]),
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
          this.model,
          fieldName,
          decrypters[fieldName](update.$set[fieldName]),
          sortFieldName
        );
      }
    }
    next();
  });
}

function evaluateMissedSortFields(model) {
  const plugin = model.schema.plugins.find(
    (plugin) => plugin.fn.name == 'sortEncryptedFields'
  );
  if (!plugin) {
    throw 'Plugin is not enabled on this model, Try ModelSchema.plugin(sortEncryptedFields), brefore creating Model.';
  }
  model.schema.options.model = model;
  const { sortFields, decrypters } = model.schema.options;
  for (const fieldName of Object.keys(sortFields)) {
    const sortFieldName = sortFields[fieldName];
    model.find({ [sortFieldName]: { $eq: null } }).then(async (documents) => {
      for (const document of documents) {
        // Retrigering sortId generation
        await model.updateOne(
          { _id: document._id },
          { $set: { [fieldName]: decrypters[fieldName](document[fieldName]) } }
        );
      }
    });
  }
}
module.exports = { sortEncryptedFields, evaluateMissedSortFields };
