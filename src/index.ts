const Base2N = require('@navpreetdevpuri/base-2-n');

function documentsBinarySearch(documents, fieldName, decrypter, value) {
  let start = 0;
  let end = documents.length - 1;

  while (start <= end) {
    const mid = Math.floor((start + end) / 2);
    const decryptedMidValue = decrypter(
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

function getAverageSortId(
  predecessorSortId,
  successorSortId,
  numberOfCharsToIncreaseOnSaturation
) {
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
        averageNumber.length + numberOfCharsToIncreaseOnSaturation,
        '\0'
      )
    );
    successorNumber = new Base2N(
      successorSortId.padEnd(
        averageNumber.length + numberOfCharsToIncreaseOnSaturation,
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

function sortEncryptedFields(noOfDivideParts = 100) {
  async function updateSortIdsForSave(
    model,
    fieldName,
    fieldValue,
    sortIdFieldName,
    objectId,
    decrypters
  ) {
    console.time(`Total time took to update orderId: ${objectId}`);
    let currN = Math.round(
      (await model.find({}).count().exec()) / noOfDivideParts
    );
    const match: { $and: [{}] } = {
      $and: [{ [sortIdFieldName]: { $ne: null } }],
    };
    let documents;
    console.time(`Total time took to search final documents: ${objectId}`);

    while (true) {
      documents = await model.aggregate([
        { $match: match },
        {
          $setWindowFields: {
            sortBy: { [sortIdFieldName]: 1 },
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
        { $project: { [fieldName]: 1, [sortIdFieldName]: 1 } },
      ]);

      if (currN < noOfDivideParts) {
        // documents.forEach((document) => (document[fieldName] = decrypters[fieldName](document[fieldName]).toLowerCase()));
        break;
      }

      const index = documentsBinarySearch(
        documents,
        fieldName,
        decrypters[fieldName],
        fieldValue
      );
      const gteIndex = index - 1;
      const lteIndex = index;
      match.$and.push({
        [sortIdFieldName]: {
          $gte:
            gteIndex == -1 ? undefined : documents[gteIndex][sortIdFieldName],
          $lte:
            lteIndex == documents.length
              ? undefined
              : documents[lteIndex][sortIdFieldName],
        },
      });
      // documents.forEach(
      //   (document) =>
      //     (document[fieldName] = decrypters[fieldName](
      //       document[fieldName]
      //     ).toLowerCase())
      // );
      currN = Math.round(currN / noOfDivideParts);
    }

    console.timeEnd(`Total time took to search final documents: ${objectId}`);

    console.time(`Total time took to biinary serach: ${objectId}`);
    const index = documentsBinarySearch(
      documents,
      fieldName,
      decrypters[fieldName],
      fieldValue
    );
    console.timeEnd(`Total time took to biinary serach: ${objectId}`);

    console.time(`Total time took to get sortId: ${objectId}`);
    const newSortId = getAverageSortId(
      documents[index - 1][sortIdFieldName],
      documents[index][sortIdFieldName],
      1
    );
    console.timeEnd(`Total time took to get sortId: ${objectId}`);

    console.time(`Total time took to get updateOne: ${objectId}`);
    await model.updateOne(
      { _id: objectId },
      { $set: { [sortIdFieldName]: newSortId.toString() } }
    );
    console.timeEnd(`Total time took to get updateOne: ${objectId}`);

    console.timeEnd(`Total time took to update orderId: ${objectId}`);
  }

  async function updateSortIdsForUpdateOne(
    model,
    fieldName,
    fieldValue,
    sortIdFieldName,
    filter,
    decrypters
  ) {
    // implementation details for updating the sorting ids for a specific field and document on updateOne go here
    console.log(
      `Updating sorting ids for ${fieldName} ${sortIdFieldName} and filter ${JSON.stringify(
        filter
      )} on updateOne`
    );
  }

  return function (
    schema: {
      post: Function;
      add: Function;
      paths: {
        [fieldName: string]: {
          options: { get: Function; sortIdFieldName: string };
        };
      };
    },
    options
  ) {
    const sortIdFields = {};
    const decrypters = {};
    for (const [fieldName, field] of Object.entries(schema.paths)) {
      if (field.options.sortIdFieldName) {
        sortIdFields[fieldName] = field.options.sortIdFieldName;
        decrypters[fieldName] = field.options.get;
        schema.add({
          [field.options.sortIdFieldName]: {
            type: String,
            default: null,
          },
        });
      }
    }

    schema.post('save', async function (doc, next) {
      for (const [fieldName, sortIdFieldName] of Object.entries(sortIdFields)) {
        // if (doc.isModified(fieldName)) {
        updateSortIdsForSave(
          this.constructor,
          fieldName,
          doc[fieldName],
          sortIdFieldName,
          doc._id,
          decrypters
        );
        // }
      }
      next();
    });

    // schema.post('updateOne', async (res, next) => {
    //   const update = res.getUpdate();
    //   for (const [fieldName, sortIdName] of Object.entries(sortIdFields)) {
    //     if (update.$set && update.$set[fieldName]) {
    //       updateSortIdsForUpdateOne(this.constructor, fieldName, update.$set[fieldName], sortIdName, res.getFilter(), decrypters);
    //     }
    //   }
    //   next();
    // });
  };
}

module.exports = sortEncryptedFields;
