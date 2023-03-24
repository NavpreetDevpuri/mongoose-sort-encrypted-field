const Base2N = require("@navpreetdevpuri/base-2-n");

async function documentsBinarySearch(model, fieldName, fieldValue, sortFieldName, ignoreCases, noOfCharsForSortId) {
  fieldValue = fieldValue || '';
  fieldValue = ignoreCases ? fieldValue.toLowerCase() : fieldValue;
  const n = await model
    .findOne({ [sortFieldName]: { $ne: null } })
    .count()
    .exec();
  if (n === 0) {
    return {
      predecessorSortId: new Base2N("\0", noOfCharsForSortId).toString(),
      successorSortId: "".padEnd(noOfCharsForSortId, "\uffff"),
    };
  }
  let start = 0;
  let end = n - 1;
  let startDoc = await model
    .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
    .sort({ [sortFieldName]: 1 })
    .skip(start)
    .exec();
  let midDoc;
  let endDoc = await model
    .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
    .sort({ [sortFieldName]: 1 })
    .skip(end)
    .exec();
  let startValue;
  let midValue;
  let endValue;

  while (start <= end) {
    const mid = Math.ceil((start + end) / 2);
    midDoc = await model
      .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
      .sort({ [sortFieldName]: 1 })
      .skip(mid)
      .exec();

    startValue = startDoc[fieldName] || '';
    midValue = midDoc[fieldName] || '';
    endValue = endDoc[fieldName] || '';
    startValue = ignoreCases ? startValue.toLowerCase() : startValue;
    midValue = ignoreCases ? midValue.toLowerCase() : midValue;
    endValue = ignoreCases ? endValue.toLowerCase() : endValue;

    if (fieldValue < midValue) {
      end = mid - 1;
      if (end <= 0) {
        break;
      }
      endDoc = await model
        .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
        .sort({ [sortFieldName]: 1 })
        .skip(end)
        .exec();
    } else if (midValue <= fieldValue) {
      start = mid + 1;
      if (start === n) {
        break;
      }
      startDoc = await model
        .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
        .sort({ [sortFieldName]: 1 })
        .skip(start)
        .exec();
    }
  }

  if (start === 0) {
    return {
      predecessorSortId: null,
      successorSortId: startDoc[sortFieldName],
    };
  }

  if (start === n) {
    startDoc = await model
      .findOne({ [sortFieldName]: { $ne: null } }, { [sortFieldName]: 1 })
      .sort({ [sortFieldName]: 1 })
      .skip(start - 1)
      .exec();
    return {
      predecessorSortId: startDoc[sortFieldName],
      successorSortId: null,
    };
  }

  if (start === end) {
    endDoc = await model
      .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
      .sort({ [sortFieldName]: 1 })
      .skip(start - 1)
      .exec();
  }

  return {
    predecessorSortId: endDoc[sortFieldName],
    successorSortId: startDoc[sortFieldName],
  };
}

function getAverageSortId(predecessorSortId, successorSortId, noOfCharsToIncreaseOnSaturation) {
  if (!predecessorSortId) {
    predecessorSortId = "".padEnd(successorSortId.length, "\0");
  }

  if (!successorSortId) {
    successorSortId = "".padEnd(predecessorSortId.length, "\uffff");
  }

  let predecessorNumber;
  let successorNumber;

  if (predecessorSortId.length === successorSortId.length) {
    predecessorNumber = new Base2N(predecessorSortId);
    successorNumber = new Base2N(successorSortId);
    const averageNumber = predecessorNumber.average(successorNumber);
    if (averageNumber.toString() != predecessorNumber.toString()) {
      return averageNumber.toString();
    }
    predecessorNumber = new Base2N(predecessorSortId.padEnd(averageNumber.length + noOfCharsToIncreaseOnSaturation, "\0"));
    successorNumber = new Base2N(successorSortId.padEnd(averageNumber.length + noOfCharsToIncreaseOnSaturation, "\0"));
    return predecessorNumber.average(successorNumber).toString();
  }

  const bigger = predecessorSortId.length > successorSortId.length ? predecessorSortId : successorSortId;
  const smaller = successorSortId.length > predecessorSortId.length ? predecessorSortId : successorSortId;

  const biggerNumber = new Base2N(bigger);
  const smallerNumber = new Base2N(smaller.padEnd(bigger.length, "\0"));

  return biggerNumber.average(smallerNumber).toString();
}

async function updateSortFieldsForDocument({
  objectId,
  model,
  fieldName,
  fieldValue,
  sortFieldName,
  ignoreCases,
  noOfCharsForSortId,
  noOfCharsToIncreaseOnSaturation,
}) {
  if (!model.schema.options.sortEncryptedFieldsOptions.silent)
    console.time(`mongoose-sort-encrypted-field -> updateSortFieldsForDocument() -> objectId: ${objectId}, timeTaken: `);
  const { predecessorSortId, successorSortId } = await documentsBinarySearch(model, fieldName, fieldValue, sortFieldName, ignoreCases, noOfCharsForSortId);
  const newSortId = getAverageSortId(predecessorSortId, successorSortId, noOfCharsToIncreaseOnSaturation);
  await model.updateOne({ _id: objectId }, { $set: { [sortFieldName]: newSortId.toString() } });
  const documentsCountWithSameSortId = await model
    .find({ [sortFieldName]: newSortId.toString() })
    .count()
    .exec();
  if (documentsCountWithSameSortId > 1) {
    if (!model.schema.options.sortEncryptedFieldsOptions.silent)
      console.log(`mongoose-sort-encrypted-field -> Got collions, retrying... objectId: ${objectId}`);
    // Retrigering sortId generation due to collion
    throw `mongoose-sort-encrypted-field -> Got collions, retrying... objectId: ${objectId}`;
  }
  if (!model.schema.options.sortEncryptedFieldsOptions.silent)
    console.timeEnd(`mongoose-sort-encrypted-field -> updateSortFieldsForDocument() -> objectId: ${objectId}, timeTaken: `);
}

async function generateSortIdForAllDocuments({ model, fieldName, sortFieldName, ignoreCases, noOfCharsForSortId }) {
  if (!model.schema.options.sortEncryptedFieldsOptions.silent)
    console.time(
      `mongoose-sort-encrypted-field -> generateSortIdForAllDocuments() -> fieldName: ${fieldName}, sortFieldName: ${sortFieldName}, timeTaken: `
    );
  const documents = await model.find({}, { [fieldName]: 1 }).exec();
  documents.sort((a, b) => {
    let aValue = a[fieldName] || '';
    let bValue = b[fieldName] || '';
    aValue = ignoreCases ? aValue.toLowerCase() : aValue;
    bValue = ignoreCases ? bValue.toLowerCase() : bValue;
    return aValue.localeCompare(bValue);
  });
  const n = documents.length;
  const log2n = Math.round(Math.log2(n)) + 1;
  let diff = new Base2N("".padEnd(noOfCharsForSortId, "\uffff"));
  for (let i = 0; i < log2n; i++) {
    diff = diff.half();
  }
  let curr = new Base2N("\0", noOfCharsForSortId);
  curr = curr.add(diff);
  for (let i = 0; i < n; i += 1) {
    await model.updateOne({ _id: documents[i]._id }, { $set: { [sortFieldName]: curr.toString() } });
    curr = curr.add(diff);
  }
  if (!model.schema.options.sortEncryptedFieldsOptions.silent)
    console.timeEnd(
      `mongoose-sort-encrypted-field -> generateSortIdForAllDocuments() -> fieldName: ${fieldName}, sortFieldName: ${sortFieldName}, timeTaken: `
    );
}

export { updateSortFieldsForDocument, generateSortIdForAllDocuments };
